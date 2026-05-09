/**
 * TTS 服务端压测程序
 *
 * 直接压测 3rd/tts-server (balcon)，覆盖：
 *  - 短文本 / 长文本 / 混合文本
 *  - 低中高并发
 *  - 队列深度与恢复
 *  - 断连场景（客户端超时断开后队列是否卡死）
 *
 * 用法:
 *   node stress-test.js [选项]
 *
 *   --url         <url>      TTS服务地址 (默认 http://127.0.0.1:3000)
 *   --concurrency <n>        并发数 (默认 3)
 *   --total       <n>        总请求数 (默认 30)
 *   --text        <type>     文本类型 short / long / mix (默认 mix)
 *   --abort-rate  <0-1>      断连率 (默认 0，不模拟断连)
 *   --abort-delay <ms>       断连延时 (默认 50)
 *   --timeout     <ms>       请求超时 (默认 30000)
    else if (cur === '--mode' && next)       { args.mode = next; i++; }
 *
 * 示例:
 *   node stress-test.js --concurrency 5 --total 50 --text mix
 *   node stress-test.js --concurrency 3 --total 20 --abort-rate 0.3
 *   node stress-test.js --concurrency 1 --total 5 --text long
 */

const http = require('http');
const { performance } = require('perf_hooks');

// ======== 配置 ========
const SHORT_TEXTS = [
  '今天天气怎么样？',
  '帮我设个闹钟。',
  '播放一首歌。',
  '明天有什么安排？',
  '打开灯。',
  '现在几点了？',
  '谢谢。',
  '再见。',
];

const LONG_TEXTS = [
  '北京今天白天多云转阴，傍晚前后有分散性阵雨或雷阵雨，北转南风二三级，最高气温26℃。夜间阴有分散性阵雨转晴，南转北风一二级，最低气温16℃。明天白天晴间多云，北转南风二三间四级，最高气温28℃。',
  '根据最新气象资料分析，未来三天本市大部分地区将以晴到多云天气为主，气温逐步回升，白天最高气温在28℃至32℃之间，夜间最低气温在18℃至22℃之间。值得注意的是，周六夜间到周日白天将有一次明显降雨过程，请提前做好出行安排。',
  '以下是今天的日程安排：早上九点有一个团队站会，预计持续三十分钟。十点到十一点半需要完成项目方案的初稿。下午两点和客户有一个线上会议。下午四点需要提交周报。晚上七点有一个健身课程，请不要忘记提前预约。',
  '欢迎使用智能语音助手。我可以帮你完成以下任务：设置闹钟和提醒、查询天气情况、播放音乐和新闻、控制智能家居设备、查询路线和交通信息、发送和阅读消息、进行语音搜索。请随时告诉我你的需求，我会尽力帮助你。',
  '这是一条用于测试TTS长文本生成性能的示例文本。在真实场景中，天气预报、新闻播报、日程提醒等内容往往包含较多文字信息，需要TTS引擎能够快速稳定地完成语音合成。如果文本过长，可能会导致合成时间增加或请求超时。',
];

function parseArgs(argv) {
  const args = {
    url: 'http://127.0.0.1:3000',
    concurrency: 3,
    total: 30,
    text: 'mix',
    abortRate: 0,
    abortDelay: 50,
    mode: 'stress',
    timeout: 30000,
  };

  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i], next = argv[i + 1];
    if (cur === '--url' && next)       { args.url = next; i++; }
    else if (cur === '--concurrency' && next) { args.concurrency = Math.max(1, parseInt(next) || 1); i++; }
    else if (cur === '--total' && next)       { args.total = Math.max(1, parseInt(next) || 1); i++; }
    else if (cur === '--text' && next)        { args.text = next; i++; }
    else if (cur === '--abort-rate' && next)  { args.abortRate = Math.min(1, Math.max(0, parseFloat(next) || 0)); i++; }
    else if (cur === '--abort-delay' && next) { args.abortDelay = Math.max(0, parseInt(next) || 0); i++; }
    else if (cur === '--timeout' && next)     { args.timeout = Math.max(1000, parseInt(next) || 30000); i++; }
    else if (cur === '--mode' && next)       { args.mode = next; i++; }
  }
  return args;
}

