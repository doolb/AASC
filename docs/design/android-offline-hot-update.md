# Android Offline APK 热更新与原生增量 APK

## 状态

2026-09-18 当前 full Offline APK 已发布 v13：`allserver` 使用
`versionCode=13`、`versionName=0.2.11-offline`，发布文件为
`apk/aasc-display-offline-v13.apk`。APK 大小 `957338670` bytes，SHA-256 为
`326d30feada394860925d2f11320bd4fb60b84cae1a710135303b89be203429c`；已发布到 LAN/WAN，
两端文件 hash 和 HTTP Content-Length 均一致，服务 `manifest.json` 未被替换。

本次 v13 发布包含 Chat2API 账号凭证导入导出、按账号 ID 合并、一次性 Android 外部网页会话
以及 Cookie/LocalStorage 白名单恢复实现。默认域名 `c.aasc.us` 返回 403，发布验收使用 LAN
`192.168.1.39` 和 WAN 直连 IP `120.79.245.103`。

现场复核：SM-N9500 当前安装 min v10 时，启动检查可以把 `c.aasc.us` 解析为
`120.79.245.103` 并成功读取清单；当前清单已显示 min v14 下载提示。完整 APK v13 不进入该清单，
仍需单独安装完整包。

2026-09-18 已发布与 full v13 配套的 min APK v14（`0.2.12-offline-min`）。v14 使用
`versionCode=14`，高于 full v13 的 `versionCode=13`，可以在已安装 full v13 的设备上原位更新；
APK 大小 `89245126` bytes，SHA-256 为
`062aee3158d5534c18b57bf8dcf28dccdffe9b27ebd33cbaa00b35fc0143382f`。LAN/WAN 更新清单均已切换到
`apk/aasc-display-offline-min-v14.apk`，SM-N9500 v10 启动后已显示 v14 手动下载提示。

2026-09-18 针对 Chat2API 账户管理弹窗只显示四个顶部按钮的问题，已发布服务代码
`code-v5.zip`（代码版本 5，沿用 dependencies v3）。代码包大小 `14005201` bytes，SHA-256 为
`dae26685353195f23afb4828980b829bb30e5aef6822887233e927714576de9e`；LAN 和 WAN 直连 IP 的
签名清单均已切换到 `code/code-v5.zip`，不重新发布 APK 或依赖包。SM-N9500 重启后日志确认
`code=5, dependencies=3` 已原子切换，设备实际加载的 `chat2api.js` 与当前源码 SHA-256 均为
`9dd599441e8b45b319fff5ecd4832d9db4b4bff2dbd19b61aa3d963463e93e7f`，弹窗包含“导出账号凭证”和
“导入账号凭证”两个独立按钮。外网域名仍只用于 DNS 解析，发布验收使用直连 IP。

追加验收：min v14 APK 使用 `apksigner` 验证通过（v2 签名），证书 SHA-256 为
`a57fd4c34c0c769246239a7d8c606b5edb62c215ecf9659448ea178eda3fb7df`，与签名清单和 full v13 一致。
SM-N9500 在应用内下载校验阶段仍报 `min APK signer SHA-256 与签名清单不匹配`，堆栈位于
`OfflineUpdateManager.kt:930` 的 `getPackageArchiveInfo` 结果比对；因此本次未修改已签名 v14 文件，改用
外网 full v13 直接安装验证成功，安装后服务 code=5/dependencies=3 和 Chat2API 六按钮均正常。

