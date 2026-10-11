# TTS Provider 与播报配置

## 需求与范围

2026-10-11 用户确认继续多 Provider 方案。在现有 system TTS 上增加 qwen-chat、qwen-api、doubao-api。AI 与 Agent 回复按来源聊天模板解析选择；文本媒体与系统播报分别有独立默认配置。群聊没有唯一模板时使用 AI 默认，临时会话使用当前角色模板。只扩展合成入口，保留音频 URL、目标选择、有序队列、回执和聊天打断。

模板可选择“继承系统 AI 默认”，或显式选择 Provider；未填音色时，仅在最终 Provider 与业务默认 Provider 相同时继承业务默认音色，否则使用最终 Provider 自身默认音色。避免跨 Provider 搬运音色 ID。qwen-chat 只允许 AI/Agent 回复，文本媒体、报时、自定义文字和系统提示拒绝使用。

## 配置与接口

业务选择存 `config.tts.aiReplyDefault/textMedia/systemBroadcast`；端点、模型、API凭证和默认音色/参数存用户配置 `tts.providers`；system不保存Provider级enabled/defaultVoice，qwen-chat不保存凭证或账号ID，模板仅保存 Provider/voice。Provider 默认关闭云端/网页能力，system 沿用旧开关与设备选择。空凭证输入保留旧值，显式清除单独处理。保存失败保持原权威配置。

控制端通过 `setTtsProviderConfig` 提交业务选择和 Provider 参数，服务端规范化并持久化，广播 `ttsProviderConfig` 脱敏权威值；初始化/重连补发当前状态，不新增 HTTP 配置接口。音色目录通过 `getTtsProviderVoices/ttsProviderVoices` 查询，失败不覆盖已选音色；已保存但目录不存在的 ID 保留并标注，最终有效性由合成接口判定。

## 生成

system 保留显示端优先/服务端回退；API Provider 调用对应端点，qwen-chat调用Chat2API语音服务，失败不切换 system。qwen-api 使用百炼非流式合成及音频 URL 下载；doubao-api 使用 V3 单向 HTTP 流、收集 base64 PCM 并包装 WAV；qwen-chat 通过Chat2API内部语音服务使用国内千问官方公开前端签名与 WebSocket 朗读流程。统一完整 WAV 进入既有内存缓存，不写临时音频文件。响应、超时、解码及音频大小有上限；不将凭证、响应原文或签名 URL 放入日志/广播。

Chat2API默认国内千问语音适配器使用纯Node校时、令牌注册/刷新和HMAC签名，直接连接官方语音WebSocket；无需Chrome、DOM、AWSC或临时目录。qwen_web基础场景注册qwen_audio_asr关联场景令牌，每次使用当前Chat2API账号Cookie/ticket。默认模型QUARK_VOICE、音色zh_female_quarkF531S0_ptts。官方协议变化可能导致鉴权失败，需要根据固定脱敏阶段错误更新契约。

无新增生产依赖。服务端/网页修改只标记 `servicePackage=true`，既有 minApk 状态保留。真实云端鉴权、声音播放、长队列及设备体验需有对应账号现场验收。

system 音色沿用旧 tts.defaultVoice及原生显示端已加载音色；速度未保存Provider默认时沿用旧tts.defaultSpeed。显示端与 Qwen API 语速采用本地 PCM 重采样，会改变音高；豆包/国内千问使用生成参数。音量在入缓存前调整。Qwen API 单次600字符，沿用业务分句，单句超限明确失败。

## 系统原生路径与 Chat2API 统一语音（2026-10-11 已实现）

用户回复“是”确认本轮方案。系统原生移除Provider级enabled、默认音色ID和目录查询；业务及模板最终选择system时新音色ID无效，继续使用tts.device、tts.serverEnabled及既有原生音色配置。旧Provider开关/音色字段规范化时忽略，下次保存移除；旧生成接口显式传入的原生音色名称仍可用。

qwen-chat只调用Chat2API统一内部语音服务，不读账号库、不保存chat2apiAccountId，不再展示账号下拉框、刷新按钮、查询状态或安装Chrome文案。旧TTS账号桥接和候选WebSocket消息已移除。Chat2API内部调度国内qwen账号，复用当前账号/Provider启用状态、限额、健康状态与已保存的round-robin/fill-first/failover策略；凭证每次读取，ticket覆盖同名旧Cookie，不复制到TTS配置。只支持共享账号库，不自动扫描自定义rootDir。