function pickText(type) {
  if (type === 'short') return SHORT_TEXTS[Math.floor(Math.random() * SHORT_TEXTS.length)];
  if (type === 'long')  return LONG_TEXTS[Math.floor(Math.random() * LONG_TEXTS.length)];
  // mix: 70% short + 30% long
  return Math.random() < 0.7
    ? SHORT_TEXTS[Math.floor(Math.random() * SHORT_TEXTS.length)]
    : LONG_TEXTS[Math.floor(Math.random() * LONG_TEXTS.length)];
}

function requestTTS(text, { timeoutMs, willAbort, abortDelayMs }) {
  return new Promise((resolve) => {
    const u = new URL(args.url);
    const body = JSON.stringify({ text, voice: 'Microsoft Xiaoxiao', speed: 0 });

    const start = performance.now();
    const req = http.request({
      hostname: u.hostname,
      port: u.port || 80,
      path: '/api/tts',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: timeoutMs
    }, (res) => {
      if (willAbort) {
        // 本应断连但服务端处理太快，走正常响应路径
        const elapsed = performance.now() - start;
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: 'unexpected_success',
            statusCode: res.statusCode,
            size: Buffer.concat(chunks).length,
            textLen: text.length,
            latencyMs: Math.round(elapsed)
          });
        });
        return;
      }

      const elapsed = performance.now() - start;
      const contentType = res.headers['content-type'] || '';
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: res.statusCode === 200 && contentType.includes('audio') ? 'success' : 'error',
          statusCode: res.statusCode,
          contentType,
          size: buf.length,
          textLen: text.length,
          latencyMs: Math.round(elapsed)
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('请求超时'));
    });

    req.on('error', () => {
      if (willAbort) {
        resolve({
          status: 'aborted',
          textLen: text.length,
          latencyMs: Math.round(performance.now() - start)
        });
      } else {
        resolve({
          status: 'error',
          error: '连接失败',
          textLen: text.length,
          latencyMs: Math.round(performance.now() - start)
        });
      }
    });

    req.write(body);

    if (willAbort) {
      setTimeout(() => {
        req.destroy(new Error('abort'));
      }, abortDelayMs);
    }

    req.end();
  });
}

function formatPct(n, total) {
  return total ? `${(n / total * 100).toFixed(1)}%` : '-';
}

function formatMs(ms) {
  return `${ms}ms`;
}

// ======== 队列卡死场景验证 (--mode verify) ========
function sendAndDisconnect(text, delayBeforeAbortMs) {
  return new Promise((resolve) => {
    const u = new URL(args.url);
    const body = JSON.stringify({ text, voice: 'Microsoft Xiaoxiao', speed: 0 });
    const req = http.request({
      hostname: u.hostname, port: u.port || 80,
      path: '/api/tts', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    });
    req.on('error', () => {});
    req.write(body);
    req.end();
    setTimeout(() => { req.destroy(); resolve({ destroyed: true }); }, delayBeforeAbortMs);
  });
}

function requestTTSsimple(text, timeoutMs) {
  return requestTTS(text, { timeoutMs, willAbort: false, abortDelayMs: 0 }).then(r => {
    if (r.status === 'success' || (r.statusCode >= 200 && r.statusCode < 300)) return { statusCode: r.statusCode || 200, contentType: r.contentType || '' };
    throw new Error(`HTTP ${r.statusCode || '失败'}`);
  });
}