本次执行已将独立 RSA 密钥对接入打包流程，并重新生成 full v2 APK、code/dependencies v3 服务更新包。full APK SHA-256 为 `9ab99a0a5bde792b5dfb2348dc75e507f64824a51b792102f90d9fc94d019a4d`；code v3 SHA-256 为 `8f1b47e4b5bca1bd2494f95520589af4b007d5ed4be9058ea48d2df43ca6b3c3`，dependencies v3 SHA-256 为 `0ff53a2c8cbc87b736b4a2746b22e652c5b15a75a0354fb4523c37f1bfa85198`。2026-09-17 将修复后的 min APK 升级为 versionCode `4`、版本 `0.2.2-offline-min`，大小 `89205130` bytes，SHA-256 为 `be31e437ca17488fab20eefd1874be2a1b40689cac59f667873e761dd17b1027`，并正式发布到 LAN/WAN。两站点 manifest 字节一致、RSA 签名有效，LAN HTTP 整包 hash、WAN 远端文件 hash 及 HTTP 206 首段校验通过；WAN HTTP HEAD 返回 `200` 且 Content-Length 正确。full APK 另已上传为 `apk/aasc-display-offline-v2.apk`，远端完整 hash 与本地一致。真机卸载后 fresh install full v2，首次 Runtime 安装约 94.6 秒；修复 ZIP 目录项规范化白名单后，设备生成 code/dependencies v3 的 `active-release.json`，`pendingHealth=false`，`/api/status`、`/v1/models` 和默认模型聊天通过。2026-09-17 使用含 `libaasc_node.so` 的 min v3 原位安装成功，数据目录和模型缓存保留，服务重新启动并继续使用 code/dependencies v3；回滚及异常降级仍待验收。

方案已确认并进入实现。Node 更新包/发布器、`allserver-min` 构建 profile、Android 签名下载/服务版本切换和 min APK 安装流程已落地；跨文件系统落盘已改为输出目录同目录暂存后原子切换，并有集成回归覆盖 `/tmp` 到工作区输出。Android JVM 单测及更新相关 Node 定向测试通过。服务发布支持 `code-only` 和 `all` 两种模式；Android 原生更新通过 `allserver-min` APK 独立发布。模型在线更新和 `.mmap` 处理不在本期范围。服务双站点发布、full APK fresh install 后的 code/dependencies 热更、min v3 原位升级和 min v4 正式发布已验收；发布器现已支持 full/min/code/dependencies 的精确旧版本清理，回滚、异常降级及 ASR/TTS 完整业务回归仍待验收。

2026-09-17 为 Offline 固定显示端 ID 和原生 Chat2API“完成”按钮生成并正式发布 min v6 热更包（versionCode 6、`0.2.4-offline-min`）。该包包含原生任务索引迁移逻辑，已同步到 LAN `http://192.168.1.39/mnt/aasc-offline/` 与 WAN `http://120.79.245.103/mnt/aasc-offline/`；APK 大小 `89208438` bytes，SHA-256 为 `0f7af47dbba366758ebbe818994da37f39028bd8174ba6b3dfa8754f33366b68`。两站点 manifest 字节一致、签名有效，LAN/WAN HTTP APK 均返回 200 和正确 Content-Length，WAN 远端文件 hash 与清单一致。

本次新增更新可见性：发现更高版本 min APK 后先由用户点击“下载更新”，浮动卡片显示下载、校验和安装阶段；下载完成后自动提交 Android PackageInstaller，系统安装确认仍由用户完成。完整 Offline APK 首次启动显示 Runtime 清单读取、Runtime 动态库、服务源码、Node 依赖和配置迁移等阶段的文件/字节进度；进度回调只在后台线程产生，Activity 在主线程更新遮罩。

Offline 显示页的控制端浮动按钮由 `OnBackPressedDispatcher` 统一处理返回键：控制页打开时返回只关闭控制页并恢复按钮，显示页保持当前 URL，不调用 WebView 历史回退；按钮状态按当前控制权限重新同步，避免按钮偶发消失后只能回退网页。

