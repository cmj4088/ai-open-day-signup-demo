/* =========================================================
 * 压测公共库 scripts/stress/lib.js
 * AI 应用教学开放日报名系统 · 压测脚本（O1）
 * 职责：提供压测所需的基础设施——
 *       1) 目标地址与场景参数（全部可用环境变量覆盖）
 *       2) 唯一手机号池（写入场景必须保证手机号不重复，否则会被 1002 拦截而失真）
 *       3) 基于全局 fetch 的轻量请求助手与并发池（用于造数据）
 *       4) 结果摘要打印与 JSON 落盘（脱敏后）
 * 约束：CommonJS；仅依赖 Node 内置能力 + autocannon（devDependency）
 * ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

// ---------- 目标与通用参数 ----------
// SUT_URL：被测服务地址；默认指向副机 3100 端口（D2/D11），可用环境变量覆盖
const SUT_URL = (process.env.SUT_URL || 'http://127.0.0.1:3100').replace(/\/+$/, '');

// 唯一手机号池的起始偏移：基线/复测/造数据共享同一池且各段错开，避免相互撞号
const PHONE_SEED_BASE = Number(process.env.PHONE_SEED_BASE) || 0;

// 结果文件目录
const RESULTS_DIR = path.join(__dirname, 'results');

// ---------- 手机号池 ----------
// 生成规则：前缀 '19' + 9 位序号 → 共 11 位数字，天然满足 ^\d{11}$ 且全局唯一
// 说明：不做 Luhn 等校验，业务只校验 11 位数字，故此处保持最简
function phoneAt(index) {
  const n = PHONE_SEED_BASE + index;
  return '19' + String(n).padStart(9, '0');
}

// 批量生成互不重复的手机号
function makePhones(count, startIndex) {
  const start = startIndex || 0;
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = phoneAt(start + i);
  }
  return out;
}

// ---------- HTTP 助手（仅用于造数据与单发校验，不做压力来源） ----------
// 发一个 JSON POST，返回 { status, body }；网络异常统一抛出并带上下文
async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

// 发一个 GET，返回 { status, body }
async function getJson(url) {
  const res = await fetch(url);
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

// 并发池：把 items 分片并发执行 fn(item)，用于快速造数据
// 说明：不引入第三方并发库，保持零额外依赖（Q5）
async function poolRun(items, concurrency, worker) {
  let cursor = 0;
  let done = 0;
  const errors = [];

  async function runner() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) {
        return;
      }
      try {
        await worker(items[i], i);
      } catch (err) {
        errors.push({ index: i, message: err && err.message ? err.message : String(err) });
      }
      done += 1;
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(runner());
  }
  await Promise.all(workers);
  return { total: items.length, done: done, errors: errors };
}

// ---------- 结果落盘 ----------
// 确保 results 目录存在
function ensureResultsDir() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

// 写 JSON 结果文件并返回绝对路径
function writeResult(fileName, payload) {
  ensureResultsDir();
  const target = path.join(RESULTS_DIR, fileName);
  fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8');
  return target;
}

// 把 autocannon 原始结果压缩成报告所需的字段（避免落盘无用的大对象）
function summarize(raw, extra) {
  if (!raw) {
    return Object.assign({ ok: false }, extra || {});
  }
  return Object.assign({
    ok: true,
    // 吞吐：请求/秒
    rps: {
      average: raw.requests.average,
      p50: raw.requests.p50,
      p99: raw.requests.p99,
      max: raw.requests.max
    },
    // 延迟：毫秒
    latency: {
      average: round2(raw.latency.average),
      p50: round2(raw.latency.p50),
      p95: round2(raw.latency.p95),
      p99: round2(raw.latency.p99),
      max: round2(raw.latency.max)
    },
    // 正确性
    total: raw.requests.total,
    ok2xx: raw['2xx'],
    non2xx: raw.non2xx,
    errorRate: raw.requests.total > 0 ? round4(raw.non2xx / raw.requests.total) : 0,
    errors: raw.errors,
    timeouts: raw.timeouts,
    statusCodeStats: raw.statusCodeStats || null,
    actualDurationSec: round2(raw.duration),
    throughputBytesAvg: Math.round(raw.throughput.average)
  }, extra || {});
}

// 保留两位小数
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// 保留四位小数（用于比率）
function round4(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

// 控制台打印一行场景摘要
function printScenario(name, s) {
  if (!s || !s.ok) {
    console.log('  [' + name + '] 未执行或失败：' + ((s && s.error) || '未知'));
    return;
  }
  console.log('  [' + name + '] rps=' + s.rps.average +
    ' p50=' + s.latency.p50 + 'ms p95=' + s.latency.p95 + 'ms p99=' + s.latency.p99 + 'ms max=' + s.latency.max + 'ms' +
    ' 非2xx=' + s.non2xx + '(' + (s.errorRate * 100).toFixed(2) + '%)' +
    ' 用时=' + s.actualDurationSec + 's');
}

module.exports = {
  SUT_URL,
  RESULTS_DIR,
  phoneAt,
  makePhones,
  postJson,
  getJson,
  poolRun,
  ensureResultsDir,
  writeResult,
  summarize,
  printScenario,
  round2
};
