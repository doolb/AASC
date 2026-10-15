# 语音服务与音色

## 默认方式与Qwen Audio 3.1目录（2026-10-15）

五种方式均默认可用，语音设置不再提供Provider启用开关；旧关闭配置会规范化为可用。先选择方式、模型或音色，再等待服务器保存确认。Chat2API的账号/Provider管理仍决定账号是否可用于实际调用，缺账号或登录失效时会明确报错。

Qwen API默认模型为`qwen-audio-3.1-tts-flash`，默认音色乔小娇`qiaoxiaojiao_v3.1`，提供[官方该模型音色表](https://platform.qianwenai.com/docs/developer-guides/speech/voice-list/qwen-audio-tts)的68个音色。两端快选和声纹页共用目录，可按官方名称/ID/标签搜索、按性别筛选；ID区分大小写，例如`Emily_v3.1`。目录只用于实际3.1模型，明确保存的其它模型保留其原目录，不跨模型混用。

## 四路统一与模型映射（2026-10-13）

四路网页/API请求均由Chat2API生成，旧业务ID保持。模型映射可同时指定application=tts和parameters.voice，映射默认先于Provider默认；如qiaoxiaojiao映射Qwen31及乔小娇。旧speech现在也接受API限定模型和已登记TTS映射，WAV播放/缓存协议保持。完整配置示例见[统一应用](chat2api-unified-applications.md)。网页qwen新保存的合法映射别名重载保留；升级前旧错误模型仍恢复QUARK_VOICE。

控制端「声纹」页面展开「语音服务与音色」，分别选择AI/Agent回复、文本阅读、报时与系统播报的服务，然后「保存语音配置」并等待服务器确认。其他控制端同步权威值，重连后重新获取。

语速−10至10按Provider分别保存；仅上游原生接口明确接受语速参数的方式显示语速输入。Qwen API按模型判断：Qwen-Audio 3.0/3.1可传原生`input.rate`，Qwen3-TTS HTTP没有声明语速字段时隐藏。音量0至100只在面板保留一个全局入口，所有业务和Provider共用。豆包网页朗读的上游语速固定，因此不显示语速设置；WAV处理只调音量，不改变语速或时长。

系统原生沿用现有TTS生成设备、服务器开关和原生音色配置，此面板只提供语速、音量，不增加启用开关或音色ID。业务或模板选中系统原生时隐藏音色ID输入；旧Provider级开关和音色ID不会阻断或覆盖原有路径。

国内千问网页可用于AI/Agent回复、文本阅读、报时/提醒、自定义文字和系统播报，由Chat2API提供语音合成。文本阅读、报时与系统播报的选择框均可选国内千问，保存后等待权威回填；已有默认选择保持。先在Chat2API账户管理中添加或登录国内千问（qwen）账号，并启用对应账号及Provider；在语音面板设置模型/默认音色并保存。TTS不再查询或选择账号，Chat2API按已保存的调度策略自动使用可用国内账号，更新登录后下次合成读取最新值。国际qwen-ai不适用于该语音协议。未提供可用账号、登录失效或上游失败会明确报错，不切换到系统原生。

豆包普通文字doubaochat已于2026-10-13用正式Node适配器真实验证流式/非流式OK，现支持Responses同账号原生续接、仅发新增输入，两轮纯Node协议记忆验证通过；同账号nodeProfile初始化后不依赖Chrome或页面签名，详情见[纯Node普通LLM](chat2api-doubao-node.md)。这不代表网页朗读链路完成真实验收。

`doubao-chat`用于 `/v1/audio/speech` 和AI/Agent语音设置，名称“豆包网页朗读（实验）”，方式默认可用。启用Chat2API中的doubaochat账号与Provider后自动选择可用账号，无须手动模型映射；显式账号映射仍优先且不退选。TTS只需Cookie，不要求文字Node资料。默认音色zh_female_wenroutaozi_uranus_bigtts，可从官方94项目录选择、上游speed=1/volume=100，面板隐藏语速设置，后处理只调全局音量；input最多1000个UTF-16字符且UTF-8≤4000字节，仅WAV。code92起同一适配器内按账号跨批次排队，完整上游音频到达即交接，不等待WAV解码；每账号最多等待16项、实例256项，等待计入原60秒时限，取消移除等待项。错误不重试或切换来源，现有分句播放顺序保持。主服务器及Android各三批同时提交已合成非静音48kHz WAV；此次未验证实际播放听感。

网页模型默认选择QUARK_VOICE，MINI_MAX需另有匹配的可用音色；目前预置的已验证音色是zh_female_quarkF531S0_ptts，完整国内音色目录尚未取得。qwen3-tts-flash应配置在Qwen API中并使用百炼API Key，不能保存为国内千问网页模型。历史错误模型读取时恢复QUARK_VOICE并保留其他参数，下一次合法保存会写回；服务端拒绝新提交的错误模型并保留原配置。

Android账户管理“打开外部网页”会向现有允许的www/chat2/chat2-api.qianwen.com三个HTTPS来源恢复登录Cookie。新版APK的恢复提示会显示当前网页来源，便于核对跳转；提示不包含网址路径或查询参数。原生来源提示需更新APK，网页或服务代码热更新无法替换原生窗口。

旧qwen-chat手动凭证及chat2apiAccountId不再使用，下次保存时移除，不会自动导入账户管理。账号凭证只由Chat2API管理。内部语音服务不要求代理HTTP任务持续运行；自定义rootDir独立库不会自动扫描。国内千问语音已由Chat2API直接调用接口生成，无需安装Chrome，也不查询浏览器账号。

Qwen API默认qwen-audio-3.1-tts-flash与乔小娇qiaoxiaojiao_v3.1。两路API Key改在Chat2API账号管理中配置：qwen-api或doubaapi，端点和豆包资源ID为账号可选参数；保存只校验格式，不发送远端请求。旧TTS私有密钥保留但不再用于生成。TTS面板只保存业务选择、启用、模型、音色和参数，仍使用原WebSocket权威配置；原有开关保留。音色可查询或填写合法ID，真实权限需合成验收。

Qwen API根据模型选择官方语音接口：Qwen-Audio使用SpeechSynthesizer并请求WAV，旧Qwen-TTS模型使用原接口；官方标准路径自动适配，自定义代理地址保持。已有明确模型/音色不自动覆盖。

豆包2.0的AI/Agent回复会自动把对应上一句用户原文写入context_texts（最多2000个Unicode字符），包含自动播报和历史手动播放；新历史保存用户消息引用，旧历史只查所属会话。没有原输入时省略，不会取最新其他轮输入。仅seed-tts-2.0且无复刻model时发送；文字阅读与系统播报不发送。情绪效果取决于模型及输入，不添加固定情绪指令。

聊天模板可继承系统AI默认或指定服务；非原生音色空值只继承同Provider业务默认，否则使用该服务默认音色。群聊使用AI默认，临时会话使用当前角色模板。旧客户端编辑其他模板字段时保留已有TTS设置。

聊天面板点击AI回复的🔊按钮时，使用该回复所属模板当前的语音服务和音色，与自动播报的选择规则一致。Agent使用所属角色，临时历史使用该历史组的角色；群聊没有明确模板或旧记录缺少来源时使用AI默认。模板已删除时也使用AI默认，不根据助手显示名猜模板。播放前更新模板，下次手动播放会读取新值；同一批分句保持一致。可只在控制端播放，也可按原选择播放到显示端；普通用户文字和自定义播报仍使用系统播报配置。

qwen-chat合成前自动去掉emoji，包含肤色、家庭组合、国旗和键帽；正文文字及标点仍朗读，聊天显示保留原文。纯emoji分句直接跳过，不请求音频，也不会产生“句子生成失败”日志。此规则同时适用于手动/自动AI/Agent和文本阅读/系统播报；无正文阅读段落跳过后继续下一句，自定义生成API返回skipped=true及audioUrl=null；其他语音服务沿用原文本规则。

语速−10至10按Provider分别配置，音量0至100全局共用。服务端原生与豆包API使用上游语速字段，国内千问网页使用原生speed字段，Qwen-Audio通过`input.rate`设置语速，Android Embedded Speech通过SSML `prosody rate`原生合成。所有WAV后处理只调整音量幅值，不重采样或变速；旧APK不支持非零原生语速时由服务端既有fallback处理。Qwen API单次最多600字符，较长回复沿用业务分句，单句超限报错。每段完整音频最多16MiB，默认总时限60秒，不保存临时音频文件。

Chat2API代理另提供POST /v1/audio/speech，沿用既有Bearer API Key鉴权；input为文本，旧模型支持qwen-chat、QUARK_VOICE、MINI_MAX，voice为音色ID，speed为0.25–4倍，volume为0–100；doubao-chat仅接受上述固定参数，账号自动选择或遵循显式映射。response_format仅wav，成功返回audio/wav二进制。

国内千问默认音色已用真实账号验证连续生成和令牌刷新后的生成；其他音色权限及设备声音需现场验收。若提示校时、令牌注册或刷新失败，检查服务器网络及Chat2API账户登录状态。其他运行实例需加载最新后端；本次Offline服务code92已发布。

当前192.168.1.39:8081主服务器已重启，ADB Offline已通过原生热更新加载code92；两端豆包真实跨批次合成通过，未改动业务启用和音色设置。


控制端右下角「音色」与显示端同名入口可快捷修改AI/Agent默认方式、音色和当前方式的独立语速；语速松手保存，原生不支持调速时隐藏。两端及本设置页以服务器回显为准，模板显式选择仍优先。详细操作见[音色快选与语速](doubao-chat-voices.md)。