本次实现已构建并正式发布 min APK v7（`0.2.5-offline-min`）。本地和远端 APK 大小均为
`89535999` bytes，SHA-256 为 `80501f7ea36a96377f8cddec3f238e0ec31b2d2bc30681d3f4b650c3ada324af`；
LAN/WAN 清单均引用 `apk/aasc-display-offline-min-v7.apk`，清单签名、APK HTTP 200 和
`Content-Length: 89535999` 已复核。发布地址为 `http://192.168.1.39/mnt/aasc-offline/` 和
`http://120.79.245.103/mnt/aasc-offline/`。SM-N9500 Android 9/API 28 真机已覆盖安装 v7 并在
Display 2 `Desktop` 虚拟屏运行，窗口配置为 1920×1018 app 区域、160 dpi，Node 子进程和
`/api/status`、`/v1/models`、`/display?displayId=offline-display` 均正常；UI 自动化能看到浮动“控制端”按钮。
该虚拟屏标记为 `touch NONE`，设备不能将 adb 触控/返回键定向到 Display 2，且 `screencap -d 2`
无法取得 Desktop 图像，因此本轮未宣称完成真实点击回归。按现有分辨率策略，1920 长边相对 1280
基准为 75%；本次校正以 `1280px@320dpi` 为 100%，使用 `round((长边 / 1280) × (densityDpi / 320) × 100)`，不修改系统 density。

2026-09-18 已将该校正打包为 min APK v8（`0.2.6-offline-min`），大小 `89231402` bytes，SHA-256 为
`470c19c57ca528d84e87729ece45b74d48a3e2acdfbf124a16751a04786b0d2c`，并正式发布到 LAN/WAN。
两站点 manifest 均引用 v8，APK HTTP 返回 200 且 Content-Length 正确，WAN 远端文件 hash 与本地一致。
SM-N9500 Android 9/API 28 已覆盖安装 v8 并在 Display 2 运行；窗口仍为 1920×1018 app 区域、160 dpi，
`/api/status`、`/v1/models`（Qwen ready）和 `/display?displayId=offline-display` 均正常。

2026-09-18 新增右下角屏幕诊断浮层后，min APK v9（`0.2.7-offline-min`）已构建并正式发布，大小 `89233662` bytes，
SHA-256 为 `32181e75e3dbfe7b381bd0660f49778860ca62c4683bc69d7dbb3254eef549b7`。SM-N9500 Display 2 的 UI
自动化读取到 `分辨率 1920×1018 | DPI 160 | 缩放 75%`；LAN `192.168.1.39` 和 WAN 直接 IP `120.79.245.103`
的 manifest 字节、HTTP 200/Content-Length 和 WAN 远端 APK hash 均复核一致。默认域名 `c.aasc.us` 当前返回备案拦截 403，未作为本次发布验收入口。

2026-09-18 外网热更源改为域名配置 `http://c.aasc.us/mnt/aasc-offline/`。Offline APK 检查更新时先将域名解析为 IP，
再把解析出的 IP 替换回更新 URL 的主机部分访问；不额外设置或保留域名 Host，路径仍使用
`/mnt/aasc-offline/manifest.json` 及清单中的组件相对路径。LAN 源仍为
`http://192.168.1.39/mnt/aasc-offline/`，内网优先、外网备用和多 IP 逐个尝试规则保持不变。

2026-09-18 已正式发布完整 Offline APK v12（`0.2.10-offline`），与当前 min versionCode 对齐，文件为 `apk/aasc-display-offline-v12.apk`。APK 大小 `957319386` bytes、SHA-256 为 `b107d7963bf4dd18068404427e12f4edc72ff8253e8914e3d1909ca66e6c8183`；LAN/WAN 直连 IP HTTP 200、Content-Length、远端文件 hash、APK v2 签名和 ZIP 完整性均通过。默认域名 `c.aasc.us` 返回 403，未作为验收入口。

2026-09-18 已正式发布控制端聊天设置修复：服务 code v4 与 Offline min APK v12（`0.2.10-offline-min`）同步到 LAN/WAN。code v4 大小 `13996510` bytes、SHA-256 为 `7ca5adf90be5738ee94b47e31534d574b411a1934e3b0d0db6702955b1247bd2`；min v12 大小 `89236426` bytes、SHA-256 为 `c4c20af9ab6b71c5e0e5dad1b4d3d2f1cdfce8cb7eaee91d6dde0ff1afdcf253`。更新清单携带“控制端聊天设置修复”发布日志，LAN/WAN 直连 IP 的 manifest 与 APK 均返回 HTTP 200、Content-Length 正确，签名和 APK v2 校验通过；默认域名 `c.aasc.us` 当前返回 403，未作为验收入口。

