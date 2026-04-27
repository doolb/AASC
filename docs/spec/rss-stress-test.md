# RSS 内存压测脚本实现文档

## 文件位置

`src/scripts/rss-stress-test.js`

## 功能描述

通用的 HTTP 压测脚本，通过向目标服务器发送并发请求制造负载，同时定时采集服务端 `/api/system-stats` 的 RSS 内存数据，分析内存变化趋势。

## 命令行参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--url` | https://127.0.0.1:8081 | 目标服务器地址 |
| `--method` | GET | HTTP 方法 |
| `--path` | /api/system-stats | 请求路径 |
| `--body` | null | 请求体（JSON 字符串） |
| `--total` | 100 | 总请求数 |
| `--concurrency` | 5 | 并发数 |
| `--timeout` | 30000 | 请求超时（毫秒） |
| `--duration` | 0 | 运行持续时间（秒，与 total 二选一） |
| `--interval` | 0 | 请求间隔（毫秒） |
| `--stats-interval` | 1000 | 系统状态采样间隔（毫秒） |
| `--output-every` | 10 | 进度输出间隔（请求数） |

## 伪代码描述

```
// 入口函数 main
async function main():
    args = parseArgs(process.argv)
    
    stats = { startedAt, success, failed, totalLatencyMs, maxLatencyMs }
    serverCurve = createCurveTracker()
    localMemHistory = []
    
    // 启动系统状态轮询
    stopPolling = startSystemStatsPolling(url, statsInterval, timeout, serverCurve)
    
    // sendRequest 发送压力请求
    async function sendRequest(workerId, index):
        bodyContent = body ? Buffer.from(body) : null
        headers = {}
        if bodyContent:
            headers['Content-Type'] = 'application/json'
            headers['Content-Length'] = bodyContent.length
        
        begin = now
        try:
            response = createHttpRequest(url, path, { method, headers, timeout, body: bodyContent })
            latency = now - begin
            stats.totalLatencyMs += latency
            stats.maxLatencyMs = max(stats.maxLatencyMs, latency)
            if 200 <= response.statusCode < 300:
                stats.success++
            else:
                stats.failed++
                // 记录前 5 次失败详情
        catch error:
            stats.failed++
    
    // worker 协程
    async function worker(workerId):
        while true:
            if duration > 0 and elapsed >= duration:
                return
            current = nextIndex++
            if interval <= 0:   // total 模式
                if current >= total:
                    return
            else:               // interval 模式
                sleep(interval)
            
            sendRequest(workerId, current + 1)
            localMemHistory.push(getMemoryUsage())
            
            // 定期输出进度（total 模式显示 total，interval 模式不显示）
            if done % outputEvery == 0:
                outputProgress(stats, getMemoryUsage())
    
    // 启动并发 workers
    workers = [worker(i) for i in range(concurrency)]
    await Promise.all(workers)
    await stopPolling()
    
    // 输出最终报告：时间、成功率、延迟、RSS 峰值、ASCII 曲线
    
// 参数解析 parseArgs
function parseArgs(argv):
    return { url, method, path, body, total, concurrency, timeout, duration, interval, statsInterval, outputEvery }

// 通用 HTTP 请求 createHttpRequest
function createHttpRequest(baseUrl, pathname, options):
    // 支持 http/https 自动选择
    // 支持 GET/POST/PUT/DELETE
    // 支持自定义 headers 和 body
    // 解析 JSON 响应
    return { statusCode, payload, raw }

// 系统状态请求 requestSystemStats
function requestSystemStats(baseUrl, timeout):
    response = createHttpRequest(baseUrl, '/api/system-stats', { method: 'GET', timeout })
    if response.statusCode != 200 or payload.status != 'ok':
        throw
    return payload.stats  // { memory: { process: { rss, heapTotal, heapUsed, external, arrayBuffers } }, cpu, timestamp }

// 系统状态轮询 startSystemStatsPolling
async function startSystemStatsPolling(baseUrl, intervalMs, timeout, tracker):
    await poll('Init')
    timer = setInterval(() => poll('Tick'), intervalMs)
    return async ():
        clearInterval(timer)
        await poll('Final')

// 曲线追踪器 createCurveTracker
function createCurveTracker():
    return { points[], peakRss, peakHeapUsed, peakExternal, peakArrayBuffers, push(stats) }

// ASCII 图表 buildAsciiChart
function buildAsciiChart(points, key, width):
    // 将数值数组归一化到 0-9 等级，输出字符图表

// 格式工具
function formatMB(bytes):    // 字节转 MB 字符串
function getMemoryUsage():   // process.memoryUsage() 包装
function formatServerStats(stats):  // 格式化服务器状态输出字符串
```
