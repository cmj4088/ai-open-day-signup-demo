/* =========================================================
 * 管理端 admin.js（v0.2）
 * AI 应用教学开放日报名名单管理
 * 职责：渲染筛选控件、按筛选条件调后端取名单、渲染表格、导出 CSV（真实下载）
 * 约束：经典 script（非 ES module），数据读写一律经由 window.Store（API 客户端）
 * 变更：v0.1 直接读 localStorage 且导出仅提示，v0.2 起筛选走服务端、导出真实下载
 * ========================================================= */
(function (window, document) {
  'use strict';

  // API 客户端引用
  var Store = window.Store;

  // 空值统一展示文案
  var EMPTY_LABEL = '—';

  // 空状态默认文案（加载失败时会被临时替换，重新渲染时恢复）
  var DEFAULT_EMPTY_TEXT = '暂无报名记录哦';

  // 导出提示自动隐藏延时（毫秒）
  var NOTICE_HIDE_DELAY = 4000;

  // 导出提示定时器句柄
  var noticeTimer = null;

  // 请求序号：筛选频繁触发时，仅采纳最后一次请求的结果，避免旧响应覆盖新结果
  var requestSeq = 0;

  // -------- DOM 引用缓存 --------
  var elStatBar = document.getElementById('stat-bar');
  var elRole = document.getElementById('filter-role');
  var elSession = document.getElementById('filter-session');
  var elKeyword = document.getElementById('filter-keyword');
  var elReset = document.getElementById('btn-reset');
  var elExport = document.getElementById('btn-export');
  var elExportNotice = document.getElementById('export-notice');
  var elEmptyNotice = document.getElementById('empty-notice');
  var elTableBody = document.getElementById('table-body');

  // 数字补零到两位，如 9 → '09'
  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  // 把 ISO 时间字符串格式化为 YYYY-MM-DD HH:mm；非法值返回 '—'
  function formatDateTime(iso) {
    if (!iso) {
      return EMPTY_LABEL;
    }
    var d = new Date(iso);
    if (isNaN(d.getTime())) {
      return EMPTY_LABEL;
    }
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  // 转义 HTML 特殊字符，避免用户输入被当作标签解析
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 取场次的时间段文案，未匹配返回空串（用于表格次要说明）
  function sessionTime(key) {
    var sessions = Store.SESSIONS || [];
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].key === key) {
        return sessions[i].time || '';
      }
    }
    return '';
  }

  // 把身份下拉渲染为「全部身份」+ ROLES 字典项
  function renderRoleOptions() {
    var roles = Store.ROLES || [];
    var html = '<option value="">全部身份</option>';
    for (var i = 0; i < roles.length; i++) {
      html += '<option value="' + escapeHtml(roles[i].key) + '">' + escapeHtml(roles[i].label) + '</option>';
    }
    elRole.innerHTML = html;
  }

  // 把场次下拉渲染为「全部场次」+ SESSIONS 字典项
  function renderSessionOptions() {
    var sessions = Store.SESSIONS || [];
    var html = '<option value="">全部场次</option>';
    for (var i = 0; i < sessions.length; i++) {
      html += '<option value="' + escapeHtml(sessions[i].key) + '">' + escapeHtml(sessions[i].label) + '</option>';
    }
    elSession.innerHTML = html;
  }

  // 读取当前筛选条件：空字符串表示该条件不参与过滤
  function readFilters() {
    return {
      role: elRole.value,
      session: elSession.value,
      keyword: elKeyword.value.trim()
    };
  }

  // 生成表格的一行 HTML（列顺序：报名时间 / 姓名 / 身份 / 院系 / 手机号 / 参加场次）
  function buildRowHtml(record) {
    var roleLabel = Store.roleLabel(record.role);
    var sessionLabel = Store.sessionLabel(record.session);
    var department = record.department ? escapeHtml(record.department) : EMPTY_LABEL;
    var name = record.name ? escapeHtml(record.name) : EMPTY_LABEL;
    var phone = record.phone ? escapeHtml(record.phone) : EMPTY_LABEL;
    // 场次额外附带时间段说明
    var time = sessionTime(record.session);
    var sessionCell = '<span class="badge">' + escapeHtml(sessionLabel) + '</span>' +
      (time ? ' <span class="muted">' + escapeHtml(time) + '</span>' : '');

    return '<tr>' +
      '<td>' + escapeHtml(formatDateTime(record.createdAt)) + '</td>' +
      '<td>' + name + '</td>' +
      '<td><span class="badge">' + escapeHtml(roleLabel) + '</span></td>' +
      '<td>' + department + '</td>' +
      '<td>' + phone + '</td>' +
      '<td>' + sessionCell + '</td>' +
      '</tr>';
  }

  // 展示空状态（可传自定义文案，默认恢复为「暂无报名记录哦」）
  function showEmpty(message) {
    elEmptyNotice.textContent = message || DEFAULT_EMPTY_TEXT;
    elEmptyNotice.classList.remove('hidden');
  }

  // 隐藏空状态
  function hideEmpty() {
    elEmptyNotice.classList.add('hidden');
  }

  // 核心渲染：按当前筛选调后端取名单 → 更新统计条 → 渲染表格 → 切换空状态
  function render() {
    var filters = readFilters();
    var seq = ++requestSeq;

    elStatBar.textContent = '加载中…';
    hideEmpty();

    Store.list(filters).then(function (records) {
      // 仅采纳最后一次请求的结果，避免筛选快速切换时旧响应覆盖新结果
      if (seq !== requestSeq) {
        return;
      }
      elStatBar.textContent = '共 ' + records.length + ' 条报名';
      elTableBody.innerHTML = records.map(buildRowHtml).join('');
      if (records.length === 0) {
        showEmpty();
      } else {
        hideEmpty();
      }
    }).catch(function (err) {
      if (seq !== requestSeq) {
        return;
      }
      // 加载失败：清空表格并给出可辨识的错误提示（区别于「无数据」）
      elStatBar.textContent = '加载失败';
      elTableBody.innerHTML = '';
      showEmpty('名单加载失败：' + ((err && err.message) || '网络异常'));
    });
  }

  // 重置：清空三个筛选控件并重新渲染全部
  function handleReset() {
    elRole.value = '';
    elSession.value = '';
    elKeyword.value = '';
    render();
  }

  // 展示导出提示，几秒后自动隐藏（重复点击先清旧定时器）
  function showNotice(message) {
    elExportNotice.textContent = message;
    elExportNotice.classList.remove('hidden');
    if (noticeTimer) {
      window.clearTimeout(noticeTimer);
    }
    noticeTimer = window.setTimeout(function () {
      elExportNotice.classList.add('hidden');
      noticeTimer = null;
    }, NOTICE_HIDE_DELAY);
  }

  // 导出按钮：按当前筛选构造下载地址，用隐藏 <a> 触发真实下载
  function handleExport() {
    var filters = readFilters();
    var url = Store.exportUrl(filters);

    var link = document.createElement('a');
    link.href = url;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showNotice('已按当前筛选条件开始下载 CSV，请查看浏览器下载目录');
  }

  // 绑定事件：筛选控件实时联动 + 重置 + 导出
  function bindEvents() {
    elRole.addEventListener('change', render);
    elSession.addEventListener('change', render);
    elKeyword.addEventListener('input', render);
    elReset.addEventListener('click', handleReset);
    elExport.addEventListener('click', handleExport);
  }

  // 入口：等后端字典就绪 → 渲染下拉 → 绑定事件 → 首屏加载名单
  function init() {
    Store.ready.then(function () {
      renderRoleOptions();
      renderSessionOptions();
      bindEvents();
      render();
    });
  }

  // DOM 就绪后初始化（脚本置于 body 末尾，通常已就绪，仍做一次兜底判断）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window, document);
