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

当前试运行部署使用独立 Termux 目录；主服务器已经具备节点注册与心跳接口。本节补充正式节点的 Bootstrap 代码下发、双进程启动和热更新回滚伪代码。认证、媒体同步和 Android 后台保活仍属于后续阶段。

## 服务器代码下发与双进程热更新伪代码

```text
GET /server
    → 构建或读取当前代码包
    → 返回 { version, size, sha256, packageUrl, files }

GET /server/package
    → 以流方式返回当前 gzip 包
    → 只打包 src、package.json、package-lock.json
    → 排除 Android 工程本地目录和语音显示端本地 node_modules
    → 不打包 logs、3rd、node_modules、用户配置、媒体、任务运行数据、模型和证书
```

```text
Bootstrap run
    → 读取节点根目录和 server-app.js 路径
    → 使用 server-launcher 的双进程逻辑
    → 启动器进程 fork 服务进程 server-app.js
    → 服务退出时按既有重启策略处理

Bootstrap update
    → 请求主服务器 /server
    → 下载 packageUrl 到临时文件
    → 校验 Content-Length/manifest.size
    → 计算 SHA-256，必须等于 manifest.sha256
    → 解压到根目录下 staging/<version>-<timestamp>
    → 检查 staging/src/apps/server/boot/server-app.js 和 package.json
    → 调用服务控制器 stop，等待旧服务退出
    → 备份根目录代码到 previous/<timestamp>
    → 合并复制 src 到根目录（保留未随包发布的本地目录），替换 package.json 和 package-lock.json
    → 调用服务控制器 start
    → 轮询 /api/status、/upload、/display、/api/aasc/servers
    → 所有检查通过则完成更新
    → 任一检查失败则 stop、恢复 previous、start，并返回失败结果
```

```text
服务控制器
    → 优先调用 Termux runit 的 sv stop/sv start
    → 若测试环境没有 runsv，则使用注入的直接进程停止/启动函数
    → 不改变 aasc-server-test/run 的 npm start 双进程入口
```
