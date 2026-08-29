# 服务器重启命令设计

## 功能需求

提供一个项目级命令行入口，通过服务器已有的控制接口 `POST /api/restart` 重启服务，供开发完成后加载最新代码。

- 默认请求地址为 `https://192.168.1.39:8081/api/restart`。
- 使用 Node.js 原生 `http`/`https` 客户端，不读取或使用 `HTTP_PROXY`、`HTTPS_PROXY` 等代理配置。
- 支持自签名 HTTPS 证书，以适配项目服务器证书。
- 支持 `AASC_SERVER_URL` 环境变量和命令行第一个参数覆盖默认服务器地址。
- 请求成功返回服务端消息；连接失败、HTTP 错误和响应超时输出明确错误并以非零状态退出。

## 边界

脚本只调用控制端重启接口，不查找服务器 PID，不发送进程信号，不直接启动或停止 `server-app.js`。

## 双进程启动与控制台生命周期

服务器运行采用前台启动器与服务器子进程分离的拓扑：

```text
npm start
  └── server-launcher.js（前台常驻，持有启动生命周期和 TTY）
        └── server-app.js（HTTP、WebSocket、业务模块和 TUI）
```

- 启动器使用 IPC 管理服务器子进程，子进程继承启动器的 `stdin/stdout/stderr`，不使用 `detached` 或 `stdio: ignore`。
- `/api/restart` 由服务器子进程通知启动器进入“主动重启”流程；子进程先关闭 WebSocket、TUI 和业务运行时，再退出。
- 启动器只在收到主动重启标记时重新拉起子进程；普通 `SIGINT`/`SIGTERM` 不重启并将信号转发给子进程。
- 子进程退出后，启动器复用同一个控制台 TTY 启动新子进程，解决服务器重启后变为后台进程、控制台绑定丢失的问题。
- 服务器业务状态仍按现有配置和运行时机制处理；本需求不引入 WebSocket 代理，不承诺已有连接零断线。

## npm 命令

```text
npm run restart:server
AASC_SERVER_URL=https://192.168.1.39:8081 npm run restart:server
npm run restart:server -- http://127.0.0.1:8081
```
