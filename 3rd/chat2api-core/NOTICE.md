# Chat2API 移植说明

本目录包含从 Chat2API 项目抽取的核心 Provider、代理协议和 OAuth 代码，来源版本为 `1.4.0`，上游 commit 为 `59f03ab2988867a4d7bacb97d98f3ee018b0e4d0`。

Chat2API 以 GPL-3.0 发布，完整许可证见同目录 `LICENSE`。移植代码的版权、许可证和对应源代码必须随 AASC 发布；AASC 适配代码与上游来源文件分开维护。

AASC 不加载 Chat2API 的 Electron、React、IPC、窗口、托盘或更新器模块，也不依赖 `/mnt/Chat2API` 运行。

DeepSeek PoW 所需的 `sha3_wasm_bg.7b9ca65ddd.wasm` 已随 AASC 适配资源复制并独立加载；运行时不读取 `/mnt/Chat2API` 中的同名文件。
