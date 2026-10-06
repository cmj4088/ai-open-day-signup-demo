/* =========================================================
 * 纯函数 · CSV 拼装 lib/csv.js
 * AI 应用教学开放日报名系统（v0.3 分层重构）
 * 职责：表头常量、单元格转义、单行格式化、BOM / CRLF 常量
 * 约束：零 IO；表头顺序与 BOM / CRLF 均属对外契约，重构前后必须逐字节一致（R4）
 * ========================================================= */
'use strict';

const { formatDateTime } = require('./datetime');

// CSV 表头（顺序固定，与 v0.2 一致，属对外契约，不得调整）
const CSV_HEADERS = ['报名编号', '报名时间', '姓名', '身份', '院系', '手机号', '参加场次'];

// UTF-8 BOM：让 Excel 正确识别中文编码，缺失会显示乱码
const BOM = '\uFEFF';

// 行尾使用 CRLF，兼容 Excel 与 Windows 记事本
const CRLF = '\r\n';

// 单个 CSV 单元格转义：含逗号 / 引号 / 换行时用双引号包裹，内部引号翻倍
function csvCell(value) {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// 表头行文本（不含 BOM 与行尾）
function headerLine() {
  return CSV_HEADERS.join(',');
}

// 单条记录 → CSV 行文本（不含行尾）
// labels 形如 { role: {key: 中文名}, session: {key: 中文名} }；
// 字典缺失时回退为原始键值，保证不因字典不全而丢列
function rowLine(record, labels) {
  const roleMap = (labels && labels.role) || {};
  const sessionMap = (labels && labels.session) || {};
  const roleLabel = roleMap[record.role] || record.role || '';
  const sessionLabel = sessionMap[record.session] || record.session || '';

  return [
    record.regNo,
    formatDateTime(record.createdAt),
    record.name,
    roleLabel,
    record.department || '',
    record.phone,
    sessionLabel
  ].map(csvCell).join(',');
}

module.exports = { CSV_HEADERS, BOM, CRLF, csvCell, headerLine, rowLine };
