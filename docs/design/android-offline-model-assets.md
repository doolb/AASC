# Android offline 模型资产按需加载设计

## 状态

2026-09-16 已实现并完成真机验证。offline APK 保留内置 MNN 模型能力，Node Runtime 只携带模型元数据；显示端按需物化模型。`.mmap` 的生成和存储方式不在本次范围。

## 需求

- offline APK 继续内置 profile 选定的 LLM 模型。
- Node Runtime 安装器只解包服务器代码、配置、任务、语音模型和轻量模型元数据，不解包 LLM 权重。
- LLM 权重作为独立 APK asset 保留，显示端首次需要推理时按选定模型复制到显示端私有模型缓存。
- MNN 当前仍从普通文件目录加载，显示端缓存路径必须稳定、可校验、可原子替换。
- offline Node 服务的模型清单要把已内置模型报告为 ready，使 `/v1` 继续把请求路由到显示端；服务端不因本地没有权重而尝试下载或执行推理。
- 已安装旧版本升级时，旧的 `aasc-server/res/models/llm/<model>` 只随 Runtime 目录替换被移除，不删除用户的在线 `files/models/llm/active` 缓存。

## 设计

```text
APK assets
├── runtime-manifest.json
├── offline-model-manifest.json
├── display-models/<modelId>/<file>       # LLM 权重和配置，仅显示端使用
└── server/res/models/...                  # Node 运行所需资源，不含 LLM 权重

filesDir
├── aasc-server/                          # Node Runtime；不包含 bundled LLM 权重
│   └── offline-model-manifest.json
└── models/llm/
    ├── bundled/<modelId>/                 # 显示端按需物化的一份模型缓存
    ├── active/                            # 在线模型下载缓存，保持原语义
    └── state.json
```

打包器将 `runtime-manifest.json` 分成两类输入：`files` 是安装器需要解包和校验的文件，`modelAssets` 只记录 APK asset 的大小和 SHA-256，不参与 Node Runtime 目录复制。`offline-model-manifest.json` 使用模型 ID、revision、asset 前缀和逐文件元数据描述显示端资产。

显示端加载内置模型时：

1. 从 `AssetManager` 读取 `offline-model-manifest.json`，确认目标模型是 profile 内置模型。
2. 如果 `files/models/llm/bundled/<modelId>` 已通过 marker、大小和 SHA-256 校验，直接复用。
3. 否则先创建 `files/models/llm/bundled`，再将 `display-models/<modelId>/` 的文件写入同级临时目录，逐文件校验后生成 `.manifest.json`，再原子切换为 bundled 目录。
4. MNN 从 bundled 普通文件目录加载；`.mmap` 继续由 `MnnLlmEngine` 写入该目录下的外部缓存位置，不提前生成。

服务端 `LlmModelManifestService` 在 offline 模式读取随包元数据，将元数据声明的模型标记为 ready。该 ready 只代表“显示端可从 APK 物化”，不代表 Node 文件系统存在模型权重；下载接口仍要求服务端实际缓存完整，避免把元数据 ready 错当成本地文件下载能力。

## 非目标

- 本阶段不重写 MNN native 文件加载器，不直接从 Android AssetManager 的 fd/offset 推理。
- 本阶段不预生成 `.mmap`，也不改变在线模型 `active` 缓存。
- 不删除 `files/models` 下由在线模式或用户操作产生的模型目录。
