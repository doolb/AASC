# Offline 自动升版、出包与发布

在有 Offline RSA 签名密钥及相应工具链/资源的出包机项目目录执行。命令会复用现有构建与发布器。

## 常用命令

```bash
# 查看参数
npm run release:offline -- --help

# 按待出包状态预览；不写文件、不升版、不加载私钥
npm run release:offline -- --dry-run

# 自动识别并恢复最近未完成构建，否则按状态选择、递增版本、出包
npm run release:offline

# 自动恢复最近未完成任务/发布最近已出包任务，否则按状态出包后发布 LAN/WAN
npm run release:offline -- --publish

# 手动选择种类，可单选或逗号组合；覆盖默认状态选择
npm run release:offline -- --only=min
npm run release:offline -- --only=code,task --publish
npm run release:offline -- --only=deps --publish

# 完整 APK：显式指定才构建；full 不会清除 min 的待出包标记
npm run release:offline -- --only=full
npm run release:offline -- --only=full,min,code --publish

# 显式全部六种（包含 full）
npm run release:offline -- --only=all --dry-run
npm run release:offline -- --only=all --publish
```

| 种类 | 产物/联动 |
|---|---|
| `min` | update-only min APK，更新对应 profile 的 versionCode/versionName |
| `code` | 服务代码与可热更网页/启动器；锁文件变化时联动 deps |
| `deps` | 生产依赖；因版本绑定自动联动 code |
| `task` | 独立任务代码 ZIP；继续执行现有兼容性校验 |
| `node` | voice-display-node 子显示端 ZIP 与签名 sidecar，独立于服务清单 |
| `full` | 完整 Offline APK，独立 full-apk-manifest 索引，不写服务 manifest |

`node` 不代表外网 `/node-min/` 下的 Node min 配套文件；本入口不重建/上传 noserver、withserver 或 allserver-min.js。

## 版本号与状态

普通新任务（含 `--new`）的版本取已发布清单、本地版本化产物/候选清单和 APK profile/构建元数据中的最大值加一。输出目录独立 `.release-offline-versions.json` 保存历史编号高水位，不随报告删除而回收编号。min/full 使用共同的 Android 最大 versionCode，避免相互覆盖安装时降级；versionName 保留现有主/次版本与后缀，递增编号段。联合 code/node 沿用原构建器的同版本编号。

显式 `--only` 会强制构建指定种类，即使对应状态是 false；默认不选择 full。构建成功且受管源码/种子指纹未改变，才清除对应标记；未选中或失败项保留待出包状态。false 表示已出包，不表示已发布。

构建会修改对应 `app.json` 和状态文件；命令不执行 Git 提交，自动调用方应按项目规则将这些跟踪文件提交并推送。APK/ZIP、报告、锁和中间文件不入 Git。

## 发布后的校验范围与进度

服务发布后，LAN/WAN分别通过HTTP核对签名清单，只完整下载本次发布列表中的包校验大小与SHA-256。`--only=min,code`通常只回读新的min APK和代码ZIP；依赖未更新时不会再通过HTTP下载旧依赖。发布前的本地包、目标已有文件与清单基线核对照常执行。`all`模式校验其全部选择资源；完整APK与独立Node包沿用各自的独立发布流程。

`release:offline`及`publish:offline-update`等服务发布CLI自动显示LAN/WAN清单核对、本次包数量/总大小、文件序号与路径、文件/累计百分比和平均速度、等待数据时长及逐文件大小/SHA-256结果。交互终端每秒在同一行覆盖进度，并随窗口宽度压缩信息，避免长行折行；重定向文件或管道时每10秒追加一行进度，不含光标控制序列。开始、清单通过、文件开始/通过、失败及完成始终立即单独记录。显示“校验完成”后仍需等待清理与最终报告，不要提前视为整次任务成功。

修改仅对新启动的命令生效，已经运行的进程保持原校验流程；本次没有自动停止或重启现有任务。直接调用旧四参数`verifyHttpTarget`的API仍保留全清单检查；发布器会显式传入本次资源范围。

## 中断与恢复

每次实际执行输出 JSON 报告路径，默认位于 `release/offline-update/output/releases/release-*.json`。报告记录选择、分配版本、签名基线、已完成项、不可变文件大小/SHA-256及两端发布结果。

报告是脚本自动写入的进度文件，不需要手工填写。通常只需重新执行原命令，入口会在相同项目、输出目录、发布目标下自动识别最近未完成任务；显式 `--only` 时还要求选择一致。最近任务已完成时，不会自动回头恢复更早被取代的任务。

