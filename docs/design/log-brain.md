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
- `public/js/log-brain-viewer.js`
  - 职责：控制端日志大脑可视化（摘要卡片、时间线、一键诊断）

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

在 `upload.html` 新增“日志大脑”页，包含：

1. 摘要卡片：错误数、告警数、模式数、风险级别。
2. 时间线：按时间窗口展示关键日志轨迹。
3. 一键诊断：调用 `/api/logs/brain-diagnose`。
4. 诊断结果面板：展示原因、证据、步骤、风险。

## 可视化增强

1. 自动刷新：支持开关与刷新间隔（5s/15s/30s），仅在“日志大脑”页激活时轮询。
2. 诊断历史缓存：本地保存最近 20 条诊断记录（问题、风险、首要原因），支持一键载入问题再次诊断。

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
