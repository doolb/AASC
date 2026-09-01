# Android Termux 服务器节点实现文档

## 当前试运行伪代码

```text
准备 Termux Android arm64 设备
    → 检查 Node.js、npm、git、runit 和可用磁盘
    → 创建独立目录 ~/aasc-server-test
    → 同步 AASC 服务端源码、Web UI、配置、资源和锁文件
    → 排除本地 node_modules、Android 构建缓存、日志和无关第三方工程

读取试运行配置
    → 保留原始 config/config.json 副本
    → 将 server.port 设置为 8081
    → 保留 HTTPS 证书和 res 资源目录

安装依赖
    → 通过 Termux npm 执行干净安装
    → 跳过 npm 安装脚本
    → 禁止 Puppeteer 下载浏览器
    → 记录未安装或不可用的原生模块

启动服务
    → runit 读取 aasc-server-test/run
    → 进入 ~/aasc-server-test
    → 启动 npm start -- --no-tui
    → 将标准输出和错误输出写入 ~/.local/state/aasc-server-test/log
    → 服务退出时由 runit 重新拉起

验收服务
    → 请求 https://127.0.0.1:8081/api/status
    → 请求 /upload 和 /display
    → 从局域网请求 https://192.168.1.6:8081/display
    → 检查服务状态、运行时长和重启次数
```

## 端口切换与 code-server 停止伪代码

```text
停止 aasc-server-test runit 服务
    → 写入 code-server 服务目录的 down 标记
    → 停止 code-server runit 服务，不删除其数据

切换 AASC 端口
    → 备份当前 config/config.json 为 config/config.before-port-8081.json
    → 将 server.port 更新为 8081
    → 启动 aasc-server-test runit 服务

验证端口状态
    → 请求 8081/api/status、/upload 和 /display
    → 确认 18081 无监听
    → 确认 code-server 服务状态为 down 且 down 标记存在
```

## 运行时约束

```text
如果运行环境是 Android/Termux:
    使用 Android 可访问的 HOME、PREFIX 和 res 路径
    不假设存在 Linux 桌面浏览器、Wine 或 systemd
    不把 SSH 前台会话作为服务生命周期
    使用 runit 或 Android 前台服务监督 Node 进程

如果模块依赖 ASR、TTS Wine 或 Puppeteer:
    标记节点能力不可用
    保留服务启动
    请求进入时返回明确的能力不可用错误
    不影响 HTTP、WebSocket、媒体和显示端主链路
```

## 现状与正式节点差异

当前实现仅是远端试运行部署，未修改仓库内 Node.js 代码。正式节点需要增加节点配置、主服务器注册、心跳、认证、能力声明、媒体同步和 Android 后台保活的伪代码与实现。
