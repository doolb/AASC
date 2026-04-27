# 日志大脑实现文档（伪代码）

## 1. 摘要生成伪代码

```text
过程 GetSummary(timeRange, limit):
    actualTimeRange = timeRange or Config.logBrain.defaultTimeRange
    entries = LogBuffer.getEntries(actualTimeRange, limit)
    stats = SystemMonitor.getStats()

    counters = BuildCounters(entries)
    patterns = BuildPatterns(entries)
    timeline = BuildTimeline(entries, 60)
    findings = BuildFindings(counters, patterns, stats, Config.logBrain.thresholds)

    返回 {
        counters,
        patterns,
        timeline,
        findings,
        stats,
        thresholds: Config.logBrain.thresholds
    }
```

## 2. 记忆体构建伪代码

```text
过程 BuildJudgeContext(question, timeRange, limit):
    summary = GetSummary(timeRange, limit)
    timeline = GetRecentTimeline(summary.timeline, 40)

    memory = {
        sensoryMemory: timeline,
        workingMemory: {
            totalEntries: summary.totalEntries,
            levelCounters: summary.counters.levels,
            categoryCounters: summary.counters.categories
        },
        episodicMemory: summary.topPatterns,
        metacognition: summary.findings
    }

    prompt = BuildPrompt(question, summary, memory)
    返回 { summary, memory, prompt }
```

## 3. 诊断上下文与回退策略伪代码

```text
过程 BuildDiagnoseContext(question, timeRange, limit):
    context = BuildJudgeContext(question, timeRange, limit)
    context.prompt = BuildDiagnosePrompt(context)
    返回 context

过程 BuildFallbackDiagnosis(context, reason):
    causes = 从 context.memory.metacognition 中提取前3条
    evidence = 从 context.memory.sensoryMemory 中提取 error/warn 时间线
    steps = 生成低成本到高成本排查步骤
    riskLevel = InferRiskLevel(context.summary)
    返回 {
        possibleCauses: causes,
        evidenceLogs: evidence,
        investigationSteps: steps,
        riskLevel,
        fallbackReason: reason
    }
```

## 4. API 伪代码

```text
GET /api/logs/brain-summary:
    summary = LogBrain.getSummary(timeRange, limit)
    返回 summary

POST /api/logs/brain-judge:
    context = LogBrain.buildJudgeContext(question, timeRange, limit)
    返回 context

POST /api/logs/brain-diagnose:
    context = LogBrain.buildDiagnoseContext(question, timeRange, limit)
    llmResp = LlmService.chat(context.prompt, diagnoseSystemPrompt)
    diagnosis = ParseDiagnosisJson(llmResp)
    若 diagnosis 为空:
        diagnosis = LogBrain.buildFallbackDiagnosis(context, llmResp.error)
    返回 { diagnosis, context }
```

## 5. 控制端页面伪代码

```text
过程 InitLogBrainViewer():
    绑定 timeRange change -> RefreshSummary
    绑定 diagnose click -> RunDiagnose

过程 RefreshSummary():
    GET /api/logs/brain-summary
    渲染摘要卡片
    渲染时间线

过程 RunDiagnose():
    POST /api/logs/brain-diagnose
    渲染风险级别
    渲染可能原因、证据日志、排查步骤
```

## 6. 自动刷新与历史缓存伪代码

```text
过程 SetBrainPanelActive(active):
    isPanelActive = active
    若 active 为 true:
        RefreshSummary()
        StartAutoRefreshIfEnabled()
    否则:
        StopAutoRefresh()

过程 StartAutoRefreshIfEnabled():
    若 autoRefreshEnabled 为 false:
        返回
    清理旧 timer
    timer = setInterval(RefreshSummary, autoRefreshIntervalMs)

过程 AppendDiagnosisHistory(question, diagnosis):
    item = { timestamp, question, riskLevel, topCause }
    history.unshift(item)
    history = history.slice(0, 20)
    localStorage.setItem(history)

过程 RenderDiagnosisHistory():
    从 history 渲染列表
    点击“载入”时回填 question 输入框
```
