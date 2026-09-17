# Android Offline APK 热更新与原生增量 APK

## 状态

本次执行已将独立 RSA 密钥对接入打包流程，并重新生成 full v2 APK、code/dependencies v3 服务更新包。full APK SHA-256 为 `9ab99a0a5bde792b5dfb2348dc75e507f64824a51b792102f90d9fc94d019a4d`；code v3 SHA-256 为 `8f1b47e4b5bca1bd2494f95520589af4b007d5ed4be9058ea48d2df43ca6b3c3`，dependencies v3 SHA-256 为 `0ff53a2c8cbc87b736b4a2746b22e652c5b15a75a0354fb4523c37f1bfa85198`。ZIP、APK 签名、公钥一致性、清单签名和工件 hash 检查通过；服务 v3 和 min v3 通道已发布到 LAN/WAN 并完成 HTTP 复验。真机卸载后 fresh install full v2，首次 Runtime 安装约 94.6 秒；修复 ZIP 目录项规范化白名单后，设备生成 code/dependencies v3 的 `active-release.json`，`pendingHealth=false`，`/api/status`、`/v1/models` 和默认模型聊天通过。min 原位安装、回滚及异常降级仍待验收。

方案已确认并进入实现。Node 更新包/发布器、`allserver-min` 构建 profile、Android 签名下载/服务版本切换和 min APK 安装流程已落地；跨文件系统落盘已改为输出目录同目录暂存后原子切换，并有集成回归覆盖 `/tmp` 到工作区输出。Android JVM 单测及更新相关 Node 定向测试通过。服务发布支持 `code-only` 和 `all` 两种模式；Android 原生更新通过 `allserver-min` APK 独立发布。模型在线更新和 `.mmap` 处理不在本期范围。服务双站点发布和 full APK fresh install 后的 code/dependencies 热更已验收；真机 min 原位升级、回滚、异常降级及 ASR/TTS 完整业务回归仍待验收。

## 需求

Offline APK 需要在不重新安装完整大包的情况下更新服务代码与生产依赖；服务代码有时变化而依赖不变，因此代码更新必须可以单独发布、设备不得因此重新下载 `node_modules`。原生 Android/Kotlin 与 JNI/MNN 库则通过较小的更新 APK 分发，安装在已经安装完整 offline APK 的设备上。

更新源为局域网优先、外网备用：

- 局域网：`http://192.168.1.39/mnt/aasc-offline/`，服务器目录 `/mnt/aasc-offline/`。
- 外网：`http://120.79.245.103/mnt/aasc-offline/`。根据 HTTP 映射使用 SCP 目录 `as@120.79.245.103:~/a/aasc-offline/`；该目录已做存在性检查并完成本次发布。用户之前输入的 `~/a/aasc-offlin` 少了末尾 `e`，未向该不存在路径写入。

发布器只写本功能命名空间中的版本化文件和最终清单，不清理发布目录，不覆盖已有 APK 链接或其他文件。

远端 SCP 目标的 SSH 登录 shell 不作为脚本解释器；发布器显式通过 `/bin/sh -c` 执行检查、校验和原子切换脚本，确保 fish 等非 POSIX 登录 shell 不改变发布语义。

## 设计

### 独立服务组件版本

签名清单分别记录 `code`、`dependencies` 和可选 `apk` 组件的版本、相对下载地址、字节数与 SHA-256。自动化测试使用临时 RSA key；本地打包使用 `~/.config/aasc-user/` 中受保护的独立更新签名 key。正式双站点发布前仍需按发布流程验收密钥保管与目标路径。服务包边界如下：

- `code`：完整 `src/` 快照（包含显示端网页 UI 和控制端 UI）以及 `package.json`、`package-lock.json`；不含 `node_modules`。
- `dependencies`：Android 兼容的生产 `node_modules` 快照及其 lockfile 指纹。
- `code-only`：生成并发布完整代码包；沿用当前依赖包，不生成、不上传、不下载依赖包。代码声明所需依赖版本及 lockfile 指纹，设备不匹配时保留旧版本并报告需要 `all` 更新。
- `all`：重新生成代码包和依赖包，设备在一个版本切换事务中同时应用两者。

