/* =========================================================
 * 测试 · 仓储层 server/test/repo.test.js（R12）
 * 被测：repositories/registrationsRepo.js 的 createRepo(db)
 * 覆盖：insert（编号生成 / 唯一约束）/ findByPhone / findById /
 *       list（筛选 + 分页 + 排序）/ iterate / 预处理语句缓存
 * 说明：仓储层是「编号生成 + SQL」的收口处，也是 R9 编号进位缺陷的发生地，
 *       故本文件把 9999→10000 边界作为最高优先级回归用例锁死。
 * 约定：只开内存库，测完即 db.close()，绝不触碰 data/app.db
 * ========================================================= */
'use strict';

// 先引入测试支撑：它必须在 ../config 之前生效，以关闭限流与请求日志
require('./_support');

const test = require('node:test');
const assert = require('node:assert/strict');

const { initDatabase } = require('../db');
const { createRepo } = require('../repositories/registrationsRepo');
const validate = require('../lib/validate');
const regno = require('../lib/regno');

// 开一个隔离的内存库跑用例，无论成功失败都关闭，避免句柄泄漏
// 用内存库而非 makeTestApp：仓储层测试不需要 Express，直接构造最小依赖更贴近被测单元
function withDb(fn) {
  const db = initDatabase({ dbPath: ':memory:', backup: false });
  try {
    fn(db);
  } finally {
    db.close();
  }
}

// 直接写库的播种助手：绕过 repo，用于精确控制 created_at 与排序，
// 从而让 list / iterate 的顺序断言不受「插入时刻」影响。
// 只 prepare 一次、复用于所有行，避免产生多余语句对象。
function seedRows(db, rows) {
  const stmt = db.prepare(
    'INSERT INTO registrations (reg_no, name, role, department, phone, session, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  rows.forEach(function (r) {
    stmt.run(r.regNo, r.name, r.role, r.department, r.phone, r.session, r.createdAt);
  });
}

// ---------- insert：编号生成与字段映射 ----------

test('insert：返回完整数据库行，字段映射正确且编号为 REG+日期+4位流水', function () {
  withDb(function (db) {
    const repo = createRepo(db);
    // 固定时间以便断言编号前缀可预测（避免跨零点导致本地日期漂移）
    const when = new Date(2026, 9, 6, 10, 0, 0); // 2026-10-06 10:00:00
    const row = repo.insert({
      name: '张三', role: 'student', department: '计算机学院',
      phone: '19900000001', session: 'morning'
    }, when);

    // 自增主键回填，证明插入确实落库
    assert.ok(row.id > 0);
    // 各列一一对应，防止列顺序错位这类静默缺陷
    assert.strictEqual(row.name, '张三');
    assert.strictEqual(row.role, 'student');
    assert.strictEqual(row.department, '计算机学院');
    assert.strictEqual(row.phone, '19900000001');
    assert.strictEqual(row.session, 'morning');
    assert.strictEqual(row.created_at, when.toISOString());
    // 当日首条应从 0001 起
    assert.strictEqual(row.reg_no, regno.regNoPrefix(when) + '0001');
  });
});

test('insert：同一手机号二次插入触发唯一约束，err.code 以 SQLITE_CONSTRAINT 开头', function () {
  withDb(function (db) {
    const repo = createRepo(db);
    const base = { name: '李四', role: '', department: '', session: 'morning' };
    repo.insert(Object.assign({ phone: '19900000002' }, base));

    // 第二次换姓名但沿用同一手机号：冲突应精确落在 phone 唯一索引上
    let err = null;
    try {
      repo.insert(Object.assign({ name: '李四改', phone: '19900000002' }, base));
    } catch (e) {
      err = e;
    }
    assert.ok(err, '重复手机号必须抛错，而不是静默成功');
    // better-sqlite3 会给出 SQLITE_CONSTRAINT_UNIQUE 之类的细分子码
    assert.ok(String(err.code).indexOf('SQLITE_CONSTRAINT') === 0,
      '预期 SQLITE_CONSTRAINT* 错误码，实际为 ' + err.code);
  });
});

// ---------- 【最高优先级 · 回归】9999 → 10000 编号进位边界 ----------