新增Chat2API speech service及默认qwen speech adapter；runtime与聊天共用dataStore/providerRegistry/loadBalancer。代理运行时提供POST /v1/audio/speech，复用既有Bearer鉴权，返回完整audio/wav二进制；TTS内部调用不要求代理HTTP任务持续运行，也不启动第二个代理。输入模型qwen-chat/QUARK_VOICE/MINI_MAX，speed为0.25–4倍，volume为0–100，response_format只支持wav。合成总时限60秒、音频16MiB；无账号、停用、凭证缺失、签名失败和超时返回固定脱敏错误，不切换TTS Provider。

前轮曾直接执行依赖DOM/iframe/AWSC的官方SDK；本轮已核对并真实验证通用场景关联语音令牌路径，默认适配器改为纯Node直接接口。账号级串行初始化/刷新/消费，最多16个会话且闲置30分钟清理；凭证变化使用新会话，旧会话按闲置/容量驱逐，不复用旧令牌。超时和迟到请求不继续连接语音。默认音色真实远端合成及刷新已通过，其他音色权限和设备声音仍需现场验收。

本机8081旧进程未下发新TTS配置，符合静态网页与旧运行后端不一致；已通过npm run restart:server重启，本机wss初始化确认新版ttsProviderConfig且无上述旧字段。静态页面隐藏标签的display冲突已修复，真实Chromium截图已查看。用户其他实例仍以实际部署版本为准；未构建或发布Offline包，servicePackage保持true。

## 控制端聊天手动播放读取所属AI语音（2026-10-11 已实现）

用户要求聊天面板手动点击AI回复播放，也读取对应AI语音方式。当前chat.js.playMessage只取speech/content，再由playText发送tts/play文本；服务端控制端tts/play合成未提供businessType/templateTts，因此按systemBroadcast选择，与自动AI/Agent回复不一致。

已让消息播放携带来源上下文，服务端据模板名称读取当前权威tts设置并以ai_reply/agent_reply生成，不从客户端接收端点/凭证。私聊使用消息来源模板，Agent使用来源角色，临时当前/历史组使用各自roleName；群聊无唯一模板、旧消息缺来源或模板已删除时采用AI默认。不得因切换会话而把另一角色音色套给旧消息。原生仍用旧音色路径，qwen-chat仍由Chat2API提供。

已覆盖历史索引播放、流式完成后按钮与chatNewMessage对象入口；保留speech优先、Markdown清理、分句/有序队列、控制端/显示端/多端目标及原自定义播报。修改chat.js/server-app.js，新增chat-reply-tts-context模块校验业务/模板名并读取服务端权威配置。整批分句捕获同一模板配置，下一次播放读取更新值。手动播放允许仅在控制端播放或只指定displayIds，不再因缺少主显示端而提前返回。

95项TTS/聊天回归与5个历史兼容文件（Node6项）通过；新增8项手动路径测试包含真实Chromium按钮点击/只读SelfTest，以及实际服务端完整handler/有序调度/Provider解析。客户端伪造Provider/密钥不进入合成，非法业务/模板名无音频。未运行全仓npm test；真实云端账号和设备声音仍待现场验收。本机服务已重启，HTTP静态脚本与WSS权威配置初始化验证通过。

## 国内千问故障与直接接口方案（2026-10-11 已实现）

用户报告display-umwo5k6l逐句生成失败，要求像Chat2API一样模拟接口获取，并回复“是”确认实施。已实现纯Node语音鉴权，继续只用Chat2API账号，签名与令牌归Chat2API内部。

旧路径故障为Chrome执行SDK字体检测时报Disk quota exceeded(122)/SIGABRT，/tmp带usrquota。隔离目录诊断生成252044字节WAV、12416ms；随后纯Node原型同账号同文本生成相同大小有效WAV、2182ms。本轮已移除语音浏览器路径，消除该临时存储依赖；未播放诊断音频，诊断目录已清理。

现有Chat2API国内聊天为chat2.qianwen.com/api/v2/chat；语音为speech-tts.qianwen.com/api/v3/tts。只带Cookie及jump_sign请求均401；直接注册qwen_audio_asr基础场景无UMID返回D1001。已真实验证qwen_web基础场景关联qwen_audio_asr可注册100个一次性令牌，时区输入使用字符串；关联场景继承基础设备ID，校时毫秒兼容数字字符串。

