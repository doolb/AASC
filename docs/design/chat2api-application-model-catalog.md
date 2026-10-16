# Provider 按应用统一模型目录

## 状态与目标

2026-10-16，设计草案，待用户确认后实施。用户希望把音色名定义为模型，Provider统一返回不同应用的模型名。首期建议覆盖Chat2API当前支持的llm/tts（内部聊天应用仍为chat），四路网络TTS：qwen、doubaochat、qwen-api、doubaapi；系统原生继续使用设备目录，不注册为可由Chat2API服务器合成的模型。此范围须在实施确认时一并确认。

## 现状证据

- provider-registry.listModels返回字符串集合，未按应用区分；core-adapter和speech-service分别组织公开模型，proxy-service在GET /v1/models拼接。
- 模型映射已支持application=tts和parameters.voice，已有qiaoxiaojiao→Qwen Audio3.1/乔小娇测试；无需为每个音色创建新的实际Provider或请求协议。
- 当前application-service合并参数时显式voice可覆盖映射默认；音色模型必须区分固定绑定与普通默认映射，防止模型名与实际声音不同。
- 模型目录与音色目录目前分开，3.1具有68项已知官方音色；其他模型仅暴露已有明确目录，不推测未知音色。

## 统一契约（2026-10-16补充：Provider必填，application默认llm）

目录项统一包含id、name、providerId、application、input_modalities、output_modalities；TTS增加baseModel和voiceId，保留性别、标签及原目录信息。id用于调用和持久化，name用于显示；同名音色通过Provider和底层模型区分。

示例：id为qwen-api/tts/qwen-audio-3.1-tts-flash/qiaoxiaojiao_v3.1，name为乔小娇，application为tts，baseModel为qwen-audio-3.1-tts-flash，voiceId为qiaoxiaojiao_v3.1。稳定id是目录中的精确键，不能直接拼成上游请求；底层voiceId区分大小写。

用户明确要求首期仍需传provider。新统一目录查询必须显式提供provider；application可省略，缺省为llm，显式支持llm/tts。内部对应providerId与application，不允许缺省聚合所有Provider。llm在接口边界映射至现有内部chat标识，不批量改写历史模型映射和planner数据。HTTP复用GET /v1/models，例如 /v1/models?provider=qwen-api&application=tts。provider缺失、为空、未知、重复或与应用不兼容时明确报错；空目录返回空列表。调用音色模型必须同时提供provider、model、input，即使模型ID已带来源也不能省略provider；持久化选择保留provider/model成对值。新查询仅传provider时返回该Provider的llm模型，显式application=tts时返回音色模型。完全不带新筛选的旧GET /v1/models继续原兼容目录，仅供旧消费者。现阶段不宣称ASR、图像等未实现应用可用。

## 执行与兼容规则

- 音色模型在服务端解析为Provider+底层模型+固定音色后进入现有application planner、账号调度和合成适配器；调用者必须显式提交provider/model/input。
- 先查请求指定Provider，再在其目录内精确解析model；绑定或用户映射的Provider与显式provider不一致时拒绝，不从model推断、覆盖Provider，也不自动切换其它Provider。
- 针对自动生成的音色模型，不同显式voice或系统控制voice报冲突，同值接受；普通旧模型及用户默认参数映射保持原优先级。语速/音量按底层模型已有能力校验。
- 仅生成明确已知的音色条目，不以声音中文名作为全局唯一ID，不把别名当底层模型发给上游，不按斜线随意解析用户自定义模型名。
- 旧model+voice请求、/v1/audio/voices、普通模型映射和旧TTS配置保留；共享底层目录来源，避免新旧接口维护两份音色数据。首期不批量改已有用户配置、不要求重建未发布修复包。
- 自定义精确/通配映射与生成ID冲突时显式标识并不生成冲突项，保留原用户规则；不能悄悄接管原有模型名。音色ID失效时明确报错，不自动换声音。
- 可见性沿用既有Provider/账号启用及凭证配置规则；列出音色不等于远端权限验证，查询不发合成请求、不修改配置或消耗账号额度。必要缓存按Provider/底层模型区分，配置变化失效。

## 拟影响模块

新增chat2api-model-catalog-service.js集中构造与解析目录；调整provider-registry、core-adapter、speech-service、application-service、proxy-service及runtime装配，使LLM、TTS、HTTP共用目录契约。具体目录源抽取复用现有音色方法，不新建配置HTTP接口。此阶段不改控制端/显示端选音色交互；内部调用可继续旧兼容接口。

## 风险与验收

重点覆盖必填Provider、application缺省llm及llm/chat边界转换、Provider与模型/映射冲突、同名隔离、voice大小写、重复/非法筛选、固定voice冲突、自定义映射冲突、账号失效、旧调用不变、目录查询无副作用、无循环依赖。查询有界且可缓存，禁止按每个音色查询或测试上游。当前仅设计，不修改代码或发布状态、不运行测试、不构建发布。
