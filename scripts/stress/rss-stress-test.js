const http = require('http');
const https = require('https');

function parseArgs(argv) {
    const args = {
        url: 'https://127.0.0.1:8081',
        method: 'GET',
        path: '/api/system-stats',
        body: null,
        total: 100,
        concurrency: 5,
        timeout: 30000,
        duration: 0,
        interval: 0,
        statsInterval: 1000,
        outputEvery: 10
    };

    for (let i = 0; i < argv.length; i++) {
        const item = argv[i];
        const next = argv[i + 1];

        if (item === '--url' && next) {
            args.url = next;
            i++;
            continue;
        }

        if (item === '--method' && next) {
            args.method = next.toUpperCase();
            i++;
            continue;
        }

        if (item === '--path' && next) {
            args.path = next;
            i++;
            continue;
        }

        if (item === '--body' && next) {
            args.body = next;
            i++;
            continue;
        }

        if (item === '--total' && next) {
            args.total = Math.max(1, parseInt(next, 10) || args.total);
            i++;
            continue;
        }

        if (item === '--concurrency' && next) {
            args.concurrency = Math.max(1, parseInt(next, 10) || args.concurrency);
            i++;
            continue;
        }

        if (item === '--timeout' && next) {
            args.timeout = Math.max(1000, parseInt(next, 10) || args.timeout);
            i++;
            continue;
        }

        if (item === '--duration' && next) {
            args.duration = Math.max(0, parseInt(next, 10) || 0);
            i++;
            continue;
        }

        if (item === '--interval' && next) {
            args.interval = Math.max(0, parseInt(next, 10) || 0);
            i++;
            continue;
        }

        if (item === '--stats-interval' && next) {
            args.statsInterval = Math.max(200, parseInt(next, 10) || args.statsInterval);
            i++;
            continue;
        }

        if (item === '--output-every' && next) {
            args.outputEvery = Math.max(1, parseInt(next, 10) || args.outputEvery);
            i++;
            continue;
        }
    }

    return args;
}

function getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
        rss: usage.rss,
        heapUsed: usage.heapUsed,
        external: usage.external,
        arrayBuffers: usage.arrayBuffers || 0
    };
}

function formatMB(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function createHttpRequest(baseUrl, pathname, options = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(pathname, baseUrl);
        const isHttps = parsed.protocol === 'https:';
        const transport = isHttps ? https : http;

        const requestOptions = {
            protocol: parsed.protocol,
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: options.method || 'GET',
            rejectUnauthorized: false,
            headers: options.headers || {},
            timeout: options.timeout || 30000
        };

        const req = transport.request(requestOptions, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                let payload = null;

                try {
                    payload = raw ? JSON.parse(raw) : null;
                } catch (error) {
                    payload = null;
                }

                resolve({
                    statusCode: res.statusCode || 0,
                    payload,
                    raw
                });
            });
        });

        req.on('timeout', () => {
            req.destroy(new Error(`请求超时 ${requestOptions.timeout}ms`));
        });

        req.on('error', reject);

        if (options.body) {
            req.write(options.body);
        }

        req.end();
    });
}

async function requestSystemStats(baseUrl, timeout) {
    const response = await createHttpRequest(baseUrl, '/api/system-stats', {
        method: 'GET',
        timeout
    });

    if (response.statusCode !== 200 || !response.payload || response.payload.status !== 'ok') {
        throw new Error(`system-stats 返回异常: HTTP ${response.statusCode} ${response.raw}`);
    }

    return response.payload.stats;
}

function formatServerStats(stats) {
    const mem = stats.memory || {};
    const processMem = mem.process || {};
    const cpu = stats.cpu || {};

    return [
        `CPU=${cpu.usage || 0}%`,
        `RSS=${formatMB(processMem.rss || 0)}`,
        `Heap=${formatMB(processMem.heapUsed || 0)}/${formatMB(processMem.heapTotal || 0)}`,
        `External=${formatMB(processMem.external || 0)}`,
        `ArrayBuffers=${formatMB(processMem.arrayBuffers || 0)}`
    ].join(' ');
}