`code-only` 构建前必须确认当前 `package-lock.json` 与已发布依赖的指纹一致；依赖声明或锁文件变化时拒绝代码单独发布，要求使用 `all`。不提供只更新 dependencies 的模式，避免依赖更新后与旧代码不兼容。

### 签名清单和下载

两个 URL 使用 HTTP，因此不能把同站点 SHA-256 当作来源认证。清单采用内嵌公钥验证的 `SHA256withRSA` 数字签名；私钥默认从受保护的用户配置目录读取，也可由发布环境通过 `AASC_OFFLINE_UPDATE_PRIVATE_KEY` 指定，禁止进入仓库、APK 和日志。签名覆盖确定性序列化的完整清单 payload；包文件再按签名清单中的大小与 SHA-256 校验。

密钥配置补充：独立更新 RSA 密钥对位于 `~/.config/aasc-user/offline-update-private.pem` 与 `~/.config/aasc-user/offline-update-public.pem`。Node 工具默认读取这两个文件；`AASC_OFFLINE_UPDATE_PRIVATE_KEY`、`AASC_OFFLINE_UPDATE_PUBLIC_KEY` 可分别覆盖。构建 full/min APK 前校验密钥匹配，APK 仅嵌入公钥；私钥文件限制为当前用户可读，不复制到仓库、APK、日志或发布目录。

启动更新检查先尝试局域网源，连接失败或超时才回退外网源；签名无效、版本字段异常或包校验失败时不接受该源的更新，继续使用当前已安装版本并记录错误。下载地址限定为清单所在源下的相对路径。解压时拒绝绝对路径、`..` 越界、符号链接和特殊文件。

### 服务代码与依赖原子切换

服务检查/应用在 `NodeServerService` 启动 Node 进程之前执行。新代码和依赖先分别下载到临时区，验证签名、大小、hash、依赖指纹、路径与剩余空间后才进入版本化目录。运行布局使用独立组件目录和 release 目录：release 保存代码版本、依赖版本的配对，并在应用私有目录内关联对应依赖；一个原子替换的 active-release 标记决定下次 Node 启动使用的配对。旧 release 在新配对成功启动前保留，可供失败回退。

代码目录包含完整 `src/`，所以服务端 API 与显示/控制 Web UI 同步更新。配置、用户数据、任务定义与 `results/`、运行实例、日志、上传文件、ASR/TTS 模型、显示端 LLM 模型缓存及 Android Node 原生运行库不属于代码包，不因服务更新被替换。版本化 release 和 active-release 标记位于 `files/aasc-server/updates/`；该目录必须加入 Runtime 安装器的可迁移用户目录清单，保证未来完整 APK Runtime 升级也不会擦除热更新 release。旧版尚无 active-release 标记的设备继续从现有 Runtime 根目录启动；首次成功应用热更新后才切换到版本化布局。

无网络、磁盘空间不足、清单或包不合法、更新解压/切换失败时，保留并启动当前可用 release，不阻止离线主界面启动。更新失败和代码要求的依赖版本不匹配通过服务状态/通知展示。启动新 release 失败时先回退到上一个已验证 release，再按现有 Node 服务监督策略启动。

### `allserver-min` 原生 APK 更新

