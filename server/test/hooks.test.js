/* =========================================================
 * 测试 · 关键事件 Hook server/test/hooks.test.js（R16）
 * 被测：hooks/signupBurstGuard.js 的 createSignupBurstGuard(overrides)
 * 覆盖：开关短路 / 阈值判定 / 触发日志 / 冷却拒绝 / 惰性恢复 /
 *       release 归还 / snapshot 快照 / reset 重置
 * 说明：本 Hook 依赖时间与日志两个副作用，故一律**注入假时钟与日志收集器**，
 *       既保证确定性（不 sleep），又能精确断言「恰好一条日志」与字段内容。
 * ========================================================= */
'use strict';

// 先引入测试支撑（关闭限流与请求日志，须早于 config 生效）
require('./_support');

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSignupBurstGuard } = require('../hooks/signupBurstGuard');

// 可控假时钟：now() 返回毫秒时间戳，set/advance 用于模拟时间流逝
// 用它替代真实等待，测试才能既稳定又秒级完成
function makeClock(start) {
  let t = start;
  return {
    now: function () { return t; },
    set: function (v) { t = v; },
    advance: function (ms) { t += ms; }
  };
}

// 收集结构化日志，返回 { log, entries }
function makeLogger() {
  const entries = [];
  return {
    entries: entries,
    log: function (event) { entries.push(event); }
  };
}

// ---------- 开关关闭时完全短路 ----------

test('enabled:false：tryAcquire 恒放行，不计数、不写日志', function () {
  const clock = makeClock(1000);
  const logger = makeLogger();
  const guard = createSignupBurstGuard({
    enabled: false, threshold: 0, cooldownMs: 500, now: clock.now, log: logger.log
  });

  // 阈值即使为 0，关闭态下也必须无条件放行（压测对照组依赖此行为）
  assert.deepStrictEqual(guard.tryAcquire(), { allowed: true });
  assert.deepStrictEqual(guard.tryAcquire(), { allowed: true });
  assert.strictEqual(logger.entries.length, 0);
});

// ---------- 阈值判定与触发日志 ----------

test('阈值内放行；超过阈值返回 tripped，并恰好写出一条结构化 trip 日志', function () {
  const clock = makeClock(1000);
  const logger = makeLogger();
  const guard = createSignupBurstGuard({
    enabled: true, threshold: 2, cooldownMs: 500, now: clock.now, log: logger.log
  });

  // 阈值 2：前两次在途均放行
  assert.deepStrictEqual(guard.tryAcquire(), { allowed: true });
  assert.deepStrictEqual(guard.tryAcquire(), { allowed: true });

  // 第三次在途数达 3 > 2 → 触发保护
  const tripped = guard.tryAcquire();
  assert.strictEqual(tripped.allowed, false);
  assert.strictEqual(tripped.reason, 'tripped');

  // 必须「恰好」一条日志：既不能漏记，也不能重复刷屏
  assert.strictEqual(logger.entries.length, 1);
  const e = logger.entries[0];
  assert.strictEqual(e.event, 'signup_burst_guard');
  assert.strictEqual(e.action, 'trip');
  assert.strictEqual(e.inFlight, 3);
  assert.strictEqual(e.threshold, 2);
  assert.strictEqual(e.cooldownMs, 500);
});

// ---------- 冷却期内拒绝 ----------

test('触发后进入冷却：冷却期内返回 cooldown，retryAfterMs > 0', function () {
  const clock = makeClock(5000);
  const logger = makeLogger();
  const guard = createSignupBurstGuard({
    enabled: true, threshold: 1, cooldownMs: 60000, now: clock.now, log: logger.log
  });

  assert.deepStrictEqual(guard.tryAcquire(), { allowed: true });
  assert.strictEqual(guard.tryAcquire().reason, 'tripped'); // 第二次在途 2 > 1 → 触发并进入冷却

  // 冷却期内（时钟未推进）任何提交都应被拒，且不写 trip 日志（仅触发那一次）
  const cooling = guard.tryAcquire();
  assert.strictEqual(cooling.allowed, false);
  assert.strictEqual(cooling.reason, 'cooldown');
  assert.ok(cooling.retryAfterMs > 0, '冷却拒绝必须给出正的重试等待时长');
  assert.strictEqual(logger.entries.length, 1);
});

