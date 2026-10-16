# Offline 自动出包与发布命令伪代码

## 参数与选择

```text
已有声明 := 现有 APK 构建、Offline 更新包、min APK 包装、完整 APK 独立索引、Node ZIP 构建与发布器
新增定义 := releasePlan { requested, selected, versions, baseline, artifactRoot, targets }
新增定义 := releaseReport { schemaVersion, plan, manifestPath, files, completed, published, cleanupErrors }

解析 only、publish、dry-run、resume、fresh、manifest-file、output-dir、local-root、remote-dir、local-verify-url、remote-verify-url
拒绝未知参数、重复参数、空选择和未知种类
only 未提供 → 按五项 offline-release-status 选择 min/code/deps/task/node
only 提供 → 仅采用显式选择；all 展开六种，包含 full
full 只由显式选择进入；不增加 full 待出包状态
deps 需要同时重建 code；锁指纹变化且选择 code → 加入 deps
根据当前签名清单和任务契约校验联合选择
无选择 → 输出无需出包，成功退出
dry-run → 输出最终选择、必要联动、版本和命令，不写文件、不加载私钥、不出包、不发布
默认执行或无路径 resume → 扫描相同输出目录、项目和目标的最新报告，显式 only 时还需种类匹配
最新报告未完成 → 自动走恢复流程；最新报告 built 且本次 publish → 自动发布既有产物
最新报告已完成 → 不自动恢复更早已被新任务取代的报告
fresh → 忽略自动恢复，开始新任务；旧内容删除范围待用户确认，版本仍避开历史预留编号
自动恢复保留原目标/参数；代码改变或锁存在时明确拒绝，不静默接管
```

## 版本与构建

```text
读取并验证基线签名清单、可用的 full 独立签名索引
读取版本化普通文件、已有候选清单/出包报告预留编号、APK profile 与构建元数据；不跟随符号链接
每种新版本 := max(对应已发布版本、本地已占用版本、配置版本) + 1
读取独立 .release-offline-versions.json 高水位；新计划落盘前先原子保存所有已占用/新分配编号
旧报告即使删除 → 独立高水位仍约束新版本，不重复使用历史编号
full/min 共用 Android 包名 → 两种 APK 从共同最大 versionCode 分配不同递增编号
code 与 node 独立版本递增；联合构建时复用同版本 Node 产物且避开两种本地产物版本
获取输出目录独占锁 → 再次读取基线/状态/计算计划
加载并校验签名密钥 → 保存初始报告与受管源码指纹
先构建并包装 min → 候选清单包含新 APK，任务契约可校验本轮新 min 版本
构建 code/deps/task → 以当前候选清单调用已有 npm script；按选择关闭附带 Node ZIP；读取并验证新签名清单
单独 node → 调用已有独立 ZIP 构建器并以独占版本文件保存
构建 min/full 的共同操作 → 先原子递增对应 app.json 的 versionCode/versionName，再调用已有 npm script
APK 构建失败 → 保留已占用版本和待出包状态；不复用失败版本
min → 用最终服务候选清单调用已有 min 包装器
full → 校验 profile、实际包名/版本、签名、大小和 SHA256，保存版本化 APK 与独立构建元数据
full serviceVersions 使用本轮服务候选清单版本，保证首次安装内置版本与本次代码一致
每个构建步骤成功 → 报告保存不可变产物及 SHA256
只有构建前后受管源码指纹一致且该项构建成功 → 清除该项待出包标记
未选中项、构建失败项、构建期间代码改变项 → 保留原标记；full 不清除 min 标记
```

## 发布与恢复

```text
publish 未提供 → 保存 built 报告、输出恢复发布命令并退出
publish 提供 → 验证报告记录的所有文件仍为普通文件且大小/SHA256相符
服务清单 → 按 selected 模式一次选择实际改变的组件（含分组依赖/任务依赖）
每个发布目标 → 检查当前组件等于构建基线或本次候选；拒绝覆盖其他更新
复用发布器：校验 → 上传版本化文件 → 原子切换签名 manifest → HTTP完整校验 → 精确清理
full → 独立发布 APK 和 full-apk-manifest，不写服务 manifest
node → 独立发布 ZIP/签名元数据，不写服务 manifest
报告逐步保存已发布结果；清理错误写入报告并以非零状态提示可重试
resume 完整出包报告 + publish → 不升版、不重新构建，验证产物后重试发布
resume 未完成报告 → 校验已完成文件/签名候选与源码指纹；复用已完成项，只为未完成项重新分配版本并构建
resume 不带 publish → 补完构建后停止；带 publish → 补完后发布
resume 禁止与 only/manifest-file 混用；采用报告中的目标和最初发布基线
SIGINT/SIGTERM/SIGHUP → 标记停止、取消可取消的命令/网络、等待当前步骤退出、保存报告，再释放锁
正常停止不清除未完成标记；强制杀死/断电可能残留锁，须先确认旧进程/子进程退出，才能手工移除精确锁文件
失败 → 保存阶段、错误及已完成项，非零退出；释放本进程持有的锁
锁已存在 → 拒绝并发；不自动删除其他进程或未知锁
```
