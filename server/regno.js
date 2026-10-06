/* =========================================================
 * 报名编号生成 regno.js
 * AI 应用教学开放日报名系统（v0.2 前后端分离）
 * 职责：生成形如 REG + YYYYMMDD + 4 位当日流水的报名编号
 * 约束：CommonJS；依赖调用方传入的 db（better-sqlite3 同步 API）
 * 说明：本进程内 SQLite 操作为同步串行，生成 + 插入之间不会并发交错，
 *       故「查询当日最大流水 + 1」即可保证当日内唯一（reg_no 另有 UNIQUE 兜底）
 * ========================================================= */
'use strict';

// 编号前缀（除日期外固定部分）
const REG_PREFIX = 'REG';

// 补零到指定宽度，如 1 → '0001'
function pad(n, width) {
  return String(n).padStart(width, '0');
}

// 取本地日期字符串 YYYYMMDD（按服务器本地时区，符合"当日流水"的业务语义）
function todayStamp(now) {
  return '' + now.getFullYear() + pad(now.getMonth() + 1, 2) + pad(now.getDate(), 2);
}

// 生成下一个报名编号：REG + YYYYMMDD + 4 位流水
function nextRegNo(db, now) {
  const date = now || new Date();
  const prefix = REG_PREFIX + todayStamp(date);

  // 取当日已有编号中的最大一条（编号定长且流水在尾部，字典序即流水序）
  const row = db.prepare(
    'SELECT reg_no FROM registrations WHERE reg_no LIKE ? ORDER BY reg_no DESC LIMIT 1'
  ).get(prefix + '%');

  let seq = 1;
  if (row && typeof row.reg_no === 'string') {
    const tail = parseInt(row.reg_no.slice(prefix.length), 10);
    if (!isNaN(tail)) {
      seq = tail + 1;
    }
  }
  return prefix + pad(seq, 4);
}

module.exports = { nextRegNo, todayStamp };