async function runVerifyMode() {
  console.log(`TTS 队列卡死自测 — ${args.url}\n`);
  let passed = 0, failed = 0;
  async function test(name, fn) { try { await fn(); console.log(`  ✓ ${name}`); passed++; } catch (err) { console.log(`  ✗ ${name}: ${err.message}`); failed++; } }

  console.log('[场景 1] 请求入队后断连，队列不应卡死');
  await test('快速断连请求不阻塞队列', async () => {
    await sendAndDisconnect('验证队列卡死问题。', 50);
    const r = await requestTTSsimple('队列正常测试', 10000);
    if (r.statusCode !== 200) throw new Error(`正常请求失败: HTTP ${r.statusCode}`);
  });

  console.log('\n[场景 2] 连续发送多个断连请求');
  await test('连续 5 个断连后队列仍正常', async () => {
    for (let i = 0; i < 5; i++) await sendAndDisconnect(`断连测试请求 ${i + 1}`, 30 + i * 10);
    const r = await requestTTSsimple('连续断连后队列正常测试', 10000);
    if (r.statusCode !== 200) throw new Error(`正常请求失败: HTTP ${r.statusCode}`);
  });

  console.log('\n[场景 3] balcon 正在处理时客户端断连');
  await test('处理中断连后队列不卡死', async () => {
    await sendAndDisconnect('这是一个较长的测试文本。'.repeat(20), 100);
    await new Promise(r => setTimeout(r, 500));
    const r = await requestTTSsimple('处理中断连后队列正常', 15000);
    if (r.statusCode !== 200) throw new Error(`正常请求失败: HTTP ${r.statusCode}`);
  });

  console.log('\n[场景 4] 混压：正常请求和断连请求交错');
  await test('混压下所有正常请求成功', async () => {
    const tasks = [];
    for (let i = 0; i < 10; i++) {
      if (i % 3 === 0) tasks.push(sendAndDisconnect(`混压断连请求 ${i}`, 20));
      else tasks.push(requestTTSsimple(`混压正常请求 ${i}`, 15000));
    }
    await Promise.all(tasks);
    const r = await requestTTSsimple('混压结束确认', 10000);
    if (r.statusCode !== 200) throw new Error(`确认请求失败: HTTP ${r.statusCode}`);
  });

  console.log('\n[场景 5] 队列空闲时断连，恢复后正常');
  await test('空闲队列断连后正常工作', async () => {
    await new Promise(r => setTimeout(r, 200));
    await sendAndDisconnect('空闲时断连', 10);
    await new Promise(r => setTimeout(r, 100));
    const r = await requestTTSsimple('空闲断连后测试', 10000);
    if (r.statusCode !== 200) throw new Error(`正常请求失败: HTTP ${r.statusCode}`);
  });

  console.log(`\n==============================`);
  console.log(`通过: ${passed}  失败: ${failed}  总计: ${passed + failed}`);
  console.log(`==============================`);
  process.exitCode = failed > 0 ? 1 : 0;
}
// =============================================

function histogram(latencies, buckets) {
  const counts = new Array(buckets.length).fill(0);
  for (const l of latencies) {
    for (let i = 0; i < buckets.length; i++) {
      if (l <= buckets[i]) { counts[i]++; break; }
    }
  }
  return buckets.map((b, i) => `${formatMs(b)}: ${'█'.repeat(Math.round(counts[i] / Math.max(1, latencies.length) * 40))} ${counts[i]}`).join('\n    ');
}

