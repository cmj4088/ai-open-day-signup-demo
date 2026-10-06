/* =========================================================
 * 测试 · HTTP 契约 server/test/api.contract.test.js（R12 / AC1）
 * 目标：老接口对外契约不得变更——逐条锁定状态码、统一响应体与错误码。
 * 被测路由（均挂 /api 下）：registrations 的 POST/GET/lookup/export、
 *   sessions、healthz；另含 404 与「报名突发保护」端到端。
 * 说明：每个用例通过 makeTestApp 构造隔离实例并挂随机端口，测完关闭服务与库；
 *       响应体统一为 { code, message, data }，错误码取自 config.CODES。
 * ========================================================= */
'use strict';

// 先引入测试支撑：必须在 ../config 之前关闭限流与请求日志
const { makeTestApp, listen, req, signupBody } = require('./_support');

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../config');

// 起一个隔离的 HTTP 服务跑用例，结束后一定关服务、关库，保证用例隔离且不残留端口
async function withServer(options, fn) {
  const made = makeTestApp(options);
  const server = await listen(made.app);
  try {
    await fn(server.baseUrl, made);
  } finally {
    await server.close();
    made.db.close();
  }
}

// 便捷：提交一条报名并返回响应体（多数用例都以后端已入库为前提）
function postSignup(baseUrl, overrides) {
  return req(baseUrl, 'POST', '/api/registrations', signupBody(overrides));
}

// ---------- 报名成功 ----------

test('POST /api/registrations：成功返回 200 + code 0，data 含 regNo/name/phone/session/createdAt', async function () {
  await withServer(null, async function (baseUrl) {
    const res = await postSignup(baseUrl, { phone: '19900000010' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.code, config.CODES.OK);
    assert.strictEqual(res.body.message, '报名成功');
    const d = res.body.data;
    // 编号契约：REG + 8 位日期 + 至少 4 位流水（本例为 4 位）
    assert.match(d.regNo, /^REG\d{12}$/);
    assert.strictEqual(d.name, '测试用户');
    assert.strictEqual(d.phone, '19900000010');
    assert.strictEqual(d.session, 'morning');
    assert.strictEqual(typeof d.createdAt, 'string');
  });
});

// ---------- 参数校验失败 ----------

test('POST /api/registrations：缺姓名 / 手机号非 11 位 / 场次非法 → 400 + code 1001 且中文提示', async function () {
  await withServer(null, async function (baseUrl) {
    const badBodies = [
      signupBody({ name: '' }),          // 缺姓名
      signupBody({ phone: '123' }),      // 手机号非 11 位数字
      signupBody({ session: 'night' })   // 场次不在字典内
    ];
    for (const body of badBodies) {
      const res = await req(baseUrl, 'POST', '/api/registrations', body);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.code, config.CODES.INVALID);
      // 提示必须是中文文案（对外可读信息），用 Unicode 区间粗判
      assert.match(res.body.message, /[\u4e00-\u9fa5]/);
      assert.strictEqual(res.body.data, null);
    }
  });
});

// ---------- 手机号重复 ----------

test('POST /api/registrations：同一手机号二次提交 → 409 + code 1002', async function () {
  await withServer(null, async function (baseUrl) {
    const first = await postSignup(baseUrl, { phone: '19900000011' });
    assert.strictEqual(first.body.code, config.CODES.OK);

    const second = await postSignup(baseUrl, { phone: '19900000011' });
    assert.strictEqual(second.status, 409);
    assert.strictEqual(second.body.code, config.CODES.DUPLICATE);
  });
});

// ---------- 按手机号查询：命中 ----------

test('GET /api/registrations/lookup：命中返回 code 0 + 记录', async function () {
  await withServer(null, async function (baseUrl) {
    await postSignup(baseUrl, { phone: '19900000012', name: '查询命中' });
    const res = await req(baseUrl, 'GET', '/api/registrations/lookup?phone=19900000012');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.code, config.CODES.OK);
    assert.strictEqual(res.body.data.name, '查询命中');
    assert.strictEqual(res.body.data.phone, '19900000012');
  });
});

// ---------- 按手机号查询：未命中（非错误码，务必按实现断言） ----------

test('GET /api/registrations/lookup：未命中返回 code 0 + data null + 专属文案', async function () {
  await withServer(null, async function (baseUrl) {
    const res = await req(baseUrl, 'GET', '/api/registrations/lookup?phone=19999999999');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.code, config.CODES.OK);
    assert.strictEqual(res.body.message, '暂未查到报名记录哦');
    assert.strictEqual(res.body.data, null);
  });
});

