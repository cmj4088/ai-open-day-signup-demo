/* =========================================================
 * 压测编排 scripts/stress/runner.js
 * AI 应用教学开放日报名系统 · 压测脚本（O1 / O2 数据来源）
 * 职责：按 PRD 第四章顺序编排 S1–S10，逐个场景跑 autocannon，
 *       采集吞吐 / 延迟 / 正确性指标，做 S2 唯一性核验，最后落盘 JSON
 * 用法：
 *   node scripts/stress/runner.js --label baseline
 *   node scripts/stress/runner.js --label retest --only s1,s2,s5
 *   node scripts/stress/runner.js --label hook --only s10
 *   SUT_URL=http://<SUT>:3100 node scripts/stress/runner.js --label baseline
 * 约束：CommonJS；只依赖 autocannon（devDependency）与 Node 内置能力
 * ========================================================= */
'use strict';

const lib = require('./lib');
const { SCENARIOS, runAutocannon } = require('./scenarios');
const { seedTo } = require('./seed');

// ---------- 命令行参数解析 ----------
function parseArgs(argv) {
  const args = { label: 'run', only: null, out: null, seed: true };
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    // 同时支持 `--label=x` 与 `--label x` 两种写法（后者更符合直觉，易被误用）
    if (token.indexOf('--label=') === 0) {
      args.label = token.slice(8);
    } else if (token === '--label') {
      args.label = argv[++i];
    } else if (token.indexOf('--only=') === 0) {
      args.only = token.slice(7).split(',').map(function (s) { return s.trim().toUpperCase(); });
    } else if (token === '--only') {
      args.only = String(argv[++i]).split(',').map(function (s) { return s.trim().toUpperCase(); });
    } else if (token.indexOf('--out=') === 0) {
      args.out = token.slice(6);
    } else if (token === '--out') {
      args.out = argv[++i];
    } else if (token === '--no-seed') {
      args.seed = false;
    }
  }
  return args;
}

// 脱敏后的目标地址占位符（AC9：报告中不得出现内网 IP / 主机名）
const SUT_PLACEHOLDER = 'http://<SUT>:3100';

// 构造场景执行上下文：号池游标 + 查询命中号段 + 未命中号段
function buildContext() {
  return {
    // 游标从 100000 起，与造数据段 [0, 50000) 完全错开，避免相互撞号
    cursor: 100000,
    // 预留一段手机号并返回起始下标
    take: function (n) {
      const start = this.cursor;
      this.cursor += n;
      return start;
    },
    // 预留单个手机号
    takeSingle: function () {
      const start = this.cursor;
      this.cursor += 1;
      return start;
    },
    // 写入号段游标：起始 2000000，与造数据段 [0,50000)、查询命中段 [0,5000)、
    // 未命中段 [5000000, ...) 全部错开，且逐请求自增，任意时长下都不可能撞号
    writeIndex: 2000000,
    // 取出下一个唯一的写入手机号序号（由各写场景的 setupRequest 逐请求调用）
    writePhone: function () {
      const i = this.writeIndex;
      this.writeIndex += 1;
      return i;
    },
    // 查询命中号段：造数据写入了 [0, 50000)，故取前 5000 个作为必然命中的样本
    hitPhones: lib.makePhones(5000, 0),
    // 未命中号段：远离任何已用号段
    missPhoneStart: 5000000,
    s2Phone: null
  };
}

// 执行单个场景的所有并发档位
async function runScenario(id, ctx) {
  const def = SCENARIOS[id];
  if (!def) {
    throw new Error('未知场景：' + id);
  }
  console.log('\n>> ' + def.id + ' ' + def.title);
  const levels = [];
  for (const level of def.levels) {
    const opts = def.build(level, ctx);
    const started = Date.now();
    let summary;
    try {
      const raw = await runAutocannon(opts);
      summary = lib.summarize(raw, { level: levelLabel(level), wallSec: lib.round2((Date.now() - started) / 1000) });
    } catch (err) {
      summary = lib.summarize(null, { level: levelLabel(level), ok: false, error: err.message });
    }
    lib.printScenario(id + '@' + levelLabel(level), summary);
    levels.push(summary);
  }
  return { id: def.id, title: def.title, levels: levels };
}

