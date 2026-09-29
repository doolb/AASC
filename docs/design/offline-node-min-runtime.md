# Node Offline min 更新运行器设计

## 目标

提供一个跨 Windows/Linux 的 Node 启动入口 `release/allserver-min.js`。部署端只需该 JS 文件、Node/npm 和网络。启动器从现有 Offline 签名更新服务下载独立的 `nodeMinSeeds` ZIP，初始化 release 配置、用户配置和任务目录，再下载服务代码并在目标机安装生产依赖。

## 功能边界

### 包含

- 复用现有 Offline `manifest.json` 和 RSA-SHA256 签名；release 初始数据以 `components.nodeMinSeeds` 单独发布，不嵌入 JS。
- `nodeMinSeeds` ZIP 包含 `release/config/`、`release/userconfig/` 和 `release/task/`，其大小和 SHA-256 来自签名清单。
- 下载并验签清单后，启动器校验 ZIP 大小与 SHA-256，再安全解压；只补充缺失文件，不覆盖目标机已有配置、用户配置和任务结果。
- 首次启动和 `package-lock.json` 指纹变化时，在目标机使用 code ZIP 内的 `package.json` 与 `package-lock.json` 执行 `npm ci --omit=dev --ignore-scripts`。
- 更新入口只依赖 Node.js 内置模块；ZIP 安全解压使用内置 ZIP32/Deflate 读取器，不要求目标机预装仓库依赖。
- 服务以 `--release` 模式启动，读取数据根目录下的 `release/config/`、`release/userconfig/`、`release/task/`。
- 代码按版本解压到 `updates/allserver-min/code/`；配置、用户配置、任务数据、日志、上传文件和模型都留在稳定数据根目录。
- 通过版本指针切换服务代码；启动失败时恢复上一版本。

### 不包含

- 不内置 Node Runtime 或生产依赖，不改 Android `allserver-min` APK 构建目录。
- 不新增 LLM 推理、模型下载/缓存/分发，也不调用 Go 或 C# 服务。
- 不改变 Offline APK 的签名密钥和发布目录。`nodeMinSeeds` 是同一签名 manifest 的可选组件，旧 Android 客户端可忽略。

## 构建、发布和运行

1. `npm run build:offline-update -- --mode code-only --code-version <版本>` 或 `--mode all` 同时生成代码包、`node-min-seeds/node-min-seeds-v<版本>.zip` 和包含两个组件的签名 manifest。ZIP 来自仓库的 `release/config/`、`release/userconfig/`、`release/task/`。
2. 通过现有 `npm run publish:offline-update` 发布构建结果。发布器先上传 ZIP 与代码包，最后原子替换 `manifest.json`；同步器也会同步 `nodeMinSeeds`。
3. 部署端准备 Node.js 24 LTS（开发机版本 `v26.8.1`，记录的推荐补丁版本 `v24.21.0`；最低兼容 `20.18.1`），将 `allserver-min.js` 放入可写数据目录并运行 `node release/allserver-min.js`。
4. 启动器从配置的 Offline 更新源读取签名清单并下载初始 ZIP；随后下载并安装 code ZIP，启动服务。后续服务代码更新仍由同一清单驱动。
5. Node Offline min 配套下载资源单独放在外网 `/home/as/a/node-min/`（公网 `http://120.79.245.103/mnt/node-min/`），包括 `allserver-min.js`、`aasc-display-noserver.apk` 和 `aasc-display-withserver.apk`；不得放进 `/mnt/aasc-offline/`。每次修改启动器或重新构建这两种 APK 后，上传对应文件并核对公网 HTTP 状态、大小和 SHA-256。

旧清单没有 `nodeMinSeeds` 时，已有完整本地 release 配置可继续运行；空白目标目录会明确提示服务器需要先发布含 `nodeMinSeeds` 的新清单。

## 持久化边界

- 脚本所在目录作为 `AASC_PROJECT_ROOT`；若脚本位于名为 `release/` 的子目录，则其上级目录作为数据根目录。
- `release-seeds.json` 记录已应用的种子版本和 SHA-256；ZIP 缓存在 `updates/allserver-min/downloads/`。
- 种子逐文件合并，只创建缺失内容；已存在的普通文件和 `results/latest` 链接不替换。
- 版本代码存放于 `updates/allserver-min/code/code-v<version>/`。`active-release.json` 原子记录当前代码与待健康确认的上一版本。
- 启动器和配套 APK 在热更新代码包之外，应单独发布；更新源的签名 manifest 不管理这些下载资源。

## 当前限制

- 首次部署需要访问含 `nodeMinSeeds` 的 Offline manifest/ZIP 和 npm registry 或可用 npm cache/镜像。已有代码版本在更新源故障时继续运行。
- 首次种子会收录 `release/task` 的定义和结果索引；其中 `status=running` 的实例会按服务既有规则尝试恢复。
- Node min 不下载 Android Offline dependencies ZIP；依赖由目标机 npm 按 code ZIP 中的 lock 文件安装。
- 解压器支持当前生成的 ZIP32/Deflate，不包含 ZIP64、多卷 ZIP 或加密 ZIP。
