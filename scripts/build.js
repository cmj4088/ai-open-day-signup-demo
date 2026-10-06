/* =========================================================
 * 无产物构建校验 scripts/build.js（D16 / R15）
 * AI 应用教学开放日报名系统 · 发布门控之一（npm run build）
 * 职责：本项目「零构建」（不打包、不产出 dist/），故 build 的语义是
 *       发布前静态校验，等价于三道检查，全部通过才允许发布：
 *         1) 全量 JS 语法扫描：对仓库内所有 .js 执行 node --check
 *         2) HTML 引用死链校验：解析 user.html / admin.html 中的本地资源引用并核对文件存在
 *         3) 发布清单输出：列出本次将随仓库发布的交付物，便于人工核对
 * 约束：CommonJS；不使用任何第三方依赖；任一检查失败即以非零码退出
 * ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// 仓库根目录（本文件位于 <root>/scripts/ 下，故向上一级）
const ROOT = path.resolve(__dirname, '..');

// 扫描时跳过的目录：依赖、运行时数据、压测产物、版本库元数据
const SKIP_DIRS = new Set(['node_modules', 'data', '.git', 'results', '.trae']);

// 需要做资源引用校验的 HTML 入口页
const HTML_PAGES = ['user.html', 'admin.html'];

// 外部引用前缀：这些不需要在本仓库中存在对应文件
const EXTERNAL_PREFIXES = ['http://', 'https://', '//', 'data:', 'mailto:', 'tel:', 'javascript:', '#'];

// 发布清单：随仓库发布的顶层交付物（用于人工核对，缺失即告警）
const MANIFEST = [
  'README.md',
  'LICENSE',
  '.gitignore',
  'package.json',
  'eslint.config.js',
  'user.html',
  'admin.html',
  'start.sh',
  'start.bat',
  'assets/css/style.css',
  'assets/js/store.js',
  'assets/js/user.js',
  'assets/js/admin.js',
  'server/server.js',
  'server/app.js',
  'server/config.js',
  'server/package.json',
  'scripts/build.js',
  'docs/部署文档.md',
  'docs/压力测试报告.md'
];

// 递归收集指定目录下所有 .js 文件（跳过 SKIP_DIRS）
function collectJsFiles(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      collectJsFiles(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

// 用 node --check 校验单个文件语法（子进程隔离，避免污染本进程）
function syntaxCheck(file) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status === 0) {
    return null;
  }
  // 优先输出 stderr，其次 stdout，最后兜底一句
  const detail = (result.stderr || result.stdout || '未知语法错误').trim();
  return detail;
}

// 是否外部引用（不校验本地存在性）
function isExternalRef(ref) {
  const lower = ref.toLowerCase();
  return EXTERNAL_PREFIXES.some(function (prefix) {
    return lower.startsWith(prefix);
  });
}

// 解析 HTTP 头部分之前就剥掉 query / hash，只留路径部分
function stripQueryAndHash(ref) {
  return ref.split('#')[0].split('?')[0];
}

// 校验单个 HTML 页面的本地资源引用是否存在
function checkHtmlRefs(page) {
  const pagePath = path.join(ROOT, page);
  if (!fs.existsSync(pagePath)) {
    return { ok: false, errors: ['入口页缺失：' + page], refs: 0 };
  }

  const html = fs.readFileSync(pagePath, 'utf8');
  // 抓取所有 src="..." 与 href="..." 的引用
  const refPattern = /(?:src|href)\s*=\s*"([^"]*)"/g;
  const errors = [];
  let refs = 0;
  let match;

  while ((match = refPattern.exec(html)) !== null) {
    const raw = match[1].trim();
    if (raw === '' || isExternalRef(raw)) {
      continue;
    }
    refs += 1;

    // 本地引用：按页面所在目录解析为绝对路径
    const localPath = path.resolve(path.dirname(pagePath), stripQueryAndHash(raw));
    // 只校验仓库内部引用（防止越权引用到仓库外）
    if (!localPath.startsWith(ROOT)) {
      errors.push(page + ' 引用了仓库外资源：' + raw);
      continue;
    }
    if (!fs.existsSync(localPath)) {
      errors.push(page + ' 引用死链：' + raw + ' → ' + path.relative(ROOT, localPath));
    }
  }

  return { ok: errors.length === 0, errors: errors, refs: refs };
}

// 打印发布清单并统计缺失项（缺失仅告警不失败，AC14 的判据是「清单正常输出」）
function printManifest() {
  console.log('\n[build] 发布清单（随仓库发布的关键交付物）：');
  const missing = [];
  for (const item of MANIFEST) {
    const exists = fs.existsSync(path.join(ROOT, item));
    console.log('  ' + (exists ? '[✓]' : '[ ]') + ' ' + item);
    if (!exists) {
      missing.push(item);
    }
  }
  return missing;
}

// 主流程：语法扫描 → HTML 死链 → 发布清单，全部通过返回 0
function main() {
  let failed = false;

  // ---------- 检查 1：全量 JS 语法扫描 ----------
  console.log('[build] 检查 1/3：JS 语法扫描（node --check）');
  const jsFiles = collectJsFiles(ROOT, []);
  const syntaxErrors = [];
  for (const file of jsFiles) {
    const err = syntaxCheck(file);
    if (err) {
      syntaxErrors.push({ file: path.relative(ROOT, file), detail: err });
    }
  }
  console.log('  已扫描 ' + jsFiles.length + ' 个 JS 文件，语法错误 ' + syntaxErrors.length + ' 个');
  if (syntaxErrors.length > 0) {
    failed = true;
    for (const item of syntaxErrors) {
      console.error('  ✗ ' + item.file + '\n' + item.detail);
    }
  }

  // ---------- 检查 2：HTML 本地资源引用 ----------
  console.log('[build] 检查 2/3：HTML 资源引用死链校验');
  for (const page of HTML_PAGES) {
    const result = checkHtmlRefs(page);
    console.log('  ' + page + '：本地引用 ' + result.refs + ' 个，' + (result.ok ? '全部可达' : '存在死链'));
    if (!result.ok) {
      failed = true;
      for (const err of result.errors) {
        console.error('  ✗ ' + err);
      }
    }
  }

  // ---------- 检查 3：发布清单 ----------
  console.log('[build] 检查 3/3：发布清单核对');
  const missing = printManifest();
  if (missing.length > 0) {
    console.warn('  ! 清单中 ' + missing.length + ' 项尚未产出（仅告警，不阻断本次校验）');
  }

  // ---------- 结论 ----------
  if (failed) {
    console.error('\n[build] 结果：FAILED（发布门控未通过，请修复上述问题）');
    return 1;
  }
  console.log('\n[build] 结果：PASSED（语法 OK / 无死链 / 清单已输出）');
  return 0;
}

process.exit(main());
