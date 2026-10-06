/* =========================================================
 * 数据库模块 db/index.js
 * AI 应用教学开放日报名系统（v0.3 分层重构）
 * 职责：打开 SQLite 连接、开启 WAL、连接加固（busy_timeout / synchronous）、
 *       建表（空库启动）、服务启动时自动备份并只保留最近 N 份、关闭前 checkpoint
 * 变更：由 server/db.js 迁移为 server/db/index.js；新增 R8 三项加固
 * 约束：CommonJS；使用 better-sqlite3 同步 API；全部 SQL 参数化
 * ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const config = require('../config');

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
  const pad2 = function (n) { return n < 10 ? '0' + n : String(n); };
  const stamp = '' + now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate()) +
    '-' + pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds());
  return BACKUP_PREFIX + stamp + '.db';
}

// 备份当前数据文件到备份目录（仅当数据文件此前已存在时才备份，避免空库产生噪音备份）
function backupDatabase(dbPath, backupDir) {
  if (!fs.existsSync(dbPath)) {
    return null;
  }
  ensureDir(backupDir);
  const target = path.join(backupDir, buildBackupName(new Date()));
  fs.copyFileSync(dbPath, target);
  return target;
}

// 清理历史备份：按文件名（即时间）升序，只保留最近 maxBackups 份
function pruneBackups(backupDir, maxBackups) {
  if (!fs.existsSync(backupDir)) {
    return [];
  }
  const files = fs.readdirSync(backupDir)
    .filter(function (name) {
      return name.indexOf(BACKUP_PREFIX) === 0 && name.slice(-3) === '.db';
    })
    .sort(); // 文件名内嵌时间戳，字典序即时间序

  const removed = [];
  // 超出保留份数的部分从最旧开始删除
  while (files.length > maxBackups) {
    const oldest = files.shift();
    fs.unlinkSync(path.join(backupDir, oldest));
    removed.push(oldest);
  }
  return removed;
}

// 初始化数据库：建目录 → 打开连接 → WAL 与加固 pragma → 建表建索引 → 备份 → 清理旧备份
// overrides 供测试注入隔离参数（dbPath / dataDir / backupDir / maxBackups / backup），
// 生产环境不传即全部取 config，行为与 v0.2 一致
function initDatabase(overrides) {
  const opts = Object.assign({
    dbPath: config.DB_PATH,
    dataDir: config.DATA_DIR,
    backupDir: config.BACKUP_DIR,
    maxBackups: config.MAX_BACKUPS,
    backup: true
  }, overrides || {});

  // 内存库（测试用）没有目录概念，跳过建目录与备份
  const inMemory = opts.dbPath === ':memory:';
  if (!inMemory) {
    ensureDir(opts.dataDir);
    ensureDir(opts.backupDir);
  }

  // 记录打开前文件是否已存在，用于决定是否备份（新建的空库无需备份）
  const existedBefore = !inMemory && fs.existsSync(opts.dbPath);

  const db = new Database(opts.dbPath);

  // WAL 模式：提升读写并发表现
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // R8-1：写锁竞争时最多等待 5s 再报错，避免瞬时并发直接抛 SQLITE_BUSY
  db.pragma('busy_timeout = 5000');
  // R8-2：WAL 模式下 synchronous=NORMAL 是安全的，且显著降低每次提交的 fsync 开销
  db.pragma('synchronous = NORMAL');

  db.exec(CREATE_TABLE_SQL);
  db.exec(CREATE_INDEX_SQL);

  if (!opts.backup) {
    return db;
  }

  if (existedBefore) {
    // 备份前做一次 checkpoint，确保 WAL 中的增量已合并进主库文件再复制
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (e) {
      // checkpoint 失败不阻断启动，仅记录
      console.warn('[db] WAL checkpoint 失败，跳过本次预备份检查点：', e.message);
    }
    const backupFile = backupDatabase(opts.dbPath, opts.backupDir);
    const removed = pruneBackups(opts.backupDir, opts.maxBackups);
    console.log('[db] 启动备份完成：' + (backupFile ? path.basename(backupFile) : '无'));
    if (removed.length > 0) {
      console.log('[db] 清理旧备份 ' + removed.length + ' 份，当前保留上限 ' + opts.maxBackups + ' 份');
    }
  } else if (!inMemory) {
    console.log('[db] 首次启动，创建空库（不注入种子数据）：' + opts.dbPath);
  }

  return db;
}

// R8-3：关闭连接前先把 WAL 增量合并回主库并截断，避免遗留大 WAL 文件
// 说明：checkpoint 失败不应阻断退出流程，故吞掉异常并仅告警
function closeDatabase(db) {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (e) {
    console.warn('[db] 关闭前 WAL checkpoint 失败（不影响退出）：', e.message);
  }
  db.close();
}

module.exports = { initDatabase, closeDatabase };
