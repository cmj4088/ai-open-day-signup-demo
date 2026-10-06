/* =========================================================
 * 纯函数 · 统一响应 lib/response.js
 * AI 应用教学开放日报名系统（v0.3 分层重构）
 * 职责：把「HTTP 状态 + 业务码 + 文案 + 数据」组装成统一响应体
 *       { code, message, data }——对外契约，任何层都不得绕过本函数直写响应
 * 约束：零 IO（只调用传入的 res），可被单测用桩对象覆盖
 * ========================================================= */
'use strict';

// 统一响应：{ code, message, data }
// 参数顺序刻意保持与调用点一致（httpStatus 在前，语义更直观）
function send(res, httpStatus, code, message, data) {
  return res.status(httpStatus).json({ code: code, message: message, data: data });
}

module.exports = { send };
