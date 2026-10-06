/* =========================================================
 * 造数据脚本 scripts/stress/seed.js
 * AI 应用教学开放日报名系统 · 压测脚本（O1）
 * 职责：向被测服务写入指定数量的唯一报名记录，供 S3/S4 的「1k/10k/50k」三档使用
 * 设计：手机号取号池起始段 [0, target)，与压测场景使用的 100000+ 段完全错开；
 *       重复提交会被后端以 1002 拒绝并计入 dup，故本脚本可重复执行（幂等收敛到 target 行）
 * 约束：CommonJS；并发默认 30——低于 Hook 阈值 100，避免造数据阶段被 Hook 拦截
 * ========================================================= */
'use strict';

const lib = require('./lib');

// 默认造数据并发（保持低于 Hook 默认阈值 100）
const DEFAULT_CONCURRENCY = Number(process.env.SEED_CONCURRENCY) || 30;

// 造数据至 target 行：返回 created / dup / failed 统计
async function seedTo(target, concurrency) {
  const conc = concurrency || DEFAULT_CONCURRENCY;
  const phones = lib.makePhones(target, 0);

  let created = 0;
  let dup = 0;
  let failed = 0;

  const started = Date.now();
  const result = await lib.poolRun(phones, conc, async function (phone, i) {
    const r = await lib.postJson(lib.SUT_URL + '/api/registrations', {
      name: '种子用户' + i,
      role: 'student',
      department: '计算机学院',
      phone: phone,
      session: i % 2 === 0 ? 'morning' : 'afternoon'
    });
    const code = r.body ? r.body.code : -1;
    if (code === 0) {
      created += 1;
    } else if (code === 1002) {
      dup += 1;
    } else {
      failed += 1;
    }
  });

  const costSec = lib.round2((Date.now() - started) / 1000);
  console.log('  [seed] 目标 ' + target + ' 行：新建 ' + created + '，已存在 ' + dup +
    '，失败 ' + failed + '，用时 ' + costSec + 's（并发 ' + conc + '）');

  return { target: target, created: created, dup: dup, failed: failed, costSec: costSec, netErrors: result.errors.length };
}

module.exports = { seedTo };
