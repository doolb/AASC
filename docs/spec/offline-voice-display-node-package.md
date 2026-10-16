# Offline Node 子显示端独立 ZIP 伪代码

```text
构建Offline服务包(codeVersion=N):
    服务源码快照 := src/** - src/apps/android-display/** - src/apps/voice-display-node/**
    服务快照 + package.json + package-lock.json → code/code-vN.zip

    appRoot := src/apps/voice-display-node
    校验 appRoot、package.json、package-lock.json、main.js 为普通路径
    遍历 appRoot:
        排除根 config.json、run-task/logs/models/results/temp/tmp/.cache/**、任意 node_modules/.bin/**
        若遇符号链接或特殊文件 → 构建失败
    其他普通文件按原相对路径复制到临时快照（含README与config.example.json）
    要求 node_modules 与应用入口存在
    另复制 src/framework/observability/system-monitor.js 与 console-redirect.js
    临时快照 → voice-display-node/voice-display-node-vN.zip
    zip测试通过后计算 size 与 SHA-256
    payload := {schemaVersion, component, version:N, source, relativeUrl, size, sha256}
    metadata := {payload, OfflineRSA签名(payload)}
    验签 metadata 并原子输出 voice-display-node/voice-display-node-vN.json

发布Node子显示端(version=N):
    读取 ZIP 与 sidecar，拒绝链接、越界路径、版本/路径不匹配
    验证 Offline RSA 签名、ZIP完整性、文件大小与SHA-256
    对 LAN 与 WAN 分别执行:
        以临时文件上传 ZIP 与 sidecar
        校验临时文件SHA-256后原子改名为严格版本文件名
        通过 HTTP 读取 sidecar 与 ZIP，校验签名/大小/SHA-256
        仅删除目标 voice-display-node/ 下严格匹配数字版本的普通旧ZIP/JSON
        保留当前版本；不得改写服务 manifest.json

安装 := 用户手工验证sidecar → 解压ZIP到项目根目录 → 按README配置并启动
自动更新客户端 := 不读取voice-display-node组件或sidecar；不会下载或安装该ZIP
待产物状态 := 服务代码变化时 servicePackage=true 且 voiceDisplayNodePackage=true
成功生成且覆盖最新提交后 := 对应状态设false；失败或内容未覆盖时保持true
```

自测入口：`npm run test:offline-voice-display-node` 与现有 `npm run test:task-code-sync` 的打包/发布相关用例。
