# 外部资源参考

- 原始参考项目：`/mnt/tmp/autohelper`
- ADB：Android Debug Bridge 命令行工具
- OpenCV：模板匹配和 ORB 特征匹配
- Node.js：`child_process`、`fs/promises`、`path`、`util.parseArgs`
- 测试：Vitest

依赖安装时使用系统 OpenCV，避免由 Node 原生模块自动下载另一份运行库。
