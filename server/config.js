/* =========================================================
 * 后端集中配置 config.js
 * AI 应用教学开放日报名系统（v0.3 压测与重构版）
 * 职责：集中常量（字典 / 错误码 / 备份份数 / 字段限制 / 路径 / 运行开关），
 *       避免同一定义散落多处导致不一致
 * 约束：CommonJS；路径与环境变量在此统一解析，其他模块只引用本文件
 * 变更：v0.3 起限流参数、请求日志、关键事件 Hook 全部改为环境变量可配（R5/R6/R16）
 * ========================================================= */
'use strict';

const path = require('path');

// ---------- 路径解析 ----------
// 服务进程的工作目录可能不同，故一律以 __dirname（server/）为基准解析相对路径
const SERVER_DIR = __dirname;
const PROJECT_ROOT = path.resolve(SERVER_DIR, '..');

// 数据目录：SQLite 文件与备份均落在此（默认在项目根的 data/ 下）
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(PROJECT_ROOT, 'data');

// SQLite 数据文件路径（默认 data/app.db）
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(DATA_DIR, 'app.db');

// 备份目录（默认 data/backups）
const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(DATA_DIR, 'backups');

// ---------- 应用版本 ----------
// 用于 /healthz 与日志；随发布手工递增（本项目无构建注入步骤，D16）
const APP_VERSION = '0.3.0';

// ---------- 运行参数 ----------
const PORT = Number(process.env.PORT) || 3000;      // 监听端口
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';  // 允许来源，生产建议收紧
const MAX_BACKUPS = 7;                               // 启动备份最多保留份数
const JSON_LIMIT = '16kb';                           // 请求体体积上限

// ---------- 限流（R5：全部环境变量可配，默认值与历史行为一致） ----------
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS) || 60 * 1000; // 限流窗口：1 分钟
const RATE_MAX = Number(process.env.RATE_MAX) || 120;                   // 单窗口单 IP 最大请求数
// 压测时必须显式关闭，否则 429 会截断压测结论（PRD 4.2）
const RATE_DISABLED = process.env.RATE_DISABLED === '1';

// ---------- 请求日志（R6：可配开关与慢请求阈值） ----------
// LOG_REQUESTS：默认开启；'0' 关闭（压测时关闭可显著降低同步写 stdout 的开销）
const LOG_REQUESTS = process.env.LOG_REQUESTS !== '0';
// LOG_SLOW_MS：大于 0 时只记录耗时超过该阈值的请求；0 表示全量记录
const LOG_SLOW_MS = Number(process.env.LOG_SLOW_MS) || 0;

// ---------- 关键事件 Hook：报名突发保护（R16 / D18） ----------
// 默认开启；阈值默认 100；冷却默认 60s；三者均可环境变量覆盖
const HOOK_SIGNUP_BURST_ENABLED = process.env.HOOK_SIGNUP_BURST_ENABLED !== '0';
const HOOK_SIGNUP_BURST_THRESHOLD = Number(process.env.HOOK_SIGNUP_BURST_THRESHOLD) || 100;
const HOOK_SIGNUP_BURST_COOLDOWN_MS = Number(process.env.HOOK_SIGNUP_BURST_COOLDOWN_MS) || 60 * 1000;

// 前端静态资源目录（项目根即静态根，user.html/admin.html/assets 均在此）
const STATIC_DIR = PROJECT_ROOT;

// ---------- 场次字典 ----------
// 与 v0.1 定稿一致：同主题、仅时间不同，地点统一报告厅 A，无容量概念
const SESSIONS = [
  { key: 'morning', label: '上午场', time: '09:00–12:00', place: '报告厅 A', theme: 'AI 应用教学开放日' },
  { key: 'afternoon', label: '下午场', time: '14:00–17:00', place: '报告厅 A', theme: 'AI 应用教学开放日' }
];

// ---------- 身份字典 ----------
const ROLES = [
  { key: 'teacher', label: '教师' },
  { key: 'student', label: '学生' },
  { key: 'other', label: '其他' }
];

// ---------- 统一响应码 ----------
const CODES = {
  OK: 0,             // 成功
  INVALID: 1001,     // 参数校验失败
  DUPLICATE: 1002,   // 手机号重复
  BUSY: 1003,        // 报名突发保护：当前报名人数较多（新增，R16；不改既有语义）
  SERVER_ERROR: 5000 // 服务器内部错误
};

// ---------- 字段长度限制 ----------
const FIELD_LIMITS = {
  name: 30,       // 姓名
  department: 50  // 院系
};

// 手机号格式：11 位数字
const PHONE_REGEX = /^\d{11}$/;

module.exports = {
  SERVER_DIR,
  PROJECT_ROOT,
  DATA_DIR,
  DB_PATH,
  BACKUP_DIR,
  STATIC_DIR,
  APP_VERSION,
  PORT,
  CORS_ORIGIN,
  MAX_BACKUPS,
  JSON_LIMIT,
  RATE_WINDOW_MS,
  RATE_MAX,
  RATE_DISABLED,
  LOG_REQUESTS,
  LOG_SLOW_MS,
  HOOK_SIGNUP_BURST_ENABLED,
  HOOK_SIGNUP_BURST_THRESHOLD,
  HOOK_SIGNUP_BURST_COOLDOWN_MS,
  SESSIONS,
  ROLES,
  CODES,
  FIELD_LIMITS,
  PHONE_REGEX
};