// 档位标签：并发数 + 时长（或定量）
function levelLabel(level) {
  if (level.amount) {
    return 'c' + level.conc + 'x' + level.amount;
  }
  return 'c' + level.conc + 'x' + level.duration + 's';
}

// S2 唯一性核验（走 API 自查，无需登录副机，避免在报告中泄漏连接方式）
async function verifyS2(phone) {
  const res = await lib.getJson(lib.SUT_URL + '/api/registrations?keyword=' + encodeURIComponent(phone));
  const rows = res.body && Array.isArray(res.body.data) ? res.body.data : [];
  const passed = rows.length === 1;
  console.log('  [verify] S2 唯一性核验：该手机号在库中命中 ' + rows.length + ' 行 → ' + (passed ? 'PASS' : 'FAIL'));
  return { phone: phone, rows: rows.length, passed: passed };
}

// 健康检查（同时作为「裸接口」参照系之一）
async function healthCheck() {
  try {
    const res = await lib.getJson(lib.SUT_URL + '/healthz');
    console.log('[runner] 健康检查：' + JSON.stringify(res.body));
    return res.body;
  } catch (err) {
    console.log('[runner] 健康检查失败：' + err.message);
    return null;
  }
}

// 主流程
async function main() {
  const args = parseArgs(process.argv);
  const ctx = buildContext();
  const startedAt = new Date().toISOString();

  console.log('==================================================');
  console.log('压测开始   标签=' + args.label);
  console.log('目标(脱敏) =' + SUT_PLACEHOLDER);
  console.log('==================================================');

  const health = await healthCheck();
  const out = {
    label: args.label,
    sut: SUT_PLACEHOLDER,
    startedAt: startedAt,
    health: health,
    seed: [],
    scenarios: {},
    verifications: {}
  };

  // 场景执行计划：写入在前，读取按数据量档位分三档，最后是混合/长稳
  const plan = [
    { kind: 'scenario', id: 'S1' },
    { kind: 'scenario', id: 'S2' },
    { kind: 'tier', rows: 1000, ids: ['S3', 'S4'] },
    { kind: 'tier', rows: 10000, ids: ['S3', 'S4'] },
    { kind: 'tier', rows: 50000, ids: ['S3', 'S4'] },
    { kind: 'scenario', id: 'S5' },
    { kind: 'scenario', id: 'S6' },
    { kind: 'scenario', id: 'S7' },
    { kind: 'scenario', id: 'S9' }
  ];

  // --only 模式：只跑指定场景（用于 S8 / S10 这类需要特定服务配置的单独验证）
  const onlyMode = Array.isArray(args.only) && args.only.length > 0;

  if (onlyMode) {
    for (const id of args.only) {
      const result = await runScenario(id, ctx);
      out.scenarios[id] = result;
      if (id === 'S2' && ctx.s2Phone) {
        out.verifications.S2 = await verifyS2(ctx.s2Phone);
      }
    }
  } else {
    for (const step of plan) {
      if (step.kind === 'tier') {
        // 数据量档位：先造数据到目标行数，再跑该档位下的读场景
        if (args.seed) {
          const seeded = await seedTo(step.rows, undefined);
          out.seed.push(seeded);
        }
        for (const id of step.ids) {
          const result = await runScenario(id, ctx);
          // 同一场景多档位：把档位信息挂到 levels 上便于报告区分
          for (const lv of result.levels) {
            lv.dataRows = step.rows;
          }
          if (!out.scenarios[id]) {
            out.scenarios[id] = { id: id, title: result.title, levels: [] };
          }
          out.scenarios[id].levels = out.scenarios[id].levels.concat(result.levels);
        }
      } else {
        const result = await runScenario(step.id, ctx);
        out.scenarios[step.id] = result;
        if (step.id === 'S2' && ctx.s2Phone) {
          out.verifications.S2 = await verifyS2(ctx.s2Phone);
        }
      }
    }
  }

  out.finishedAt = new Date().toISOString();
  const fileName = args.out || (args.label + '.json');
  const target = lib.writeResult(fileName, out);
  console.log('\n[runner] 结果已写入：' + target);
  console.log('[runner] 压测结束');
}

main().catch(function (err) {
  console.error('[runner] 压测异常终止：' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
