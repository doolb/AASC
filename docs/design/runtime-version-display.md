# 控制端运行版本显示设计

## 需求

控制端“服务器”面板需要显示当前实际运行的 APK、服务代码、依赖包和显示端版本，便于外网真机确认热更新是否生效，以及定位依赖包版本问题。
同时必须显示 Node 进程实际使用的服务代码路径和依赖路径，避免“版本号显示 v4，但进程仍从旧的根目录加载依赖”这类诊断歧义。

## 版本来源

服务端统一返回 `versions` 对象：

| 字段 | 来源 | 说明 |
|------|------|------|
| `apk` | `AASC_SERVER_VERSION`，无值时回退到 `package.json.version` | APK/服务基线版本标识 |
| `code` | `updates/active-release.json.codeVersion` | 当前热更新服务代码版本；无热更新时回退 `offline-update-client.json` |
| `dependencies` | 当前生效 release 的 `dependencyVersion` | 当前热更新依赖包版本；没有 release 时使用内置基线 |
| `display` | 现有显示端代码版本扫描结果 | 显示端资源指纹/时间戳，沿用已有显示端版本语义 |
| `codePath` | Node 入口文件所在的代码根目录 | 服务进程实际加载的代码路径，可能是热更代码目录 |
| `dependenciesPath` | `AASC_NODE_MODULES_DIR` 或项目根目录 `node_modules` | Node 进程实际解析依赖的目录 |
| `dependencySource` | 当前依赖路径和 release 状态 | `active-release`、`legacy-root`、`bundled-baseline` 或 `package-root` |

热更新指针优先于 APK 内置基线，确保服务重启后控制端显示的是实际生效版本，而不是 APK 打包时的旧版本。

## 展示位置

1. AASC 节点注册 metadata 携带 `versions`，服务器目录接口可直接展示每个节点的版本。
2. `/api/status` 同样返回 `versions`，方便诊断工具读取。
3. 控制端“服务器”面板在顶部显示当前连接节点的版本摘要，并在每个服务器卡片中显示完整版本明细。

## 兼容与发布

- 旧服务端或旧节点没有 `metadata.versions` 时，控制端继续显示原有 `server.version`。
- 路径字段使用服务进程运行时的绝对路径，不根据版本号拼接或猜测；旧节点缺少路径字段时只显示已有版本信息。
- `legacy-root` 仍然显示实际的根 `node_modules` 路径，方便识别兼容模式是否绕过了热更依赖目录。
- 该功能只修改服务代码和控制端静态代码，不改变 APK 原生代码，不需要重新生成依赖包。
- 发布时只增加 code 版本；完整 APK、min APK、模型和依赖包保持不变。