新增qwen-speech-auth，qwen-speech-adapter默认使用Node鉴权，speech-service只按白名单阶段码回传固定提示；校时/注册/刷新失败、超时和忙状态可区分，不采纳上游原文。令牌/Cookie仅内存，响应512KiB、会话16个、有界Cookie与令牌池、不跟随重定向。原生、其他Provider、账号调度、AI上下文和播放协议保持。无新增生产依赖，servicePackage保持true；具体自测、真实生成与部署见对应task。

## 纯表情分句的空音频诊断（2026-10-11，已修复）

19:56:58的控制端手动tts/play文本按当前Markdown清理及分句逻辑输出12个片段，其中4个仅为✨、🐱💻⚡、📶🐾、❤️；isPunctuationOnly不会过滤表情。19:57:00至19:57:06出现4条句子生成失败，其他文字片段仍独立生成并播放。

同一Chat2API国内千问账号直接接口逐段验证：主人好呀！返回49004字节有效WAV；4个纯表情片段各返回code=2000000、status=2、音频0字节。wrapPcm正确拒绝空PCM，但speech-service将错误统一为检查账号及语音运行环境，导致错误归因误导。验证只生成并检查音频，没有播放或更改账号配置。

原候选方案为通用TTS过滤及上游空音频错误码；用户进一步要求仅qwenchat做emoji筛选，因此实施下述qwen-chat入口方案，未采用全Provider过滤和Chat2API错误映射变更。通用分句器仍保留表情，聊天原文不变。

## qwen-chat emoji筛选（2026-10-11，已实现）

用户在诊断方案后要求qwenchat做emoji筛选，视为确认仅针对qwen-chat实施。筛选位于qwen-chat薄适配器，按Unicode字素簇整体去除表情、肤色组合、ZWJ家庭、国旗、键帽与变体选择符，普通数字和文字标点保留；聊天原文不变。纯表情或筛选后仅剩标点/空白返回null，不查询Chat2API账号、不连接语音、不生成假空WAV。Provider服务及手动/自动AI/Agent播放调用共同接受该跳过结果；其他Provider继续原文和现有音频规则。真正正文生成失败仍明确报告，本轮不更改Chat2API鉴权或错误映射。

## 国内千问音色范围核查（2026-10-11）

针对用户再次确认QUARK_VOICE音色数量：目前只确认zh_female_quarkF531S0_ptts可用，官网默认配置及本项目预置一条不等于模型音色总数为一；其他音色尚无可用ID/目录证据，不承诺可以切换。

当前qwen-chat.voices仅预置已真实合成验证的默认女声zh_female_quarkF531S0_ptts，生成请求仍可传入其他voice，是否可用由上游模型与账号判定。实时核对国内官网4.9.6的js/async/4180.js，公开朗读tts_config默认同为该音色及QUARK_VOICE，该朗读模块未发现音色目录；不能据此断言上游仅支持一种音色。国际版Qwen及百炼API目录不能直接作为国内账号音色。扩充目录需国内官方目录或逐项合成证据，本轮未增加未经验证的音色。

用户进一步把模型改成qwen3-tts-flash后不可用。已查明qwen-chat调用网页WebSocket并使用Chat2API账号Cookie，qwen3-tts-flash则是qwen-api百炼HTTP模型，使用API Key与对应系统音色。修复前配置model接受任意有界字符串，但Chat2API语音请求只接受qwen-chat别名、QUARK_VOICE、MINI_MAX，导致不兼容模型保存成功后生成才失败。QUARK_VOCIE也是拼写错误，正确为QUARK_VOICE。

用户回复“先修复”确认实施后，控制端网页模型改为QUARK_VOICE与MINI_MAX下拉选择，并提示MINI_MAX需匹配音色、百炼模型应使用Qwen API。服务端在现有WebSocket保存流程严格校验，非法模型失败并回传原权威值；qwen-chat别名规范化为QUARK_VOICE。历史已保存的不兼容模型读取时恢复默认QUARK_VOICE，保留音色、账号和其他参数，下次合法保存持久化。只读SelfTest同步检查模型，不增加云端请求。未扩充未经验证的音色。

