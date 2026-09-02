# 服务器重启命令实现规范

## 配置解析伪代码

```text
DEFAULT_SERVER_URL = 'https://192.168.1.39:8081'

resolveServerUrl(environment, commandArguments):
    commandUrl = commandArguments 的第一个非空参数
    environmentUrl = environment.AASC_SERVER_URL 去除首尾空白
    如果 commandUrl 存在:
        返回 commandUrl
    如果 environmentUrl 存在:
        返回 environmentUrl
    返回 DEFAULT_SERVER_URL

buildRestartUrl(serverUrl):
    解析 serverUrl
    如果没有协议:
        报告地址格式错误
    返回 serverUrl 去除末尾斜杠 + '/api/restart'
```

## 请求流程伪代码

```text
restartServer(serverUrl):
    restartUrl = buildRestartUrl(serverUrl)
    根据 restartUrl 协议选择 Node 原生 http 或 https 模块
    创建 POST 请求
    不读取 HTTP_PROXY/HTTPS_PROXY，不设置代理 Agent
    HTTPS 使用项目自签名证书兼容选项
    设置 Content-Type=application/json 和响应超时
    发送空 JSON 请求体
    收集响应文本
    响应状态为 2xx:
        解析 JSON 或保留文本
        输出重启结果
        返回成功
    其他状态:
        输出 HTTP 状态和响应内容
        返回失败
    网络错误或超时:
        输出明确错误
        返回失败
```

## npm 注册

```text
package.json scripts.restart:server:
    node scripts/ops/restart-server.js
```

## 双进程启动器伪代码

```text
启动器 main:
    stopping = false
    restartRequested = false
    child = spawn(server-app.js, { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] })

    child.on(message):
        如果 message.type == 'restartRequested':
            restartRequested = true
        如果 message.type == 'serverReady':
            crashCount = 0

    child.on(exit):
        如果 stopping:
            退出并返回子进程退出码
        如果 restartRequested:
            restartRequested = false
            清理旧子进程引用
            重新启动 server-app.js
        否则:
            记录异常退出
            crashCount 加一
            如果 crashCount 小于 5:
                延迟 1000 毫秒重新启动
            否则:
                以非零码退出

    收到 SIGINT 或 SIGTERM:
        stopping = true
        向 child 转发相同信号
        等待子进程退出，不再触发自动重启
```

## 服务器重启伪代码

```text
POST /api/restart:
    返回 { status: 'success', message: '服务器正在重启...' }
    如果存在 IPC 通道:
        向启动器发送 { type: 'restartRequested' }
    否则:
        执行兼容的优雅退出，不自行 detached 启动新服务器

主动重启关闭流程:
    关闭所有 WebSocket 客户端
    停止 TUI 并恢复控制台状态
    关闭 Chat/Agent 等受管运行时
    退出当前服务器子进程
```

## TTY 约束

- 启动器必须保持前台，不调用 `unref()`，并持续占有父级终端生命周期。
- 服务器子进程的标准输入、输出和错误流继承启动器，TUI 仍由服务器进程渲染。
- `useTUI = commandArguments 包含 '--tui' 且不包含 '--no-tui'`；默认启动不创建启用状态的 TUI，显式传入 `--tui` 才显示控制台界面。
- 重启时先调用 TUI 销毁逻辑，再退出子进程；新子进程重新初始化 TUI，但终端设备不改变。
- 启动器收到外部停止信号时禁止自动拉起新子进程，避免 Ctrl+C 无法真正退出。
