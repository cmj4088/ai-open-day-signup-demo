/* =========================================================
 * 服务层 · 报名业务 services/registrationsService.js
 * AI 应用教学开放日报名系统（v0.3 分层重构）
 * 职责：编排业务用例——提交（校验 → 查重 → 事务插入）、按手机号查询、
 *       名单列表（含可选分页）、导出（返回流式迭代器）
 * 约定：所有用例返回「结果描述对象」{ status, code, message, data }，
 *       由路由层原样交给 lib/response.send —— 服务层不直接接触 res
 * 约束：不含 SQL（全部下沉 repositories），不含 HTTP 细节
 * ========================================================= */
'use strict';

const config = require('../config');
const validate = require('../lib/validate');

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

// 判断唯一约束冲突命中了哪一列（信号来自 better-sqlite3 的 error.code 与 message）
// 踩坑记录：v0.2 把所有 SQLITE_CONSTRAINT 一律当「手机号重复」返回 1002，
//   于是 reg_no（报名编号）冲突被伪装成「该手机号已报名」，压测中表现为
//   第 10000 条之后人人「重复报名」，真实故障被完全掩盖。此处改为按列区分。
function uniqueConflictColumn(err) {
  if (!err || typeof err.code !== 'string' || err.code.indexOf('SQLITE_CONSTRAINT') !== 0) {
    return null;
  }
  const text = String(err.message || '');
  if (text.indexOf('registrations.phone') !== -1) {
    return 'phone';
  }
  if (text.indexOf('registrations.reg_no') !== -1) {
    return 'reg_no';
  }
  // 未能识别具体列时不猜：交给上层按 5000 处理，避免把内部故障伪装成「重复报名」
  return 'unknown';
}

// 创建服务实例：注入仓储
function createService(repo) {
  return {
    // 提交报名：服务端二次校验（前端校验可被绕过，唯一性以本层为准）
    signup: function (body) {
      const checked = validate.validateSignup(body || {});
      if (checked.error) {
        return { status: 400, code: config.CODES.INVALID, message: checked.error, data: null };
      }
      const value = checked.value;

      // 预检手机号：命中直接返回 1002（友好提示，避免依赖约束报错）
      if (repo.findByPhone(value.phone)) {
        return { status: 409, code: config.CODES.DUPLICATE, message: '该手机号已报名，请勿重复提交', data: null };
      }

      try {
        const row = repo.insert(value);
        return { status: 200, code: config.CODES.OK, message: '报名成功', data: rowToRecord(row) };
      } catch (err) {
        // 并发兜底：仅当冲突确实发生在 phone 列时，才按「手机号重复」返回 1002；
        // 其它唯一冲突（如 reg_no）属于服务端缺陷，交给统一错误处理按 5000 暴露出来
        if (uniqueConflictColumn(err) === 'phone') {
          return { status: 409, code: config.CODES.DUPLICATE, message: '该手机号已报名，请勿重复提交', data: null };
        }
        throw err;
      }
    },

    // 按手机号查询：命中返回记录，未命中 data=null 且文案不同
    lookup: function (phoneInput) {
      const phone = validate.toTrimmedStr(phoneInput);
      if (!config.PHONE_REGEX.test(phone)) {
        return { status: 400, code: config.CODES.INVALID, message: '请填写正确的 11 位手机号哦', data: null };
      }
      const row = repo.findByPhone(phone);
      return {
        status: 200,
        code: config.CODES.OK,
        message: row ? '查询成功' : '暂未查到报名记录哦',
        data: row ? rowToRecord(row) : null
      };
    },

    // 名单列表：role / session / keyword 三条件 AND；可选 limit / offset
    list: function (query) {
      const filters = validate.buildFilters(query);
      const pagination = validate.parsePagination(query);
      const rows = repo.list(filters, pagination);
      return { status: 200, code: config.CODES.OK, message: '查询成功', data: rows.map(rowToRecord) };
    },

    // 导出：返回「逐行映射的迭代器 + 中文字典」，由路由层边读边写（R4）
    // 说明：用生成器做映射而不是先 map 成数组，才能保证导出全程是流式的
    exportStream: function (query) {
      const filters = validate.buildFilters(query);
      const cursor = repo.iterate(filters);

      function* records() {
        for (const row of cursor) {
          yield rowToRecord(row);
        }
      }

      return {
        records: records(),
        labels: { role: validate.ROLE_LABELS, session: validate.SESSION_LABELS }
      };
    }
  };
}

module.exports = { createService, rowToRecord };