2026-09-18 根据 Display 2 与手机实测结果调整 Offline WebView 缩放曲线：以 `1280px@320dpi` 为 100%，使用
`round((((长边 / 1280) + (densityDpi / 320)) / 2) × 100)`。目标为 Display 2 `1920×1080@160dpi` 显示 `100%`，
`2309×1080@480dpi` 手机显示 `165%`。min v10（`0.2.8-offline-min`）已完成构建、v2 签名校验、LAN/WAN 正式发布和 SM-N9500 Display 2 验证；APK 大小 `89233814` bytes，SHA-256 为 `713a0ecd53536afadf5115864e1ea28a90409717aa2bbd95655fbad155ce139e`，LAN/WAN manifest 字节一致（SHA-256 `bc613aba55e41fced9b01d38cbfc83d0541c4eb5b8b61b4b0d6545dbd6134ac0`），APK HTTP 200/Content-Length 和 WAN 远端 hash 均通过。UI 自动化读取到 `分辨率 1920×1018 | DPI 160 | 缩放 100%`，`/api/status` 返回 `status=ok`，固定 `offline-display` 连接正常；默认域名 `c.aasc.us` 仍返回备案拦截 403，发布验收使用 LAN 和 WAN 直连 IP。

## 需求

Offline APK 需要在不重新安装完整大包的情况下更新服务代码与生产依赖；服务代码有时变化而依赖不变，因此代码更新必须可以单独发布、设备不得因此重新下载 `node_modules`。原生 Android/Kotlin 与 JNI/MNN 库则通过较小的更新 APK 分发，安装在已经安装完整 offline APK 的设备上。

更新源为局域网优先、外网备用：

- 局域网：`http://192.168.1.39/mnt/aasc-offline/`，服务器目录 `/mnt/aasc-offline/`。
- 外网配置：`http://c.aasc.us/mnt/aasc-offline/`，解析后使用 IP 替换 URL 主机访问；当前 DNS 预期指向 `120.79.245.103`。根据 HTTP 映射使用 SCP 目录 `as@120.79.245.103:~/a/aasc-offline/`；该目录已做存在性检查并完成本次发布。用户之前输入的 `~/a/aasc-offlin` 少了末尾 `e`，未向该不存在路径写入。

发布器只写本功能命名空间中的版本化文件和最终清单；清单原子切换并完成验证后，仅清理本规则明确匹配且不再被当前发布引用的旧版本文件。清理局限于局域网和外网各自的发布根目录，不覆盖 APK 链接，也不触碰日志、模型、配置、任务、results 或其他文件。2026-09-17 已按该规则清理两站点的旧 code v2、dependencies v2 和 min v3。

远端 SCP 目标的 SSH 登录 shell 不作为脚本解释器；发布器显式通过 `/bin/sh -c` 执行检查、校验和原子切换脚本，确保 fish 等非 POSIX 登录 shell 不改变发布语义。

## 设计

### 独立服务组件版本

签名清单分别记录 `code`、`dependencies` 和可选 `apk` 组件的版本、相对下载地址、字节数与 SHA-256。 `apkMin` 可选记录 `releaseNotes`，由发布日志文件提供并纳入同一签名 payload。自动化测试使用临时 RSA key；本地打包使用 `~/.config/aasc-user/` 中受保护的独立更新签名 key。正式双站点发布前仍需按发布流程验收密钥保管与目标路径。服务包边界如下：

- `code`：完整 `src/` 快照（包含显示端网页 UI 和控制端 UI）以及 `package.json`、`package-lock.json`；不含 `node_modules`。
- `dependencies`：Android 兼容的生产 `node_modules` 快照及其 lockfile 指纹。
- `code-only`：生成并发布完整代码包；沿用当前依赖包，不生成、不上传、不下载依赖包。代码声明所需依赖版本及 lockfile 指纹，设备不匹配时保留旧版本并报告需要 `all` 更新。
- `all`：重新生成代码包和依赖包，设备在一个版本切换事务中同时应用两者。

