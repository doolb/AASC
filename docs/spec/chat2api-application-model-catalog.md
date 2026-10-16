# Provider 按应用统一模型目录规格（待确认，未实现）

```text
已有声明 := providerRegistry + coreAdapter.listModels + speechService.voices + modelMapper + applicationService.plan
已有来源 := Provider聊天模型 + 已知API/网页音色目录 + 模型映射 + 账号可见性
新增定义 := ModelEntry { id, name, providerId, application, input_modalities, output_modalities, baseModel, voiceId, tags, gender }
新增定义 := ModelQuery { application, providerId }
新增定义 := VoiceBinding { generatedModelId, providerId, baseModel, voiceId, fixedVoice }

操作流程 := 校验ModelQuery → providerId必填，拒绝空/未知/重复Provider；application缺省llm，显式仅llm或tts
公开llm应用 → 边界转换为已有内部chat；历史映射与planner标识保持
Provider注册信息与可用账号 → 根据原可见性规则取得候选Provider
llm来源 → 返回聊天ModelEntry，公开application为llm；不混入已识别TTS模型
tts来源 → 按底层模型读取既有明确音色目录 → 声音名称作为name
Provider/底层模型/音色精确ID → 生成稳定id与VoiceBinding → 检查用户映射冲突 → 冲突项不生成且可观测
指定Provider目录 → 按application过滤 → 返回同一ModelEntry结构，不默认聚合所有Provider
GET /v1/models新查询 → 要求provider，application省略默认llm；完全未筛选旧请求 → 保持原兼容行为
旧audio/voices → 投影共享音色来源 → 保留原响应形状

新音色模型请求 → 要求provider/model/input → 指定Provider内精确查VoiceBinding → 得到底层模型/固定voice
显式provider与绑定或映射Provider不同 → 明确拒绝 → 不从模型推断/覆盖Provider，不跨Provider退选
生成ID与用户映射冲突 → 拒绝歧义解析，不接管用户模型
生成ID无冲突 → 校验请求与系统控制voice → 不同值报冲突，同值接受
VoiceBinding → 原application planner → 同一账号与能力校验 → 原适配器合成
普通模型或旧model+voice → 原解析与参数优先级保持
目录中移除/未知ID → 明确报错 → 不替换成默认声音

自测流程 := application缺省llm、显式llm/tts、内部chat边界转换 → 正确目录与旧内部语义
自测流程 := 缺失/空/未知/重复Provider、Provider与model/映射冲突 → 明确拒绝
自测流程 := 固定目录 → llm/tts与Provider交集、68项3.1及原其他明确音色 → 查询不合成
自测流程 := 同名跨模型、英文voice大小写、精确/通配用户映射、固定voice冲突 → 精确路由或明确拒绝
自测流程 := 账号/Provider状态改变 → 缓存失效 → 不返回伪可用条目
自测流程 := 未筛选models、旧model+voice、旧音色API与自定义默认参数映射 → 兼容行为保持
当前状态 := 未修改源码、未执行测试、未出包发布
```

```text
后续约束 := Qwen API与千问网页TTS的baseModel取代码固定值；音色别名只绑定固定引擎与voice，不提供底层模型配置
状态 := 上述固定方案与统一目录均未实施，实施确认分别处理
```
