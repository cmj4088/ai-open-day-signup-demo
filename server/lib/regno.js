/* =========================================================
 * 纯函数 · 报名编号 lib/regno.js
 * AI 应用教学开放日报名系统（v0.3 分层重构）
 * 职责：由「当日已有编号中的最大值」推导下一个报名编号
 *       （原 server/regno.js 的 SQL 部分已上移到 repositories，本文件只留纯计算）
 * 约束：零 IO；生成规则与 v0.2 逐字符一致（Q4 向后兼容）
 * 边界（R9 显式固定）：流水为 4 位补零，单日超过 9999 条时序号自然进位为 5 位，
 *                      编号形如 REG2026100610000，不再是一条脏数据而是合法值
 * ========================================================= */
'use strict';

const { pad, todayStamp } = require('./datetime');

// 编号前缀（除日期外固定部分）
const REG_PREFIX = 'REG';

// 当日编号前缀：REG + YYYYMMDD
function regNoPrefix(date) {
  return REG_PREFIX + todayStamp(date);
}

// 由当日最大编号推导下一个编号（纯函数）
// 参数：prefix 为当日前缀，maxRegNo 为当日已有编号中的字典序最大值（可为 null）
// 说明：编号定长且流水在尾部，故字典序即流水序；取不到时从 0001 起
function nextRegNoFrom(prefix, maxRegNo) {
  let seq = 1;
  if (typeof maxRegNo === 'string' && maxRegNo.indexOf(prefix) === 0) {
    const tail = parseInt(maxRegNo.slice(prefix.length), 10);
    if (!isNaN(tail)) {
      seq = tail + 1;
    }
  }
  return prefix + pad(seq, 4);
}

module.exports = { REG_PREFIX, regNoPrefix, nextRegNoFrom };