// ---------- 按手机号查询：参数非法 ----------

test('GET /api/registrations/lookup：手机号非法 → 400 + code 1001', async function () {
  await withServer(null, async function (baseUrl) {
    const res = await req(baseUrl, 'GET', '/api/registrations/lookup?phone=abc');
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, config.CODES.INVALID);
  });
});

// ---------- 列表筛选：role / session / keyword，及 AND 组合 ----------

test('GET /api/registrations：role/session/keyword 过滤正确，三条件同时给出为 AND', async function () {
  await withServer(null, async function (baseUrl) {
    // 造 3 条互不相同的数据，覆盖三个可筛选维度
    await postSignup(baseUrl, { name: '张老师', role: 'teacher', department: '物理', phone: '19900000021', session: 'morning' });
    await postSignup(baseUrl, { name: '李同学', role: 'student', department: '计算机', phone: '19900000022', session: 'afternoon' });
    await postSignup(baseUrl, { name: '王其他', role: 'other', department: '数学', phone: '19900000023', session: 'morning' });

    const byRole = await req(baseUrl, 'GET', '/api/registrations?role=teacher');
    assert.strictEqual(byRole.body.data.length, 1);
    assert.strictEqual(byRole.body.data[0].name, '张老师');

    const bySession = await req(baseUrl, 'GET', '/api/registrations?session=morning');
    assert.strictEqual(bySession.body.data.length, 2);

    // keyword 命中院系（LIKE 包含匹配）
    const byKeyword = await req(baseUrl, 'GET', '/api/registrations?keyword=' + encodeURIComponent('计算机'));
    assert.strictEqual(byKeyword.body.data.length, 1);
    assert.strictEqual(byKeyword.body.data[0].name, '李同学');

    // 三条件同时给出 → AND，只剩同时满足 role/session/关键字的张老师
    const andAll = await req(baseUrl, 'GET',
      '/api/registrations?role=teacher&session=morning&keyword=' + encodeURIComponent('张'));
    assert.strictEqual(andAll.body.data.length, 1);
    assert.strictEqual(andAll.body.data[0].name, '张老师');
  });
});

// ---------- 分页 ----------

test('GET /api/registrations：limit/offset 生效；limit 超上限按实现夹紧而非报错', async function () {
  await withServer(null, async function (baseUrl) {
    // 5 条数据用于验证分页切片
    for (let i = 0; i < 5; i++) {
      await postSignup(baseUrl, { name: '分页' + i, phone: '1990000003' + i });
    }
    const all = (await req(baseUrl, 'GET', '/api/registrations')).body.data;
    assert.strictEqual(all.length, 5);

    const page1 = (await req(baseUrl, 'GET', '/api/registrations?limit=2')).body.data;
    const page2 = (await req(baseUrl, 'GET', '/api/registrations?limit=2&offset=2')).body.data;
    assert.strictEqual(page1.length, 2);
    assert.strictEqual(page2.length, 2);
    // 分页切片顺序应与全量排序一致，且两页不重叠
    assert.deepStrictEqual(page1.map(function (r) { return r.id; }), all.slice(0, 2).map(function (r) { return r.id; }));
    assert.deepStrictEqual(page2.map(function (r) { return r.id; }), all.slice(2, 4).map(function (r) { return r.id; }));

    // limit=99999 超过 MAX_LIMIT(1000)：parsePagination 把其夹紧到上限，不报错
    const clamped = await req(baseUrl, 'GET', '/api/registrations?limit=99999');
    assert.strictEqual(clamped.status, 200);
    assert.strictEqual(clamped.body.code, config.CODES.OK);
    assert.strictEqual(clamped.body.data.length, 5); // 数据量小于上限，故仍返回全部
  });
});

// ---------- 导出 CSV 契约 ----------

