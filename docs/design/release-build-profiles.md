# Release 配置与 APK 构建 profile 设计

## 目标

为服务器和 Android APK 建立统一的 release 输入边界，让服务器可以通过 `npm start -- --release` 使用并保存发布配置，同时让三个 APK 构建 profile 使用各自的 `release/apkbuild` 目录保存中间文件，并按配置选择内置功能和模型。

## 构建 profile

已有目录作为固定 profile，不改名、不合并：

| profile | 命令 | 内容 |
|---|---|---|
| `noserver` | `npm run build:apk:noserver` | 只有显示端，不内置或启动 Node 服务 |
| `withserver` | `npm run build:apk` | 普通 APK，内置 Node 子服务器 |
| `allserver` | `npm run build:apk:offline` | Offline APK，内置本机 Node 主服务、任务和选定模型 |

每个 profile 的构建输入和中间产物只允许写入对应的 `release/apkbuild/<profile>/`，包括配置、服务器运行包、Runtime assets、Gradle 目录和最终输出，不能与其他 profile 共用可变目录。

## 服务器 release 模式

- 不带 `--release` 时保持当前读取路径：`config/`、`~/.config/aasc-user/` 和 `res/tasks/`。
- 带 `--release` 时使用 `release/config/`、`release/userconfig/` 和 `release/task/`，配置和任务运行结果直接保存回 release 目录，便于配置完成后直接制作 APK。
- 发布目录至少需要 `config/config.json`、用户配置目录和任务目录；路径缺失时明确失败，不静默回退到开发目录。

## APK 输入配置

每个 profile 使用 `release/apkbuild/<profile>/app.json`，只描述 APK 内容，不再声明任务列表：

```json
{
  "schemaVersion": 1,
  "embeddedNode": true,
  "features": ["llm", "asr", "tts", "render-display"],
  "models": ["qwen3.5-0.8b-claude-opus-distilled-mnn", "sensevoice", "tts"]
}
```

- `embeddedNode` 决定是否打包和启动 Node 服务；`noserver` 必须为 `false`。
- `features` 是 APK 的能力声明，随 profile 元数据进入运行包，用于运行时/发布检查；Gradle 原生依赖不按 feature 删除，避免裁剪导致启动缺库。
- `models` 使用模型 manifest 或模型目录清单中的稳定 ID，构建器根据 ID 收集完整文件并生成最终 manifest，不再依赖单一硬编码模型白名单。
- `noserver` 不允许配置模型；`withserver` 和 `allserver` 可以分别声明空模型列表或需要内置的模型 ID。
- 任务不在 `app.json` 选择。release APK 包含 `release/task` 中的任务定义和 `results`，首次启动由 `results/index.json` 中 `mode=service` 且 `status=running` 的实例决定恢复哪些服务。

## 任务结果与首次恢复

`release/task/<name>/results/index.json` 保存实例 ID、状态、参数和任务元数据；`results/<instanceId>/` 保存日志与输出文件。构建器保留这些文件，并将 Android assets 不支持的 `results/latest` 软链接转换为可恢复的 marker，安装器在私有目录中重新创建软链接。服务启动后沿用 `TaskManager.restoreAutoStartServices()` 恢复预先标记为 `running` 的服务实例。

## 配置传递

- release 服务器直接读写 release 配置。
- APK 将 `release/config` 和 `release/userconfig` 作为首次安装种子；已有 APK 用户数据不覆盖。
- `release/task` 的定义、实例索引、日志和输出进入 APK 的运行目录；安装后这些目录变为可写运行数据。Android assets 不支持隐藏文件和软链接时，`.task-links.json`、`results/latest` 使用 marker，在首次安装后恢复。
- `noserver` 不生成服务器运行包、Runtime、任务和模型资产，仅读取自己的 `app.json`，保留显示端访问主服务器的能力；因此不要求 release 服务器任务目录可用。

## 失败处理与兼容性

- profile 配置 JSON、模型 ID、任务结果索引格式或 release 输入目录无效时，构建阶段失败并说明具体路径。
- 旧命令 `npm start` 和没有 profile 参数的开发服务器行为保持不变。
- `build:apk`、`build:apk:offline` 默认走 release 输入；新增 `build:apk:noserver` 使用 `noserver` profile。
- Gradle/AAR 原生依赖暂不按 feature 删除；feature 负责运行包、任务和模型资源选择，避免缺少 native 库导致 APK 启动失败。
