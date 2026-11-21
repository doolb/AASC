# 猪了个猪关卡导航

目标按当前关卡独立运行。中层优先采集并检查可复用的已验证布局；候选布局不能视为已复核。只有完整路线经独立重放并确认现场一致后才执行，未解决的缺口才交给高层。

```navigation-json
{
  "metadata": {"id":"pig-game", "name":"猪了个猪", "version":"1.0.0", "navigators":["pig-game"]},
  "scenarios": [{"id":"pig-level", "priority":500}],
  "goals": [{
    "id":"pig-level", "kind":"compound", "period":"persistent", "scenarioId":"pig-level",
    "steps":[
      {"id":"capture", "kind":"pig-game"},
      {"id":"review", "kind":"pig-game"},
      {"id":"solve", "kind":"pig-game"},
      {"id":"execute", "kind":"pig-game"},
      {"id":"victory", "kind":"pig-game"}
    ]
  }]
}
```
