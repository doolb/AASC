# 语音服务与音色

控制端「声纹」页面展开「语音服务与音色」，分别选择AI/Agent回复、文本阅读、报时与系统播报的服务，然后「保存语音配置」并等待服务器确认。其他控制端同步权威值，重连后重新获取。

Qwen API与豆包API的Key保存在服务器用户配置文件中：普通运行为`~/.config/aasc-user/userconfig.json`，当前开发机为`/home/as/.config/aasc-user/userconfig.json`；release模式为运行项目目录下的`release/userconfig/userconfig.json`。字段分别是`tts.providers["qwen-api"].credential`与`tts.providers["doubao-api"].credential`。保存在JSON文件内，不保存在控制端浏览器或主`config.json`；页面只收到是否已配置的状态。

系统原生沿用现有TTS生成设备、服务器开关和原生音色配置，此面板只提供语速、音量，不增加启用开关或音色ID。业务或模板选中系统原生时隐藏音色ID输入；旧Provider级开关和音色ID不会阻断或覆盖原有路径。

国内千问网页仅用于AI/Agent回复，由Chat2API提供语音合成。先在Chat2API账户管理中添加或登录国内千问（qwen）账号，并启用对应账号及Provider；在语音面板启用国内千问、设置模型/默认音色并保存。TTS不再查询或选择账号，Chat2API按已保存的调度策略自动使用可用国内账号，更新登录后下次合成读取最新值。国际qwen-ai不适用于该语音协议。未提供可用账号、登录失效或上游失败会明确报错，不切换到系统原生。

豆包普通文字doubaochat已于2026-10-13用正式Node适配器真实验证流式/非流式OK；同账号nodeProfile初始化后不依赖Chrome或页面签名，详情见[纯Node普通LLM](chat2api-doubao-node.md)。这不代表网页朗读链路完成真实验收。

`doubao-chat`已接入 `/v1/audio/speech` 和AI/Agent语音设置，名称“豆包网页朗读（实验）”，默认关闭，真实运行未重新验收。先在现有Chat2API模型映射中为doubao-chat指定preferredProviderId=doubaochat及preferredAccountId，所选账号和Provider须启用且可用；严格绑定，不自动换号。业务面板无Cookie/账号输入。固定音色zh_female_wenroutaozi_uranus_bigtts、speech speed=1/volume=100，业务语速0；input最多1000个UTF-16字符且UTF-8≤4000字节，只接受wav。Frontier收集完整Ogg、校验并解码为单声道PCM WAV，缓存及下载仍为.wav/audio/wav；错误不重试、不切换其它来源。公开协议已核对，本地模拟及WASM样本通过；新真实聊天/合成需独立明确授权，Android Node/WASM、音色听感与设备播放尚未验收。文字网页fetch已实现为默认关闭的实验功能，真实运行未验收。

网页模型默认选择QUARK_VOICE，MINI_MAX需另有匹配的可用音色；目前预置的已验证音色是zh_female_quarkF531S0_ptts，完整国内音色目录尚未取得。qwen3-tts-flash应配置在Qwen API中并使用百炼API Key，不能保存为国内千问网页模型。历史错误模型读取时恢复QUARK_VOICE并保留其他参数，下一次合法保存会写回；服务端拒绝新提交的错误模型并保留原配置。

Android账户管理“打开外部网页”会向现有允许的www/chat2/chat2-api.qianwen.com三个HTTPS来源恢复登录Cookie。新版APK的恢复提示会显示当前网页来源，便于核对跳转；提示不包含网址路径或查询参数。原生来源提示需更新APK，网页或服务代码热更新无法替换原生窗口。

旧qwen-chat手动凭证及chat2apiAccountId不再使用，下次保存时移除，不会自动导入账户管理。账号凭证只由Chat2API管理。内部语音服务不要求代理HTTP任务持续运行；自定义rootDir独立库不会自动扫描。国内千问语音已由Chat2API直接调用接口生成，无需安装Chrome，也不查询浏览器账号。

Qwen API默认qwen-audio-3.1-tts-flash与乔小娇qiaoxiaojiao_v3.1，填写百炼API Key，豆包API填写API Key及匹配音色的资源ID；qwen-chat、qwen-api、doubao-api默认开启，明确保存过的开关值继续保留；仍需配置各自账号或API凭证。音色目录可查询或手工填写有效ID，查询失败保留当前值。凭证留空保留已保存值，勾选「清除已保存凭证」才删除；保存后清空输入框，页面仅显示是否配置。业务选择存主配置，服务参数及API凭证存用户配置，模板仅存provider/voice。

Qwen API根据模型选择官方语音接口：Qwen-Audio使用SpeechSynthesizer并请求WAV，旧Qwen-TTS模型使用原接口；官方标准路径自动适配，自定义代理地址保持。已有明确模型/音色不自动覆盖。

豆包2.0的AI/Agent回复会自动把对应上一句用户原文写入context_texts（最多2000个Unicode字符），包含自动播报和历史手动播放；新历史保存用户消息引用，旧历史只查所属会话。没有原输入时省略，不会取最新其他轮输入。仅seed-tts-2.0且无复刻model时发送；文字阅读与系统播报不发送。情绪效果取决于模型及输入，不添加固定情绪指令。

聊天模板可继承系统AI默认或指定服务；非原生音色空值只继承同Provider业务默认，否则使用该服务默认音色。群聊使用AI默认，临时会话使用当前角色模板。旧客户端编辑其他模板字段时保留已有TTS设置。

聊天面板点击AI回复的🔊按钮时，使用该回复所属模板当前的语音服务和音色，与自动播报的选择规则一致。Agent使用所属角色，临时历史使用该历史组的角色；群聊没有明确模板或旧记录缺少来源时使用AI默认。模板已删除时也使用AI默认，不根据助手显示名猜模板。播放前更新模板，下次手动播放会读取新值；同一批分句保持一致。可只在控制端播放，也可按原选择播放到显示端；普通用户文字和自定义播报仍使用系统播报配置。

qwen-chat合成前自动去掉emoji，包含肤色、家庭组合、国旗和键帽；正文文字及标点仍朗读，聊天显示保留原文。纯emoji分句直接跳过，不请求音频，也不会产生“句子生成失败”日志。此规则同时适用于手动播放和自动AI/Agent播报；其他语音服务沿用原文本规则。

语速−10至10，音量0至100。原生显示端与Qwen API使用PCM重采样，可能改变音高；服务端原生与豆包/国内千问使用生成参数。Qwen API单次最多600字符，较长回复沿用业务分句，单句超限报错。每段完整音频最多16MiB，默认总时限60秒，不保存临时音频文件。

Chat2API代理另提供POST /v1/audio/speech，沿用既有Bearer API Key鉴权；input为文本，旧模型支持qwen-chat、QUARK_VOICE、MINI_MAX，voice为音色ID，speed为0.25–4倍，volume为0–100；新增实验性doubao-chat仅接受上述固定参数与显式账号映射。response_format仅wav，成功返回audio/wav二进制。

国内千问默认音色已用真实账号验证连续生成和令牌刷新后的生成；其他音色权限及设备声音需现场验收。若提示校时、令牌注册或刷新失败，检查服务器网络及Chat2API账户登录状态。其他运行实例需加载最新后端；Offline服务代码包尚未构建发布。

先前千问纯Node版本曾通过本机8081手动播放及音频HTTP200验证；该历史记录不代表本次豆包实验选项已加载或验收。本次未重启主服务器，运行实例需在用户自行安排加载后使用最新代码。
