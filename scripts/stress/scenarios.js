/* =========================================================
 * 压测场景定义 scripts/stress/scenarios.js
 * AI 应用教学开放日报名系统 · 压测脚本（O1）
 * 职责：按 PRD 第四章定义 S1–S10 场景，把每个场景转换为 autocannon 的入参
 *
 * ---- 关键设计（v3，两次踩坑后的定稿）----
 * ① 写入类场景必须保证「每次请求的手机号全局唯一」，否则除首条外全部被 1002 拦截，
 *    测到的是查重分支而非写入能力。
 * ② autocannon 的 setupRequest **不是顶层选项**，而是 **requests 数组内每一项的属性**
 *    （见 node_modules/autocannon/lib/validate.js：只从 opts.requests[i] 上读取），
 *    且**必须 return reqData**；写成顶层选项会被静默忽略 —— 请求会退回默认的
 *    `GET /` 并返回 200，表面上「零错误」，实际一条数据都没写。此坑已实测踩中。
 * ③ 因此本文件统一采用：requests 数组只放 **1 条模板**（混合场景放 1 条模板 + 槽位轮转），
 *    手机号在 setupRequest 中**逐请求实时生成**，号段无上限、无需预分配内存。
 *
 * 约束：CommonJS；参数全部来自 lib/config 与环境变量
 * ========================================================= */
'use strict';

const autocannon = require('autocannon');
const lib = require('./lib');

// 写入请求体的默认字段（与业务必填项一致）
const SIGNUP_TEMPLATE = {
  role: 'student',
  department: '计算机学院',
  session: 'morning'
};

// 写入模板请求（方法/路径/请求头为兜底值，实际由 setupRequest 逐请求覆盖）
function writeTemplate() {
  return {
    method: 'POST',
    path: '/api/registrations',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'template', phone: '19000000000', session: SIGNUP_TEMPLATE.session })
  };
}

// 构造「逐请求唯一手机号」的 setupRequest
// 说明：ctx.writePhone() 全局自增，跨场景不重复（见 runner.buildContext）
function makeWriteSetup(ctx) {
  return function (reqData) {
    const idx = ctx.writePhone();
    reqData.method = 'POST';
    reqData.path = '/api/registrations';
    reqData.headers = { 'Content-Type': 'application/json' };
    reqData.body = JSON.stringify({
      name: '压测用户' + idx,
      role: SIGNUP_TEMPLATE.role,
      department: SIGNUP_TEMPLATE.department,
      phone: lib.phoneAt(idx),
      session: SIGNUP_TEMPLATE.session
    });
    return reqData;
  };
}

// 构造「始终同一手机号」的 setupRequest（S2 唯一性并发正确性专用）
// 关键：刻意固定手机号，用于验证 50 并发下恰好 1 条入库、其余 1002
function makeSamePhoneSetup(phone) {
  const body = JSON.stringify({
    name: '唯一性测试',
    role: SIGNUP_TEMPLATE.role,
    department: SIGNUP_TEMPLATE.department,
    phone: phone,
    session: 'afternoon'
  });
  return function (reqData) {
    reqData.method = 'POST';
    reqData.path = '/api/registrations';
    reqData.headers = { 'Content-Type': 'application/json' };
    reqData.body = body;
    return reqData;
  };
}

// 构造「命中 / 未命中各半」的查询路径数组
// 命中：造数据阶段已写入的真实号段；未命中：远离任何已用号段的号段
function buildLookupPaths(count, hitPhones, missPhoneStart) {
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const hit = i % 2 === 0;
    const phone = hit ? hitPhones[i % hitPhones.length] : lib.phoneAt(missPhoneStart + i);
    out[i] = '/api/registrations/lookup?phone=' + phone;
  }
  return out;
}

// 纯查询场景的 setupRequest：按顺序循环给定路径
function makePathCycler(paths) {
  let n = 0;
  return function (reqData) {
    reqData.method = 'GET';
    reqData.path = paths[n % paths.length];
    n += 1;
    return reqData;
  };
}

// 混合场景的 setupRequest：提交 : 列表 : 查询 = 5 : 4 : 1（D9）
// 说明：以 10 个槽位为一组循环，故配比精确；提交槽位走唯一手机号生成，保证可写库
function makeMixedSetup(ctx, lookupPaths) {
  const write = makeWriteSetup(ctx);
  let n = 0;
  return function (reqData) {
    const slot = n % 10;
    n += 1;
    if (slot < 5) {
      // 槽位 0–4：提交（5/10）
      return write(reqData);
    }
    if (slot < 9) {
      // 槽位 5–8：列表（4/10）
      reqData.method = 'GET';
      reqData.path = '/api/registrations';
      return reqData;
    }
    // 槽位 9：单条查询（1/10）
    reqData.method = 'GET';
    reqData.path = lookupPaths[n % lookupPaths.length];
    return reqData;
  };
}