function createCurveTracker() {
    return {
        points: [],
        peakRss: 0,
        peakHeapUsed: 0,
        peakExternal: 0,
        peakArrayBuffers: 0,
        push(stats) {
            const processMem = stats?.memory?.process || {};
            this.points.push({
                timestamp: stats?.timestamp || Date.now(),
                rss: processMem.rss || 0,
                heapUsed: processMem.heapUsed || 0,
                heapTotal: processMem.heapTotal || 0,
                external: processMem.external || 0,
                arrayBuffers: processMem.arrayBuffers || 0,
                cpu: Number(stats?.cpu?.usage || 0)
            });
            this.peakRss = Math.max(this.peakRss, processMem.rss || 0);
            this.peakHeapUsed = Math.max(this.peakHeapUsed, processMem.heapUsed || 0);
            this.peakExternal = Math.max(this.peakExternal, processMem.external || 0);
            this.peakArrayBuffers = Math.max(this.peakArrayBuffers, processMem.arrayBuffers || 0);
        }
    };
}

function buildAsciiChart(points, key, width) {
    if (!points.length) {
        return '无数据';
    }

    const values = points.map(item => item[key] || 0);
    const maxValue = Math.max(...values, 1);
    const minValue = Math.min(...values, 0);
    const span = Math.max(maxValue - minValue, 1);
    const step = Math.max(1, Math.ceil(values.length / width));
    const blocks = ' .:-=+*#%@';
    const samples = [];

    for (let i = 0; i < values.length; i += step) {
        const slice = values.slice(i, i + step);
        const avg = slice.reduce((sum, item) => sum + item, 0) / slice.length;
        const normalized = Math.min(blocks.length - 1, Math.max(0, Math.round(((avg - minValue) / span) * (blocks.length - 1))));
        samples.push(blocks[normalized]);
    }

    return `${formatMB(minValue)}|${samples.join('')}|${formatMB(maxValue)}`;
}

