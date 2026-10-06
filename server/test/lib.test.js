/* =========================================================
 * 单元测试 · lib 纯函数层 server/test/lib.test.js（R12 / AC2）
 * 覆盖：lib/datetime.js、lib/csv.js、lib/validate.js、lib/regno.js
 * 说明：lib 层零 IO，故本文件不起服务、不开数据库，直接用 node:test 断言
 * ========================================================= */
'use strict';

// 先引入测试支撑（其会关闭限流与请求日志，须早于 config 生效）
require('./_support');

const test = require('node:test');
const assert = require('node:assert');

const datetime = require('../lib/datetime');
const csv = require('../lib/csv');
const validate = require('../lib/validate');
const regno = require('../lib/regno');

// ---------- lib/datetime.js ----------

test('pad：按宽度补零，且不截断超长值', function () {
  assert.strictEqual(datetime.pad(1, 4), '0001');
  assert.strictEqual(datetime.pad(12, 4), '0012');
  // 超过宽度时必须保持原值（R9 编号跨 9999 的边界依赖此行为）
  assert.strictEqual(datetime.pad(10000, 4), '10000');
});

test('todayStamp：输出本地日期 YYYYMMDD', function () {
  // 用本地时间构造，避免时区导致断言漂移
  const d = new Date(2026, 9, 6, 9, 30, 0); // 月份从 0 起：9 = 十月
  assert.strictEqual(datetime.todayStamp(d), '20261006');
});

test('formatDateTime：ISO → 本地可读时间；非法值原样返回', function () {
  const iso = new Date(2026, 9, 6, 9, 5, 3).toISOString();
  assert.strictEqual(datetime.formatDateTime(iso), '2026-10-06 09:05:03');
  assert.strictEqual(datetime.formatDateTime('不是时间'), '不是时间');
  assert.strictEqual(datetime.formatDateTime(null), '');
});

// ---------- lib/csv.js ----------

test('csvCell：仅在含逗号/引号/换行时加引号，内部引号翻倍', function () {
  assert.strictEqual(csv.csvCell('普通'), '普通');
  assert.strictEqual(csv.csvCell('含,逗号'), '"含,逗号"');
  assert.strictEqual(csv.csvCell('含"引号'), '"含""引号"');
  assert.strictEqual(csv.csvCell('含\n换行'), '"含\n换行"');
  assert.strictEqual(csv.csvCell(null), '');
});

test('headerLine：表头顺序固定（对外契约，不得调整）', function () {
  assert.strictEqual(csv.headerLine(), '报名编号,报名时间,姓名,身份,院系,手机号,参加场次');
  // BOM 与行尾常量的取值属契约
  assert.strictEqual(csv.BOM, '\uFEFF');
  assert.strictEqual(csv.CRLF, '\r\n');
});

test('rowLine：字典键映射为中文，缺失时回退原值', function () {
  const labels = { role: { student: '学生' }, session: { morning: '上午场' } };
  const record = {
    regNo: 'REG202610060001',
    createdAt: new Date(2026, 9, 6, 9, 5, 3).toISOString(),
    name: '张三',
    role: 'student',
    department: '',
    phone: '19900000001',
    session: 'morning'
  };
  assert.strictEqual(csv.rowLine(record, labels),
    'REG202610060001,2026-10-06 09:05:03,张三,学生,,19900000001,上午场');

  // 字典缺失 role 时回退原始键值，保证不丢列
  assert.strictEqual(csv.rowLine(record, { session: { morning: '上午场' } }),
    'REG202610060001,2026-10-06 09:05:03,张三,student,,19900000001,上午场');
});

// ---------- lib/validate.js ----------

test('validateSignup：必填仅姓名/手机号/场次，身份与院系可空', function () {
  const ok = validate.validateSignup({
    name: '  张三  ', phone: ' 19900000001 ', session: 'morning'
  });
  assert.deepStrictEqual(ok.value, {
    name: '张三', role: '', department: '', phone: '19900000001', session: 'morning'
  });
});

