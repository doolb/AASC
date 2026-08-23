# 日志大脑设计

## 目标

新增“类人脑”日志管理能力，将原始日志转为可供大模型判断问题的结构化上下文。

## 设计思路

1. 感知记忆（Sensory Memory）：保留最新时间线日志片段。
2. 工作记忆（Working Memory）：统计错误级别、分类计数、关键波动指标。
3. 情景记忆（Episodic Memory）：提炼重复日志模式，识别高频异常线索。
4. 元认知（Metacognition）：生成可执行的风险判断与排查建议。

## 核心组件

- `src/framework/observability/log-brain.js`
  - 输入：日志流（LogBuffer）+ 系统状态（SystemMonitor）
  - 输出：认知摘要、诊断上下文、回退诊断结果
- `src/apps/server/api/log-brain-api.js`
  - 职责：聚合 `brain-summary / brain-judge / brain-diagnose` 接口
  - 依赖：`log-brain` + `src/external/llm/llm-service.js`
- 控制端日志大脑可视化已移除
  - 工作 Agent 可直接读取项目日志文件进行问题分析
  - 保留服务端 `LogBrain` 与日志诊断 API，供后台处理和其他调用方使用

## API 设计

1. `GET /api/logs/brain-summary`
   - 功能：返回日志认知摘要
   - 参数：`timeRange`、`limit`
2. `POST /api/logs/brain-judge`
   - 功能：生成给大模型的问题判断上下文
   - 入参：`question`、`timeRange`、`limit`
3. `POST /api/logs/brain-diagnose`
   - 功能：直接调用 LLM 输出结构化诊断结果
   - 入参：`question`、`timeRange`、`limit`
   - 出参：
     - `possibleCauses`（概率排序）
     - `evidenceLogs`
     - `investigationSteps`
     - `riskLevel`

## 控制端页面

控制端不再提供“日志大脑”页签、面板、查看器脚本和专用样式。控制端保留普通“日志”页签；需要深入分析时由工作 Agent 读取项目日志文件完成。

服务端日志大脑 API 保持不变，不依赖控制端页面是否存在。

## 阈值配置化

在 `config/config.json` 新增 `logBrain` 配置：

- `errorThreshold`
- `warnThreshold`
- `memoryWarningThreshold`
- `defaultTimeRange`

服务端启动时从配置读取阈值注入 `LogBrain`，避免规则写死。

## 价值

1. 把海量日志转成可读结论，降低人工筛查成本。
2. 给 LLM 提供结构化上下文，提高问题判断准确度。
3. 保持实时更新，可用于线上故障快速归因。
4. 控制端可视化诊断闭环，降低排障沟通成本。
