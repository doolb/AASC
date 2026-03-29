#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');

// ====== 配置 ======
const CONFIG = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
  dumpWidth: 120,
  timeout: 30000,
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
const query = args.filter(a => !a.startsWith('-') && isNaN(a) || (numIdx !== -1 && args.indexOf(a) === numIdx + 1)).length > 0
  ? args.filter(a => !a.startsWith('-')).join(' ')
  : '';

// 更准确的 query 提取
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

// ====== 构建 elinks 命令 ======
const url = `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}`;

// 设置 User-Agent 避免 Bing 拒绝
const cmd = `links \
  -dump-width ${CONFIG.dumpWidth} \
  -eval "set protocol.http.user_agent = '${CONFIG.userAgent}'" \
  -dump "${url}"`;

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
    console.error('   elinks 未安装。安装方法:');
    console.error('   sudo apt install elinks   (Debian/Ubuntu)');
    console.error('   sudo yum install elinks   (CentOS/RHEL)');
    console.error('   brew install elinks        (macOS)');
  } else if (err.stderr) {
    console.error(err.stderr);
  } else {
    console.error(err.message);
  }
  process.exit(1);
}

// ====== 原始模式 ======
if (rawMode) {
  console.log(raw);
  process.exit(0);
}

// ====== 解析搜索结果 ======
const results = parseBingResults(raw);

if (results.length === 0) {
  console.log('\n⚠️  未能解析到搜索结果，显示原始输出:\n');
  console.log(raw);
  process.exit(0);
}

const display = results.slice(0, maxResults);

if (urlOnly) {
  // 只输出 URL
  display.forEach(r => console.log(r.url));
} else {
  // 格式化输出
  display.forEach((r, i) => {
    console.log(`\n${i + 1}. ${r.title}`);
    console.log(`   ${r.url}`);
    if (r.snippet) {
      // 缩进显示摘要
      const lines = wrapText(r.snippet, 66);
      lines.forEach(line => console.log(`   ${line}`));
    }
  });
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`共 ${results.length} 条结果${maxResults < Infinity ? `，显示前 ${display.length} 条` : ''}`);
}

// ====== 解析函数 ======
function parseBingResults(text) {
  const lines = text.split('\n');
  const results = [];
  let current = null;
  let capturing = false;

  // 底部链接引用区域标记
  const stopMarkers = ['Visible links', 'Hidden links', 'References'];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 遇到引用区域，停止
    if (stopMarkers.some(m => trimmed.startsWith(m))) break;

    // 匹配链接行: [N]文字
    const linkMatch = trimmed.match(/^\[(\d+)\]\s+(.+)$/);

    if (linkMatch) {
      const title = linkMatch[2].trim();

      // 过滤掉明显是导航的短链接
      if (title.length < 5) continue;

      // 保存上一个结果
      if (current && (current.url || current.snippet)) {
        results.push(current);
      }

      current = {
        index: linkMatch[1],
        title: title,
        url: '',
        snippet: '',
      };
      capturing = true;
      continue;
    }

    if (capturing && current) {
      // URL 行检测
      if (/^https?:\/\/\S+$/.test(trimmed)) {
        current.url = trimmed;
      }
      // 摘要文本（非空、非编号、非括号标记）
      else if (
        trimmed.length > 0 &&
        !/^\[\d+\]/.test(trimmed) &&
        !/^\d+\.\s*https?:\/\//.test(trimmed) &&
        !/^_{3,}$/.test(trimmed)           // 下划线分隔线
      ) {
        current.snippet += (current.snippet ? ' ' : '') + trimmed;
      }
    }
  }

  // 保存最后一个
  if (current && (current.url || current.snippet)) {
    results.push(current);
  }

  return results;
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