async function startSystemStatsPolling(baseUrl, intervalMs, timeout, tracker) {
    let timer = null;
    let stopped = false;

    const poll = async (label) => {
        if (stopped && label !== 'Final') {
            return;
        }

        try {
            const stats = await requestSystemStats(baseUrl, timeout);
            tracker.push(stats);
            console.log(`[RSS压测][Server][${label}] ${formatServerStats(stats)}`);
        } catch (error) {
            console.log(`[RSS压测][Server][${label}] 拉取 system-stats 失败: ${error.message}`);
        }
    };

    await poll('Init');

    timer = setInterval(() => {
        poll('Tick').catch(() => {});
    }, intervalMs);

    return async () => {
        stopped = true;
        if (timer) {
            clearInterval(timer);
        }
        await poll('Final');
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const startedAt = Date.now();

    const stats = {
        startedAt,
        success: 0,
        failed: 0,
        totalLatencyMs: 0,
        maxLatencyMs: 0
    };
    const serverCurve = createCurveTracker();
    const localMemHistory = [];

    let nextIndex = 0;
    let stopPolling = async () => {};

    console.log('[RSS压测] 启动');
    console.log(`[RSS压测] URL: ${args.url}`);
    console.log(`[RSS压测] 请求: ${args.method} ${args.path}`);
    if (args.body) {
        console.log(`[RSS压测] Body: ${args.body}`);
    }
    if (args.interval > 0) {
        console.log(`[RSS压测] 间隔: ${args.interval}ms`);
        console.log(`[RSS压测] 持续时间: ${args.duration || '∞'}s`);
    } else {
        console.log(`[RSS压测] 总请求: ${args.total}, 并发: ${args.concurrency}, 超时: ${args.timeout}ms`);
        if (args.duration > 0) {
            console.log(`[RSS压测] 持续时间: ${args.duration}s`);
        }
    }
    console.log(`[RSS压测] 进程初始内存: RSS ${formatMB(getMemoryUsage().rss)}, Heap ${formatMB(getMemoryUsage().heapUsed)}, External ${formatMB(getMemoryUsage().external)}`);

    console.log(`[RSS压测] 已启用服务端 system-stats 采样，间隔 ${args.statsInterval}ms`);
    stopPolling = await startSystemStatsPolling(args.url, args.statsInterval, args.timeout, serverCurve);

    async function sendRequest(workerId, index) {
        const begin = Date.now();
        const bodyContent = args.body ? Buffer.from(args.body, 'utf8') : null;
        const requestHeaders = {};
        let requestBody = null;

        if (bodyContent) {
            requestHeaders['Content-Type'] = 'application/json';
            requestHeaders['Content-Length'] = bodyContent.length;
            requestBody = bodyContent;
        }

        try {
            const response = await createHttpRequest(args.url, args.path, {
                method: args.method,
                headers: requestHeaders,
                timeout: args.timeout,
                body: requestBody
            });
            const latency = Date.now() - begin;
            stats.totalLatencyMs += latency;
            stats.maxLatencyMs = Math.max(stats.maxLatencyMs, latency);

            if (response.statusCode >= 200 && response.statusCode < 300) {
                stats.success++;
            } else {
                stats.failed++;
                if (stats.failed <= 5) {
                    console.log(`[RSS压测][Worker ${workerId}] 请求 ${index} 失败: HTTP ${response.statusCode} ${(response.raw || '').slice(0, 200)}`);
                }
            }
        } catch (error) {
            stats.failed++;
            if (stats.failed <= 5) {
                console.log(`[RSS压测][Worker ${workerId}] 请求 ${index} 异常: ${error.message}`);
            }
        }
    }

    async function worker(workerId) {
        while (true) {
            const elapsed = (Date.now() - startedAt) / 1000;

            if (args.duration > 0 && elapsed >= args.duration) {
                return;
            }

            const current = nextIndex;
            nextIndex++;

            if (args.interval <= 0) {
                if (current >= args.total) {
                    return;
                }
            } else {
                await sleep(args.interval);
            }

            await sendRequest(workerId, current + 1);

            localMemHistory.push(getMemoryUsage());

            const done = stats.success + stats.failed;
            if (args.interval <= 0) {
                if (done % args.outputEvery === 0 || done === args.total) {
                    const mem = getMemoryUsage();
                    console.log(
                        `[RSS压测] 进度 ${done}/${args.total} (${elapsed.toFixed(1)}s) | success=${stats.success} failed=${stats.failed} | ` +
                        `RSS=${formatMB(mem.rss)} Heap=${formatMB(mem.heapUsed)} External=${formatMB(mem.external)}`
                    );
                }
            } else {
                if (done % args.outputEvery === 0) {
                    const mem = getMemoryUsage();
                    console.log(
                        `[RSS压测] 进度 ${done} (${elapsed.toFixed(1)}s) | success=${stats.success} failed=${stats.failed} | ` +
                        `RSS=${formatMB(mem.rss)} Heap=${formatMB(mem.heapUsed)} External=${formatMB(mem.external)}`
                    );
                }
            }
        }
    }

    async function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    const workers = [];
    for (let i = 0; i < args.concurrency; i++) {
        workers.push(worker(i + 1));
    }

    await Promise.all(workers);
    await stopPolling();

    const elapsed = Date.now() - stats.startedAt;
    const totalDone = stats.success + stats.failed;
    const mem = getMemoryUsage();
    const avgLatency = totalDone > 0 ? (stats.totalLatencyMs / totalDone).toFixed(1) : '0.0';

    console.log('');
    console.log('[RSS压测] ==== 最终报告 ====');
    console.log(`[RSS压测] 耗时: ${elapsed}ms (${(elapsed / 1000).toFixed(1)}s)`);
    console.log(`[RSS压测] 总请求: ${totalDone}`);
    console.log(`[RSS压测] 成功: ${stats.success}`);
    console.log(`[RSS压测] 失败: ${stats.failed}`);
    console.log(`[RSS压测] 成功率: ${totalDone > 0 ? (stats.success / totalDone * 100).toFixed(1) : '0.0'}%`);
    console.log(`[RSS压测] 平均延迟: ${avgLatency}ms`);
    console.log(`[RSS压测] 最大延迟: ${stats.maxLatencyMs}ms`);
    console.log(`[RSS压测] 本机进程 RSS 峰值: ${formatMB(Math.max(...localMemHistory.map(m => m.rss), mem.rss))}`);
    console.log(`[RSS压测] 本机进程 结束内存: RSS ${formatMB(mem.rss)}, Heap ${formatMB(mem.heapUsed)}, External ${formatMB(mem.external)}`);

    console.log(`[RSS压测] 服务端采样点数: ${serverCurve.points.length}`);
    console.log(
        `[RSS压测] 服务端峰值: RSS ${formatMB(serverCurve.peakRss)}, Heap ${formatMB(serverCurve.peakHeapUsed)}, ` +
        `External ${formatMB(serverCurve.peakExternal)}, ArrayBuffers ${formatMB(serverCurve.peakArrayBuffers)}`
    );
    console.log(`[RSS压测] 服务端RSS曲线: ${buildAsciiChart(serverCurve.points, 'rss', 48)}`);
    console.log(`[RSS压测] 服务端External曲线: ${buildAsciiChart(serverCurve.points, 'external', 48)}`);
    console.log(`[RSS压测] 服务端ArrayBuffers曲线: ${buildAsciiChart(serverCurve.points, 'arrayBuffers', 48)}`);
}

main().catch((error) => {
    console.error('[RSS压测] 失败:', error.message);
    process.exitCode = 1;
});
