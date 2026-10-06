/* =========================================================
 * 关键事件 Hook · 注册与编排 hooks/index.js
 * AI 应用教学开放日报名系统（v0.3 新增，R16）
 * 职责：集中创建各 Hook、按注册顺序登记，并向应用层暴露调用入口
 * 说明：目前仅一个 Hook（signupBurstGuard），保留注册表结构是为了
 *       后续新增 Hook 时调用方无需改动——注册顺序即执行顺序（D13/D14）
 * 约束：本文件不依赖 db / service / repo，只做装配
 * ========================================================= */
'use strict';

const { createSignupBurstGuard } = require('./signupBurstGuard');

// 创建 Hook 集合
// overrides 形如 { signupBurstGuard: { threshold: 5 } }，仅用于测试注入
function createHooks(overrides) {
  const opts = overrides || {};

  // 注册表：顺序即执行顺序
  const registry = [];

  const signupBurstGuard = createSignupBurstGuard(opts.signupBurstGuard);
  registry.push(signupBurstGuard);

  return {
    registry: registry,
    // 提交报名前申请许可 / 处理完毕后释放
    signupBurstGuard: signupBurstGuard,
    // 全部 Hook 的状态快照（合并为一个对象，便于日志与排查）
    snapshot: function () {
      const out = {};
      registry.forEach(function (hook) {
        out[hook.name] = hook.snapshot();
      });
      return out;
    }
  };
}

module.exports = { createHooks };
