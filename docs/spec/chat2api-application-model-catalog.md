# Provider 按应用统一模型目录规格（待确认，未实现）

```text
已有声明 := providerRegistry + coreAdapter.listModels + speechService.voices + modelMapper + applicationService.plan
已有来源 := Provider聊天模型 + 已知API/网页音色目录 + 模型映射 + 账号可见性
新增定义 := ModelEntry { id, name, providerId, application, input_modalities, output_modalities, baseModel, voiceId, tags, gender }
新增定义 := ModelQuery { application, providerId }
新增定义 := VoiceBinding { generatedModelId, providerId, baseModel, voiceId, fixedVoice }

操作流程 := 校验ModelQuery → 应用仅chat或tts，未知应用与重复筛选拒绝
Provider注册信息与可用账号 → 根据原可见性规则取得候选Provider
chat来源 → 返回聊天ModelEntry；不混入已识别TTS模型
tts来源 → 按底层模型读取既有明确音色目录 → 声音名称作为name
Provider/底层模型/音色精确ID → 生成稳定id与VoiceBinding → 检查用户映射冲突 → 冲突项不生成且可观测
统一目录 → 按application与providerId过滤 → 返回同一ModelEntry结构
GET /v1/models显式筛选 → 统一目录；未筛选 → 保持原兼容行为
旧audio/voices → 投影共享音色来源 → 保留原响应形状

请求model → 精确查VoiceBinding → 得到实际Provider/底层模型/固定voice
生成ID与用户映射冲突 → 拒绝歧义解析，不接管用户模型
生成ID无冲突 → 校验请求与系统控制voice → 不同值报冲突，同值接受
VoiceBinding → 原application planner → 同一账号与能力校验 → 原适配器合成
普通模型或旧model+voice → 原解析与参数优先级保持
目录中移除/未知ID → 明确报错 → 不替换成默认声音

自测流程 := 固定目录 → chat/tts与Provider交集、68项3.1及原其他明确音色 → 查询不合成
自测流程 := 同名跨模型、英文voice大小写、精确/通配用户映射、固定voice冲突 → 精确路由或明确拒绝
自测流程 := 账号/Provider状态改变 → 缓存失效 → 不返回伪可用条目
自测流程 := 未筛选models、旧model+voice、旧音色API与自定义默认参数映射 → 兼容行为保持
当前状态 := 未修改源码、未执行测试、未出包发布
```