- `release/apkbuild/allserver-min/app.json` 定义只更新已安装 offline APK 的 profile。该 APK 使用 `com.aasc.display.offline`、与完整包相同的签名证书和更高的 `versionCode`；新鲜安装时显示“请先安装完整 Offline APK”，不启动服务。
- `build:apk:offline:min` 只打包应用代码、Android/AAR/CMake 原生库以及 Node Runtime 所需的最小原生动态库集合；不生成/携带完整 Node 服务源码、`node_modules`、服务模型或 LLM 权重。min 构建保持当前 bundled model ID/revision 不变；原生 LLM 管理器先验证缓存，缓存命中时不依赖已从 APK 移除的模型 manifest/权重 asset。
- 更新包中的显式 update-only Runtime 清单只允许更新 `files/aasc-server/runtime/arm64-v8a/lib/` 下的允许列表原生运行库；不得调用完整 Runtime 替换流程，不触碰服务源码、依赖、配置、任务、results、日志、ASR/TTS 模型和 LLM 缓存。
- 完整 Offline APK 内的 updater 下载 min APK、校验签名清单和 SHA-256 后交给 Android 系统安装器，由用户确认安装。安装 APK 前检查并确保当前 APK 内置的 LLM 模型已物化并 hash 校验到 `files/models/llm/bundled/<modelId>`；空间不足或模型物化失败则延后原生更新，避免升级后 APK asset 被替换而缓存尚不存在。`MnnLlmModelManager` 在读取 APK metadata 前先检查同 revision 缓存；min 不携带模型 manifest/权重，模型 ID/revision 变更仍必须走完整 APK 发布。
- min APK 替换后，应用私有数据保持原样；Node Runtime 安装器根据 update-only 标志执行受限原生库更新。模型在线更新、复制/预生成 `.mmap` 不属于该步骤。

当前 Gradle 构建使用 `assembleDebug`，正式更新必须验证 full/min 两包 `applicationId`、签名证书摘要和递增版本码完全兼容。首次启用需要先构建并安装包含 updater 的完整 offline APK，然后再验证 min 更新通道；不能用 min APK 引导尚无 updater 的旧安装。

## 发布与版本顺序

新增入口：

- `npm run build:offline-update -- --mode=code-only|all`：生成签名服务更新包及本地校验清单。
- `npm run publish:offline-update -- --mode=code-only|all`：将版本化服务包先发布到局域网目录和远端目录，最后原子替换各自签名清单；`code-only` 保留原依赖包及清单条目。
- `npm run build:apk:offline:min`：构建 update-only min APK。
- `npm run publish:offline-apk:min`：把 min APK 版本文件发布后更新签名清单中的 APK 组件。

初次启用先把现有完整 offline APK 更新为带 updater 的版本（版本码从当前 `1` 提升），真机验证同签名原位升级和恢复数据；随后使用严格更高版本码的 min APK 完成一次系统确认安装。安装/签名失败不得卸载旧包或删除应用数据。安装权限设置回跳后复用已验证的缓存更新元数据，不依赖二次联网；Activity 被系统回收后，完整数据目录仍存在时在恢复前台重新验签检查。

## 验收与范围

- `code-only` 不执行生产依赖安装，不生成或上传依赖档案；新代码和现有依赖匹配时生效，不匹配时旧 release 继续可用。
- `all` 同时生成、校验并切换源码和依赖；故意损坏任一包、制造路径穿越或空间不足时不得切换 active release。
- 首次启动无网络时可启动旧 release；局域网不可达时回退外网；签名错误时不降级为未签名更新。
- min APK 可由完整包安装为更新，版本码与签名符合 Android 规则；min fresh install 不启动 Node；升级后 `/api/status`、`/v1/models`、聊天、ASR/TTS、配置和任务 results 均保留。
- 全量/代码包均包含 `src/apps/web-mediacenter/ui`，验证服务 API 与 UI 代码来自同一代码版本。
- 不包含模型下载通道、完整 APK 自动静默安装、服务端 only-dependency 更新、`.mmap` 预生成或删除、显示端业务功能改造。
远端 HTTP 目录需要能够读取发布清单。由于 SCP 会保留临时文件的受限权限，发布器在远端 manifest 原子切换前将临时清单设为 `0644`；清单只包含公开版本和 hash 信息，不包含签名私钥。

ZIP 安全校验统一使用去除目录项尾部 `/` 后的规范化名称；组件白名单必须显式允许 `src` 和 `node_modules` 这两个根目录项，同时继续拒绝 Android 显示端代码、跨组件路径和目录穿越。
