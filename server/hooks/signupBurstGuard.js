/* =========================================================
 * 关键事件 Hook · 报名突发保护 hooks/signupBurstGuard.js
 * AI 应用教学开放日报名系统（v0.3 新增，R16）
 * 语义（D18）：**在途并发提交数 > 阈值（默认 100）** →
 *   ① 本次及冷却期内所有提交一律拒绝，返回 code=1003 / HTTP 503
 *   ② 进入冷却（默认 60s），冷却期内**不触碰数据库**（零写库）
 *   ③ 触发与恢复各输出一行 JSON 结构化日志到 stdout（D14/D20）
 *   ④ 冷却到期后由下一个到达的请求「惰性恢复」——不使用定时器，避免持有事件循环句柄
 * 定位：这是**业务保护**而非容量上限（N10/K9），与传输层限流分层并存（D13）
 * 约束：不依赖 service / repo；时钟与日志可注入，便于单测
 * ========================================================= */
'use strict';

const config = require('../config');

// 默认日志出口：单行 JSON 写 stdout，便于压测脚本重定向后直接作为证据引用
function defaultLog(event) {
  console.log(JSON.stringify(event));
}

// 创建报名突发保护 Hook
// overrides 可注入：enabled / threshold / cooldownMs / now / log（测试用）
function createSignupBurstGuard(overrides) {
  const opts = Object.assign({
    enabled: config.HOOK_SIGNUP_BURST_ENABLED,
    threshold: config.HOOK_SIGNUP_BURST_THRESHOLD,
    cooldownMs: config.HOOK_SIGNUP_BURST_COOLDOWN_MS,
    now: function () { return Date.now(); },
    log: defaultLog
  }, overrides || {});

  // 运行状态：在途请求数 + 冷却截止时间戳（0 表示未冷却）
  let inFlight = 0;
  let cooldownUntil = 0;

  // 惰性结算冷却：若已到期则清零并记录一次恢复日志
  function settleCooldown(ts) {
    if (cooldownUntil !== 0 && ts >= cooldownUntil) {
      opts.log({
        event: 'signup_burst_guard',
        action: 'recover',
        ts: new Date(ts).toISOString(),
        cooldownMs: opts.cooldownMs
      });
      cooldownUntil = 0;
    }
  }

  return {
    // Hook 名称：供注册表与状态快照使用
    name: 'signupBurstGuard',

    // 申请一个提交许可
    // 返回 { allowed: true } 或 { allowed: false, reason, retryAfterMs }
    tryAcquire: function () {
      // 开关关闭时完全不参与，直接放行（压测需要「Hook 关闭」的对照组，K7）
      if (!opts.enabled) {
        return { allowed: true };
      }

      const ts = opts.now();

      // 1) 先结算冷却；仍在冷却期内 → 直接拒绝
      //    注意：拒绝路径不增加在途计数，也不触发任何数据库操作
      settleCooldown(ts);
      if (cooldownUntil > ts) {
        return { allowed: false, reason: 'cooldown', retryAfterMs: cooldownUntil - ts };
      }

      // 2) 计入在途数后再判断是否越界
      inFlight += 1;
      if (inFlight > opts.threshold) {
        // 越界：撤销本次计数（本次请求不再继续处理），并立即进入冷却
        const observed = inFlight;
        inFlight -= 1;
        cooldownUntil = ts + opts.cooldownMs;

        opts.log({
          event: 'signup_burst_guard',
          action: 'trip',
          ts: new Date(ts).toISOString(),
          inFlight: observed,
          threshold: opts.threshold,
          cooldownMs: opts.cooldownMs
        });

        return { allowed: false, reason: 'tripped', retryAfterMs: opts.cooldownMs };
      }

      // 3) 正常放行：调用方**必须**在 finally 中调用 release()
      return { allowed: true };
    },

    // 释放许可：必须在 finally 中调用，保证异常路径下在途计数不泄漏
    release: function () {
      if (!opts.enabled) {
        return;
      }
      if (inFlight > 0) {
        inFlight -= 1;
      }
    },

    // 当前状态快照（排查 / 健康检查扩展用）
    snapshot: function () {
      const ts = opts.now();
      const cooling = cooldownUntil > ts;
      return {
        enabled: opts.enabled,
        inFlight: inFlight,
        threshold: opts.threshold,
        cooldownMs: opts.cooldownMs,
        cooling: cooling,
        cooldownRemainMs: cooling ? cooldownUntil - ts : 0
      };
    },

    // 重置状态（仅测试使用）
    reset: function () {
      inFlight = 0;
      cooldownUntil = 0;
    }
  };
}

module.exports = { createSignupBurstGuard };
