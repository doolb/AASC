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
    node src/scripts/restart-server.js
```
