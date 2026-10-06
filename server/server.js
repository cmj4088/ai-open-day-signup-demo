/* =========================================================
 * 应用入口 server.js
 * AI 应用教学开放日报名系统（v0.2 前后端分离）
 * 职责：装配中间件（日志 / CORS / JSON / 限流）、暴露 API 路由、
 *       托管前端静态资源（仅放行 user.html / admin.html / assets）、
 *       统一错误处理与优雅退出
 * 约束：CommonJS；配置一律来自 config.js（环境变量在此层之外解析）
 * ========================================================= */
'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { initDatabase } = require('./db');
const registrationsRouter = require('./routes/registrations');
const sessionsRouter = require('./routes/sessions');

// 初始化数据库（含 WAL、建表、启动备份）
const db = initDatabase();

const app = express();

// 部署在反向代理（如 ngrok / nginx）之后时，正确解析客户端 IP（供限流使用）
app.set('trust proxy', 1);
// 关闭 X-Powered-By，减少指纹暴露
app.disable('x-powered-by');

// ---------- 请求日志（R6：开关与慢请求阈值均可配） ----------
// 说明：console.log 是同步写 fd，高并发下会成为可观开销，压测时用 LOG_REQUESTS=0 关闭
app.use(function (req, res, next) {
  if (!config.LOG_REQUESTS) {
    return next();
  }
  const startedAt = Date.now();
  res.on('finish', function () {
    const cost = Date.now() - startedAt;
    // LOG_SLOW_MS > 0 时只记慢请求，减少高频日志噪音
    if (config.LOG_SLOW_MS > 0 && cost < config.LOG_SLOW_MS) {
      return;
    }
    console.log('[' + new Date().toISOString() + '] ' + req.method + ' ' + req.originalUrl +
      ' -> ' + res.statusCode + ' (' + cost + 'ms)');
  });
  next();
});

// ---------- CORS ----------
app.use(cors({ origin: config.CORS_ORIGIN }));

// ---------- 请求体解析（体积限制，防大包） ----------
app.use(express.json({ limit: config.JSON_LIMIT }));

// ---------- 限流（R5：参数与开关均可配；管理端无鉴权，限流尤为必要） ----------
// 说明：RATE_DISABLED=1 时不挂载限流中间件（压测专用，避免 429 截断结论）
if (config.RATE_DISABLED) {
  console.log('[server] 限流已通过 RATE_DISABLED=1 关闭（仅供压测使用）');
} else {
  const apiLimiter = rateLimit({
    windowMs: config.RATE_WINDOW_MS,
    limit: config.RATE_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    // 超限时返回统一响应体，保持契约一致
    handler: function (req, res) {
      res.status(429).json({
        code: config.CODES.SERVER_ERROR,
        message: '请求过于频繁，请稍后再试',
        data: null
      });
    }
  });
  app.use('/api', apiLimiter);
}

// ---------- 健康检查（R7：纯新增，不入 /api 前缀故不受限流影响） ----------
// 返回 { status, uptime, version }，并做一次数据库「可写」探测
// 探测方式：BEGIN IMMEDIATE 会立即申请写锁，成功即可证明库可写，且不改动任何数据
function probeDbWritable() {
  try {
    db.exec('BEGIN IMMEDIATE; COMMIT;');
    return true;
  } catch {
    // 任何异常都视为不可写（既包括锁冲突，也包括库损坏）
    return false;
  }
}

app.get('/healthz', function (req, res) {
  const writable = probeDbWritable();
  return res.status(writable ? 200 : 503).json({
    status: writable ? 'ok' : 'degraded',
    uptime: Math.round(process.uptime()),
    version: config.APP_VERSION
  });
});

// ---------- API 路由 ----------
app.use('/api/registrations', registrationsRouter.createRouter(db));
app.use('/api/sessions', sessionsRouter.createRouter());

// ---------- 前端静态资源 ----------
// 只放行必要的静态资源与两个入口页，避免把 server/ 源码与 data/ 数据库暴露出去
app.use('/assets', express.static(path.join(config.STATIC_DIR, 'assets')));

// 首页默认指向用户端报名页
app.get('/', function (req, res) {
  res.sendFile(path.join(config.STATIC_DIR, 'user.html'));
});
app.get('/user.html', function (req, res) {
  res.sendFile(path.join(config.STATIC_DIR, 'user.html'));
});
app.get('/admin.html', function (req, res) {
  res.sendFile(path.join(config.STATIC_DIR, 'admin.html'));
});

// ---------- 404 ----------
app.use(function (req, res) {
  // API 请求返回统一 JSON；页面请求返回简短文本
  if (req.path.indexOf('/api/') === 0) {
    return res.status(404).json({ code: config.CODES.SERVER_ERROR, message: '接口不存在', data: null });
  }
  return res.status(404).send('404 Not Found');
});

// ---------- 统一错误处理 ----------
// 说明：Express 错误中间件必须为 4 个参数，故保留 next 形参（未使用）
// eslint-disable-next-line no-unused-vars
app.use(function (err, req, res, next) {
  // JSON 解析失败 / 体积超限：归为参数校验失败
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
    return res.status(400).json({ code: config.CODES.INVALID, message: '请求数据格式不正确', data: null });
  }
  // 其余异常：记录堆栈，对外只返回统一错误码，不泄漏内部细节
  console.error('[error]', err && err.stack ? err.stack : err);
  return res.status(500).json({ code: config.CODES.SERVER_ERROR, message: '服务器内部错误', data: null });
});

// ---------- 启动 ----------
const server = app.listen(config.PORT, function () {
  console.log('==================================================');
  console.log('AI 应用教学开放日报名系统 · 后端服务已启动');
  console.log('监听端口 : ' + config.PORT);
  console.log('数据文件 : ' + config.DB_PATH);
  console.log('备份目录 : ' + config.BACKUP_DIR);
  console.log('用户端   : http://localhost:' + config.PORT + '/user.html');
  console.log('管理端   : http://localhost:' + config.PORT + '/admin.html');
  console.log('==================================================');
});

// ---------- 优雅退出：关闭 HTTP 服务与数据库连接 ----------
function shutdown(signal) {
  console.log('\n[server] 收到 ' + signal + '，正在关闭…');
  server.close(function () {
    try {
      db.close();
    } catch (e) {
      console.warn('[server] 关闭数据库连接异常：', e.message);
    }
    console.log('[server] 已安全退出');
    process.exit(0);
  });
}

process.on('SIGINT', function () { shutdown('SIGINT'); });
process.on('SIGTERM', function () { shutdown('SIGTERM'); });