## qwen3-tts-flash与Maia网页接口实测（2026-10-11）

用户要求实测指定模型与音色，已使用当前Chat2API国内账号、既有签名和网页WebSocket，以独立诊断直接调用低层适配器绕过本地模型白名单。qwen3-tts-flash+Maia上游4000002、音频0字节；同模型加网页默认音色仍4000002；QUARK_VOICE加Maia为5000005、音频0字节。默认组合前后分别成功生成97484/98924字节有效WAV，五次连接均建立并发送原参数。结论仅适用于当前国内网页接口和账号，不外推其他接口或未来版本；生产模型限制、账号与音色目录不变。百炼官方音色目录列有Maia，本次未调用百炼API。

## 参考

- [百炼 Qwen TTS API](https://help.aliyun.com/en/model-studio/qwen-tts-api)
- [豆包 V3 单向流式 HTTP](https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh)
- [国内千问用户指定页面](https://www.qianwen.com/chat/6ca4f1aa0292497095cb46e6ea45e08f)：2026-10-11 核对公开前端 4.9.6 的 doQwenAuth 与 `/api/v3/tts`，未读取私有会话内容。音色克隆的 synthesis_text 只生成采样文本，不能当作音频接口。

## Qwen API 错误提示与 WAV 排查（2026-10-11，错误日志已实现，WAV待复现）

用户报告21:43:57起连续三次“TTS WAV 块不完整”，随后要求将实际错误原因加入打印。现有Qwen API走非流式合成、音频URL下载、本地速率/音量调整和完整WAV校验；报错表示RIFF子块声明长度超过已收集字节，可能为异常长度头或真实截断，尚无原始音频证据，不归因于模型或音色。

使用当前本机百炼配置qwen3-tts-flash/Maia、速率1/音量100独立复测，API返回HTTP 400、Arrearage；本次未进入音频下载。当前欠费与原WAV错误属于不同阶段，不能替代原故障结论。标准WAV通过、未知data长度与截断样本均能触发原错误，证明仅凭错误文字不能区分二者。v64已完成发布，本轮错误日志改动已实现但尚未出新包，不包含在v64中。

用户要求其他错误也相应打印，确认前轮方案并扩展豆包API。实施沿用现有失败日志：HTTP失败响应按16KiB和原总时限读取，仅提取已知错误码；Qwen API将欠费、凭证、权限、参数、限流等已知原因映射为固定中文提示，包含HTTP状态和白名单错误码。未知/非JSON/超限/中断响应沿用固定HTTP错误，不将上游message、凭证、响应原文或签名音频URL带入日志。HTTP下载保留现有行为；豆包HTTP失败与成功流中的业务错误使用同一固定映射，共用业务码仅依据官方固定标记细分并发、资源匹配等原因。HTTP 200的业务失败也使用相同映射。成功音频、WAV校验、缓存与播放协议保持现有逻辑。

用户本轮确认错误日志改动；按已告知方案修改tts-provider-http.js、tts-provider-registry.js、新增tts-provider-errors.js错误映射模块并补充tts-provider-integration.test.js。原WAV问题待账户恢复或取得完整音频样本后继续复现，不通过忽略长度校验掩盖真实截断。

## 豆包语音指令核查（2026-10-11，尚未接入）

用户询问context_texts是否已接入。真实请求仅含text/speaker/model/audio_params，规范化配置也没有语音指令字段，因此当前无法发送该字段。官方单向HTTP文档支持在req_params.additions的JSON序列化字符串内提供context_texts，只适用于豆包语音合成模型2.0音色；model参数用于复刻音色，指定后不支持context_texts。本轮只核查并回答，未增加指令配置或固定语气。后续若用户要求接入，应先明确Provider默认与AI模板指令的配置范围，继续使用现有AASC/WebSocket权威配置。

参考： https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh ； https://docs.volcengine.com/docs/DoubaoVoice/error-code-query-1?lang=zh ； https://help.aliyun.com/zh/model-studio/error-code 。

本轮错误提示回归：TTS Provider、手动AI播放、Agent和实际服务端并发共96项通过，无失败/跳过；3个生产JS语法检查通过。真实百炼请求通过生产适配器显示Qwen API HTTP 400 [Arrearage]及固定中文欠费原因，无音频下载。Offline servicePackage设为true，minApk/dependenciesPackage保持，尚未发布新包。
