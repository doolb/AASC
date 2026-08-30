# Chat2API 核心上游清单

- repository: `https://github.com/xiaoY233/Chat2API.git`
- version: `1.4.0`
- commit: `59f03ab2988867a4d7bacb97d98f3ee018b0e4d0`
- license: `GPL-3.0`

## 计划纳入的核心路径

- `src/main/providers/`：Provider 定义、模型和账号字段。
- `src/main/proxy/adapters/`：Provider 请求适配器和流式处理。
- `src/main/proxy/forwarder.ts`、`loadbalancer.ts`、`modelMapper.ts`、`stream.ts`：代理转发、路由和响应处理。
- `src/main/proxy/routes/`：OpenAI 兼容路由的协议参考。
- `src/main/proxy/toolCalling/`、`utils/`：工具调用和协议转换。
- `src/main/oauth/`：Provider OAuth 登录适配器和凭据转换。

## 明确排除的路径

- `src/main/index.ts`、`src/main/ipc/`：Electron 主进程和 IPC。
- `src/main/renderer/`、`src/renderer/`：桌面 UI。
- `src/main/window/`、`src/main/tray/`、`src/main/updater/`：桌面窗口、托盘和更新器。
- `electron`：Electron 专属运行时和构建入口。
- Electron 专属 Store、桌面构建配置和独立日志管理。

## 同步规则

1. 先记录上游 commit，再抽取核心源文件。
2. 上游来源文件不直接承载 AASC 业务逻辑，差异放到 `src/apps/server/modules/chat2api/`。
3. 同步后运行 `npm run check:chat2api` 和 Chat2API/AASC 兼容测试。
4. 发布时随本目录提供 GPL-3.0、版权和修改说明。
