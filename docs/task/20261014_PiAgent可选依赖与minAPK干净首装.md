# PiAgent 可选依赖与 min APK 干净首装

## 任务描述与授权

用户要求 PiAgent 改可选，仅 LLM 选择 PiAgent 后下载；在 ADB 卸载 Offline 后单独安装 min APK。卸载安装已明确授权；新 Pi 代码方案通过异步问题等待确认，尚未修改 Pi 代码。

## Design 需求与 Spec 设计

Pi 见 design/spec/llm-agent-mode.md：两个根包和完整闭包按三平台独立签名，普通 LLM/Codex 不下载，缓存不改变基础指纹；建议首次实际 agent/pi 聊天准备，切换时即准备为待确认选项。

min 复用 design/spec/android-display-offline-apk.md：空应用目录仅装 update-only min，经原生确认下载服务/基础组/种子，验证本机 API、版本路径、页面、WebSocket、健康提交与重启复用。

## 受影响模块与代码

Pi 待确认：package.json/lock、dependency-groups/shared-update-manifest、Offline 构建/发布/sync、task-dependency-manager、pi-runtime-manager/module-paths/readonly-tools、server-app 与测试。伪代码先行，不修改 Android 原生逻辑或 Node-min 独立启动器。

## 自测与兼容性

Pi 待执行：普通模式不准备、Pi 首次/并发/失败重试/离线缓存、真实 ESM 闭包导入、平台/锁版本拒绝错配、现成本机 SDK 兼容；保留 ORT 与四组签名测试。

ADB SM-N9500/192.168.1.6:5555 原 full50。配置、账号、任务/results、模型、WebView 备份 `.cache/adb-offline-min-20261014/user-data-backup.tar`：381976576 bytes/301 entries/SHA256 `6f68ac78868f86210b66d234a8c295f6a1c008dfb387851da544ba4b2baf2562`，权限0600，不提交 Git。卸载成功后 pm path 无结果；单装 min51 成功，首次安装时间2026-10-14 19:55:37，启动前 files 不存在。APK 89412146 bytes/SHA256 `5099960c5da396f38df2b8861aacf32c8d6efa3d2f42d7787fdfbeb3578310a1`，CRC通过，allserver-min/updateOnly=true。

原生确认 LAN 来源约130MiB，发布组合 code85/dependencies9/seeds85。不恢复备份、不装 full、不借旧服务目录。新 ORT/Pi 制品未发布，此测试不代表新版依赖减重验收。

20:03:53首装失败：OfflineBootstrapManager.restoreSeeds报“任务 latest 指向无效实例”。代码/依赖下载和锁校验已结束，common/android已保存校验缓存；种子部分恢复，active-release与code/dependencies未安装，HTTPS API未就绪。APK安装成功，环境独立首装未通过；重启/模型推理未验收。

真实seeds85只读检查：llm-server/latest=40f3b6b1、time.announce/latest=728486a7，目标均有显式目录项、0文件。恢复器过滤isFile，漏建合法空目录；设备results只有index/latest，缺目标目录，与堆栈和界面一致。证据保留.cache内的UI XML、错误截图、bootstrap-state/备份摘要，不提交私有数据。

修复方案另行待确认：Android design/spec先行，restoreSeeds恢复空目录并保留路径/链接/已有数据防护；补OfflineBootstrapTest空实例/重试/链接用例，构建发布新版min后重测。未人工伪造实例文件或绕过校验，未改线上种子/清单；本轮ADB18081转发及临时sdcard XML已精确移除，既有19222映射保留。

## 性能、风险与预计工时

Pi coding-agent 在 common v9 展开约90MiB，供应商 SDK 另占空间，最终节省以新归档测量。原生平台资源须分别筛选，独立缓存需完整闭包保证 ESM 解析。下载失败反馈，不回退绕过选择的模式。源码与定向验证预计4–6小时，签名发布/真机验收另计。

## 未明确事项与进度

Pi触发与实施待确认。ADB单装测试完成并定位首装故障，原生修复/新版min重测待确认。已同步design/spec/self-test/changelog/todo，保留Pi待实施和min故障待修复；备份保留，设备现为min51首装失败状态。
