#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ====== 配置 ======
const CONFIG = {
  dumpWidth: 120,
  timeout: 30000,
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// ====== 参数解析 ======
const args = process.argv.slice(2);

if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  console.log(`
用法: node bing-search.js [选项] <关键词>

选项:
  -n NUM   只显示前 NUM 条结果 (默认: 全部)
  -r       原始输出，不做解析
  -u       只输出 URL 列表
  -h       显示帮助

示例:
  node bing-search.js Node.js 教程
  node bing-search.js -n 3 -u TypeScript
`);
  process.exit(0);
}

const rawMode = args.includes('-r');
const urlOnly = args.includes('-u');
const numIdx = args.indexOf('-n');
const maxResults = numIdx !== -1 && args[numIdx + 1] ? parseInt(args[numIdx + 1]) : Infinity;

// 提取搜索关键词（跳过 -n 及其值、-r、-u、-h）
let queryParts = [];
let skipNext = false;
for (let i = 0; i < args.length; i++) {
  if (skipNext) { skipNext = false; continue; }
  if (args[i] === '-n') { skipNext = true; continue; }
  if (args[i] === '-r' || args[i] === '-u' || args[i] === '-h') continue;
  queryParts.push(args[i]);
}
const searchQuery = queryParts.join(' ');

if (!searchQuery) {
  console.error('❌ 请提供搜索关键词');
  process.exit(1);
}

// ====== 构建 links 命令 ======
const url = `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}`;

// 创建临时配置文件设置 User-Agent
// links 通过配置文件设置 http_header
const configDir = path.join(os.tmpdir(), `links-cfg-${process.pid}`);
fs.mkdirSync(configDir, { recursive: true });
const configFile = path.join(configDir, 'links.cfg');
fs.writeFileSync(configFile, `http_header "User-Agent" "${CONFIG.userAgent}"\n`);

const cmd = `links -dump -width ${CONFIG.dumpWidth} "${url}"`;

// ====== 执行搜索 ======
console.log(`\n🔍 ${searchQuery}`);
console.log(`🔗 ${url}`);
console.log('─'.repeat(70));

let raw = '';
try {
  raw = execSync(cmd, {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: CONFIG.timeout,
    shell: true,
  });
} catch (err) {
  console.error('\n❌ 搜索失败');
  if (err.status === 127) {
    console.error('   links 未安装。安装方法:');
    console.error('   sudo apt install links2     (Debian/Ubuntu)');
    console.error('   sudo yum install links      (CentOS/RHEL)');
    console.error('   brew install links           (macOS)');
  } else if (err.stderr) {
    console.error(err.stderr);
  } else {
    console.error(err.message);
  }
  cleanup();
  process.exit(1);
}

// 清理临时配置
cleanup();

// ====== 原始模式 ======
if (rawMode) {
  console.log(raw);
  process.exit(0);
}

// ====== 解析搜索结果 ======
const results = parseLinksResults(raw);

if (results.length === 0) {
  console.log('\n⚠️  未能解析到搜索结果，显示原始输出:\n');
  console.log(raw);
  process.exit(0);
}

const display = results.slice(0, maxResults);

if (urlOnly) {
  display.forEach(r => console.log(r.url));
} else {
  display.forEach((r, i) => {
    console.log(`\n${i + 1}. ${r.title}`);
    console.log(`   ${r.url}`);
    if (r.snippet) {
      wrapText(r.snippet, 66).forEach(line => console.log(`   ${line}`));
    }
  });
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`共 ${results.length} 条结果${maxResults < Infinity ? `，显示前 ${display.length} 条` : ''}`);
}

// ====== 清理临时文件 ======
function cleanup() {
  try {
    fs.unlinkSync(configFile);
    fs.rmdirSync(configDir);
  } catch (_) { /* 忽略清理错误 */ }
}

// ====== 解析函数 ======
function parseLinksResults(text) {
  const lines = text.split('\n');
  const results = [];

  // ---- 第一步：从底部引用区提取 URL 映射 ----
  const linkMap = {};
  let inRefSection = false;
  const refLineIndices = new Set();

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // 匹配 "Visible links:" / "Hidden links:" / "References:" 等标记
    if (/^(Visible\s+links|Hidden\s+links|References)\s*:?\s*$/i.test(trimmed)) {
      inRefSection = true;
      refLineIndices.add(i);
      continue;
    }
    if (inRefSection) {
      refLineIndices.add(i);
      // 匹配 "  6. https://..." 格式
      const refMatch = trimmed.match(/^\s*(\d+)\.\s+(https?:\/\/\S+)/);
      if (refMatch) {
        linkMap[refMatch[1]] = refMatch[2];
      }
    }
  }

  // ---- 第二步：从正文区提取标题和摘要 ----
  let current = null;
  let capturing = false;

  for (let i = 0; i < lines.length; i++) {
    if (refLineIndices.has(i)) continue;

    const trimmed = lines[i].trim();

    // 跳过空行和分隔线
    if (!trimmed || /^[_=\-]{3,}$/.test(trimmed)) continue;

    // 跳过页面顶部导航元素（短标题链接）
    if (!capturing && trimmed.length < 8) continue;

    // 匹配链接行: [N]标题文字
    const linkMatch = trimmed.match(/^\[(\d+)\]\s+(.+)$/);

    if (linkMatch) {
      const title = linkMatch[2].trim();
      const idx = linkMatch[1];

      // 保存上一个结果
      if (current && (current.url || current.snippet)) {
        results.push(current);
      }

      current = {
        index: idx,
        title: title,
        url: linkMap[idx] || '',       // 优先从引用区取
        snippet: '',
      };
      capturing = true;
      continue;
    }

    if (capturing && current) {
      // 独立 URL 行（部分 links 版本在标题下方直接输出 URL）
      if (/^https?:\/\/\S+$/.test(trimmed) && !current.url) {
        current.url = trimmed;
      }
      // 摘要文本
      else if (!/^\[\d+\]/.test(trimmed)) {
        current.snippet += (current.snippet ? ' ' : '') + trimmed;
      }
    }
  }

  // 保存最后一个
  if (current && (current.url || current.snippet)) {
    results.push(current);
  }

  // ---- 第三步：过滤掉无 URL 的导航项 ----
  return results.filter(r => r.url);
}

// ====== 文本换行工具 ======
function wrapText(text, maxLen) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + word.length + 1 <= maxLen) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