`code-only` 构建前必须确认当前 `package-lock.json` 与已发布依赖的指纹一致；依赖声明或锁文件变化时拒绝代码单独发布，要求使用 `all`。不提供只更新 dependencies 的模式，避免依赖更新后与旧代码不兼容。

### 签名清单和下载

两个 URL 使用 HTTP，因此不能把同站点 SHA-256 当作来源认证。清单采用内嵌公钥验证的 `SHA256withRSA` 数字签名；私钥默认从受保护的用户配置目录读取，也可由发布环境通过 `AASC_OFFLINE_UPDATE_PRIVATE_KEY` 指定，禁止进入仓库、APK 和日志。签名覆盖确定性序列化的完整清单 payload；包文件再按签名清单中的大小与 SHA-256 校验。

密钥配置补充：独立更新 RSA 密钥对位于 `~/.config/aasc-user/offline-update-private.pem` 与 `~/.config/aasc-user/offline-update-public.pem`。Node 工具默认读取这两个文件；`AASC_OFFLINE_UPDATE_PRIVATE_KEY`、`AASC_OFFLINE_UPDATE_PUBLIC_KEY` 可分别覆盖。构建 full/min APK 前校验密钥匹配，APK 仅嵌入公钥；私钥文件限制为当前用户可读，不复制到仓库、APK、日志或发布目录。

启动更新检查先尝试局域网源，连接失败或超时才回退外网源；外网域名源先解析为一个或多个 IP，实际 HTTP URL 使用解析出的 IP 主机且不覆盖 Host 头。多个解析结果按顺序尝试，全部失败后才报告该源不可用。签名无效、版本字段异常或包校验失败时不接受该源的更新，继续使用当前已安装版本并记录错误。下载地址限定为清单所在源下的相对路径。解压时拒绝绝对路径、`..` 越界、符号链接和特殊文件。

发布 min APK 时可通过 `--release-notes-file <UTF-8 文件>` 写入本次更新日志。发布器首尾裁剪日志，保留内部换行，限制为 4096 个 Unicode 字符；空日志不写入清单字段。Android 更新卡片显示版本、大小和日志内容，最多展示 6 行；旧清单缺少 `releaseNotes` 时沿用原有版本/大小提示。

2026-09-18 已完成该能力：`offline-min-apk-package.js` 在生成并验签 `apkMin` 时读取日志文件，Android 清单解析和更新卡片按同一上限处理；Node 39 项 Offline/APK 回归、Android `OfflineUpdateManifestTest` 定向测试均通过，未携带日志的 v10 清单仍保持兼容。

### 发布资源保留与清理

版本化资源发布到局域网和外网两个独立目标。服务清单中的 `code.relativeUrl`、`dependencies.relativeUrl` 和 `apkMin.relativeUrl` 是各自组件的权威保留项；完整 Offline APK 不进入服务更新清单，使用 `apk/aasc-display-offline-v<versionCode>.apk` 命名，完整包发布时保留本次版本。清理规则只匹配以下精确版本文件：`code/code-v<数字>.zip`、`dependencies/dependencies-v<数字>.zip`、`apk/aasc-display-offline-min-v<数字>.apk` 和 `apk/aasc-display-offline-v<数字>.apk`。

每个目标都按“校验本地工件 → 上传版本文件 → 原子替换清单（完整 APK 无清单替换）→ HTTP/远端校验 → 精确清理旧版本”的顺序执行。清理只删除普通文件，不跟随或删除符号链接；当前清单引用的服务包、当前 min APK 和本次/最新完整 APK 必须保留。清理失败不回滚已经验证的发布，返回可重试错误并保留旧文件。

