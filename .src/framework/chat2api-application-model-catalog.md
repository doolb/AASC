#skill: ai-code-translation

## framework / 按应用统一Provider模型目录（待确认）

已有声明
- ProviderRegistry、ModelMapper、ApplicationService.plan、SpeechService.voices // 使用原账号与应用流程
- 聊天模型和既有音色目录 // 目录查询不能触发合成

新增定义
- ModelEntry { id, name, providerId, application, baseModel, voiceId, input_modalities, output_modalities, tags, gender }
- VoiceBinding { generatedModelId, providerId, baseModel, voiceId, fixedVoice }
- ModelQuery { application, providerId }

操作流程
- 校验ModelQuery的必填providerId → application省略时采用llm → 定位指定Provider并查询llm或tts来源 // 不宣称未实现应用
- 公开llm应用在边界映射至内部chat → LLM模型组织ModelEntry且application回显llm；tts底层模型与明确音色 → 组织同一ModelEntry // 声音名称显示为模型名
- Provider加底层模型加音色精确ID → 生成稳定id → 与用户精确/通配映射核对 // 不接管自定义规则
- 指定Provider目录结果 → 应用筛选 → HTTP或内部查询返回 // 不另外建立配置接口
- 未筛选旧models请求 → 原兼容目录；旧voices请求 → 同源数据投影 // 保留已有消费者
- 校验新音色模型请求provider/model/input均存在 → 指定Provider内精确匹配VoiceBinding → 绑定底层模型和voice // 避免把别名直接发上游
- 显式provider与绑定或模型映射的Provider不同 → 报冲突且不自动切换 // 保留用户显式来源
- 请求voice或控制voice不同于固定绑定 → 报冲突；一致则接受 // 模型选择必须对应实际声音
- 原普通模型和自定义默认映射 → 沿用原优先级 // 仅生成音色模型使用固定绑定
- 解析结果 → 原planner与账号调度 → 原合成适配器 // 保留鉴权、超时和真实错误
- 状态变化 → 失效对应Provider与底层模型缓存 // 避免过期权限或跨模型音色

自测流程
- application省略与显式llm → 同一LLM目录；内部chat不批量改写 // 验证默认值与边界转换
- Provider缺失/空/未知/重复与绑定/映射冲突 → 拒绝，不自动推断来源 // 对应目录与planner单测
- 统一契约、应用/Provider过滤、3.1目录、同名隔离、voice大小写 → 精确结果 // 对应新目录单测
- 显式和控制voice冲突、映射冲突、无效绑定 → 拒绝；正常绑定 → 适配器收到真实模型与声音 // 对应planner单测
- 未筛选models与旧voice请求、账户不可用、查询零合成 → 保持兼容 // 对应proxy与speech回归
