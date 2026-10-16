# Offline 首装、热更、模型与启动器迁入 JS

## 任务与授权

用户提出从 APK 层拆分热更到 JS，参照 server boot；明确首装和模型下载一起迁移，并追加启动器自身也热更。具体文件/边界已告知，用户回复“是”确认实施。默认 master，保留现有用户改动；先按spec落实内置无依赖启动器与协议，再迁移各业务和验证，不因本次确认清空手机或自行发布。

## 需求分析与能力下放

采用 analyze-requirement-level 默认 enterprise。主L7（APK/Node宿主与更新器架构分工）、次L6（首装/模型/自更新接口），必须下放到L4实施。证据：“从apk层拆分到js”强3、“启动器也可以热更js”强3，均指向架构；“首装、模型下载也一起拆”中2限定模块范围。主权重6/总8×相邻一致0.90，置信度0.675。评分清晰度24/25、证据18/20、完备度16/20、风险18/20、L4落地14/15，共90/100；设计可进入实施确认，直接大改风险高。

关键断点为JS启动器自己失败时谁恢复、空环境没有依赖如何执行、原生与JS写入权以及模型加载路径契约。拆解动作为builtin-only内置基线与固定宿主恢复入口、签名code ZIP内的自更新候选、新进程握手/健康/回退、模型下载与原生加载解耦。未额外调用翻译或伪代码同步技能。

## design 需求与 spec

见 `docs/design/android-offline-js-launcher.md` 与 `docs/spec/android-offline-js-launcher.md`，已按真实源码更新。APK固定Node/原生能力和最小可信宿主；可热更JS负责首装、服务/依赖/任务/数据修复、模型准备及自身升级。首期复用签名code ZIP发布启动器，不新增独立发布组件。内置启动器基线不被JS覆写，缓存活动版本与上一健康版本可回退。

## 受影响模块与执行步骤

1. 新增 `src/apps/server/boot/offline-launcher/`：entry/controller/protocol、首装安装、服务组合更新、模型存储和启动器切换模块，分别控制在项目文件行数约束内，仅依赖Node builtin。
2. 修改 `NodeRuntimeInstaller.kt`、`NodeServerService.kt`、`scripts/ops/prepare-android-node-runtime.js`：无服务代码也能启动JS；宿主通道、固定入口校验、自更新重启、看门狗与内置回退。
3. 适配 `server-launcher.js` 和共享签名/分组/任务/数据修复工具；收缩 `OfflineUpdateManager.kt`、`OfflineBootstrapManager.kt`、`OfflineReleaseState.kt` 等原生业务流程，保留原生APK安装。过渡期确保单写者。
4. 迁移 `OfflineModelStore.kt` 下载/可信定义/缓存/取消，调整 `MainActivity.kt`、`NativeBridge.kt`、模型准备Dialog与ASR/TTS/声纹/MNN管理器接口，保留原生推理与原路径缓存。
5. 迁移旧min/full数据状态；验证后首次发布过渡min与配套code，随后JS启动器迭代通过签名代码包交付。原生协议/Node/引擎变化仍需要APK。

## 自测、兼容与性能

空应用无服务代码/无node_modules的首装、确认与拒绝、后台完成后的提示恢复；模型默认组、缓存/坏缓存、稍后不下载、取消/重试/迟到回调；普通APK隔离、min59/旧full活动指针和既有数据保留。服务/依赖/task-only/数据修复/full首次激活均按原契约验收。

自更新验证下载损坏/签名错误/路径链接/宿主协议不兼容、候选JS语法错误与握手超时、断电中断、旧服务启动失败、上一健康JS与APK基线回退；确认没有双更新器写同一目录。比较启动时间、下载流式内存、目录扫描、取消响应和恢复等待，记录设备实测后再定预算，不凭空声明更快。

优先npm已有定向脚本；原生无相应npm入口时使用Gradle；新增自测代码与spec同步。源码与定向测试已完成，结果见下方执行记录；未构建或发布 APK/ZIP。

## 风险、待确认与工时

风险高：最小宿主不可移除，否则启动器失败没有独立恢复者；Android原生引擎和系统APK安装不能变成纯JS；元数据热更不等于任意新增模型架构。拟采用“固定最小APK宿主＋内置基线＋可热更JS启动器”及签名code ZIP自更新，已按用户确认边界实施。协议字段、状态迁移和回退顺序需在实施前补成逐模块L4，不覆盖既有数据。

预计3–5工作日（首装/组合更新、模型迁移、自更新、兼容真机分段实施），出包和多设备验收另计。当前源码已完成，待签名机出包及设备验收；minApk/servicePackage=true，未标为已出包。

## 用户追加确认：启动器网页UI

2026-10-16 用户选择“一起改为网页UI”。新增HTML页面、OfflineLauncherActivity、manifest注册及MainActivity入口转接；验证页面RPC白名单、本地资源与导航约束、进度/取消/恢复及首装展示确认。


## 执行记录与剩余验收

- 完成builtin JS闭包、固定supervisor重新验签/字节比对/候选握手/原请求重放/回退；NodeService只在新资产存在时启用，旧profile保留兼容路径。
- 完成首装种子/journal/latest、服务/分组依赖/生产锁/taskCode/数据修复门槛/真实HTTP组合健康、pending回滚和精确目录清理；不覆盖配置与任务结果。
- 完成模型定义/状态/目录/下载/取消与分组进度、原生门面及首装令牌；新增本地HTML启动页和白名单WebView桥，首装、更新、模型与恢复入口接入。
- 新增tests/offline-js-launcher*.test.js、OfflineLauncherProtocolTest.kt和npm脚本。JS/Chromium26/26、原首装打包63/63、数据修复72/72、Android Offline/Node147项通过；未跑全仓测试。定向日志与截图保存在/tmp，不提交构建产物。
- 本轮不修改独立Node入口release/allserver-min.js，不产生node-min上传需求；普通server-launcher仍走既有逻辑，新Offline ServiceProcess直接托管server-app。
- 待过渡min与签名code出包、LAN/WAN发布和真实设备升级/首装/后台/模型加载推理/性能验收；手机数据与先前备份未改动。该剩余项保留todo，源码完成记录移入changelog。
