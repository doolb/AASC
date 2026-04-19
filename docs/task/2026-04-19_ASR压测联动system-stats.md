# 任务：ASR 压测联动 system-stats

## 任务描述

扩展现有 ASR 压测脚本，在压测 `/api/asr/recognize` 的同时自动拉取 `/api/system-stats`，输出服务端进程内存曲线，便于直接观察 RSS 是否进入平台期。

## Design 需求

### 联动监控
- 压测期间周期性采集服务端 `process.rss`、`heapUsed`、`external`、`arrayBuffers`
- 压测结束后输出服务端峰值指标
- 用纯文本 ASCII 曲线快速展示 RSS / External / ArrayBuffers 变化趋势
- 支持按需关闭指标采样，避免给服务端增加额外请求

## Spec 设计

### `scripts/asr-stress-test.js`
- 抽象通用 HTTP 请求函数
- 新增 `/api/system-stats` 拉取逻辑
- 新增采样曲线聚合器和 ASCII 图表生成逻辑
- 新增 `--stats-interval` 和 `--no-system-stats` 参数

## 受影响的功能模块和代码

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| scripts/asr-stress-test.js | 修改 | 联动服务端 system-stats，输出峰值和 ASCII 曲线 |
| docs/design/sherpa-asr.md | 修改 | 补充联动监控设计 |
| docs/spec/sherpa-asr.md | 修改 | 补充联动采样伪代码 |

## 自测用例

1. 服务端启动后执行 `node scripts/asr-stress-test.js --total 5 --concurrency 2`
2. 确认脚本输出 `[Server][Init]`、`[Server][Tick]`、`[Server][Final]` 指标日志
3. 确认结束时输出服务端 RSS / External / ArrayBuffers 曲线
4. 执行 `--no-system-stats`，确认不再拉取 `/api/system-stats`
5. 修改 `--stats-interval 500`，确认采样频率变化生效

## 兼容性测试

- Windows PowerShell
- HTTP / HTTPS 服务端地址
- 服务端已启动和未启动两种场景

## 性能测试

- 默认 1 秒采样一次，避免给服务端带来过高监控压力
- 高并发压测时验证采样日志仍可稳定输出

## 风险评估

- 低风险：仅增强本地脚本，不修改业务接口
- 低风险：指标采样频率可配，默认压力较小
- 中风险：如果压测本身持续时间过短，曲线点数可能较少

## 预计工时

- 脚本扩展：1 小时
- 文档同步：0.5 小时
- 基础验证：0.5 小时
- 总计：2 小时
