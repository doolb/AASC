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

## 5. 控制端页签移除伪代码

```text
过程 InitControlPage():
    加载现有控制端页签和面板
    不注册 data-target="brain"
    不创建 panel-brain
    不加载 LogBrainViewer 脚本

    若 localStorage.lastPanel 对应的面板不存在:
        将 lastPanel 回退为 "media"
        保存回退后的页签

过程 SwitchPanel(targetId):
    只允许切换当前页面实际存在的面板
    brain 不再是有效控制端目标
```

## 6. 服务端能力保留伪代码

```text
过程 InitServerLogBrain():
    LogBuffer 持续接收结构化日志
    LogBrain.ingest(entry)
    注册 /api/logs/brain-summary
    注册 /api/logs/brain-judge
    注册 /api/logs/brain-diagnose

控制端页面是否存在日志大脑面板，不影响上述服务端流程
```