// 场景定义表
// 每个场景：{ id, title, levels, build(level, ctx) }
// 约定：一律使用 requests[0].setupRequest 逐请求装填（见文件头说明）
const SCENARIOS = {
  // ---------- S1 写入基线 ----------
  S1: {
    id: 'S1',
    title: '写入基线（POST /api/registrations）',
    levels: [
      { conc: 10, duration: 30 },
      { conc: 50, duration: 30 },
      { conc: 100, duration: 30 }
    ],
    build: function (level, ctx) {
      const tpl = writeTemplate();
      tpl.setupRequest = makeWriteSetup(ctx);
      return {
        url: lib.SUT_URL,
        connections: level.conc,
        duration: level.duration,
        requests: [tpl]
      };
    }
  },

  // ---------- S2 唯一性并发正确性（同一手机号并发提交） ----------
  S2: {
    id: 'S2',
    title: '唯一性并发正确性（同一手机号并发提交）',
    levels: [{ conc: 50, amount: 300 }],
    build: function (level, ctx) {
      const phone = lib.phoneAt(ctx.takeSingle());
      ctx.s2Phone = phone;
      const tpl = writeTemplate();
      tpl.setupRequest = makeSamePhoneSetup(phone);
      return {
        url: lib.SUT_URL,
        connections: level.conc,
        amount: level.amount,
        requests: [tpl]
      };
    }
  },

  // ---------- S3 列表读取（三档数据量，由 runner 分层执行） ----------
  S3: {
    id: 'S3',
    title: '列表读取（GET /api/registrations）',
    levels: [{ conc: 50, duration: 30 }],
    build: function (level) {
      return {
        url: lib.SUT_URL + '/api/registrations',
        connections: level.conc,
        duration: level.duration
      };
    }
  },

  // ---------- S4 导出 CSV（并发 10，导出重，过高会先打死客户端） ----------
  S4: {
    id: 'S4',
    title: '导出 CSV（GET /api/registrations/export）',
    levels: [{ conc: 10, duration: 20 }],
    build: function (level) {
      return {
        url: lib.SUT_URL + '/api/registrations/export',
        connections: level.conc,
        duration: level.duration
      };
    }
  },

  // ---------- S5 单条查询（命中/未命中各半） ----------
  S5: {
    id: 'S5',
    title: '单条查询（GET /api/registrations/lookup）',
    levels: [{ conc: 50, duration: 30 }],
    build: function (level, ctx) {
      const paths = buildLookupPaths(2000, ctx.hitPhones, ctx.missPhoneStart);
      return {
        url: lib.SUT_URL,
        connections: level.conc,
        duration: level.duration,
        requests: [{ method: 'GET', path: paths[0], setupRequest: makePathCycler(paths) }]
      };
    }
  },

  // ---------- S6 混合场景（5:4:1，并发 50，60s） ----------
  S6: {
    id: 'S6',
    title: '混合场景（提交:列表:查询 = 5:4:1）',
    levels: [{ conc: 50, duration: 60 }],
    build: function (level, ctx) {
      const lookupPaths = buildLookupPaths(2000, ctx.hitPhones, ctx.missPhoneStart);
      const tpl = writeTemplate();
      tpl.setupRequest = makeMixedSetup(ctx, lookupPaths);
      return {
        url: lib.SUT_URL,
        connections: level.conc,
        duration: level.duration,
        requests: [tpl]
      };
    }
  },

  // ---------- S7 极限爬升（10→800，每级 20s） ----------
  S7: {
    id: 'S7',
    title: '极限爬升（混合场景并发阶梯）',
    levels: [
      { conc: 10, duration: 20 },
      { conc: 50, duration: 20 },
      { conc: 100, duration: 20 },
      { conc: 200, duration: 20 },
      { conc: 400, duration: 20 },
      { conc: 800, duration: 20 }
    ],
    build: function (level, ctx) {
      const lookupPaths = buildLookupPaths(2000, ctx.hitPhones, ctx.missPhoneStart);
      const tpl = writeTemplate();
      tpl.setupRequest = makeMixedSetup(ctx, lookupPaths);
      return {
        url: lib.SUT_URL,
        connections: level.conc,
        duration: level.duration,
        requests: [tpl]
      };
    }
  },

  // ---------- S9 长稳（并发 50 持续 5 分钟，观察 WAL / RSS） ----------
  S9: {
    id: 'S9',
    title: '长稳（并发 50 持续 5 分钟）',
    levels: [{ conc: 50, duration: 300 }],
    build: function (level, ctx) {
      const lookupPaths = buildLookupPaths(2000, ctx.hitPhones, ctx.missPhoneStart);
      const tpl = writeTemplate();
      tpl.setupRequest = makeMixedSetup(ctx, lookupPaths);
      return {
        url: lib.SUT_URL,
        connections: level.conc,
        duration: level.duration,
        requests: [tpl]
      };
    }
  },

  // ---------- S10 Hook 触发与冷却（高并发持续提交） ----------
  S10: {
    id: 'S10',
    title: 'Hook 触发与冷却（高并发持续提交，期望出现 1003）',
    levels: [{ conc: 200, duration: 60 }],
    build: function (level, ctx) {
      const tpl = writeTemplate();
      tpl.setupRequest = makeWriteSetup(ctx);
      return {
        url: lib.SUT_URL,
        connections: level.conc,
        duration: level.duration,
        requests: [tpl]
      };
    }
  },

  // ---------- S8 限流影响确认（对未关闭限流的实例打写入） ----------
  S8: {
    id: 'S8',
    title: '限流影响确认（实例保留默认限流，确认 429 出现阈值）',
    levels: [{ conc: 10, duration: 30 }],
    build: function (level, ctx) {
      const tpl = writeTemplate();
      tpl.setupRequest = makeWriteSetup(ctx);
      return {
        url: lib.SUT_URL,
        connections: level.conc,
        duration: level.duration,
        requests: [tpl]
      };
    }
  }
};

// 执行一次 autocannon 跑测（Promise 化）
function runAutocannon(opts) {
  return new Promise(function (resolve, reject) {
    autocannon(opts, function (err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

module.exports = { SCENARIOS, runAutocannon };
