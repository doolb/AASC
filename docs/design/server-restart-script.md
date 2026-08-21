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

## npm 命令

```text
npm run restart:server
AASC_SERVER_URL=https://192.168.1.39:8081 npm run restart:server
npm run restart:server -- http://127.0.0.1:8081
```
