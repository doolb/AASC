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

## 参考

- [百炼 Qwen TTS API](https://help.aliyun.com/en/model-studio/qwen-tts-api)
- [豆包 V3 单向流式 HTTP](https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh)
- [国内千问用户指定页面](https://www.qianwen.com/chat/6ca4f1aa0292497095cb46e6ea45e08f)：2026-10-11 核对公开前端 4.9.6 的 doQwenAuth 与 `/api/v3/tts`，未读取私有会话内容。音色克隆的 synthesis_text 只生成采样文本，不能当作音频接口。
