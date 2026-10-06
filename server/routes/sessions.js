/* =========================================================
 * 场次字典路由 routes/sessions.js
 * AI 应用教学开放日报名系统（v0.2 前后端分离）
 * 职责：GET /api/sessions 返回场次字典（主题/时间/地点），供前端渲染
 * 约束：CommonJS；数据源统一取 config.SESSIONS，避免多处硬编码
 * ========================================================= */
'use strict';

const express = require('express');

const config = require('../config');

// 创建路由
function createRouter() {
  const router = express.Router();

  // 返回场次数组：data = [{ key, label, time, place, theme }, ...]
  router.get('/', function (req, res) {
    return res.status(200).json({
      code: config.CODES.OK,
      message: '查询成功',
      data: config.SESSIONS
    });
  });

  return router;
}

module.exports = { createRouter };
