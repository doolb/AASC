#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const PACKAGE = 'com.wiki.fgold';
const REMOTE = '/sdcard/gold-eye-cli-window.xml';
const number = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let serial;
let history = join(homedir(), '.local/share/gold-eye-cli/history.jsonl');

function run(program, args, options = {}) {
  try {
    return execFileSync(program, args, { maxBuffer: 32 * 1024 * 1024, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  } catch (e) {
    if (e.signal === 'SIGINT') process.exit(130);
    throw new Error(`${program} 执行失败: ${e.stderr?.toString().trim() || e.message}`);
  }
}
function adb(...args) {
  return run('adb', [...(serial ? ['-s', serial] : []), ...args], { encoding: 'utf8' });
}
function decode(s) {
  return s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, v) => {
    if (v[0] === '#') return String.fromCodePoint(v[1].toLowerCase() === 'x' ? parseInt(v.slice(2), 16) : Number(v.slice(1)));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[v];
  });
}
function nodes(xml) {
  return [...xml.matchAll(/<node\b[^>]*>/g)].map(([tag]) => {
    const node = {};
    for (const match of tag.matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)')/g)) node[match[1]] = decode(match[2] ?? match[3]);
    return node;
  });
}
function dump() {
  const result = adb('shell', 'uiautomator', 'dump', REMOTE);
  if (!result.includes('dumped to:')) throw new Error('无法读取屏幕，请确认屏幕已亮起且设备已解锁。');
  return nodes(adb('shell', 'cat', REMOTE));
}
function tap(node) {
  const b = node?.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
  if (!b) throw new Error('无法确定界面按钮的位置。');
  adb('shell', 'input', 'tap', String(Math.round((+b[1] + +b[3]) / 2)), String(Math.round((+b[2] + +b[4]) / 2)));
}
async function page(tab) {
  adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  let screen = dump();
  if (!screen.some(n => n.package === PACKAGE)) {
    adb('shell', 'monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1');
    await sleep(1800);
  }
  for (let i = 0; i < 8; i++) {
    screen = dump();
    if (!screen.some(n => n.package === PACKAGE)) throw new Error('无法打开黄金天眼，请确认设备已解锁且已安装该应用。');
    const cancel = screen.find(n => n['content-desc'] === '取消' && n.clickable === 'true');
    if (cancel && screen.some(n => n['content-desc'] === '发现新版本！')) {
      tap(cancel);
      await sleep(600);
      continue;
    }
    const target = screen.find(n => n.clickable === 'true' && n['content-desc']?.startsWith(`${tab}\n第 `));
    if (target) {
      if (target.selected !== 'true') {
        tap(target);
        await sleep(1000);
        continue;
      }
      return screen;
    }
    if (screen.some(n => n['content-desc']?.startsWith('分时\n第 1 个标签'))) {
      adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
      await sleep(500);
      continue;
    }
    await sleep(1000);
  }
  throw new Error(`无法进入“${tab}”页面；请检查设备是否锁屏、弹出提示或应用正在加载。`);
}
function quotes(screen) {
  const result = [];
  for (const n of screen) {
    if (n.package !== PACKAGE) continue;
    const parts = (n['content-desc'] || '').split('\n').map(s => s.replaceAll('\u200b', '').trim()).filter(Boolean);
    if (parts.length !== 4 || !/^[A-Z][A-Z0-9._-]*$/.test(parts[1])) continue;
    if (!(number.test(parts[2]) || parts[2] === '--')) continue;
    if (!(parts[3] === '--' || (parts[3].endsWith('%') && number.test(parts[3].slice(0, -1))))) continue;
    result.push({ name: parts[0], symbol: parts[1], price: parts[2], change: parts[3] });
  }
  if (!result.length) throw new Error('行情列表没有可读取的报价，请等待加载后重试。');
  return result;
}
async function sample() {
  const screen = await page('行情');
  return { captured_at: new Date().toISOString(), quotes: quotes(screen) };
}
function show(data, json) {
  if (json) return console.log(JSON.stringify(data));
  console.log(`采集时间: ${data.captured_at}（App 可能有延迟或无报价）`);
  console.log('名称 / 代码  最新价  涨跌幅');
  for (const q of data.quotes) console.log(`${q.name} (${q.symbol})  ${q.price}  ${q.change}`);
  console.log();
}
function trend(symbol, limit) {
  let lines;
  try { lines = readFileSync(history, 'utf8').split('\n'); }
  catch (e) { if (e.code === 'ENOENT') throw new Error(`没有采样记录：${history}；请先运行 watch。`); throw e; }
  const points = [];
  for (const line of lines) {
    try {
      const data = JSON.parse(line);
      for (const q of data.quotes) if (q.symbol === symbol && number.test(q.price)) points.push([data.captured_at, Number(q.price)]);
    } catch { /* 忽略损坏或不完整的记录 */ }
  }
  const p = points.slice(-limit);
  if (!p.length) throw new Error(`没有 ${symbol} 的有效采样记录。`);
  const values = p.map(x => x[1]), low = Math.min(...values), high = Math.max(...values), levels = [...'▁▂▃▄▅▆▇█'];
  console.log(`${symbol} 本地采样趋势（${p.length} 点）`);
  console.log(values.map(v => levels[high === low ? 3 : Math.round((v - low) * 7 / (high - low))]).join(''));
  console.log(`最小: ${low}  最大: ${high}  最新: ${values.at(-1)}`);
  console.log(`${p[0][0]} 至 ${p.at(-1)[0]}\n横轴为采样顺序；采样间隔可能不等。`);
}
async function chart(period) {
  const labels = { live: '实时', '1m': '近一月', '3m': '近三月', '6m': '近半年', '1y': '近一年' };
  if (['1w', '2w', '3w', 'weekly'].includes(period)) return detailChart(period);
  if (!labels[period]) throw new Error('走势图周期可选 live、1w、2w、3w、1m、3m、6m、1y、weekly。');
  let screen = await page('首页');
  const target = screen.find(n => n['content-desc'] === labels[period] && n.clickable === 'true');
  if (target) { tap(target); await sleep(1800); screen = dump(); }
  else if (!screen.some(n => n['content-desc'] === labels[period])) throw new Error('没有找到走势图周期，请确认首页价格趋势区域可见。');
  const marker = screen.find(n => n['content-desc'] === '价格趋势');
  const markerBounds = marker?.bounds?.match(/^\[\d+,(\d+)\]/);
  const y = markerBounds ? +markerBounds[1] : 0;
  const graph = screen.find(n => n.NAF === 'true' && n.clickable === 'true' && n.scrollable === 'true' && (() => {
    const b = n.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
    return b && +b[2] > y && +b[4] - +b[2] > 100;
  })());
  if (!marker || !graph) throw new Error('未找到走势图区域，请将首页滚动到价格趋势处并重试。');
  renderGraph(graph, `黄金天眼价格趋势：${labels[period]}（截图；以 App 显示为准）`);
}
async function detailChart(period) {
  const candle = { '1w': '4小时', '2w': '8小时', '3w': '12小时', weekly: '周线' }[period];
  let screen = await page('行情');
  const gold = screen.find(n => n.clickable === 'true' && n['content-desc']?.split('\n')[1] === 'AUS');
  if (!gold) throw new Error('行情列表中没有看到天眼金价（AUS），请在手机上切回“全部”行情并滚动至顶部。');
  tap(gold);
  await sleep(1200);
  screen = dump();
  const more = screen.find(n => n.clickable === 'true' && /\n第 6 个标签，共 6 个$/.test(n['content-desc'] || ''));
  if (!more) throw new Error('无法打开天眼金价的 K 线周期菜单。');
  tap(more);
  await sleep(500);
  screen = dump();
  const choice = screen.find(n => n.clickable === 'true' && n['content-desc'] === candle);
  if (!choice) throw new Error(`未找到${candle}选项。`);
  tap(choice);
  await sleep(1800);
  screen = dump();
  if (!screen.some(n => n.selected === 'true' && n['content-desc']?.startsWith(`${candle}\n第 `))) {
    throw new Error(`无法确认${candle}已选中，请检查 App 是否加载完成。`);
  }
  const graph = screen.find(n => n.scrollable === 'true' && n['content-desc']?.includes('MA('));
  if (!graph) throw new Error('没有找到 K 线图表，数据可能尚未加载。');
  const title = period === 'weekly' ? '黄金天眼天眼金价：周线 K 线图（每根 K 线代表一周）' : `黄金天眼天眼金价：${candle} K 线（时间范围以图中时间轴为准）`;
  renderGraph(graph, title);
}
function renderGraph(graph, title) {
  const b = graph.bounds.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/).slice(1).map(Number);
  const png = run('adb', [...(serial ? ['-s', serial] : []), 'exec-out', 'screencap', '-p']);
  const cropped = spawnSync('magick', ['png:-', '-crop', `${b[2]-b[0]}x${b[3]-b[1]}+${b[0]}+${b[1]}`, '+repage', 'png:-'], { input: png, maxBuffer: 32 * 1024 * 1024 });
  if (cropped.error || cropped.status !== 0) throw new Error(`截图裁剪失败，请安装 ImageMagick：${cropped.error?.message || cropped.stderr.toString()}`);
  console.log(title);
  const rendered = spawnSync('chafa', ['--margin-bottom', '3', '--font-ratio', process.env.GOLD_EYE_FONT_RATIO || '1/2', '-'], { input: cropped.stdout, stdio: ['pipe', 'inherit', 'inherit'] });
  if (rendered.error || rendered.status !== 0) throw new Error(`chafa 显示失败，请确认已安装 chafa：${rendered.error?.message || rendered.status}`);
}
function usage() {
  console.log(`用法: node scripts/gold-eye-cli.js [-s 设备] [--history 文件] <命令> [选项]
  quote [--json]              获取当前可见行情
  watch [--interval 秒] [--json] 持续采集并保存（默认间隔 30 秒）
  chart [live|1w|2w|3w|1m|3m|6m|1y|weekly] 显示 App 走势图（weekly 为周线）
  trend 代码 [--limit 数量]   显示本地采样趋势（默认 80 点）`);
}
async function main() {
  const args = process.argv.slice(2);
  while (args[0] === '-s' || args[0] === '--serial' || args[0] === '--history') {
    const opt = args.shift(), value = args.shift();
    if (!value) throw new Error(`${opt} 需要参数`);
    if (opt === '--history') history = value; else serial = value;
  }
  const cmd = args.shift();
  if (!cmd || cmd === '-h' || cmd === '--help') return usage();
  if (cmd === 'chart') {
    if (args.length > 1) throw new Error('chart 参数过多');
    return chart(args[0] || '1m');
  }
  if (cmd === 'trend') {
    const symbol = args.shift()?.toUpperCase();
    if (!symbol) throw new Error('请提供品种代码，例如 AUS');
    let limit = 80;
    if (args[0] === '--limit') { args.shift(); limit = Number(args.shift()); }
    if (args.length || !Number.isInteger(limit) || limit < 1) throw new Error('--limit 必须是正整数');
    return trend(symbol, limit);
  }
  if (cmd !== 'quote' && cmd !== 'watch') throw new Error(`未知命令：${cmd}`);
  let json = false, interval = 30;
  while (args.length) {
    const opt = args.shift();
    if (opt === '--json') json = true;
    else if (opt === '--interval' && cmd === 'watch') interval = Number(args.shift());
    else throw new Error(`未知选项：${opt}`);
  }
  if (!Number.isFinite(interval) || interval <= 0) throw new Error('--interval 必须大于 0');
  const interactive = cmd === 'watch' && !json && process.stdout.isTTY;
  let active = false;
  const restore = () => {
    if (active) {
      active = false;
      process.stdout.write('\x1b[?25h\x1b[?1049l');
    }
  };
  const stop = () => { restore(); process.exit(130); };
  if (interactive) {
    active = true;
    process.stdout.write('\x1b[?1049h\x1b[?25l');
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    process.on('exit', restore);
  }
  try {
    do {
      const data = await sample();
      if (cmd === 'watch') {
        mkdirSync(dirname(history), { recursive: true });
        appendFileSync(history, JSON.stringify(data) + '\n');
      }
      if (interactive) process.stdout.write('\x1b[H\x1b[2J');
      show(data, json);
      if (interactive) console.log('自动刷新中，按 Ctrl+C 退出。');
      if (cmd === 'watch') await sleep(interval * 1000);
    } while (cmd === 'watch');
  } finally {
    restore();
    if (interactive) {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      process.off('exit', restore);
    }
  }
}
main().catch(e => { console.error(`错误: ${e.message}`); process.exitCode = 1; });