```bash
# 推荐：直接重新执行原命令，自动识别，不需要报告路径
npm run release:offline
npm run release:offline -- --publish

# 也可明确要求自动识别
npm run release:offline -- --resume --publish

# 构建中断：校验并复用已完成项，未完成项仍按原版本号构建，不升号
npm run release:offline -- --resume=/绝对路径/release-报告.json

# 出包完成后发布，或发布中断后重试；完整出包报告不会重新升版/构建
npm run release:offline -- --resume=/绝对路径/release-报告.json --publish

# 只看恢复计划
npm run release:offline -- --resume=/绝对路径/release-报告.json --dry-run

# 代码已经改变或希望放弃旧任务：清理旧报告及未发布包，沿用最近任务原版本号重新出包
npm run release:offline -- --fresh --only=min,code --publish

# 需要新版本：忽略自动恢复，按最大编号加一创建任务
npm run release:offline -- --new --only=min,code --publish
```

`--fresh` 会删除同项目、输出目录和发布目标的旧任务报告，以及报告关联的未发布版本化 APK/ZIP。先保存独立版本高水位及新报告，重建沿用最近任务各包已分配的版本号；其他新任务仍避开历史编号。只清理产物输出根中的严格数字版本普通文件；不递归删除，也不清理 profile 原始输出、Node种子/修复ZIP、配置、模型、任务或结果。

`--resume` 与 `--fresh` 都不升号。原号重建必须先证明版本在两端尚未发布；已经上传、已被清单引用或状态无法确认时会停止，请用 `--new` 创建新版本。`--fresh` 没有旧任务编号或新增种类在旧任务中无编号时，也会停止；不自动编造新编号。仅清理且无待出包项时不构建。

已发布记录、LAN/WAN当前签名清单引用、LAN实际目录存在、WAN经SSH确认存在或公网HTTP非404，均保留；状态无法确认或摘要/文件改变也保留，原因记入新报告。旧报告及同ID基线/full构建元数据最后删除，清理中断时可自动补齐。`--fresh --dry-run` 只列候选，正式执行才核对发布状态并删除。

Ctrl+C、SIGTERM 或终端正常关闭时，入口请求停止命令/网络，等待当前步骤退出，保存报告后释放锁。已完成产物保留；版本号不回退；尚未完成的操作保持待出包。发布前后可能只成功了一个目标，不回滚已经生效的发布，恢复时重新校验并补齐另一端。

SIGKILL、断电或系统崩溃无法执行退出清理，可能留下 `.release-offline.lock` 和构建子进程。先查看锁内 PID，确认原入口、npm/Gradle/归档及发布子进程都已退出，再手工移除该精确锁文件，使用原报告恢复。入口不会自动删除未知锁、接管旧进程或清理临时文件。

源码、候选签名或产物已改变会拒绝继续旧报告；目标出现其他新组件时拒绝覆盖其清单。清理失败返回非零退出码，报告保留可重试错误；已生效发布不回滚。使用输出目录锁约束本入口；既有手工发布脚本使用前也需避免交叉运行。

## 路径和工具参数

```bash
npm run release:offline -- --only=min,code --dry-run \
  --manifest-file=/mnt/aasc-offline/manifest.json \
  --output-dir=/mnt/AASC/release/offline-update/output \
  --local-root=/mnt/aasc-offline \
  --remote-dir=/home/as/a/aasc-offline
```

默认以 LAN 当前签名清单为构建基线，同时读取 WAN 清单/完整 APK 索引预留版本。指定 `--manifest-file` 后使用指定基线，并跳过出包计划中的 WAN 查询，可离线预览；实际发布仍校验目标基线。Node 默认计划额外经 SSH 查询 WAN 版本文件。

`--local-verify-url`、`--remote-verify-url` 可指定两端 HTTP 校验根；构建依赖可传 `--dependency-roots=JSON文件` 和 `--node-abi=数字`。APK 优先使用 `AASC_APKSIGNER`/`AASC_AAPT`，未设置时查找 `ANDROID_HOME`（默认 `/opt/android-sdk`）最新 build-tools，再回退 PATH。恢复使用报告中的原路径/目标，不允许覆盖这些参数。

退出码：`0` 为成功、预览或无需出包；`1` 为失败，包括可重试清理错误。加 `--publish` 时，即使待出包状态已全部清除，也会自动识别最近尚未发布的完整报告；没有合适报告且没有待出包项时才提示无需出包。
