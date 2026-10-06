/* =========================================================
 * 用户端逻辑 user.js
 * AI 应用教学开放日报名系统（静态 HTML Demo）
 * 职责：表单渲染与校验、提交报名、三视图切换、按手机号查询
 * 约束：经典 script（非 ES module），全部数据读写走 window.Store
 * ========================================================= */
(function (window, document) {
  'use strict';

  var Store = window.Store;

  // ---------- 视图容器 ----------
  var viewSignup = document.getElementById('view-signup');
  var viewSuccess = document.getElementById('view-success');
  var viewQuery = document.getElementById('view-query');

  // ---------- 报名表单元素 ----------
  var form = document.getElementById('signup-form');
  var inputName = document.getElementById('input-name');
  var inputRole = document.getElementById('input-role');
  var inputDepartment = document.getElementById('input-department');
  var inputPhone = document.getElementById('input-phone');
  var inputSession = document.getElementById('input-session');

  // ---------- 报名表单错误提示元素 ----------
  var errorName = document.getElementById('error-name');
  var errorPhone = document.getElementById('error-phone');
  var errorSession = document.getElementById('error-session');

  // ---------- 成功页元素 ----------
  var successName = document.getElementById('success-name');
  var successSession = document.getElementById('success-session');

  // ---------- 查询页元素 ----------
  var queryPhone = document.getElementById('query-phone');
  var queryResult = document.getElementById('query-result');

  // 切换视图：先全部取消 active，再点亮目标视图，并回到页面顶部
  function showView(target) {
    var views = [viewSignup, viewSuccess, viewQuery];
    for (var i = 0; i < views.length; i++) {
      views[i].classList.remove('active');
    }
    target.classList.add('active');
    window.scrollTo(0, 0);
  }

  // 显示某字段错误：写入文案并加 .show 使其可见
  function showError(el, message) {
    el.textContent = message;
    el.classList.add('show');
  }

  // 清除某字段错误：清空文案并移除 .show 使其隐藏
  function clearError(el) {
    el.textContent = '';
    el.classList.remove('show');
  }

  // 渲染顶部场次介绍区：主题一行 + 每场次一行（时间 · 地点）
  function renderSessionInfo() {
    var box = document.getElementById('session-info');
    box.innerHTML = '';

    // 主题行：所有场次共用同一主题，取第一条即可
    if (Store.SESSIONS.length > 0) {
      box.appendChild(buildRow('活动主题', Store.SESSIONS[0].theme));
    }
    // 逐个场次渲染：标签 + 时间 · 地点
    for (var i = 0; i < Store.SESSIONS.length; i++) {
      var s = Store.SESSIONS[i];
      box.appendChild(buildRow(s.label, s.time + ' · ' + s.place));
    }
  }

  // 构造一行结果：.result-row（左标签 / 右值），使用 textContent 避免注入
  function buildRow(label, value) {
    var row = document.createElement('div');
    row.className = 'result-row';

    var labelEl = document.createElement('span');
    labelEl.className = 'result-label';
    labelEl.textContent = label;

    var valueEl = document.createElement('span');
    valueEl.className = 'result-value';
    valueEl.textContent = value;

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    return row;
  }

  // 渲染身份下拉：保留首个「请选择身份」空选项，追加 Store.ROLES
  function renderRoleOptions() {
    for (var i = 0; i < Store.ROLES.length; i++) {
      var opt = document.createElement('option');
      opt.value = Store.ROLES[i].key;
      opt.textContent = Store.ROLES[i].label;
      inputRole.appendChild(opt);
    }
  }

  // 渲染场次下拉：保留首个「请选择场次」空选项，追加 Store.SESSIONS
  function renderSessionOptions() {
    for (var i = 0; i < Store.SESSIONS.length; i++) {
      var s = Store.SESSIONS[i];
      var opt = document.createElement('option');
      opt.value = s.key;
      opt.textContent = s.label + ' ' + s.time;
      inputSession.appendChild(opt);
    }
  }

  // ---------- 字段校验（返回布尔值，同时控制错误提示显隐） ----------

  // 姓名：去空格后非空
  function validateName() {
    if (inputName.value.trim() === '') {
      showError(errorName, '请填写姓名哦');
      return false;
    }
    clearError(errorName);
    return true;
  }

  // 手机号格式校验（同步）：非空且为 11 位数字
  function validatePhoneFormat() {
    var phone = inputPhone.value.trim();
    if (!/^\d{11}$/.test(phone)) {
      showError(errorPhone, '请填写正确的 11 位手机号哦');
      return false;
    }
    clearError(errorPhone);
    return true;
  }

  // 手机号查重（异步，失焦时触发）：调后端按手机号查询，命中即提示已报名
  function checkPhoneDuplicate() {
    if (!validatePhoneFormat()) {
      return;
    }
    var phone = inputPhone.value.trim();
    Store.getByPhone(phone).then(function (record) {
      // 请求返回时输入框可能已被改动，二次确认当前值再决定是否提示
      if (inputPhone.value.trim() !== phone) {
        return;
      }
      if (record) {
        showError(errorPhone, '该手机号已报名，请勿重复提交');
      } else {
        clearError(errorPhone);
      }
    }).catch(function () {
      // 网络异常时静默，提交阶段由服务端唯一索引兜底
    });
  }

  // 参加场次：必须选择
  function validateSession() {
    if (inputSession.value === '') {
      showError(errorSession, '请选择参加场次哦');
      return false;
    }
    clearError(errorSession);
    return true;
  }

  // 提交中状态：禁用按钮，避免重复点击造成并发提交
  var submitting = false;

  // 切换提交按钮的禁用态与文案
  function setSubmitting(flag) {
    submitting = flag;
    var btn = form.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = flag;
      btn.textContent = flag ? '提交中…' : '提交报名';
    }
  }

  // 提交：整体校验 → 聚焦首个错误字段 → 调后端 API 写入 → 切成功页
  function handleSubmit(event) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    // 依次做前端同步校验（必填与格式）；重复性由服务端唯一索引兜底
    var okName = validateName();
    var okPhone = validatePhoneFormat();
    var okSession = validateSession();

    // 任一不通过：聚焦第一个出错字段并中止
    if (!okName || !okPhone || !okSession) {
      if (!okName) {
        inputName.focus();
      } else if (!okPhone) {
        inputPhone.focus();
      } else {
        inputSession.focus();
      }
      return;
    }

    setSubmitting(true);
    // 调用后端提交报名
    Store.add({
      name: inputName.value.trim(),
      role: inputRole.value,
      department: inputDepartment.value.trim(),
      phone: inputPhone.value.trim(),
      session: inputSession.value
    }).then(function (result) {
      setSubmitting(false);

      // 失败：重复手机号按业务文案提示；其余（含网络异常）统一在手机号下方提示
      if (!result.ok) {
        if (result.reason === 'duplicate') {
          showError(errorPhone, '该手机号已报名，请勿重复提交');
        } else {
          showError(errorPhone, result.message || '提交失败，请稍后重试');
        }
        inputPhone.focus();
        return;
      }

      // 成功后填充回执并切到成功页
      successName.textContent = result.data.name;
      successSession.textContent = sessionDetail(result.data.session);
      showView(viewSuccess);
    });
  }

  // 场次键 → 「标签 · 时间 · 地点」整串文案；未匹配则退回 Store.sessionLabel
  function sessionDetail(key) {
    for (var i = 0; i < Store.SESSIONS.length; i++) {
      var s = Store.SESSIONS[i];
      if (s.key === key) {
        return s.label + ' · ' + s.time + ' · ' + s.place;
      }
    }
    return Store.sessionLabel(key);
  }

  // 将 ISO 时间格式化为 YYYY-MM-DD HH:mm；非法值返回 '—'
  function formatDateTime(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) {
      return '—';
    }
    var pad = function (n) {
      return n < 10 ? '0' + n : '' + n;
    };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  // 查询：按手机号命中则渲染结果卡，否则给红色提示
  function handleQuery() {
    var phone = queryPhone.value.trim();

    // 未输入或格式不合法：先给提示后返回
    if (phone === '') {
      renderNotice('请先输入手机号再查询哦', 'error');
      return;
    }
    if (!/^\d{11}$/.test(phone)) {
      renderNotice('请填写正确的 11 位手机号哦', 'error');
      return;
    }

    renderNotice('查询中…', 'info');
    // 调后端按手机号查询
    Store.getByPhone(phone).then(function (record) {
      // 未命中：固定文案
      if (!record) {
        renderNotice('暂未查到报名记录哦', 'error');
        return;
      }

      // 命中：渲染结果卡（姓名 / 身份 / 院系 / 参加场次 / 报名时间）
      queryResult.innerHTML = '';
      var card = document.createElement('div');
      card.className = 'result-card';
      card.appendChild(buildRow('姓名', record.name));
      card.appendChild(buildRow('身份', Store.roleLabel(record.role)));
      card.appendChild(buildRow('院系', record.department || '—'));
      card.appendChild(buildRow('参加场次', Store.sessionLabel(record.session)));
      card.appendChild(buildRow('报名时间', formatDateTime(record.createdAt)));
      queryResult.appendChild(card);
    }).catch(function () {
      renderNotice('网络异常，请稍后重试', 'error');
    });
  }

  // 在查询容器内渲染一条提示（info 默认 / error 红色）
  function renderNotice(message, type) {
    queryResult.innerHTML = '';
    var notice = document.createElement('div');
    notice.className = 'notice ' + (type === 'error' ? 'notice-error' : 'notice-info');
    notice.textContent = message;
    queryResult.appendChild(notice);
  }

  // 返回首页：重置表单并清空提示，回到报名页
  function backToSignup(reset) {
    if (reset) {
      form.reset();
      clearError(errorName);
      clearError(errorPhone);
      clearError(errorSession);
    }
    showView(viewSignup);
  }

  // ---------- 初始化：渲染字典 + 绑定事件 ----------
  function init() {
    // 场次字典来自后端接口，就绪后再渲染下拉与介绍区（保证与服务端一致）
    Store.ready.then(function () {
      renderSessionInfo();
      renderRoleOptions();
      renderSessionOptions();
    });

    // 失焦实时校验（手机号额外做一次异步查重）
    inputName.addEventListener('blur', validateName);
    inputPhone.addEventListener('blur', checkPhoneDuplicate);
    inputSession.addEventListener('blur', validateSession);

    // 提交表单
    form.addEventListener('submit', handleSubmit);

    // 报名页 → 查询页
    document.getElementById('go-query').addEventListener('click', function () {
      showView(viewQuery);
    });

    // 成功页：返回首页（重置表单）/ 查询状态
    document.getElementById('success-home').addEventListener('click', function () {
      backToSignup(true);
    });
    document.getElementById('success-query').addEventListener('click', function () {
      showView(viewQuery);
    });

    // 查询页：查询 / 返回报名页
    document.getElementById('btn-query').addEventListener('click', handleQuery);
    document.getElementById('query-back').addEventListener('click', function () {
      backToSignup(false);
    });

    // 查询框内回车即查询，提升手感
    queryPhone.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleQuery();
      }
    });
  }

  init();
})(window, document);