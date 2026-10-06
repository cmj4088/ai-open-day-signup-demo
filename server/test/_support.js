/* =========================================================
 * 测试支撑 server/test/_support.js
 * AI 应用教学开放日报名系统（v0.3，R12）
 * 职责：为各测试文件提供「隔离的应用实例」与轻量 HTTP 助手
 * 关键约定：
 *   ① 测试一律使用 **内存库**（dbPath=':memory:'）且不做启动备份，
 *      绝不触碰 data/app.db（治理层约定：测试不得污染开发数据）；
 *   ② 端口用 app.listen(0) 由系统随机分配，避免与在跑的服务抢端口；
 *   ③ 限流与请求日志在 **config 被 require 之前** 关闭 —— 故本文件必须在
 *      任何 server 模块之前被 require（各测试文件首行 require 本文件）；
 *   ④ 本文件不含任何测试用例，不产生 import 期副作用（除设置上述环境变量）
 * 约束：CommonJS；仅使用 Node 内置能力（node:test / fetch）
 * ========================================================= */
'use strict';

// 必须先于 ../config 的 require 生效：关闭限流（否则并发用例会被 429 截断）
// 与请求日志（减少测试输出噪音）
process.env.RATE_DISABLED = '1';
process.env.LOG_REQUESTS = '0';

const { initDatabase } = require('../db');
const { createHooks } = require('../hooks');
const { createApp } = require('../app');

// 构造完全隔离的测试应用
// options.hooks 为 Hook 注入项（如 { signupBurstGuard: { threshold: 2 } }）
// 返回 { db, hooks, app }，调用方负责在 after() 中 db.close()
function makeTestApp(options) {
  const opts = options || {};
  const db = initDatabase({ dbPath: ':memory:', backup: false });
  const hooks = createHooks(opts.hooks);
  const app = createApp({ db: db, hooks: hooks });
  return { db: db, hooks: hooks, app: app };
}

// 把应用挂到随机端口，返回 { baseUrl, close }
function listen(app) {
  return new Promise(function (resolve) {
    const server = app.listen(0, '127.0.0.1', function () {
      const addr = server.address();
      resolve({
        baseUrl: 'http://127.0.0.1:' + addr.port,
        close: function () {
          return new Promise(function (done) {
            server.close(function () { done(); });
          });
        }
      });
    });
  });
}

// 极简请求助手：返回 { status, body(JSON 或 null), text, headers }
// 说明：export 接口返回的是 CSV 文本，故同时保留 text 与 headers 供断言
async function req(baseUrl, method, path, body) {
  const init = { method: method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(baseUrl + path, init);
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, text: text, headers: res.headers };
}

// 构造一条合法的报名请求体（可按需局部覆盖）
function signupBody(overrides) {
  return Object.assign({
    name: '测试用户',
    role: 'student',
    department: '计算机学院',
    phone: '19900000001',
    session: 'morning'
  }, overrides || {});
}

module.exports = { makeTestApp, listen, req, signupBody };
