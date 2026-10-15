# 独立任务代码同步

## 已有声明

- 引用 Offline 更新构建器、签名清单、TaskIO、TaskManager 和任务执行器 // 保持现有发布与任务流程
- 引用 docs/spec/task-code-sync.md 的完整契约 // 用户已确认版本、依赖、回滚和数据保留规则

## 新增定义

- TaskCodeContract { version, requiredCodeVersion, maximumCodeVersion, taskCodeApiVersion, requiredApkVersionCode, requiredDependencyVersion, requiredLockSha256 } // 包身份和兼容要求一起签名
- TaskCodeCatalog { root, manifest, files, managedTaskNames, retiredTaskNames } // 代码与可变任务数据分开定位
- TaskCodeSelection { tasks, retiredTaskNames } // 只同步明确选择的源码

## 操作流程

- 从 res/tasks 读取选择清单，校验普通文件、相对路径、文件类型与容量 // 禁止把运行结果或依赖复制进代码包
- 求逐任务服务版本区间交集并校验 API，聚合一致的依赖版本和锁指纹 // 不能默认新版兼容或忽略任务间冲突
- 生成逐文件摘要、任务 revision 和任务代码包摘要，单独压缩任务 ZIP // 源码和兼容声明一起决定新版本
- 在签名清单登记 taskCode，保留其他组件引用并校验完整兼容组合 // 独立发布不能破坏已发布组件
- 将任务 ZIP 加入发布、镜像和精确清理的已知组件 // 文件先就绪才切换清单
- 读取原生启动上下文指定的任务版本目录并校验内容 // 不以动态指针替换旧进程代码
- 统一读取元数据、执行入口、文件列表、HTTP 和重发的有效代码 // 旧缓存不能绕过受管代码
- 保留原 tasksDir 的配置、参数、结果、任务链和用户输入 // 更新只改变代码来源
- 执行前拒绝受管代码写操作，继续现有实例和配置操作 // 失败检查先于生命周期变更
- 分开 entryPath 与 workDir，按当前 revision 下发任务并释放旧显示端资源 // 相对模块和数据写入各有明确位置

## 实现映射

- 映射共享契约到 src/apps/server/modules/aasc/task-code-contract.js
- 映射打包到 scripts/ops/task-code-package.js 和现有 Offline 构建发布脚本
- 映射有效代码到 src/apps/server/modules/task-engine/task-code-catalog.js 与既有任务 IO/执行入口
