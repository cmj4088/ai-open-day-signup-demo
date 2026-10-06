/* =========================================================
 * ESLint flat config（扁平配置，ESLint v9）
 * AI 应用教学开放日报名系统 · 发布门控之一（npm run lint）
 * 职责：只抓「真实缺陷」，不启用任何格式化 / 风格规则（D12）
 * 约束：通过标准为「零 error」（D19），warning 允许但需在报告中列明
 * 说明：本项目横跨三种运行环境（Node CJS / 浏览器 classic script / 测试），
 *       故按目录分别声明 sourceType 与 globals，避免误报 no-undef
 * ========================================================= */
'use strict';

// ---------- 环境全局变量清单（手工声明，避免为 globals 包再引入依赖，遵守 Q5） ----------

// Node.js 侧可用全局：CommonJS 包装器 + 标准库 + 现代 Web 标准（Node ≥18 已内置）
const NODE_GLOBALS = {
  require: 'readonly',
  module: 'readonly',
  exports: 'writable',
  __dirname: 'readonly',
  __filename: 'readonly',
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  global: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  queueMicrotask: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly'
};

// 浏览器侧可用全局：前端为经典 script（非模块），只显式声明用到的
const BROWSER_GLOBALS = {
  window: 'readonly',
  document: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  XMLHttpRequest: 'readonly',
  Blob: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  localStorage: 'readonly',
  requestAnimationFrame: 'readonly'
};

// ---------- 只抓真实缺陷的规则集（无一条风格/格式化规则） ----------
const DEFECT_RULES = {
  // 引用未声明的变量（拼写错误、漏 require 的典型信号）
  'no-undef': 'error',
  // 声明未使用的变量（死代码信号）；忽略以 _ 开头的占位参数
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  // 重复声明同一标识符
  'no-redeclare': 'error',
  // 对象字面量重复键（后者覆盖前者，几乎总是笔误）
  'no-dupe-keys': 'error',
  // 函数参数名 / 形参重复
  'no-dupe-args': 'error',
  // switch case 重复
  'no-duplicate-case': 'error',
  // 不可达代码
  'no-unreachable': 'error',
  // 条件里恒真恒假（如 if (x = 1) 之外的常量条件笔误）
  'no-constant-condition': 'error',
  // 条件表达式里出现赋值（经典的 = 与 == 混淆）
  'no-cond-assign': 'error',
  // 对函数声明重新赋值
  'no-func-assign': 'error',
  // 正则中的无效字符类等
  'no-invalid-regexp': 'error',
  // 异步 Promise executor 里 return（静默吞掉错误）
  'no-async-promise-executor': 'error',
  // 自比较 x === x
  'no-self-compare': 'error',
  // 空语句块（可能是漏写实现）；catch 允许为空（本仓库有意用之）
  'no-empty': ['error', { allowEmptyCatch: true }],
  // 在 finally 中 return / throw（会吞掉异常）
  'no-unsafe-finally': 'error',
  // 数值与 NaN 的比较
  'use-isnan': 'error',
  // 与 -0 比较
  'no-compare-neg-zero': 'error',
  // typeof 结果与非法字符串比较
  'valid-typeof': 'error'
};

module.exports = [
  // 忽略依赖与运行时数据目录（压测产物 results/ 也不纳入 lint）
  {
    ignores: ['node_modules/**', 'server/node_modules/**', 'data/**', 'scripts/stress/results/**']
  },

  // 后端源码：CommonJS
  {
    files: ['server/**/*.js'],
    ignores: ['server/test/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: NODE_GLOBALS
    },
    rules: DEFECT_RULES
  },

  // 后端测试：同样是 CommonJS，额外允许 node:test 相关全局
  {
    files: ['server/test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: NODE_GLOBALS
    },
    rules: DEFECT_RULES
  },

  // 前端脚本：经典 script，浏览器环境
  {
    files: ['assets/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2018,
      sourceType: 'script',
      globals: BROWSER_GLOBALS
    },
    rules: DEFECT_RULES
  },

  // 工程脚本（构建 / 压测）：Node CommonJS
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: NODE_GLOBALS
    },
    rules: DEFECT_RULES
  },

  // 根配置自身
  {
    files: ['eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: NODE_GLOBALS
    },
    rules: DEFECT_RULES
  }
];
