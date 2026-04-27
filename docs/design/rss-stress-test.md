# RSS 内存压测脚本设计文档

> 状态：✅ 已实现（2026-04-27）

## 功能需求

编写一个通用的 HTTP 压测脚本，专注于监测目标服务器的 RSS 内存变化：

1. 向目标服务器发送可配置的 HTTP 请求，产生负载
2. 定时通过 `/api/system-stats` 采集服务端 RSS/Heap/External 数据
3. 同时记录本机压测进程的内存占用
4. 输出内存变化的 ASCII 曲线图
5. 报告峰值内存、平均延迟、请求成功率

## 架构设计

### 参数配置
- `--url` 目标服务器地址
- `--method` HTTP 方法
- `--path` 请求路径
- `--body` 请求体 JSON 字符串
- `--total` 总请求数
- `--concurrency` 并发数
- `--timeout` 请求超时
- `--duration` 按持续时间运行（与 total 二选一）
- `--interval` 请求间隔（按间隔发请求，与 concurrency/total/duration 配合）
- `--stats-interval` 系统状态采样间隔
- `--output-every` 进度输出间隔

### 数据采集
1. **服务端数据**：通过 `/api/system-stats` GET 接口拉取，包含 RSS/HeapTotal/HeapUsed/External/ArrayBuffers/CPU
2. **本地数据**：通过 `process.memoryUsage()` 采集
3. **曲线追踪**：记录每个采样点的完整内存数据，计算峰值

### 输出报告
1. 实时进度：当前完成数/总数，成功/失败数
2. 服务端内存快照：每次采样输出 RSS/Heap/External 等
3. 最终报告：总耗时、平均/最大延迟、峰值内存
4. ASCII 图表：RSS、External、ArrayBuffers 的变化曲线
