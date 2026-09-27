# Node Offline min 更新运行器实现规范

## 启动和初始化

```text
node release/allserver-min.js [--root <项目根目录>]
    校验 Node.js >= 20.18.1；生产建议使用 Node.js 24 LTS
    仅依赖 Node.js 内置模块；不要求本地源码、package.json 或 node_modules
    解析数据根目录；若脚本目录名为 release，则使用其上级目录
    读取 UPDATE_BASE_URLS/manifest.json，校验 RSA-SHA256 签名和 components.code
    验证可选 components.nodeMinSeeds 字段
    如果有 nodeMinSeeds:
        下载 relativeUrl 指向的 ZIP 到 updates/allserver-min/downloads/
        校验下载字节数和 SHA-256 与签名清单一致
        使用安全 ZIP32/Deflate 解压到唯一 staging 目录
        只接受 config、userconfig、task 三个顶层目录
        逐文件合并到 projectRoot/release；已有文件不覆盖
        将 task/*/results/latest 文本标记恢复为平台适用的链接
        原子记录 release-seeds.json 中的版本与 SHA-256
    如果清单没有 nodeMinSeeds:
        本地 release/config/config.json、release/userconfig、release/task 均存在时继续
        否则提示先发布包含 nodeMinSeeds 的 Offline 清单
    读取并验证 active-release.json
    如果没有活动版本:
        从相同签名清单下载 code ZIP
        校验大小、SHA-256、ZIP 路径和 CRC32
        检查 server-app.js、package.json、package-lock.json
        校验 package-lock.json 等于 code.requiredLockSha256
        使用 ZIP 内 package manifest 在目标机运行 npm ci --omit=dev --ignore-scripts
        启动服务并等待 serverReady 后更新活动版本指针
    定时检查同一 Offline manifest；新代码安装完毕后切换版本
    新代码未通过健康检查时恢复 previous 版本
```

## 下载约束

- 仅允许 HTTP/HTTPS 更新源；manifest 由固定 Offline 公钥验签。
- `relativeUrl` 必须是相对路径，解析后的地址仍须位于配置源的同源目录内。
- `nodeMinSeeds.size` 最大 64 MiB；下载流超过清单大小时立即中止。
- ZIP 拒绝路径穿越、重复路径、符号链接和特殊文件；只允许 `config/`、`userconfig/`、`task/` 根项。
- 下载 ZIP 先写入临时文件；SHA-256 校验成功后才作为有效缓存使用。

## 原子性和数据保护

- 下载、解压都在 `updates/allserver-min/` 下进行，不把暂存文件写入 release 目录。
- 种子只创建缺失文件；普通文件、已有目录以及已有 `results/latest` 不覆盖。
- 当前本地应用种子版本高于服务端回退版本时不降级；本地 release 目录不完整则报错。
- 活动代码指针通过同目录临时文件和 rename 写入；保留 `previous` 以支持回退。
- 更新器不删除配置、模型、日志、用户文件、任务结果或 Android 更新目录。

## 发布流程

```text
npm run build:offline-update -- --mode code-only --code-version <版本>
    从 release/config、release/userconfig、release/task 生成 node-min-seeds ZIP
    将 nodeMinSeeds 与 code 一起签入同一 manifest

npm run publish:offline-update -- --mode code-only --manifest-file <清单>
    校验待发布 ZIP
    上传 nodeMinSeeds 和 code
    最后发布 manifest.json

npm run sync:offline-update
    同步 code、nodeMinSeeds、dependencies、apkMin 和 dataRepair
```

`--mode all` 同时构建/发布 dependencies ZIP。Node min 不下载该依赖 ZIP，而在 Windows/Linux 目标机按 code ZIP 的 package lock 安装依赖。

## 手动验收场景（本规范不代表已执行）

- 新空目录可从签名清单下载并校验种子 ZIP，再初始化配置和任务并安装 code ZIP。
- 本地已有文件不覆盖；缺失的默认文件可从服务器 ZIP 补齐。
- 旧清单在本地 release 数据完整时可以继续启动；无本地数据时给出发布要求。
- 签名错误、大小/hash 不符、恶意 ZIP 路径或 ZIP 根目录多出项目均不得写入 release。
- Windows x64 和 Linux x64 启动、热更新、自动重启和回滚仍需在目标机现场验收。