test('GET /api/registrations/export：UTF-8 BOM + CRLF + 中文表头，行数与库中一致', async function () {
  await withServer(null, async function (baseUrl) {
    await postSignup(baseUrl, { phone: '19900000051' });
    await postSignup(baseUrl, { phone: '19900000052' });
    await postSignup(baseUrl, { phone: '19900000053' });

    // 用原始字节读取：Response.text() 会按 WHATWG 规范自动剥掉 UTF-8 BOM，
    // 故必须用 arrayBuffer 才能验证 BOM 字节确实存在
    const raw = await fetch(baseUrl + '/api/registrations/export');
    const buf = Buffer.from(await raw.arrayBuffer());
    // BOM 必须存在（EF BB BF），否则 Excel 打开中文乱码
    assert.deepStrictEqual([buf[0], buf[1], buf[2]], [0xEF, 0xBB, 0xBF]);
    // Buffer.toString('utf8') 保留 BOM 字符，便于按文本切行断言
    const text = buf.toString('utf8');
    assert.strictEqual(text.charCodeAt(0), 0xFEFF);

    const parts = text.slice(1).split('\r\n');
    // 首行为固定顺序的中文表头（对外契约）
    assert.strictEqual(parts[0], '报名编号,报名时间,姓名,身份,院系,手机号,参加场次');
    // 去掉末尾因 CRLF 产生的空串后，数据行数应与库中记录数一致
    const dataRows = parts.slice(1).filter(function (line) { return line !== ''; });
    assert.strictEqual(dataRows.length, 3);
  });
});

// ---------- 健康检查 ----------

test('GET /healthz：status ok，含 version 与 hooks 快照字段', async function () {
  await withServer(null, async function (baseUrl) {
    const res = await req(baseUrl, 'GET', '/healthz');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
    assert.strictEqual(res.body.version, config.APP_VERSION);
    // hooks 快照须包含 signupBurstGuard 及其关键字段，便于压测确认冷却状态
    const snap = res.body.hooks.signupBurstGuard;
    assert.ok(snap);
    assert.strictEqual(snap.enabled, true);
    assert.strictEqual(snap.threshold, config.HOOK_SIGNUP_BURST_THRESHOLD);
    assert.strictEqual(typeof snap.cooling, 'boolean');
  });
});

// ---------- 场次字典 ----------

test('GET /api/sessions：返回场次字典（key/label/time/place/theme）', async function () {
  await withServer(null, async function (baseUrl) {
    const res = await req(baseUrl, 'GET', '/api/sessions');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.code, config.CODES.OK);
    assert.strictEqual(res.body.data.length, config.SESSIONS.length);
    assert.deepStrictEqual(res.body.data.map(function (s) { return s.key; }), ['morning', 'afternoon']);
  });
});

// ---------- Hook 端到端：报名突发保护 ----------

test('Hook 端到端：threshold=0 时报名返回 503 + code 1003，冷却期内继续 503', async function () {
  // 阈值 0 → 首个请求在途数即 1 > 0，必然触发保护
  await withServer({ hooks: { signupBurstGuard: { threshold: 0 } } }, async function (baseUrl) {
    const first = await postSignup(baseUrl, { phone: '19900000061' });
    assert.strictEqual(first.status, 503);
    assert.strictEqual(first.body.code, config.CODES.BUSY);

    // 第二次处于冷却期内，同样被拒（且不触及数据库）
    const second = await postSignup(baseUrl, { phone: '19900000062' });
    assert.strictEqual(second.status, 503);
    assert.strictEqual(second.body.code, config.CODES.BUSY);
  });
});

// ---------- 未知路径 ----------

test('未知路径：/api 前缀返回 404 JSON，其余返回 404 文本', async function () {
  await withServer(null, async function (baseUrl) {
    const apiRes = await req(baseUrl, 'GET', '/api/not-exist');
    assert.strictEqual(apiRes.status, 404);
    assert.strictEqual(apiRes.body.code, config.CODES.SERVER_ERROR);
    assert.strictEqual(apiRes.body.message, '接口不存在');

    const pageRes = await req(baseUrl, 'GET', '/not-exist');
    assert.strictEqual(pageRes.status, 404);
    assert.ok(pageRes.text.indexOf('404') !== -1);
  });
});

// ---------- 服务端内部错误（AC1 要求 1001/1002/5000 逐一断言） ----------

test('服务端异常：仓储层抛错 → 500 + code 5000，且对外不泄漏内部细节', async function () {
  await withServer(null, async function (baseUrl, made) {
    // 人为打坏底层 prepare：等价于仓储层/SQL 出现真实故障，
    // 用于验证统一错误处理会把它收敛成 5000，而不是伪装成业务错误码
    made.db.prepare = function () {
      throw new Error('模拟内部故障：SQL 解析失败');
    };

    const res = await postSignup(baseUrl, { phone: '19900000020' });
    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.code, config.CODES.SERVER_ERROR);
    // 对外文案固定，不得回显内部错误信息（防信息泄漏）
    assert.strictEqual(res.body.message, '服务器内部错误');
    assert.strictEqual(res.body.data, null);
  });
});