AI 执行约束同步记录：仓库根目录的 `CLAUDE.md` 与 `AGENTS.md` 均必须包含本节规则；后续 AI 修改、打包、发布或清理 Offline 资源前先读取这两个入口及本设计/spec 文档。

### 服务代码与依赖原子切换

服务检查/应用在 `NodeServerService` 启动 Node 进程之前执行。新代码和依赖先分别下载到临时区，验证签名、大小、hash、依赖指纹、路径与剩余空间后才进入版本化目录。运行布局使用独立组件目录和 release 目录：release 保存代码版本、依赖版本的配对，并在应用私有目录内关联对应依赖；一个原子替换的 active-release 标记决定下次 Node 启动使用的配对。旧 release 在新配对成功启动前保留，可供失败回退。

代码目录包含完整 `src/`，所以服务端 API 与显示/控制 Web UI 同步更新。配置、用户数据、任务定义与 `results/`、运行实例、日志、上传文件、ASR/TTS 模型、显示端 LLM 模型缓存及 Android Node 原生运行库不属于代码包，不因服务更新被替换。版本化 release 和 active-release 标记位于 `files/aasc-server/updates/`；该目录必须加入 Runtime 安装器的可迁移用户目录清单，保证未来完整 APK Runtime 升级也不会擦除热更新 release。旧版尚无 active-release 标记的设备继续从现有 Runtime 根目录启动；首次成功应用热更新后才切换到版本化布局。

无网络、磁盘空间不足、清单或包不合法、更新解压/切换失败时，保留并启动当前可用 release，不阻止离线主界面启动。更新失败和代码要求的依赖版本不匹配通过服务状态/通知展示。启动新 release 失败时先回退到上一个已验证 release，再按现有 Node 服务监督策略启动。

### `allserver-min` 原生 APK 更新

- `release/apkbuild/allserver-min/app.json` 定义只更新已安装 offline APK 的 profile。该 APK 使用 `com.aasc.display.offline`、与完整包相同的签名证书和更高的 `versionCode`；新鲜安装时显示“请先安装完整 Offline APK”，不启动服务。
- `build:apk:offline:min` 只打包应用代码、Android/AAR/CMake 原生库以及 Node Runtime 所需的最小原生动态库集合；不生成/携带完整 Node 服务源码、`node_modules`、服务模型或 LLM 权重。min 构建保持当前 bundled model ID/revision 不变；原生 LLM 管理器先验证缓存，缓存命中时不依赖已从 APK 移除的模型 manifest/权重 asset。
- 更新包中的显式 update-only Runtime 清单只允许更新 `files/aasc-server/runtime/arm64-v8a/lib/` 下的允许列表原生运行库；min APK 仍携带 `libaasc_node.so` 以保证 Android 原位替换后 Node 入口存在。不得调用完整 Runtime 替换流程，不触碰服务源码、依赖、配置、任务、results、日志、ASR/TTS 模型和 LLM 缓存。
- 完整 Offline APK 内的 updater 下载 min APK、校验签名清单和 SHA-256 后交给 Android 系统安装器，由用户确认安装。安装 APK 前检查并确保当前 APK 内置的 LLM 模型已物化并 hash 校验到 `files/models/llm/bundled/<modelId>`；空间不足或模型物化失败则延后原生更新，避免升级后 APK asset 被替换而缓存尚不存在。`MnnLlmModelManager` 在读取 APK metadata 前先检查同 revision 缓存；min 不携带模型 manifest/权重，模型 ID/revision 变更仍必须走完整 APK 发布。
- min APK 替换后，应用私有数据保持原样；Node Runtime 安装器根据 update-only 标志执行受限原生库更新。模型在线更新、复制/预生成 `.mmap` 不属于该步骤。

当前 Gradle 构建使用 `assembleDebug`，正式更新必须验证 full/min 两包 `applicationId`、签名证书摘要和递增版本码完全兼容。首次启用需要先构建并安装包含 updater 的完整 offline APK，然后再验证 min 更新通道；不能用 min APK 引导尚无 updater 的旧安装。

### 更新提示与首包启动进度

