/* =========================================================
 * 数据库模块 db.js
 * AI 应用教学开放日报名系统（v0.2 前后端分离）
 * 职责：打开 SQLite 连接、开启 WAL、建表（空库启动）、
 *       服务启动时自动备份并只保留最近 N 份
 * 约束：CommonJS；使用 better-sqlite3 同步 API；全部 SQL 参数化
 * ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const config = require('./config');

// 备份文件名前缀，用于 prune 时筛选
const BACKUP_PREFIX = 'app-';

// 建表语句：phone 建 UNIQUE 索引作为手机号唯一的最终兜底（防并发绕过前端预检）
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS registrations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reg_no      TEXT    NOT NULL UNIQUE,          -- 报名编号 REG+YYYYMMDD+4位流水
  name        TEXT    NOT NULL,                 -- 姓名（必填）
  role        TEXT    DEFAULT '',               -- 身份 teacher/student/other，可空
  department  TEXT    DEFAULT '',               -- 院系，可空
  phone       TEXT    NOT NULL UNIQUE,          -- 手机号（11 位，全局唯一）
  session     TEXT    NOT NULL,                 -- 场次 morning/afternoon
  created_at  TEXT    NOT NULL                  -- 报名时间 ISO 字符串
);
`;

// 常用排序与查询索引：按创建时间倒序是名单与导出的默认顺序
const CREATE_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_registrations_created_at ON registrations (created_at DESC);
`;

// 确保目录存在（递归创建，已存在则忽略）
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// 生成备份文件名：app-YYYYMMDD-HHmmss.db
function buildBackupName(now) {
  const pad = function (n) {
    return n < 10 ? '0' + n : String(n);
  };
  const stamp = '' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
    '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  return BACKUP_PREFIX + stamp + '.db';
}

// 备份当前数据文件到备份目录（仅当数据文件此前已存在时才备份，避免空库产生噪音备份）
function backupDatabase() {
  if (!fs.existsSync(config.DB_PATH)) {
    return null;
  }
  ensureDir(config.BACKUP_DIR);
  const target = path.join(config.BACKUP_DIR, buildBackupName(new Date()));
  fs.copyFileSync(config.DB_PATH, target);
  return target;
}

// 清理历史备份：按文件名（即时间）升序，只保留最近 MAX_BACKUPS 份
function pruneBackups() {
  if (!fs.existsSync(config.BACKUP_DIR)) {
    return [];
  }
  const files = fs.readdirSync(config.BACKUP_DIR)
    .filter(function (name) {
      return name.indexOf(BACKUP_PREFIX) === 0 && name.slice(-3) === '.db';
    })
    .sort(); // 文件名内嵌时间戳，字典序即时间序

  const removed = [];
  // 超出保留份数的部分从最旧开始删除
  while (files.length > config.MAX_BACKUPS) {
    const oldest = files.shift();
    fs.unlinkSync(path.join(config.BACKUP_DIR, oldest));
    removed.push(oldest);
  }
  return removed;
}

// 初始化数据库：建目录 → 打开连接 → WAL → 建表建索引 → 备份 → 清理旧备份
function initDatabase() {
  ensureDir(config.DATA_DIR);
  ensureDir(config.BACKUP_DIR);

  // 记录打开前文件是否已存在，用于决定是否备份（新建的空库无需备份）
  const existedBefore = fs.existsSync(config.DB_PATH);

  const db = new Database(config.DB_PATH);
  // WAL 模式：提升读写并发表现；foreign_keys 便于后续扩展
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(CREATE_TABLE_SQL);
  db.exec(CREATE_INDEX_SQL);

  // 备份前做一次 checkpoint，确保 WAL 中的增量已合并进主库文件再复制
  if (existedBefore) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (e) {
      // checkpoint 失败不阻断启动，仅记录
      console.warn('[db] WAL checkpoint 失败，跳过本次预备份检查点：', e.message);
    }
    const backupFile = backupDatabase();
    const removed = pruneBackups();
    console.log('[db] 启动备份完成：' + (backupFile ? path.basename(backupFile) : '无'));
    if (removed.length > 0) {
      console.log('[db] 清理旧备份 ' + removed.length + ' 份，当前保留上限 ' + config.MAX_BACKUPS + ' 份');
    }
  } else {
    console.log('[db] 首次启动，创建空库（不注入种子数据）：' + config.DB_PATH);
  }

  return db;
}

module.exports = { initDatabase };
