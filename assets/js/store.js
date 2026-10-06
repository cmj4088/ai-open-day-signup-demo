/* =========================================================
 * API 客户端 store.js（v0.2）
 * AI 应用教学开放日报名系统
 * 职责：统一封装对后端 REST API 的 fetch 调用，
 *       向上层（用户端 / 管理端）暴露 list / getByPhone / add / exportUrl 与字典
 * 约束：经典 script（非 ES module），通过 window.Store 暴露
 * 变更：v0.1 封装 localStorage，v0.2 起全部改走后端 API（同源相对路径）
 * ========================================================= */

(function (window) {
  'use strict';

  // 接口基地址：与后端同源（由 Node 服务统一托管前端），故用空串走相对路径
  var API_BASE = '';

  // 统一错误文案，网络异常时展示
  var NETWORK_ERROR_MESSAGE = '网络异常，请稍后重试';

  // 场次字典兜底值：页面渲染前先有内容，接口返回后会被覆盖（保证首屏不空白）
  var SESSIONS = [
    { key: 'morning', label: '上午场', time: '09:00–12:00', place: '报告厅 A', theme: 'AI 应用教学开放日' },
    { key: 'afternoon', label: '下午场', time: '14:00–17:00', place: '报告厅 A', theme: 'AI 应用教学开放日' }
  ];

  // 身份字典：纯 UI 枚举，前端内聚维护
  var ROLES = [
    { key: 'teacher', label: '教师' },
    { key: 'student', label: '学生' },
    { key: 'other', label: '其他' }
  ];

  // 空值统一展示文案（与后端 CSV 展示保持一致）
  var EMPTY_LABEL = '—';

  // 把筛选条件对象拼成查询串（空值忽略；关键词做 encodeURIComponent）
  function buildQuery(filters) {
    var f = filters || {};
    var parts = [];
    if (f.role) {
      parts.push('role=' + encodeURIComponent(f.role));
    }
    if (f.session) {
      parts.push('session=' + encodeURIComponent(f.session));
    }
    if (f.keyword) {
      parts.push('keyword=' + encodeURIComponent(f.keyword));
    }
    return parts.length > 0 ? '?' + parts.join('&') : '';
  }

  // 统一 GET：解析 { code, message, data }；HTTP 层异常抛出 Error(message)
  function getJson(path) {
    return fetch(API_BASE + path).then(function (res) {
      return res.json().catch(function () {
        throw new Error(NETWORK_ERROR_MESSAGE);
      });
    }).then(function (body) {
      if (!body || body.code !== 0) {
        throw new Error((body && body.message) || NETWORK_ERROR_MESSAGE);
      }
      return body.data;
    });
  }

  // 拉取场次字典：失败时保留兜底值，不阻断页面（返回 Promise 供 ready 使用）
  function loadSessions() {
    return getJson('/api/sessions').then(function (data) {
      if (Array.isArray(data) && data.length > 0) {
        SESSIONS = data;
      }
      return SESSIONS;
    }).catch(function () {
      return SESSIONS;
    });
  }

  // 名单列表（带筛选）：resolve 记录数组；失败 reject
  function list(filters) {
    return getJson('/api/registrations' + buildQuery(filters));
  }

  // 按手机号查询：resolve 记录或 null；失败 reject
  function getByPhone(phone) {
    return getJson('/api/registrations/lookup?phone=' + encodeURIComponent(phone));
  }

  // 提交报名：resolve { ok, data?, reason?, message? }，永不 reject（便于页面统一处理）
  function add(record) {
    return fetch(API_BASE + '/api/registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record)
    }).then(function (res) {
      return res.json().then(function (body) {
        return { ok: body.code === 0, data: body.data, reason: body.code, message: body.message };
      });
    }).then(function (result) {
      // 1002 = 手机号重复，其余非 0 视为校验失败
      if (!result.ok) {
        return {
          ok: false,
          reason: result.reason === 1002 ? 'duplicate' : 'invalid',
          message: result.message || '提交失败，请检查填写内容'
        };
      }
      return { ok: true, data: result.data };
    }).catch(function () {
      return { ok: false, reason: 'network', message: NETWORK_ERROR_MESSAGE };
    });
  }

  // 导出下载地址：交给页面用隐藏 <a> 触发下载（浏览器处理 Content-Disposition）
  function exportUrl(filters) {
    return API_BASE + '/api/registrations/export' + buildQuery(filters);
  }

  // 场次键 → 展示文案，空值/未匹配返回 '—'
  function sessionLabel(key) {
    for (var i = 0; i < SESSIONS.length; i++) {
      if (SESSIONS[i].key === key) {
        return SESSIONS[i].label;
      }
    }
    return EMPTY_LABEL;
  }

  // 身份键 → 展示文案，空值/未匹配返回 '—'
  function roleLabel(key) {
    for (var i = 0; i < ROLES.length; i++) {
      if (ROLES[i].key === key) {
        return ROLES[i].label;
      }
    }
    return EMPTY_LABEL;
  }

  // 页面就绪用：场次字典拉取完成后 resolve（页面据此渲染下拉）
  var ready = loadSessions();

  // 暴露全局 API 与字典，供用户端 / 管理端复用
  window.Store = {
    ready: ready,
    list: list,
    getByPhone: getByPhone,
    add: add,
    exportUrl: exportUrl,
    sessionLabel: sessionLabel,
    roleLabel: roleLabel,
    get SESSIONS() {
      return SESSIONS;
    },
    ROLES: ROLES
  };
})(window);