test('validateSignup：逐条触发校验文案', function () {
  assert.strictEqual(validate.validateSignup({ name: '', phone: '19900000001', session: 'morning' }).error, '请填写姓名哦');
  assert.strictEqual(validate.validateSignup({ name: '张'.repeat(31), phone: '19900000001', session: 'morning' }).error,
    '姓名太长啦，最多 30 个字');
  assert.strictEqual(validate.validateSignup({ name: '张三', phone: '123', session: 'morning' }).error,
    '请填写正确的 11 位手机号哦');
  assert.strictEqual(validate.validateSignup({ name: '张三', phone: '19900000001', session: 'night' }).error,
    '请选择参加场次哦');
  assert.strictEqual(validate.validateSignup({ name: '张三', phone: '19900000001', session: 'morning', role: 'boss' }).error,
    '身份取值不合法');
  assert.strictEqual(validate.validateSignup({ name: '张三', phone: '19900000001', session: 'morning', department: '院'.repeat(51) }).error,
    '院系名称太长啦，最多 50 个字');
});

test('escapeLike：转义 LIKE 通配符，防止用户输入被当通配', function () {
  assert.strictEqual(validate.escapeLike('a%b_c\\d'), 'a\\%b\\_c\\\\d');
});

test('buildFilters：三个条件 AND 组合，空条件忽略', function () {
  assert.deepStrictEqual(validate.buildFilters({}), { whereSql: '', params: [] });

  const onlyRole = validate.buildFilters({ role: 'student' });
  assert.strictEqual(onlyRole.whereSql, ' WHERE role = ?');
  assert.deepStrictEqual(onlyRole.params, ['student']);

  const all = validate.buildFilters({ role: 'student', session: 'morning', keyword: '张' });
  assert.strictEqual(all.whereSql,
    ' WHERE role = ? AND session = ? AND (name LIKE ? ESCAPE \'\\\' OR phone LIKE ? ESCAPE \'\\\' OR department LIKE ? ESCAPE \'\\\')');
  assert.deepStrictEqual(all.params, ['student', 'morning', '%张%', '%张%', '%张%']);
});

test('parsePagination：都不传 → null（全量，保持 v0.2 行为）', function () {
  assert.strictEqual(validate.parsePagination({}), null);
  assert.strictEqual(validate.parsePagination({ limit: '', offset: '' }), null);
});

test('parsePagination：传参时夹紧到合法区间，非法值不报错', function () {
  assert.deepStrictEqual(validate.parsePagination({ limit: '10', offset: '5' }), { limit: 10, offset: 5 });
  // 超过上限 → 夹紧到 MAX_LIMIT
  assert.deepStrictEqual(validate.parsePagination({ limit: '99999' }), { limit: validate.MAX_LIMIT, offset: 0 });
  // limit 非法 → 取上限；offset 非法 → 取 0
  assert.deepStrictEqual(validate.parsePagination({ limit: 'abc', offset: '-3' }), { limit: validate.MAX_LIMIT, offset: 0 });
  // 只给 offset：等价于从 offset 起取一页
  assert.deepStrictEqual(validate.parsePagination({ offset: '7' }), { limit: validate.MAX_LIMIT, offset: 7 });
});

// ---------- lib/regno.js ----------

test('regNoPrefix：REG + YYYYMMDD', function () {
  assert.strictEqual(regno.regNoPrefix(new Date(2026, 9, 6)), 'REG20261006');
});

test('nextRegNoFrom：无历史编号从 0001 起', function () {
  assert.strictEqual(regno.nextRegNoFrom('REG20261006', null), 'REG202610060001');
});

test('nextRegNoFrom：按当日最大编号 +1', function () {
  assert.strictEqual(regno.nextRegNoFrom('REG20261006', 'REG202610060041'), 'REG202610060042');
});

test('nextRegNoFrom：前缀不匹配时（跨日脏值）退回 0001', function () {
  assert.strictEqual(regno.nextRegNoFrom('REG20261006', 'REG202610050099'), 'REG202610060001');
});

test('nextRegNoFrom：R9 边界 —— 单日超过 9999 条时流水自然退化为 5 位', function () {
  // 这是被显式固定下来的边界事实（生成逻辑不变，仅在此锁定，避免成为隐性坑）
  assert.strictEqual(regno.nextRegNoFrom('REG20261006', 'REG202610069999'), 'REG2026100610000');
});
