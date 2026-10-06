/* =========================================================
 * 仓储层 · 报名数据 repositories/registrationsRepo.js
 * AI 应用教学开放日报名系统（v0.3 分层重构）
 * 职责：承载**全部 SQL**，对外暴露语义化方法（查找 / 插入 / 列表 / 流式迭代）
 * 关键改造（R2）：预处理语句按 SQL 文本缓存复用。
 *   重构前每个请求都会执行 db.prepare()，高并发下产生大量 Statement 对象，
 *   既重复解析 SQL，又在 GC 析构时引入额外开销（压测暴露的问题 #2）。
 * 约束：只做数据存取与映射，不含业务判断（业务判断在 services 层）
 * ========================================================= */
'use strict';

const { regNoPrefix, nextRegNoFrom } = require('../lib/regno');

// 固定 SQL 片段：列表与导出共用同一查询形状，保证两者结果集完全一致
const BASE_SELECT = 'SELECT * FROM registrations';
const ORDER_BY = ' ORDER BY created_at DESC, id DESC';

// 具名 SQL：集中在此，便于统一审阅参数化情况
const SQL = {
  selectByPhone: 'SELECT * FROM registrations WHERE phone = ?',
  selectById: 'SELECT * FROM registrations WHERE id = ?',
  // 取当日最大编号：必须按「流水数字」而非「整串字典序」比较。
  // 踩坑记录（R9，压测实测复现）：流水补零为 4 位，单日第 10000 条起进位成 5 位，
  //   此时字典序会把 REG202610069999 判为大于 REG2026100610000（第 11 位 '9' > '1'），
  //   导致每天第 10000 条之后永远推导出同一个编号 → 撞 reg_no 唯一约束 → 全量写入失败。
  // 修正：先按长度降序（位数多者数值必大），同长度内字典序即数值序。
  maxRegNoOfDay: 'SELECT reg_no FROM registrations WHERE reg_no LIKE ? ' +
    'ORDER BY LENGTH(reg_no) DESC, reg_no DESC LIMIT 1',
  insert: 'INSERT INTO registrations (reg_no, name, role, department, phone, session, created_at) ' +
    'VALUES (@reg_no, @name, @role, @department, @phone, @session, @created_at)'
};

// 创建仓储实例：注入 db，返回语义化方法集合
function createRepo(db) {
  // 预处理语句缓存：键为 SQL 文本。组合数有限（筛选片段 + 是否分页），故缓存不会无限增长
  const stmtCache = new Map();

  function stmt(sql) {
    let cached = stmtCache.get(sql);
    if (!cached) {
      cached = db.prepare(sql);
      stmtCache.set(sql, cached);
    }
    return cached;
  }

  // 事务：取当日最大编号 → 推导新编号 → 插入 → 回读完整记录
  // 说明：better-sqlite3 为同步 API，事务内不会与其它写操作交错，
  //       故「查最大值 + 1」足以保证当日内编号唯一（reg_no 另有 UNIQUE 兜底）
  const insertTx = db.transaction(function (rec, now) {
    const stampDate = now || new Date();
    const prefix = regNoPrefix(stampDate);
    const maxRow = stmt(SQL.maxRegNoOfDay).get(prefix + '%');
    const regNo = nextRegNoFrom(prefix, maxRow ? maxRow.reg_no : null);
    const createdAt = stampDate.toISOString();

    const info = stmt(SQL.insert).run({
      reg_no: regNo,
      name: rec.name,
      role: rec.role,
      department: rec.department,
      phone: rec.phone,
      session: rec.session,
      created_at: createdAt
    });

    return stmt(SQL.selectById).get(info.lastInsertRowid);
  });

  return {
    // 按手机号取原始行（未命中返回 null）
    findByPhone: function (phone) {
      return stmt(SQL.selectByPhone).get(phone) || null;
    },

    // 按主键取原始行
    findById: function (id) {
      return stmt(SQL.selectById).get(id) || null;
    },

    // 插入一条报名记录（含编号生成），返回数据库原始行
    insert: function (rec, now) {
      return insertTx(rec, now);
    },

    // 列表查询：filters = { whereSql, params }；pagination = null（全量）或 { limit, offset }
    // 说明：不传分页时 SQL 与 v0.2 完全相同，行为逐字节一致（Q4）
    list: function (filters, pagination) {
      let sql = BASE_SELECT + filters.whereSql + ORDER_BY;
      const params = filters.params.slice();
      if (pagination) {
        sql += ' LIMIT ? OFFSET ?';
        params.push(pagination.limit, pagination.offset);
      }
      return stmt(sql).all(...params);
    },

    // 流式迭代（导出专用，R4）：iterate 逐行产出，避免整表一次性读进内存
    // 注意：迭代器必须在同一 tick 内消费完，不可跨请求保存（better-sqlite3 的约束）
    iterate: function (filters) {
      return stmt(BASE_SELECT + filters.whereSql + ORDER_BY).iterate(...filters.params);
    }
  };
}

module.exports = { createRepo };
