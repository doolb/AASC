# 原生 TTS 路径与 Chat2API 统一语音

## 需求与状态

用户指出系统原生启用开关多余、不支持此处音色ID，并要求 qwen-chat 直接由 Chat2API 提供。目标：原生沿用旧路径，TTS不单独管理或查询千问账号。用户回复“是”确认本轮具体方案，实现及定向验证已完成，本机服务已重启。此前已确认并实现的是TTS直接选择账号，本轮替代其职责。

## 需求评审

沿用 analyze-requirement-level enterprise。主L6，次L5/L7：原生旧路径、Chat2API统一语音、账号调度、运行版本一致性分片。证据：用户“应该是现有的路径”（L5，中2）、“系统原生不支持音色id”（L6，强3）、“qwenchat应该直接由chat2api提供”（L6，强3）、Chat2API目前只有聊天入口无speech（L6，强3）、运行实例未收到新增配置消息（L7，弱1）。置信度9/12×0.90=0.68；层级23/25、证据18/20、完备14/20、风险18/20、L4落地13/15，共86/100。补充语音契约、签名运行依赖与本机部署验证后结论通过，风险中；建议下放L4，将原生规范化、界面、Chat2API语音契约与部署验证分离。

补充项：输入输出——现有Chat2API无speech入口，需补内部音频/错误契约，避免假定已有TTS；依赖——聊天鉴权不能替代语音签名，需核验Node执行能力，避免错误承诺无需Chrome；验收——页面运行实例尚未确认，需核对URL/后端版本及实际语音，避免只改源码未作用于用户实例。前两项通过实现前契约研究补齐，第三项保留现场验收。

## 设计、实现文件与执行步骤

详见design/spec/tts-providers.md与.src/framework/tts-provider-configuration.md的最新已实现段落。

1. system：修改tts-provider-settings/policy/service、server-app与控制端设置，移除新增启用与ID/查询，忽略旧system Provider字段；保留tts.device/serverEnabled及原生音色职责。
2. qwen-chat：移除TTS账号桥接、账号字段、候选WS消息、页面查询/刷新/计时器；TTS仅调用Chat2API语音服务。
3. Chat2API：核验上游语音签名协议；新增speech服务/适配器与业务入口，装配runtime/proxy，复用账号调度、权限与脱敏；不新增HTTP配置读写接口。
4. 更新Provider/账号/实际路由/浏览器及Chat2API自测、SelfTest和文档；检查Offline状态，定向验证后提交推送。目标运行实例更新后验证版本及账号合成，不能把源码提交视为重启或发布。

## 自测、兼容性与性能

原生旧enabled=false/旧Provider音色ID不阻断或覆盖旧路径；显示端、服务端开关/回退、音量/语速、API与模板兼容。控制端无原生新增开关/ID或qwen账号查询；Chat2API调度、无账号、停用、鉴权/签名失败、超时、完整音频、脱敏及原聊天回归。保持音频16MiB、请求总超时与现有播放队列，无新增轮询。真实签名/音色/设备声音与延迟另验收；不宣称模拟通过代表真实成功。

优先package scripts，Chat2API回归用npm run check:chat2api；TTS定向无对应script时用node --test。预计2–5小时，不含上游协议变化及现场验收。

## 只读验证

系统UI无差别增加enabled，server-app的systemGenerate新增了阻断检查，故重复开关问题属实。当前原服务端支持旧voice名称/默认音色配置，原生显示端使用已加载音色；新Provider音色ID不能统一套用，不移除旧路径的音色能力。

本机8081进程自2026-10-10启动，源码2026-10-11已修改。通过wss只读控制连接，未收到ttsProviderConfig，getTtsProviderAccounts在短诊断窗口内无回复，符合旧运行进程未加载新handler；网页超时不等于Chat2API没有账号。未查看实际账号凭证、修改运行代码、重启或发布。用户URL已通过异步问题询问，后续按实际回答定位。

Chat2API qwen聊天适配器只构造Cookie和聊天请求，未包含doQwenAuth/语音签名或audio/speech；现有Chrome来自TTS网页适配器。不能把聊天请求字段直接当语音签名。

## 完成与验证记录

已完成system重复开关/音色ID/查询移除，旧Provider字段忽略且后续保存移除；保留tts.device/serverEnabled、旧调用原生音色名称和显示端失败回退。qwen-chat只转交speech参数，旧账号桥接/查询WS/账号下拉框与计时器删除。Chat2API新增speech-service、qwen-speech-adapter及HTTP业务入口，共用runtime账号/Provider/调度层，固定脱敏错误与完整WAV输出。配置、模板与SelfTest同步。截图核查发现hidden被标签display覆盖，已显式隐藏并以浏览器计算样式验证。

官方SDK使用DOM/iframe/AWSC，默认Chat2API语音仍用隔离Chrome。TTS不承担签名或Chrome安装提示；尚无纯Node替代，不将迁移描述为消除运行依赖。仅使用临时测试账号和模拟签名，未输出或直接检查真实用户凭证。

`npm run check:chat2api` 100/100通过；TTS及既有路由/模板/Agent/文本/原生/Linux运行回归，两组41/41与76/76，扣除3项重复共114项通过，无跳过。界面/原生/HTTP整理后最终定向9/9再次通过。真实Chromium360px展开原生和千问截图已查看。未运行全仓npm test，既有chat-tts-interruption旧按钮夹具问题保持记录。

```sh
npm run check:chat2api
node --test --test-concurrency=1 tests/tts-*.test.js
node --test --test-concurrency=1 tests/tts-provider-ui-browser.test.js tests/tts-provider-system-route.test.js src/apps/server/modules/tts/tts-provider-policy.test.js src/apps/server/modules/chat/pi-runtime-policy.test.js tests/group-chat-templates.test.js tests/server-tts-concurrency-integration.test.js tests/server-voice-feature-toggle.test.js tests/repair-mode-server-contract.test.js tests/text-media-tts-service.test.js tests/agent-chat-tts.test.js tests/reminder-tts-routing.test.js tests/display-voice-tts-routing.test.js tests/display-media-name-tts.test.js
node --test --test-concurrency=1 tests/tts-provider-ui-browser.test.js tests/tts-provider-integration.test.js tests/tts-provider-system-route.test.js
npm run restart:server -- https://127.0.0.1:8081
```

2026-10-11 17:17本机服务已重启，wss://127.0.0.1:8081/control收到ttsProviderConfig，确认system无enabled/defaultVoice，qwen-chat无chat2apiAccountId。旧进程与新静态页面不匹配已在本机解决；用户其他实例需核对实际版本。真实远端签名、账号音色权限、设备试听和性能仍待验收。

完成实现项从todo删除，保留账号/设备/包发布验收。design/spec/.src/usage/self-test/changelog及Chat2API模块文档已同步。servicePackage=true（原已true），minApk=true与dependenciesPackage=false保持；未构建或发布Offline包。
