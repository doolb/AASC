# 独立任务代码更新

源码已支持，正式签名包和设备迁移尚未完成。本轮配置的支持版为 min58、服务最低96/API1；首批任务中的 win-monitor 要求依赖组合10和选择清单记录的锁指纹。正式出包前先核对 LAN/WAN 当前版本；已占用版本须递增。

## 首次迁移

1. 在持有签名密钥的出包机准备支持任务上下文的桥接服务，以及 min58 或后续支持版。无 taskCode 指针时仍使用原任务目录。
2. 设备覆盖安装支持版 min，加载桥接服务并确认健康。
3. 发布首个任务 ZIP。设备更新时校验服务/API、APK和依赖约束，切换完整组合并重启一次 Node，显示端重连后收到当前任务代码。

旧 min56/57 不会因服务热更而获得原生任务包安装能力。正式任务 ZIP 不写入原任务数据目录；已有配置、参数、实例、结果和日志保留。

## 后续仅任务变更

修改 `res/tasks` 的生产代码及 `release/task-code-files.json` 的显式文件/兼容要求，将 `release/offline-release-status.json` 的 `taskCodePackage` 标记为 true。服务和依赖要求不变时无需重建它们。

```sh
npm run build:offline-update -- --mode=task-code-only --task-code-version 2
```

构建器基于当前签名清单，输出 `task-code/task-code-v2.zip` 和 `manifests/manifest-task-code-v2.json`。示例版本必须替换为未使用的递增版本。引用的服务、任务API或精确依赖不兼容时构建失败。

服务也需更新时，可使用现有 `--mode=code-only --code-version N --task-code-version T` 联合构建；依赖集合变化使用 `--mode=all` 并提供相应依赖版本/构建输入。沿用任务时也会校验新服务是否仍兼容。

通过 `npm run publish:offline-update -- --mode=task-code-only` 和既有发布目标参数发布，清单路径指向本次签名任务清单；只上传任务ZIP，最后原子切换清单。任务专用发布会核对目标当前清单，其他组件引用变化后必须重新构建。LAN/WAN 独立发布和校验；`npm run sync:offline-update` 已包含可选任务组件。

设备已有服务和依赖满足要求时，只需下载变化的任务 ZIP；落后的设备按同一清单补齐服务/依赖。健康检查失败恢复完整旧组合。任务更新包含一次服务重启，会短暂重连。

## 代码和数据

- 首批四任务六文件来自 `res/tasks`；`release/task` 只作首次启动种子。
- 官方任务代码只读；需要自定义时复制为不同任务名。配置、参数、运行/停止和实例操作沿用现有入口。
- 显式退役名称保留墓碑，旧种子代码不会重新生效，历史数据保留。
- 服务版本诊断的 `versions.taskCode` 返回实际版本、路径、摘要、API和组合身份，供核对生效来源。
- 当前六个文件源码共31,019字节；按构建器压缩参数测得样包13,119字节，正式大小以签名清单为准。

## 验证

```sh
npm run test:task-code-sync
```

Android 使用项目 Gradle 的 `:app:testDebugUnitTest`。定向用例覆盖兼容性、签名/文件异常、只读保护、有效代码读取、任务单独更新预算、完整回滚和同实例20次重载释放；真实设备更新流量、重连耗时和画面需在发布支持版后验收。
