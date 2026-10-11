# TTS 多 Provider 配置与生成接入

## 任务与确认

用户在 2026-10-11 对前轮具体方案回复“是”，授权继续实现。目标与契约见 `../design/tts-providers.md`，L4 数据流见 `../spec/tts-providers.md` 及 `.src/framework/tts-provider-configuration.md`。使用当前 Node.js/CommonJS 目录，不创建平台镜像。

## 需求等级分析

默认 enterprise。主等级 L6（四个 Provider、统一音频契约）；次等级 L5（业务选择/继承/失败规则）、L7（WebSocket 权威配置）。证据：模板覆盖 AI 默认，文本媒体与系统播报分离，配置持久化/广播/重连补发。建议下放到 L4：拆分选择策略、配置存储、Provider 注册、生成服务和入口装配。层级清晰度23/25、证据充分度18/20、实现完备度17/20、风险暴露度18/20、L4可落地性14/15，总分90/100；权重L6=9、L5=3、L7=2，一致性0.90，主等级置信度0.58，结论需补充外部契约和验收证据。

补充项：输入输出契约——原草稿缺少外部请求字段，按官方文档/网页公开源码核实，避免错误请求；依赖与约束——真实账号和音色权限未知，通过用户配置显式启用，避免假定已有凭证；验收与观测——缺少云端现场声音证据，先模拟接口与回归，再保留现场验收项。可独立实施已确认的配置与业务流程；不把模拟通过视为真实账号验收完成。

## 受影响模块

- Provider policy/settings/registry/service/HTTP 音频工具与测试。
- config-app-service、pi-runtime-policy、llm-service 模板规范化/保存。
- server-app AI/Agent/文本媒体/系统入口与 WebSocket；Agent 与文本媒体使用注入的统一生成回调。
- 控制端 tts.js、chat.js、websocket.js、upload.html 与 Provider 设置模块。
- design/spec/task/todo/changelog、使用说明、Offline 状态。

## 执行步骤

1. 先完善上述 spec 与 .src 伪代码及自测映射。
2. 修正模板继承与 Provider 音色规则，补齐用户配置和脱敏。
3. 实现适配器与统一内存音频生成，接入各业务入口。
4. 接入控制端配置、音色查询和权威回包流程。
5. 定向自测/回归及语法检查，同步文档，提交上传代码与状态。

## 自测、兼容性与性能

用例按 spec 的自测流程；通过 npm scripts 或不存在对应 script 时的 node --test 执行。旧模板、原生成设备、关闭服务器TTS、音频缓存满、断线重连、长句和迟到结果均覆盖。只处理完整音频且上限16MiB，无常驻后台定时器或新增生产依赖；每次网络请求/保存等待有可清理超时计时器。模拟超时与上限检查，真实延迟/手机性能另行现场测量。

## 风险、歧义与工时

网页接口可能变化、账号过期、音色权限变化，返回明确错误且不自动回退。群聊无唯一模板时使用系统 AI 默认，Agent来源无模板时同样继承。未确认账号不从其他模块提取凭证；通过配置界面提供。预计 4–8 小时，实际状态记录在下方。

## 状态

- 已完成配置、Provider适配器、业务装配、模板/UI、自测与文档；账号/设备声音和发布验收仍待补充。
- 国内千问按用户指定的 www.qianwen.com 页面核对公开前端 4.9.6；复用官方 doQwenAuth SDK 与 WebSocket 文本/结束包，凭证由用户显式配置，未读取私有会话或其他模块账户。
- 19个定向文件97/97通过，无跳过：其中真实控制页覆盖保存等待/成功/失败、发送异常/超时/等待时断线/重连、目录失败/自定义ID保留、凭证清空、模板继承和控制端自测；HTTP/WebSocket模拟覆盖请求契约、PCM/WAV、鉴权、截断与超时；实际system入口执行覆盖旧回退/开关、缓存满、参数与内存引用。其余回归覆盖群聊、Agent/文本句序、取消/迟到结果及语音目标。
- 初轮扩大检查包含 chat-tts-interruption.test.js，55/56通过；唯一失败查找已移除的 displayChatTtsStop 按钮。只读确认HEAD正式display.html同样缺该ID，保持原文件与测试，不宣称全仓通过。本轮音量/业务参数引起的两处源断言已同步。
- 通配符组合命令进入沙箱时HTTP监听/Chromium不可用；按环境审批在沙箱外用显式文件名重跑，上述97项全部通过。真实云端账号合成、国内网页签名成功、音色权限、设备声效/手机性能未做现场验证。
- 测试命令：`node --test --test-concurrency=1 tests/tts-provider-settings.test.js tests/tts-provider-integration.test.js tests/tts-provider-qwen-chat.test.js tests/tts-provider-ws.test.js tests/tts-provider-ui-browser.test.js tests/tts-provider-system-route.test.js src/apps/server/modules/tts/tts-provider-policy.test.js src/apps/server/modules/chat/pi-runtime-policy.test.js tests/group-chat-templates.test.js tests/tts-display-routing.test.js tests/server-tts-concurrency-integration.test.js tests/server-voice-feature-toggle.test.js tests/repair-mode-server-contract.test.js tests/text-media-tts-service.test.js tests/agent-chat-tts.test.js tests/reminder-tts-routing.test.js tests/tts-text-normalizer.test.js tests/display-voice-tts-routing.test.js tests/display-media-name-tts.test.js`。暂无对应定向 npm script，未运行完整 npm test 或 live stress:tts。
- Offline只涉及服务代码包，servicePackage已为true；保留minApk=true、dependenciesPackage=false。未构建、重启或发布运行服务。
- 27个本轮JavaScript文件语法检查和任务文件git diff --check通过；仅提交本轮TTS路径及共享文档中的TTS段落，保留工作区其他改动。
