# Offline豆包网页LLM与TTS真实测试

## 用户授权与范围

后续确认：用户已明确选择“同时修复Node资料采集与TTS”，授权实施所列生产文件、自测、受影响出包及真机复测。先更新spec的已确认实施段再写代码，当前进入修复阶段。

用户明确要求使用当前Offline APK已有豆包账号测试网页登录账号的LLM与TTS，随后明确“node应该可以直连，不需要网页”。允许短文字/语音请求及必要的协议诊断；文字通过Node直连，不打开官网网页。账号秘密只在APK UID内存使用，不读取无关会话，不导出Cookie/账号设备标识，不改变长期业务配置。生产修复方案已提出，尚待确认。

## Design/Spec与评审

对应chat2api-doubao-web设计/spec新增真实记录。enterprise主L6/次L5，置信度0.80，风险中；证据为用户指定当前账号、LLM/TTS两路径及捕获的正式实现结果。层级23、证据18、实施18、风险18、L4可落地14，总91/100；测试可执行，修复需确认。L4为当前APK UID读取同账号→正式适配器→短请求→只记录固定状态/协议数值→验收或定位。断点为Cookie-only文字门槛、TTS模拟状态与实际不一致；行动为核对账号初始化/绑定、补实际状态码全链路测试。

## 实际结果

min55/code87/deps10，Android Node26.4.0；启用豆包账号仅1个，保存Cookie但没有nodeProfile，主配置网页运行环境disabled。正式CoreAdapter使用显式同账号，25ms返回503/doubao_browser_disabled，未发官方推理。

按用户Node直连要求，直接调用当前code87文字适配器，不注入browserTransport、不修改生产代码或账号。一次短句请求实际由Android Node发送，448ms，官方HTTP200/text-event-stream，但SSE业务错误被分类为doubao_risk_control/403，没有有效文字。此403是业务映射，不是HTTP403。证明Node能访问接口，不能把HTTP200等同LLM成功；Cookie-only请求没有完整Node协议资料，不能据此断言Node路径不可用或缺资料就是唯一风控原因。风险响应后不自动重试、不打开官网页面。

正式SpeechService使用临时内存映射严格绑定同账号（业务Provider/配置未保存），334ms返回502/doubao_speech_upstream。额外一次短句诊断用原适配器，只监听事件名/数值码：WS open、VoiceGenie TaskStarted/status=20000000，适配器非零即错误，在StartSession前关闭，无音频。已有模拟夹具省略status字段，decoder默认0，未覆盖真实成功码。

## 受影响模块与候选修复

测试只用实际APK code87模块与私人账号库，脚本/脱敏结果在.cache，不提交凭据。候选TTS修复：src/apps/server/modules/chat2api/chat2api-doubao-speech-adapter.js及对应test/protocol-test，明确接受0/20000000、真正失败仍返回固定代码；不改声线、传输白名单、重试或账号绑定。确认后更新spec再改代码，定向测试、真实同账号生成WAV，标记/构建服务代码包。

候选LLM修复：chat2api-login-profiles.js、Android Chat2ApiAuthWebView/Chat2ApiCredentialCapture/Chat2ApiLoginActivity及服务端账号保存流程，在用户正常登录时一并采集并校验同上下文的deviceId/webId/fp/UA，保存既有credentials.nodeProfile，聊天复用已实现Node协议；旧账号缺资料明确提示补全，不用网页聊天作为解决方式，不伪造设备身份。对应测试验证账号隔离、profile脱敏、缺失字段与Node传输选择；涉及原生采集则同时标记服务代码包和min APK。方案已向用户提出，等待确认，当前生产代码未改。

## 自测、兼容、性能与风险

实施进度：新增Chat2ApiDoubaoNodeCapture纯采集/校验器，服务端profile声明要求cookie和nodeProfile，WebView只读取固定两存储键与当前UA，Activity转换嵌套对象；既有OAuth/normalizeDoubaoCredentials保存路径无需重写，新增正式保存/脱敏测试。旧账号非兼容模式返回422/doubao_node_profile_required。TTS接受20000000；真实Android进一步定位到Worker裸ESM import不能读取独立依赖目录，新增tts-opus-decode-worker.js绝对入口导入修复及分目录RED/GREEN真实WASM测试。

自测：Chat2API254/254、音频34/34、Android271项零失败/1既有跳过，新采集6项全过。Android当前账号短句使用修改后适配器/Worker临时内存加载已完整生成WAV163652bytes/48000Hz/1704.25ms/非静音，无播放；尚待新包正式SpeechService复验。servicePackage/minApk均true，依赖集合不变；计划code88/min56保留deps10和现有数据种子。当前账号的合法Node设备资料仍需正常登录取得，不把虚构资料用于真实验收。

以20000000贯穿TaskStarted/SessionStarted/句子/TTSEnded，保留0兼容和401/403/429/未知错误、取消/超时/迟到帧；Android/WASM完整Ogg转WAV、非静音/时长与单声道验证。当前TTS仅测到TaskStarted，不称为合成成功或登录完整验收；LLM直连发到上游但遭业务风控，不称为文字成功。短句/限时，无错误自动重试、不改变账号池、不静默回退系统原生。

修复估计2–4小时与服务发布/真机复验另计；真实上游风控或过期凭据需用户登录，不能伪造初始化身份。测试定位已完成，用户已确认同时实施Node资料采集及TTS，进度/实测结果后续追加。