- 更新清单发现更高 `apkMin.versionCode` 时，Activity 显示版本、大小和“下载更新/稍后”按钮；未点击下载前不创建 APK 下载文件。
- 用户点击下载后，更新管理器通过回调报告 `downloading` 的已接收字节和清单声明总字节，浮动卡片显示百分比；完成后依次显示 `verifying`、`materializing` 和 `installing`，失败时保留当前版本并提供重试。
- PackageInstaller 的 `STATUS_PENDING_USER_ACTION`、成功和失败结果通过应用内状态广播回传；不执行静默安装，不在后台强行打开系统页面。
- 首次完整 Runtime 安装将 manifest 文件按 `runtime`、服务源码、`node_modules` 依赖和配置元数据分类累计已复制字节；NodeServerService 将阶段和进度广播给 MainActivity。快速复用已安装 Runtime 时直接显示“已复用”，不伪造解压进度。

## 发布与版本顺序

新增入口：

- `npm run build:offline-update -- --mode=code-only|all`：生成签名服务更新包及本地校验清单。
- `npm run publish:offline-update -- --mode=code-only|all`：将版本化服务包先发布到局域网目录和远端目录，最后原子替换各自签名清单；`code-only` 保留原依赖包及清单条目。
- `npm run build:apk:offline:min`：构建 update-only min APK。
- `npm run package:offline-apk:min -- --manifest-file <当前清单> --release-notes-file <UTF-8 日志>`：将 min APK、构建清单和本次更新日志写入新的签名本地清单；日志字段随后随 `apk-min` 发布流程上传。
- `npm run publish:offline-apk:min`：把 min APK 版本文件发布后更新签名清单中的 APK 组件。
- `npm run publish:offline-apk:full -- --apk <full-apk> --build-manifest <build-manifest>`：把完整 Offline APK 以 versionCode 文件名发布到两个目标，并清理旧完整 APK；完整 APK 不写入服务更新清单。

初次启用先把现有完整 offline APK 更新为带 updater 的版本（版本码从当前 `1` 提升），真机验证同签名原位升级和恢复数据；随后使用严格更高版本码的 min APK 完成一次系统确认安装。安装/签名失败不得卸载旧包或删除应用数据。安装权限设置回跳后复用已验证的缓存更新元数据，不依赖二次联网；Activity 被系统回收后，完整数据目录仍存在时在恢复前台重新验签检查。

## 验收与范围

- `code-only` 不执行生产依赖安装，不生成或上传依赖档案；新代码和现有依赖匹配时生效，不匹配时旧 release 继续可用。
- `all` 同时生成、校验并切换源码和依赖；故意损坏任一包、制造路径穿越或空间不足时不得切换 active release。
- 首次启动无网络时可启动旧 release；局域网不可达时回退外网；签名错误时不降级为未签名更新。
- min APK 可由完整包安装为更新，版本码与签名符合 Android 规则；min fresh install 不启动 Node；升级后 `/api/status`、`/v1/models`、聊天、ASR/TTS、配置和任务 results 均保留。
- 全量/代码包均包含 `src/apps/web-mediacenter/ui`，验证服务 API 与 UI 代码来自同一代码版本。
- 新 full/min APK、代码包或依赖包发布后，局域网和外网均只保留当前权威版本；发布目录中的日志、模型、配置、任务、results、非版本文件和符号链接保持不变。
- 不包含模型下载通道、完整 APK 自动静默安装、服务端 only-dependency 更新、`.mmap` 预生成或删除、显示端业务功能改造。
远端 HTTP 目录需要能够读取发布清单。由于 SCP 会保留临时文件的受限权限，发布器在远端 manifest 原子切换前将临时清单设为 `0644`；清单只包含公开版本和 hash 信息，不包含签名私钥。

ZIP 安全校验统一使用去除目录项尾部 `/` 后的规范化名称；组件白名单必须显式允许 `src` 和 `node_modules` 这两个根目录项，同时继续拒绝 Android 显示端代码、跨组件路径和目录穿越。
