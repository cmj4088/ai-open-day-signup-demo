/* =========================================================
 * 纯函数 · 校验与筛选 lib/validate.js
 * AI 应用教学开放日报名系统（v0.3 分层重构）
 * 职责：参数校验（validateSignup）、筛选条件构造（buildFilters + escapeLike）、
 *       分页参数解析（parsePagination）、字典标签映射
 * 约束：零 IO；规则与 v0.2 完全一致（Q4 向后兼容），仅新增可选分页参数
 * ========================================================= */
'use strict';

const config = require('../config');

// 场次 / 身份键集合：白名单校验用，集中构造避免各层重复推导
const SESSION_KEYS = config.SESSIONS.map(function (s) { return s.key; });
const ROLE_KEYS = config.ROLES.map(function (r) { return r.key; });

// 场次 / 身份键 → 展示文案（CSV 导出用），只构造一次
const SESSION_LABELS = {};
config.SESSIONS.forEach(function (s) { SESSION_LABELS[s.key] = s.label; });
const ROLE_LABELS = {};
config.ROLES.forEach(function (r) { ROLE_LABELS[r.key] = r.label; });

// 分页单页上限：既有管理端一次拉全量的习惯不变，这里只防「一次拉几十万行」
const MAX_LIMIT = 1000;

// 字符串安全取值并去首尾空格（null / undefined 统一归为空串）
function toTrimmedStr(value) {
  return (value == null ? '' : String(value)).trim();
}

// 提交报名参数校验：仅 姓名 / 手机号 / 场次 必填，身份、院系可空
// 返回 { error: 文案 } 或 { value: 规整后的字段 }
function validateSignup(body) {
  const name = toTrimmedStr(body.name);
  const role = toTrimmedStr(body.role);
  const department = toTrimmedStr(body.department);
  const phone = toTrimmedStr(body.phone);
  const session = toTrimmedStr(body.session);

  if (name === '') {
    return { error: '请填写姓名哦' };
  }
  if (name.length > config.FIELD_LIMITS.name) {
    return { error: '姓名太长啦，最多 ' + config.FIELD_LIMITS.name + ' 个字' };
  }
  if (!config.PHONE_REGEX.test(phone)) {
    return { error: '请填写正确的 11 位手机号哦' };
  }
  if (SESSION_KEYS.indexOf(session) === -1) {
    return { error: '请选择参加场次哦' };
  }
  // 身份为可选项：留空合法，填写则必须在字典内
  if (role !== '' && ROLE_KEYS.indexOf(role) === -1) {
    return { error: '身份取值不合法' };
  }
  if (department.length > config.FIELD_LIMITS.department) {
    return { error: '院系名称太长啦，最多 ' + config.FIELD_LIMITS.department + ' 个字' };
  }

  return { value: { name: name, role: role, department: department, phone: phone, session: session } };
}

// LIKE 通配符转义：避免用户输入 % / _ / \ 被当作通配匹配
function escapeLike(str) {
  return str.replace(/[\\%_]/g, function (m) { return '\\' + m; });
}

// 依据查询参数构造 WHERE 片段（role / session / keyword 三条件 AND，空则忽略）
// 返回 { whereSql, params }；whereSql 为空串表示不带筛选
function buildFilters(query) {
  const role = toTrimmedStr(query.role);
  const session = toTrimmedStr(query.session);
  const keyword = toTrimmedStr(query.keyword);

  const where = [];
  const params = [];

  if (role !== '') {
    where.push('role = ?');
    params.push(role);
  }
  if (session !== '') {
    where.push('session = ?');
    params.push(session);
  }
  if (keyword !== '') {
    // 关键字命中范围：姓名 + 手机号 + 院系（包含匹配，ESCAPE 处理通配符）
    where.push("(name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR department LIKE ? ESCAPE '\\')");
    const like = '%' + escapeLike(keyword) + '%';
    params.push(like, like, like);
  }

  return {
    whereSql: where.length > 0 ? ' WHERE ' + where.join(' AND ') : '',
    params: params
  };
}

// 分页参数解析（R3）
// 语义：limit / offset 都不传 → 返回 null（表示全量，与 v0.2 行为逐字节一致）
//       任一传入 → 返回 { limit, offset }；非法值按「未传」处理并夹紧到合法区间
// 刻意不报错：避免给既有调用方引入新的失败分支（Q4）
function parsePagination(query) {
  const hasLimit = query.limit !== undefined && query.limit !== '';
  const hasOffset = query.offset !== undefined && query.offset !== '';

  if (!hasLimit && !hasOffset) {
    return null;
  }

  const rawLimit = parseInt(query.limit, 10);
  const rawOffset = parseInt(query.offset, 10);

  // 未给 limit 或给了非法 limit 时，默认取单页上限（而非全量，避免误用分页却拉全表）
  let limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : MAX_LIMIT;
  if (limit > MAX_LIMIT) {
    limit = MAX_LIMIT;
  }

  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  return { limit: limit, offset: offset };
}

module.exports = {
  MAX_LIMIT,
  SESSION_KEYS,
  ROLE_KEYS,
  SESSION_LABELS,
  ROLE_LABELS,
  toTrimmedStr,
  validateSignup,
  escapeLike,
  buildFilters,
  parsePagination
};
