/* =========================================================
 * 报名路由 routes/registrations.js
 * AI 应用教学开放日报名系统（v0.2 前后端分离）
 * 职责：提交报名 / 按手机号查询 / 名单列表（筛选）/ 导出 CSV
 * 约束：CommonJS；SQL 全部参数化；响应统一 { code, message, data }
 * 说明：服务端承担二次校验（前端校验可被绕过，唯一性以本层为准）
 * ========================================================= */
'use strict';

const express = require('express');

const config = require('../config');
const { nextRegNo, todayStamp } = require('../regno');

// 场次 / 身份键集合，用于服务端白名单校验
const SESSION_KEYS = config.SESSIONS.map(function (s) { return s.key; });
const ROLE_KEYS = config.ROLES.map(function (r) { return r.key; });

// 场次 / 身份键 → 展示文案（用于 CSV 导出）
const SESSION_LABELS = {};
config.SESSIONS.forEach(function (s) { SESSION_LABELS[s.key] = s.label; });
const ROLE_LABELS = {};
config.ROLES.forEach(function (r) { ROLE_LABELS[r.key] = r.label; });

// CSV 表头（顺序固定）
const CSV_HEADERS = ['报名编号', '报名时间', '姓名', '身份', '院系', '手机号', '参加场次'];

// 统一响应：{ code, message, data }
function send(res, httpStatus, code, message, data) {
  return res.status(httpStatus).json({ code: code, message: message, data: data });
}

// 判断是否为 SQLite 唯一约束冲突（信号来自 better-sqlite3 的 error.code）
function isUniqueError(err) {
  return !!(err && typeof err.code === 'string' && err.code.indexOf('SQLITE_CONSTRAINT') === 0);
}

// 数据库行 → API 记录（列名下划线转驼峰，与前端字段保持一致）
function rowToRecord(row) {
  return {
    id: row.id,
    regNo: row.reg_no,
    name: row.name,
    role: row.role || '',
    department: row.department || '',
    phone: row.phone,
    session: row.session,
    createdAt: row.created_at
  };
}

// 字符串安全取值并去首尾空格
function toTrimmedStr(value) {
  return (value == null ? '' : String(value)).trim();
}

// 提交报名参数校验：仅 姓名/手机号/场次 必填，身份/院系可空
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

// LIKE 通配符转义，避免用户输入 % / _ 被当作通配匹配
function escapeLike(str) {
  return str.replace(/[\\%_]/g, function (m) { return '\\' + m; });
}

// 依据查询参数构造 WHERE 片段（role / session / keyword 三条件 AND，空则忽略）
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

// 时间格式化：ISO → 'YYYY-MM-DD HH:mm:ss'（本地时区），非法值返回原串
function formatDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return iso == null ? '' : String(iso);
  }
  const pad = function (n) { return n < 10 ? '0' + n : String(n); };
  return '' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

// 单个 CSV 单元格转义：含逗号/引号/换行时用双引号包裹，内部引号翻倍
function csvCell(value) {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// 组装 CSV 文本：前置 UTF-8 BOM，行尾 CRLF，保证 Excel 打开中文不乱码
function buildCsv(records) {
  const lines = [CSV_HEADERS.join(',')];
  records.forEach(function (r) {
    lines.push([
      r.regNo,
      formatDateTime(r.createdAt),
      r.name,
      ROLE_LABELS[r.role] || r.role || '',
      r.department || '',
      r.phone,
      SESSION_LABELS[r.session] || r.session || ''
    ].map(csvCell).join(','));
  });
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

// 创建路由（注入 db 与事务）
function createRouter(db) {
  const router = express.Router();

  // 预处理语句：按手机号查是否存在 / 按手机号取记录 / 按 id 取记录 / 列表查询
  const selectByPhone = db.prepare('SELECT * FROM registrations WHERE phone = ?');
  const selectById = db.prepare('SELECT * FROM registrations WHERE id = ?');
  const insertStmt = db.prepare(
    'INSERT INTO registrations (reg_no, name, role, department, phone, session, created_at) ' +
    'VALUES (@reg_no, @name, @role, @department, @phone, @session, @created_at)'
  );

  // 事务：生成编号 + 插入 + 回读完整记录（同步串行，保证编号与写入一致）
  const insertTx = db.transaction(function (rec) {
    const regNo = nextRegNo(db);
    const createdAt = new Date().toISOString();
    const info = insertStmt.run({
      reg_no: regNo,
      name: rec.name,
      role: rec.role,
      department: rec.department,
      phone: rec.phone,
      session: rec.session,
      created_at: createdAt
    });
    return selectById.get(info.lastInsertRowid);
  });

  // ---------- 提交报名 ----------
  router.post('/', function (req, res, next) {
    try {
      const checked = validateSignup(req.body || {});
      if (checked.error) {
        return send(res, 400, config.CODES.INVALID, checked.error, null);
      }
      const value = checked.value;

      // 预检手机号：命中直接返回 1002（友好提示，避免依赖约束报错）
      const existing = selectByPhone.get(value.phone);
      if (existing) {
        return send(res, 409, config.CODES.DUPLICATE, '该手机号已报名，请勿重复提交', null);
      }

      const row = insertTx(value);
      return send(res, 200, config.CODES.OK, '报名成功', rowToRecord(row));
    } catch (err) {
      // 并发兜底：唯一索引冲突同样按重复处理
      if (isUniqueError(err)) {
        return send(res, 409, config.CODES.DUPLICATE, '该手机号已报名，请勿重复提交', null);
      }
      return next(err);
    }
  });

  // ---------- 按手机号查询 ----------
  router.get('/lookup', function (req, res, next) {
    try {
      const phone = toTrimmedStr(req.query.phone);
      if (!config.PHONE_REGEX.test(phone)) {
        return send(res, 400, config.CODES.INVALID, '请填写正确的 11 位手机号哦', null);
      }
      const row = selectByPhone.get(phone);
      return send(res, 200, config.CODES.OK, row ? '查询成功' : '暂未查到报名记录哦', row ? rowToRecord(row) : null);
    } catch (err) {
      return next(err);
    }
  });

  // ---------- 导出 CSV（必须声明在通用列表路由之前更直观；此处路径独立无冲突） ----------
  router.get('/export', function (req, res, next) {
    try {
      const filters = buildFilters(req.query);
      const rows = db.prepare(
        'SELECT * FROM registrations' + filters.whereSql + ' ORDER BY created_at DESC, id DESC'
      ).all(...filters.params);

      const csv = buildCsv(rows.map(rowToRecord));
      const stamp = todayStamp(new Date());
      const asciiName = 'registrations-' + stamp + '.csv';
      const cnName = '报名名单-' + stamp + '.csv';

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      // 同时给出 ASCII 与其 UTF-8 编码名，兼容各浏览器下载表现
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="' + asciiName + '"; filename*=UTF-8\'\'' + encodeURIComponent(cnName)
      );
      return res.send(csv);
    } catch (err) {
      return next(err);
    }
  });

  // ---------- 名单列表（筛选） ----------
  router.get('/', function (req, res, next) {
    try {
      const filters = buildFilters(req.query);
      const rows = db.prepare(
        'SELECT * FROM registrations' + filters.whereSql + ' ORDER BY created_at DESC, id DESC'
      ).all(...filters.params);
      return send(res, 200, config.CODES.OK, '查询成功', rows.map(rowToRecord));
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { createRouter };
