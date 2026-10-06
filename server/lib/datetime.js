/* =========================================================
 * 纯函数 · 日期时间 lib/datetime.js
 * AI 应用教学开放日报名系统（v0.3 分层重构）
 * 职责：提供补零、当日日期戳、ISO → 本地可读时间三件纯函数
 * 约束：零 IO、零外部依赖，可被单测直接覆盖（R12）
 * ========================================================= */
'use strict';

// 补零到指定宽度，如 1 → '0001'
// 说明：padStart 不会截断超长值，故当序号超过 4 位时自然输出更长字符串（R9 边界）
function pad(n, width) {
  return String(n).padStart(width, '0');
}

// 取本地日期字符串 YYYYMMDD（按服务器本地时区，符合「当日流水」的业务语义）
function todayStamp(now) {
  const d = now || new Date();
  return '' + d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2);
}

// 时间格式化：ISO → 'YYYY-MM-DD HH:mm:ss'（本地时区）
// 非法值按原样返回（空值返回空串），保证导出 CSV 不因脏数据整批失败
// 踩坑记录：必须在 new Date 之前判空——new Date(null) / new Date('') 都是**合法时间**
//   （分别等于 1970-01-01 与 epoch 的无效差异），会输出「1970-01-01 08:00:00」这种假数据
function formatDateTime(iso) {
  if (iso === null || iso === undefined || iso === '') {
    return '';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return String(iso);
  }
  return '' + d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2) +
    ' ' + pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2);
}

module.exports = { pad, todayStamp, formatDateTime };