function printResults(stats, wallTimeMs) {
  const total = stats.success + stats.error + stats.aborted + stats.timeout;
  const avgLatency = stats.latencies.length ? Math.round(stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length) : 0;
  const maxLatency = stats.latencies.length ? Math.max(...stats.latencies) : 0;
  const minLatency = stats.latencies.length ? Math.min(...stats.latencies) : 0;
  const sorted = [...stats.latencies].sort((a, b) => a - b);
  const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : 0;
  const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
  const p99 = sorted.length ? sorted[Math.floor(sorted.length * 0.99)] : 0;

  console.log(`
==============================  压测报告  ==============================

[总览]
  总请求数:     ${total}
  并发数:       ${args.concurrency}
  文本类型:     ${args.text}
  断连率:       ${(args.abortRate * 100).toFixed(0)}%
  总耗时:       ${(wallTimeMs / 1000).toFixed(1)}s
  TPS:          ${(total / (wallTimeMs / 1000)).toFixed(1)}

[结果分布]
  ✅ 成功:      ${stats.success} (${formatPct(stats.success, total)})
  ❌ 错误:      ${stats.error} (${formatPct(stats.error, total)})
  ⚡ 断连:      ${stats.aborted} (${formatPct(stats.aborted, total)})
  ⏰ 超时:      ${stats.timeout} (${formatPct(stats.timeout, total)})

[延迟 (ms)]
  平均:         ${formatMs(avgLatency)}
  最小:         ${formatMs(minLatency)}
  最大:         ${formatMs(maxLatency)}
  P50:          ${formatMs(p50)}
  P95:          ${formatMs(p95)}
  P99:          ${formatMs(p99)}

[延迟分布]
    ${histogram(stats.latencies, [1000, 3000, 5000, 10000, 20000, 30000, 60000])}

[按文本长度分组]
  short (< 50):  req=${stats.shortCount}  ok=${stats.shortOk}  avg=${stats.shortAvgLatency ? formatMs(stats.shortAvgLatency) : '-'}
  medium (50-200): req=${stats.mediumCount} ok=${stats.mediumOk} avg=${stats.mediumAvgLatency ? formatMs(stats.mediumAvgLatency) : '-'}
  long (> 200):   req=${stats.longCount}   ok=${stats.longOk}   avg=${stats.longAvgLatency ? formatMs(stats.longAvgLatency) : '-'}

[队列恢复]
  监控卡死: ${stats.queueMonitorStuck ? '❌ 是' : '✓ 否'}
  最后 5 个请求全部成功: ${stats.lastFiveOk ? '✓' : '✗'}
  队列是否卡死: ${stats.queueStuck ? '❌ 是' : '✓ 否'}

========================================================================
`);
}

// ======== 队列状态监控 ========
let queueMonitorStuck = false;
function startQueueMonitor(baseUrl, intervalMs, stuckThresholdMs) {
  let lastTask = null;
  let stuckSince = 0;
  const timer = setInterval(async () => {
    try {
      const u = new URL('/api/tts/status', baseUrl);
      const { hostname, port, pathname } = u;
      http.get({ hostname, port, path: pathname, timeout: 3000 }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const s = JSON.parse(data);
            if (!s.isProcessing) { lastTask = null; stuckSince = 0; return; }
            if (s.currentTask === lastTask && s.currentTask) {
              if (!stuckSince) stuckSince = Date.now();
              else if (Date.now() - stuckSince > stuckThresholdMs) {
                queueMonitorStuck = true;
                console.error(`\n⚠️ 队列疑似卡死: currentTask="${s.currentTask.slice(0, 60)}..." elapsed=${s.processingElapsed}ms queue=${s.queueLength}`);
              }
            } else {
              lastTask = s.currentTask;
              stuckSince = 0;
            }
          } catch (_) {}
        });
      }).on('error', () => {});
    } catch (_) {}
  }, intervalMs);
  return timer;
}

const args = parseArgs(process.argv.slice(2));