test('回归：单日第 10000 条起编号进位为 5 位（LENGTH 排序修正，防编号推导卡死）', function () {
  withDb(function (db) {
    const repo = createRepo(db);
    const now = new Date();
    const prefix = regno.regNoPrefix(now);

    // 直接插入一条当日 9999 行，模拟「今天已报名 9999 人」的临界状态。
    // 之所以绕过 repo：要精确构造 4 位流水的最大值，触发长度进位分支。
    db.prepare(
      'INSERT INTO registrations (reg_no, name, role, department, phone, session, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(prefix + '9999', '边界用户', 'student', '', '19911110001', 'morning', now.toISOString());

    // 第 10000 条：修正后按 LENGTH 排序取到 9999，推导出 5 位的 10000。
    // 若退化为整串 ORDER BY reg_no DESC，本行能过、但下一行会撞唯一约束（见下）。
    const second = repo.insert({ name: '第10000人', role: '', department: '', phone: '19911110002', session: 'morning' }, now);
    assert.strictEqual(second.reg_no, prefix + '10000');

    // 第 10001 条：此时库中 4 位与 5 位流水混存。
    // 字典序会把 prefix+9999 判为大于 prefix+10000（第 11 位 '9' > '1'），
    // 从而再次推导出已存在的 10000 → 撞 reg_no 唯一约束 → 全量写入失败。
    // 该断言正是锁死「按长度优先」这一修正的关键。
    const third = repo.insert({ name: '第10001人', role: '', department: '', phone: '19911110003', session: 'morning' }, now);
    assert.strictEqual(third.reg_no, prefix + '10001');
  });
});

// ---------- findByPhone / findById ----------

test('findByPhone / findById：命中返回原始行，未命中返回 null', function () {
  withDb(function (db) {
    const repo = createRepo(db);
    const row = repo.insert({
      name: '王五', role: '', department: '', phone: '19900000003', session: 'afternoon'
    }, new Date(2026, 9, 6, 11, 0, 0));

    assert.strictEqual(repo.findByPhone('19900000003').reg_no, row.reg_no);
    assert.strictEqual(repo.findById(row.id).phone, '19900000003');
    // 未命中必须返回 null 而非 undefined，以便上层做 !!row 判断
    assert.strictEqual(repo.findByPhone('10000000000'), null);
    assert.strictEqual(repo.findById(999999), null);
  });
});

// ---------- list：全量 / 排序 ----------

test('list：无分页时返回全部，且按 created_at DESC, id DESC 排序', function () {
  withDb(function (db) {
    const repo = createRepo(db);
    seedRows(db, [
      { regNo: 'R-A', name: 'A', role: '', department: '', phone: 'p1', session: 'morning', createdAt: '2026-10-01T00:00:01.000Z' },
      { regNo: 'R-B', name: 'B', role: '', department: '', phone: 'p2', session: 'morning', createdAt: '2026-10-01T00:00:02.000Z' },
      { regNo: 'R-C', name: 'C', role: '', department: '', phone: 'p3', session: 'morning', createdAt: '2026-10-01T00:00:03.000Z' },
      { regNo: 'R-D', name: 'D', role: '', department: '', phone: 'p4', session: 'morning', createdAt: '2026-10-01T00:00:04.000Z' }
    ]);

    const all = repo.list({ whereSql: '', params: [] }, null);
    assert.strictEqual(all.length, 4);
    // 时间倒序：最新（D）在最前
    assert.deepStrictEqual(all.map(function (r) { return r.name; }), ['D', 'C', 'B', 'A']);
  });
});

// ---------- list：分页 ----------

test('list：传入 { limit, offset } 时按排序截断，且不越界', function () {
  withDb(function (db) {
    const repo = createRepo(db);
    seedRows(db, [
      { regNo: 'R-A', name: 'A', role: '', department: '', phone: 'p1', session: 'morning', createdAt: '2026-10-01T00:00:01.000Z' },
      { regNo: 'R-B', name: 'B', role: '', department: '', phone: 'p2', session: 'morning', createdAt: '2026-10-01T00:00:02.000Z' },
      { regNo: 'R-C', name: 'C', role: '', department: '', phone: 'p3', session: 'morning', createdAt: '2026-10-01T00:00:03.000Z' },
      { regNo: 'R-D', name: 'D', role: '', department: '', phone: 'p4', session: 'morning', createdAt: '2026-10-01T00:00:04.000Z' }
    ]);

    // 排序为 D,C,B,A；从 offset=1 起取 2 条 → C,B
    const page = repo.list({ whereSql: '', params: [] }, { limit: 2, offset: 1 });
    assert.deepStrictEqual(page.map(function (r) { return r.name; }), ['C', 'B']);
  });
});

// ---------- list：筛选 ----------

test('list：filters（role / keyword）正确过滤，params 与 whereSql 配套', function () {
  withDb(function (db) {
    const repo = createRepo(db);
    seedRows(db, [
      { regNo: 'R-A', name: '张老师', role: 'teacher', department: '物理', phone: 'p1', session: 'morning', createdAt: '2026-10-01T00:00:01.000Z' },
      { regNo: 'R-B', name: '李同学', role: 'student', department: '计算机', phone: 'p2', session: 'morning', createdAt: '2026-10-01T00:00:02.000Z' },
      { regNo: 'R-C', name: '王老师', role: 'teacher', department: '数学', phone: 'p3', session: 'morning', createdAt: '2026-10-01T00:00:03.000Z' }
    ]);

    // role 精确匹配 → 两位老师
    const teachers = repo.list(validate.buildFilters({ role: 'teacher' }), null);
    assert.strictEqual(teachers.length, 2);
    assert.ok(teachers.every(function (r) { return r.role === 'teacher'; }));

    // keyword 命中院系列 → 仅李同学
    const cs = repo.list(validate.buildFilters({ keyword: '计算机' }), null);
    assert.strictEqual(cs.length, 1);
    assert.strictEqual(cs[0].name, '李同学');
  });
});

// ---------- iterate：与 list 结果一致 ----------

test('iterate：逐行产出，条数与顺序与 list 完全一致', function () {
  withDb(function (db) {
    const repo = createRepo(db);
    seedRows(db, [
      { regNo: 'R-A', name: 'A', role: '', department: '', phone: 'p1', session: 'morning', createdAt: '2026-10-01T00:00:01.000Z' },
      { regNo: 'R-B', name: 'B', role: '', department: '', phone: 'p2', session: 'morning', createdAt: '2026-10-01T00:00:02.000Z' },
      { regNo: 'R-C', name: 'C', role: '', department: '', phone: 'p3', session: 'morning', createdAt: '2026-10-01T00:00:03.000Z' }
    ]);
    const filters = { whereSql: '', params: [] };

    // better-sqlite3 的 iterate 必须在同一 tick 内消费完，故此处在同步用例里立即展开为数组
    const iterated = Array.from(repo.iterate(filters)).map(function (r) { return r.name; });
    const listed = repo.list(filters, null).map(function (r) { return r.name; });
    assert.deepStrictEqual(iterated, listed);
    assert.deepStrictEqual(iterated, ['C', 'B', 'A']);
  });
});

// ---------- 预处理语句缓存复用 ----------

test('语句缓存：同一 SQL 多次调用只 prepare 一次（R2 关键性能语义）', function () {
  const db = initDatabase({ dbPath: ':memory:', backup: false });
  try {
    // 包住原生 prepare 统计调用次数：repo 内部按 SQL 文本缓存，理应只穿透到底层一次
    const origPrepare = db.prepare.bind(db);
    let prepareCalls = 0;
    db.prepare = function (sql) {
      prepareCalls += 1;
      return origPrepare(sql);
    };

    const repo = createRepo(db);
    // 三次同形查询共用同一条 SQL，命中缓存后不应再触及 db.prepare
    repo.findByPhone('19900000001');
    repo.findByPhone('19900000002');
    repo.findByPhone('19900000003');
    assert.strictEqual(prepareCalls, 1, '同一 SQL 应只 prepare 一次，实际调用 ' + prepareCalls + ' 次');
  } finally {
    db.close();
  }
});