// ---------- 冷却到期惰性恢复 ----------

test('假时钟推进超过 cooldownMs 后惰性恢复：下一请求放行并写 recover 日志', function () {
  const clock = makeClock(0);
  const logger = makeLogger();
  const guard = createSignupBurstGuard({
    enabled: true, threshold: 1, cooldownMs: 1000, now: clock.now, log: logger.log
  });

  assert.deepStrictEqual(guard.tryAcquire(), { allowed: true }); // 在途 1，放行
  assert.strictEqual(guard.tryAcquire().reason, 'tripped');       // 在途 2 > 1 → 触发，冷却至 1000
  guard.release();                                               // 让首个在途请求离场，避免恢复后立刻再次触顶

  // 推进到冷却截止时刻（>= cooldownUntil）→ 应惰性恢复
  clock.set(1000);
  assert.deepStrictEqual(guard.tryAcquire(), { allowed: true });
  // 日志序列必须是「先 trip 后 recover」，恢复只记一次
  assert.deepStrictEqual(logger.entries.map(function (e) { return e.action; }), ['trip', 'recover']);
  assert.strictEqual(logger.entries[1].event, 'signup_burst_guard');
});

// ---------- release 归还计数 ----------

test('release：归还并发计数，阈值 1 下串行的两次请求都能通过', function () {
  const clock = makeClock(0);
  const guard = createSignupBurstGuard({
    enabled: true, threshold: 1, cooldownMs: 1000, now: clock.now, log: function () {}
  });

  // 串行：第一次申请→释放→第二次申请，两次都在阈值内，证明 release 确实把计数降了回去
  assert.deepStrictEqual(guard.tryAcquire(), { allowed: true });
  guard.release();
  assert.deepStrictEqual(guard.tryAcquire(), { allowed: true });
});

// ---------- snapshot 快照 ----------

test('snapshot：反映 enabled / 在途数 / 阈值 / 冷却状态与剩余时长', function () {
  const clock = makeClock(0);
  const guard = createSignupBurstGuard({
    enabled: true, threshold: 1, cooldownMs: 1000, now: clock.now, log: function () {}
  });

  assert.deepStrictEqual(guard.snapshot(), {
    enabled: true, inFlight: 0, threshold: 1, cooldownMs: 1000, cooling: false, cooldownRemainMs: 0
  });

  guard.tryAcquire();                    // 在途 1
  assert.strictEqual(guard.snapshot().inFlight, 1);
  guard.tryAcquire();                    // 触发，冷却至 1000；在途回落到 1

  const snap = guard.snapshot();
  assert.strictEqual(snap.inFlight, 1);
  assert.strictEqual(snap.cooling, true);
  assert.strictEqual(snap.cooldownRemainMs, 1000); // ts=0，剩余即为整个冷却时长
});

// ---------- reset 重置 ----------

test('reset：清零冷却与在途计数，恢复到初始快照', function () {
  const clock = makeClock(0);
  const guard = createSignupBurstGuard({
    enabled: true, threshold: 1, cooldownMs: 1000, now: clock.now, log: function () {}
  });

  guard.tryAcquire();
  guard.tryAcquire();                    // 触发冷却
  assert.strictEqual(guard.snapshot().cooling, true);

  guard.reset();
  assert.deepStrictEqual(guard.snapshot(), {
    enabled: true, inFlight: 0, threshold: 1, cooldownMs: 1000, cooling: false, cooldownRemainMs: 0
  });
});
