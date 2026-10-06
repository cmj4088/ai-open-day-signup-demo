/* =========================================================
 * 进程入口 server.js
 * AI 应用教学开放日报名系统（v0.3 分层重构）
 * 职责：**只做启动与退出**——初始化数据库 → 创建 Hook → 装配应用 → 监听端口 →
 *       注册信号处理做优雅退出
 * 变更：中间件、路由、静态托管、404 与错误处理已全部移入 app.js
 * 约束：CommonJS；配置一律来自 config.js
 * ========================================================= */
'use strict';

const config = require('./config');
const { initDatabase, closeDatabase } = require('./db');
const { createHooks } = require('./hooks');
const { createApp } = require('./app');

// ---------- 初始化：数据库（含 WAL、加固 pragma、建表、启动备份） ----------
const db = initDatabase();

// ---------- 初始化：关键事件 Hook（报名突发保护，R16） ----------
const hooks = createHooks();

// ---------- 初始化：应用装配 ----------
const app = createApp({ db: db, hooks: hooks });

// ---------- 启动 ----------
const server = app.listen(config.PORT, function () {
  console.log('==================================================');
  console.log('AI 应用教学开放日报名系统 · 后端服务已启动');
  console.log('版本     : ' + config.APP_VERSION);
  console.log('监听端口 : ' + config.PORT);
  console.log('数据文件 : ' + config.DB_PATH);
  console.log('备份目录 : ' + config.BACKUP_DIR);
  console.log('限流     : ' + (config.RATE_DISABLED ? '已关闭（RATE_DISABLED=1）' : config.RATE_MAX + ' 次/' + (config.RATE_WINDOW_MS / 1000) + 's'));
  console.log('突发保护 : ' + (config.HOOK_SIGNUP_BURST_ENABLED
    ? '开启（阈值 ' + config.HOOK_SIGNUP_BURST_THRESHOLD + ' 并发，冷却 ' + (config.HOOK_SIGNUP_BURST_COOLDOWN_MS / 1000) + 's）'
    : '已关闭'));
  console.log('用户端   : http://localhost:' + config.PORT + '/user.html');
  console.log('管理端   : http://localhost:' + config.PORT + '/admin.html');
  console.log('健康检查 : http://localhost:' + config.PORT + '/healthz');
  console.log('==================================================');
});

// ---------- 优雅退出：停止接收新连接 → 关闭 HTTP 服务 → 关闭数据库 ----------
function shutdown(signal) {
  console.log('\n[server] 收到 ' + signal + '，正在关闭…');
  server.close(function () {
    // 关闭前先 checkpoint（R8-3），避免遗留大 WAL 文件
    closeDatabase(db);
    console.log('[server] 已安全退出');
    process.exit(0);
  });
}

process.on('SIGINT', function () { shutdown('SIGINT'); });
process.on('SIGTERM', function () { shutdown('SIGTERM'); });