async function main() {
  if (args.mode === 'verify') {
    await runVerifyMode();
    return;
  }

  console.log(`\nTTS 服务端压测开始`);
  console.log(`  目标:     ${args.url}`);
  console.log(`  并发:     ${args.concurrency}`);
  console.log(`  总量:     ${args.total}`);
  console.log(`  文本:     ${args.text}`);
  console.log(`  断连率:   ${(args.abortRate * 100).toFixed(0)}%`);
  console.log(`  超时:     ${args.timeout}ms\n`);

  const stats = {
    success: 0,
    error: 0,
    aborted: 0,
    timeout: 0,
    latencies: [],
    shortCount: 0, shortOk: 0, shortTotalLatency: 0,
    mediumCount: 0, mediumOk: 0, mediumTotalLatency: 0,
    longCount: 0, longOk: 0, longTotalLatency: 0,
    results: []
  };

  // 复用第一个请求的 text，用来做最后的队列恢复验证
  const recoveryCheckText = '队列恢复验证测试。';

  // 是否有任何请求成功
  let anySuccess = false;
  let lastFiveAllSuccess = true;

  const wallStart = performance.now();

  // 生产者-消费者：用信号量控制并发
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= args.total) break;

      const text = pickText(args.text);
      const willAbort = Math.random() < args.abortRate;
      const result = await requestTTS(text, {
        timeoutMs: args.timeout,
        willAbort,
        abortDelayMs: args.abortDelay
      });

      if (result.status === 'success') {
        stats.success++;
        stats.latencies.push(result.latencyMs);
        anySuccess = true;
      } else if (result.status === 'aborted') {
        stats.aborted++;
      } else if (result.status === 'timeout') {
        stats.timeout++;
        stats.latencies.push(result.latencyMs);
      } else {
        stats.error++;
      }

      // 按文本长度分组
      const len = result.textLen || text.length;
      if (len < 50) {
        stats.shortCount++;
        if (result.status === 'success') { stats.shortOk++; stats.shortTotalLatency += result.latencyMs; }
      } else if (len <= 200) {
        stats.mediumCount++;
        if (result.status === 'success') { stats.mediumOk++; stats.mediumTotalLatency += result.latencyMs; }
      } else {
        stats.longCount++;
        if (result.status === 'success') { stats.longOk++; stats.longTotalLatency += result.latencyMs; }
      }

      stats.results.push(result);

      const done = stats.success + stats.error + stats.aborted + stats.timeout;
      if (done % 10 === 0 || done === args.total) {
        process.stdout.write(`\r  进度: ${done}/${args.total}  ✅${stats.success} ❌${stats.error} ⚡${stats.aborted} ⏰${stats.timeout}`);
      }
    }
  }

  // 启动队列监控，2 秒检查一次，同任务卡 10 秒报警
  const monitorTimer = startQueueMonitor(args.url, 2000, 10000);

  const workers = [];
  for (let i = 0; i < args.concurrency; i++) workers.push(worker());
  await Promise.all(workers);

  clearInterval(monitorTimer);
  if (queueMonitorStuck) {
    console.error('  队列卡死检测: 监控到队列卡死');
  }

  // ── 队列恢复验证 ──
  // 压测结束后发送 5 个正常请求，全部成功才算队列正常
  process.stdout.write(`\n  队列恢复验证...`);
  for (let i = 0; i < 5; i++) {
    try {
      const r = await requestTTS(recoveryCheckText, { timeoutMs: 15000, willAbort: false, abortDelayMs: 0 });
      if (r.status !== 'success') {
        lastFiveAllSuccess = false;
      }
    } catch {
      lastFiveAllSuccess = false;
    }
  }
  process.stdout.write(` ${lastFiveAllSuccess ? '✓' : '✗'}\n`);

  const wallTimeMs = performance.now() - wallStart;

  stats.lastFiveOk = lastFiveAllSuccess;
  stats.queueMonitorStuck = queueMonitorStuck;
  stats.queueStuck = (!lastFiveAllSuccess || queueMonitorStuck) && anySuccess;
  // 如果没有任何成功的请求（可能服务端没启动），不判定为卡死
  if (!anySuccess && stats.error + stats.timeout === args.total) {
    stats.queueStuck = false;
  }

  stats.shortAvgLatency = stats.shortOk ? Math.round(stats.shortTotalLatency / stats.shortOk) : 0;
  stats.mediumAvgLatency = stats.mediumOk ? Math.round(stats.mediumTotalLatency / stats.mediumOk) : 0;
  stats.longAvgLatency = stats.longOk ? Math.round(stats.longTotalLatency / stats.longOk) : 0;

  printResults(stats, wallTimeMs);

  if (stats.queueStuck) {
    console.error('❌ 队列卡死检测: 压测后有成功请求但恢复验证失败，队列可能已卡死！');
    process.exitCode = 2;
  } else if (!lastFiveAllSuccess && anySuccess) {
    console.error('⚠️ 恢复验证部分失败，建议检查服务端状态');
    process.exitCode = 1;
  }
}

main();
