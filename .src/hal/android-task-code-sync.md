# Android 独立任务代码更新

## 已有声明

- 引用 OfflineUpdateManifest、OfflineUpdateManager、OfflineBootstrapManager 和 NodeServerService // 继续由原生统一管理更新事务

## 新增定义

- TaskCodeArtifact { artifact, codeRange, apiVersion, dependencyVersion, lockSha256, requiredApkVersionCode } // 与签名字段保持一致
- ReleaseTuple { code, dependencies, taskCode, previous, pendingHealth } // 回滚必须包含全部组件
- LaunchTaskCodeContext { directory, version, archiveSha256 } // 每个进程固定自己的任务代码身份

## 操作流程

- 解析可选 taskCode 组件并校验服务与依赖约束 // 旧指针无任务包时继续兼容路径
- 已验签来源的服务或依赖版本低于本机时先判为过期 // 忽略旧源缺少taskCode，保留同版/新版移除拒绝规则
- 计算变化组件集合，任务单独改变时不下载 code/dependencies // 独立文件也应独立复用
- 原生更新提示显示任务版本，任务专用候选显示“任务代码更新”标题 // 同服务版本时仍能识别变化内容
- 校验 APK 最低版本，下载并安全解压任务 ZIP 到独立版本目录 // 不修改 res/tasks
- 在所有候选目录就绪后原子写完整 pending 组合 // 避免部分组件提前启用
- 以同一启动组合注入任务目录、版本及摘要并验证实际服务健康 // 不让旧进程或错误路径冒充成功
- 健康失败时恢复完整 previous 并重启 // 不能只退代码留下新任务或依赖
- 对活动、候选和回滚引用执行精确保留 // 配置、模型、用户任务与链接不受清理影响

## 实现映射

- 并入 src/apps/android-display/app/src/main/java/com/aasc/display 下的现有更新器和服务
- 将任务包校验与契约集中到 OfflineTaskCode 辅助模块 // 避免在原更新器继续堆叠大型条件分支
