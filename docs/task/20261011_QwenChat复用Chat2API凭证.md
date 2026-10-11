# QwenChat 复用 Chat2API 凭证

## 任务与状态

用户最初要求可以选择使用 Chat2API 凭证，随后明确：“qwenchat只使用chat2api的帐号”，本轮回复“是”确认实施。方案收敛为只选账号、不保留手动来源；实现与定向自测已完成，真实账号/设备验收待处理。design/spec 分别见 `../design/tts-providers.md` 与 `../spec/tts-providers.md`，.src 映射见 `.src/framework/tts-provider-configuration.md`。

## 需求分析

按 analyze-requirement-level enterprise 模式评审。目标明确：qwen-chat 只使用 Chat2API 国内千问账号。主等级 L6，次等级 L5；证据为“qwenchat只使用chat2api的帐号”（模块桥接，强3）、现有账号存储具有脱敏 listAccounts 与私有 getAccount 两种契约（强3）、现有 TTS settings/生成器需要共同支持账号引用（强3）、账号变化及错误不能触发隐式切换（规则，中2）。邻层一致性0.90，置信度9/11×0.90=0.74，结论可开发，已获得方案确认。

评分：层级清晰度23/25、证据充分度18/20、实现完备度18/20、风险暴露度18/20、L4可落地性14/15，共91/100。直接开发风险中。建议下放至 L4：将来源规范化、账号候选查询、每次生成凭证解析与控制端交互分别落实到 spec 的已有声明/新增定义/操作流程，不堆叠 if-else。

## 设计与边界

- qwen-chat 明确选择 Chat2API 国内 qwen 账号，仅保存引用；无手动凭证输入和来源开关。
- 旧 qwen-chat 手动字段忽略且下次保存移除；不自动导入账号，其他 Provider 保持原规则。
- 使用内置共享账号库和已有 Provider 注册表，无需运行代理；自定义 rootDir 不自动扫描。
- 服务端每次生成读取最新账号 Cookie/ticket；不从前端导出凭证，不复制配置，不修改原账号。
- 账号或 Provider 停用/删除、缺凭证、鉴权失败明确报错，不自动更换账号；Chrome 签名依赖仍存在。
- AASC WebSocket 提供脱敏候选查询，保存复用原权威配置流程，不增设 HTTP 配置接口。

## 受影响文件与执行步骤

1. 先完善 docs/spec/tts-providers.md 和 .src/framework/tts-provider-configuration.md 的伪代码。
2. 修改 tts-provider-settings.js，仅增加账号ID规范化、忽略旧手动凭证、其他 Provider 兼容及脱敏。
3. 新增 TTS/Chat2API 凭证桥接模块，注入 qwen-chat-tts.js 与 Provider/server-app 装配。
4. 修改 tts-provider-ws.js、控制端 tts-provider-settings.js/websocket.js，移除 qwen-chat 凭证输入，只增加账号选择、失败及重连处理。
5. 更新 self-test.js、对应测试、usage/design/spec/task/todo/changelog，按影响设置 servicePackage，定向验证后提交上传。

## 自测、兼容性与性能

覆盖 qwen-chat 旧手动值不再用于生成/回包、其他 Provider 凭证规则兼容、账号列表脱敏、国际账号排除、停用/删除/缺凭证、凭证更新、完整Cookie/ticket、未选账号、账号选择与失败/重连恢复，以及实际生成注入点。使用临时测试账号数据与假签名器，不输出真实用户凭证。先检查 npm scripts，Chat2API 回归用 npm run check:chat2api；缺少定向 script 的 TTS 检查用 node --test。

每次合成仅增加账号/Provider 文件读取，不增加代理实例、后台轮询或生产依赖；维持原总超时和签名并发限制。真实账号合成时延及设备声音保留现场验收。

## 风险、预计工时与未明确项

风险：网页登录过期、前端签名变化、账号在选择后被删除、Cookie 与 ticket 不一致。凭证解析需采用明确优先级并以 Chat2API 当前 ticket 覆盖同名 Cookie；错误须脱敏。预计1–3小时，不含账号与设备现场验收。自定义 rootDir/多独立库不在本次默认范围，如后续需要需明确库选择契约。

## 验证记录

已完成桥接模块、settings/registry/qwen-chat-tts/ws/server-app接线及控制端设置/websocket/self-test。只使用临时测试账号数据，未读取真实用户账号凭证。旧手动凭证不参与配置回包或生成，下次配置保存时移除；不启动第二个代理或新增生产依赖。

20个TTS定向文件104/104与 `npm run check:chat2api` 的94/94通过，无跳过，按三组分别执行并扣除重复的qwen-chat用例统计。真实配置写盘、临时Chat2API账号库、本地HTTP/WebSocket及Chromium验证均通过；浏览器重新查看展开国内千问设置的360px截图，只有账号选择且失效值保留。签名器仍模拟，不能视为真实远端鉴权/声音成功。

定向命令：

```sh
node --test --test-concurrency=1 tests/tts-chat2api-accounts.test.js tests/tts-provider-settings.test.js tests/tts-provider-qwen-chat.test.js tests/tts-provider-ws.test.js
node --test --test-concurrency=1 tests/tts-provider-ui-browser.test.js tests/tts-provider-integration.test.js tests/tts-provider-system-route.test.js src/apps/server/modules/tts/tts-provider-policy.test.js
node --test --test-concurrency=1 tests/tts-provider-qwen-chat.test.js src/apps/server/modules/chat/pi-runtime-policy.test.js tests/group-chat-templates.test.js tests/tts-display-routing.test.js tests/server-tts-concurrency-integration.test.js tests/server-voice-feature-toggle.test.js tests/repair-mode-server-contract.test.js tests/text-media-tts-service.test.js tests/agent-chat-tts.test.js tests/reminder-tts-routing.test.js tests/tts-text-normalizer.test.js tests/display-voice-tts-routing.test.js tests/display-media-name-tts.test.js
npm run check:chat2api
```

界面截图调整后单独重跑浏览器1/1通过；配置校验整理后重跑settings/桥接7/7通过。所有本轮JS语法与diff检查通过。未运行全仓npm test，不宣称全仓通过。实际账号合成、签名成功、设备声效与延迟仍待验收，完成实现项移出todo，保留原账号/设备验收项。

Offline仅影响servicePackage（原已true），保持minApk=true、dependenciesPackage=false；未重启、构建或发布运行服务。
