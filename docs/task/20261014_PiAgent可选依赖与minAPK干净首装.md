# PiAgent 可选依赖与 min APK 干净首装

## 任务描述与授权

用户要求PiAgent可选，仅LLM选择PiAgent才下载；明确下载规则为保存配置时提示，取消恢复原配置，启动检查配置下载。用户授权ADB卸载Offline并单独安装min，追加报告“任务last指向无效实例”后按已告知修复方案实施。默认master工作区，保留其他任务改动，不构建完整APK。

## Design需求与Spec设计

设计见`docs/design/llm-agent-mode.md`、`docs/design/aasc.md`与`docs/design/android-display-offline-apk.md`；伪代码先更新对应spec再改代码。两个Pi根SDK及完整闭包按Android/Linux64/Win64独立签名，基础组只移走独占包。保存/切换候选通过现有AASC/WebSocket预检，缺包返回下载确认；确认后准备，核对配置指纹，持久化并广播权威配置。取消或失败不写候选，恢复原表单；启动仅检查当前选中的Pi配置，普通LLM/Codex和未使用Pi不下载。

SDK与只读工具共享独立模块根，不修改全局NODE_PATH，不在Android运行npm。min恢复种子目录与文件，在目录就绪后恢复latest，保留已有文件及链接防护。Node配套C++库加入必需资源，NodeRuntimeManifest和Installer共用精确白名单。

enterprise主L6/次L7，置信度0.80，风险中，建议下放L4：候选→预检/确认→准备→指纹校验→持久化/广播。

## 影响模块与代码

package.json/lock；dependency-closure/dependency-groups/shared-update-manifest；task-dependency-manager；PiProfileConfig/pi-runtime-manager/pi-readonly-tools；llm-service/server-app；网页chat/websocket；prepare-android-node-runtime；Android OfflineBootstrapManager/NodeRuntimeManifest/NodeRuntimeInstaller；对应Node/Android测试。复用既有动态注册的构建/发布/sync，不新增配置HTTP接口，不修改Node-min独立启动器。

## 自测、兼容与性能

`npm run test:pi-optional`30/30：保存确认/取消恢复/失败不写/并发配置冲突、仅选中Pi启动、三平台签名闭包/真实ESM、版本与平台拒绝、现成本机SDK。`test:task-dependencies`106/106、`test:offline-bootstrap`63/63；Android254项0失败/1既有环境跳过，包含空实例重试、链接父目录拒绝和C++解析/安装一致性。主机/var/tmp隔离完整SDK闭包实际导入createAgentSession、ModelRuntime、readonly-tools与provider资源成功，无父目录模块兜底。真实ORT脚本Chromium1项已通过；未进行真实LLM/MNN/LFM-VL模型推理。

common v10 ZIP45722279bytes（43.6MiB），展开136437556bytes（130.1MiB）；原v9 ZIP119296700bytes（113.7MiB）、展开421633741bytes（402.1MiB）。Android基础组内容未变复用v9。ORT10独立ZIP30835681bytes；PiAndroid10 ZIP44299304bytes，Linux10 ZIP44915259bytes，Windows10 ZIP44860368bytes。首装原生显示由约130MiB降至60MiB；Pi首次选择额外下载约42.2MiB，缓存供后续复用。

## ADB备份与历史故障

设备SM-N9500/API28，ADB192.168.1.6:5555，包com.aasc.display.offline。原full50的配置/账号/任务/results/模型/WebView备份`.cache/adb-offline-min-20261014/user-data-backup.tar`，381976576bytes/301entries/SHA256 `6f68ac78868f86210b66d234a8c295f6a1c008dfb387851da544ba4b2baf2562`，权限0600，保留不入Git。测试不恢复旧备份、不借完整包或旧服务目录，普通APK保持。

min51首次安装成功但首装失败：seeds85的llm-server/40f3b6b1和time.announce/728486a7是合法空目录，restoreSeeds仅复制文件遗漏目录，latest目标不存在。min52补目录后，Node因缺配套libc++_shared.so退出；APK的NDK库仍缺Node符号，诊断复制Node配套库后--version=v26.4.0/退出0。min53打入库但Installer旧白名单拒绝，未通过首装。诊断文件已移除，最终重新卸载安装，不能将上述中间版本计为成功。

## 正式制品与最终首装

code86为早期构建快照未发布；修正“仅当前选中Pi启动准备”后重打code87，复用deps10/ORT10/Pi三平台10/seeds86。发布先保留当时已发布min元数据再重新签名，避免降级清单。LAN/WAN服务87/依赖10上线，完整full50保持。

min54：89914041bytes，SHA256 `ed8075e671415711da0ad11c103eafa7b6f595c27c1c2b97f030b61a7e19cc14`，签名指纹 `a57fd4c34c0c769246239a7d8c606b5edb62c215ecf9659448ea178eda3fb7df`，profile/updateOnly/CRC及Node C++真实字节校验通过。再次卸载Offline、空files独立安装54并确认LAN约60MiB，实际HTTPS status=ok、APK54/code87/deps10，活动路径为updates版本目录，pendingHealth=false、previous=null。两个原空实例目录和latest相对链接均正确，首装前未准备ORT/Pi。

Node在独立子进程使用runtime/arm64-v8a/lib/libc++_shared.so，MNN在Android主进程使用APK NDK库，地址空间和搜索路径分离；不把Node库替换进APK JNI目录，未验收同时MNN真实推理。

发布快照之后其他TTS会话继续修改服务/原生源码，minApk/servicePackage保留true，dependenciesPackage=false。本次产物覆盖本任务；不能声称覆盖其他最新改动。APK/ZIP/模型/cache/私人配置和结果不提交Git。

## 风险与工时

下载不可达/签名或锁版本不符返回明确错误，不静默切换模式；下载中并发修改拒绝旧草稿。原生/Node C++ ABI不同，不得互相替代。预计源码与定向验证4–6小时，签名制品及设备验收另计。真实模型/GPU验收另保留todo，本任务已实现并完成干净min启动验证。

## 最终发布与Pi真机验收补充

min54发布器完成LAN/WAN全部组件HTTP大小/SHA验证与精确清理，无清理错误。两端签名清单一致指向code87/deps10/min54。实际控制WebSocket预检返回downloadRequired，取消不提交、权威revision保持；确认后PiAndroid10下载/校验并提交qwen3.5，状态ready，随后恢复default。独立缓存为updates/task-dependencies/pi-agent-android/dependencies-v10-1ac555893546，真实Android Node v26.4.0直接从该模块根成功导入Pi两SDK及只读工具。默认LLM冷启动复用code87/deps10和已有缓存，status=ok、pendingHealth=false。精确移除本轮18081转发及min52/53/54测试XML，保留原19222映射与私人备份。
