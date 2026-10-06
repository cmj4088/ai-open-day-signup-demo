/* =========================================================
 * API 客户端 store.js（v0.3）
 * AI 应用教学开放日报名系统
 * 职责：统一封装对后端 REST API 的 fetch 调用，
 *       向上层（用户端 / 管理端）暴露 list / getByPhone / add / exportUrl 与字典
 * 约束：经典 script（非 ES module），通过 window.Store 暴露
 * 变更：v0.1 封装 localStorage，v0.2 起全部改走后端 API（同源相对路径），
 *       v0.3（R10）起所有请求统一带 15s 超时并做统一错误分类；
 *       add 的 network / duplicate / invalid 三种 reason 语义保持不变（Q4 契约要求）
 * ========================================================= */

(function (window) {
  'use strict';

  // 接口基地址：与后端同源（由 Node 服务统一托管前端），故用空串走相对路径
  var API_BASE = '';

  // 统一错误文案，网络异常时展示
  var NETWORK_ERROR_MESSAGE = '网络异常，请稍后重试';

  // 请求超时（R10）：后端僵死或网络黑洞时 fetch 可能长时间挂起，
  // 页面会一直停在「提交中…」，故统一设 15s 上限
  var TIMEOUT_MS = 15000;

  // 超时文案：与网络异常区分开，便于用户判断是「服务慢」还是「网断了」
  var TIMEOUT_ERROR_MESSAGE = '请求超时，请稍后重试';

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

  // 统一请求入口（R10）：所有 fetch 都经此，保证「超时 + JSON 解析 + 错误分类」只有一处实现
  // 入参：path 为相对路径，init 为 fetch 配置（可省略）
  // 出参：Promise<响应体对象>；超时 / 网络异常 / 非 JSON 一律 reject Error(中文文案)
  function request(path, init) {
    var options = init || {};
    var controller = null;
    var timer = null;

    // AbortController 在旧浏览器可能缺失：缺失时退化为「无超时」而不是直接报错
    if (typeof window.AbortController === 'function') {
      controller = new window.AbortController();
      options.signal = controller.signal;
      timer = window.setTimeout(function () {
        controller.abort();
      }, TIMEOUT_MS);
    }

    // 无论成功还是失败都要清掉定时器，否则会残留定时器句柄
    function settle() {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    }

    return fetch(API_BASE + path, options).then(function (res) {
      settle();
      // 服务端非 JSON 响应（如反向代理返回 502 页面）也归为网络异常
      return res.json().catch(function () {
        throw new Error(NETWORK_ERROR_MESSAGE);
      });
    }, function (err) {
      settle();
      // 统一错误分类：abort 即超时，其余（断网 / DNS / 连不上）为网络异常
      var aborted = err && err.name === 'AbortError';
      throw new Error(aborted ? TIMEOUT_ERROR_MESSAGE : NETWORK_ERROR_MESSAGE);
    });
  }

  // 统一 GET：解析 { code, message, data }；HTTP 层异常抛出 Error(message)
  function getJson(path) {
    return request(path).then(function (body) {
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

  // 业务错误码 → 前端分类（语义与 v0.2 完全一致：1002 = 手机号重复，其余非 0 = 校验/业务失败）
  // 说明：后端新增的 1003（报名突发保护）不新增前端分类，复用 invalid 并透传服务端文案，
  //       使对外契约始终只有 network / duplicate / invalid 三种 reason（Q4）
  function classifyCode(code) {
    return code === 1002 ? 'duplicate' : 'invalid';
  }

  // 提交报名：resolve { ok, data?, reason?, message? }，永不 reject（便于页面统一处理）
  function add(record) {
    return request('/api/registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record)
    }).then(function (body) {
      if (body && body.code === 0) {
        return { ok: true, data: body.data };
      }
      return {
        ok: false,
        reason: classifyCode(body && body.code),
        message: (body && body.message) || '提交失败，请检查填写内容'
      };
    }).catch(function (err) {
      // 超时与断网统一归为 network；文案区分「超时」与「网络异常」，便于用户判断
      return { ok: false, reason: 'network', message: (err && err.message) || NETWORK_ERROR_MESSAGE };
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
