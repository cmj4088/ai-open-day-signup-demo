/* =========================================================
 * 路由层 · 报名 routes/registrations.js
 * AI 应用教学开放日报名系统（v0.3 分层重构）
 * 职责：**仅 HTTP 编排**——取参 → 调 Hook → 调 Service → 写响应
 * 变更：原 236 行单文件（校验 + SQL + CSV 拼装 + HTTP 编排）已按 R1 拆分为
 *       lib（纯函数）/ repositories（SQL）/ services（业务）/ 本文件（HTTP）
 * 约束：本文件不得出现 SQL、不得出现业务规则判断；
 *       API 契约与 v0.2 完全一致（Q4），仅新增可选分页参数与错误码 1003
 * ========================================================= */
'use strict';

const express = require('express');

const config = require('../config');
const csv = require('../lib/csv');
const { send } = require('../lib/response');
const { todayStamp } = require('../lib/datetime');
const { createRepo } = require('../repositories/registrationsRepo');
const { createService } = require('../services/registrationsService');

// 创建路由：依赖注入 { db, hooks }
function createRouter(deps) {
  const repo = createRepo(deps.db);
  const service = createService(repo);
  const hooks = deps.hooks;
  const router = express.Router();

  // ---------- 提交报名 ----------
  router.post('/', function (req, res, next) {
    // Hook 位于业务层、限流之后（D13）：先申请许可
    // 被拒时直接返回 1003，既不进入业务逻辑，也不触碰数据库（冷却期零写库）
    const permit = hooks.signupBurstGuard.tryAcquire();
    if (!permit.allowed) {
      return send(res, 503, config.CODES.BUSY, '当前报名人数较多，请稍后再试', null);
    }

    try {
      const result = service.signup(req.body || {});
      return send(res, result.status, result.code, result.message, result.data);
    } catch (err) {
      return next(err);
    } finally {
      // 必须在 finally 释放，保证异常路径下在途计数不泄漏
      hooks.signupBurstGuard.release();
    }
  });

  // ---------- 按手机号查询 ----------
  router.get('/lookup', function (req, res, next) {
    try {
      const result = service.lookup(req.query.phone);
      return send(res, result.status, result.code, result.message, result.data);
    } catch (err) {
      return next(err);
    }
  });

  // ---------- 导出 CSV（流式逐行写出，R4） ----------
  // 说明：路径与通用列表路由不同，无冲突；声明在此更贴近业务阅读顺序
  router.get('/export', function (req, res, next) {
    try {
      const stream = service.exportStream(req.query);
      const stamp = todayStamp(new Date());
      const asciiName = 'registrations-' + stamp + '.csv';
      const cnName = '报名名单-' + stamp + '.csv';

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      // 同时给出 ASCII 与其 UTF-8 编码名，兼容各浏览器下载表现
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="' + asciiName + '"; filename*=UTF-8\'\'' + encodeURIComponent(cnName)
      );

      // BOM + 表头先写，随后逐行流式输出，避免整串 CSV 驻留内存
      res.write(csv.BOM + csv.headerLine() + csv.CRLF);
      for (const record of stream.records) {
        res.write(csv.rowLine(record, stream.labels) + csv.CRLF);
      }
      return res.end();
    } catch (err) {
      // 流式响应一旦开始写出，状态码与响应头已定，无法再改；此时只能中断连接
      if (res.headersSent) {
        return res.destroy();
      }
      return next(err);
    }
  });

  // ---------- 名单列表（筛选，可选分页） ----------
  router.get('/', function (req, res, next) {
    try {
      const result = service.list(req.query);
      return send(res, result.status, result.code, result.message, result.data);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { createRouter };
