# 服务端 TTS 稳定性实现文档

## 模块位置

- `src/external/tts/tts-service.js`
- `src/apps/server/modules/config/config-app-service.js`
- `src/apps/server/boot/server-app.js`

## 配置结构

```
tts:
    serviceUrl: string
    defaultVoice: string
    defaultSpeed: number
    requestTimeoutMs: number
    maxErrorBytes: number
```

## 核心流程伪代码

### generateTTS

```
generateTTS(text, voice, speed):
    if text 为空:
        throw 错误

    outputPath = generateUniquePath()
    await callExternalTTS(text, voice, speed, outputPath)

    if outputPath 不存在:
        throw 错误

    return outputPath
```

### callExternalTTS

```
callExternalTTS(text, voice, speed, outputPath):
    初始化 settled=false
    构建 POST JSON 请求

    定义 done(error, resultPath):
        如果已 settled 直接返回
        标记 settled=true
        如果 error:
            删除 outputPath 半成品文件
            reject(error)
        否则:
            resolve(resultPath)

    req = http.request(options, onResponse)
    req.setTimeout(requestTimeoutMs)
    req.on('error', done(error))
    req.write(postData)
    req.end()

onResponse(res):
    if statusCode != 200:
        读取错误体(最多 maxErrorBytes)
        end 时 done(错误)
        return

    writeStream = fs.createWriteStream(outputPath)
    pipeline(res, writeStream, (error) => {
        if error:
            done(写入失败错误)
        else:
            done(null, outputPath)
    })
```

## 配置 API 伪代码

### GET /api/tts/config

```
返回:
    serviceUrl
    defaultVoice
    defaultSpeed
    requestTimeoutMs
    maxErrorBytes
```

### POST /api/tts/config

```
从 body 读取 serviceUrl/defaultVoice/defaultSpeed/requestTimeoutMs/maxErrorBytes
调用 config.setTtsConfig()
调用 tts.init(config.getTtsConfig())
返回 success
```

## 内存与资源回收要点

- 请求超时后立即销毁 socket，避免连接悬挂
- 写入流统一由 `pipeline` 收敛成功和错误路径
- 失败路径删除半成品音频文件
- 错误响应体读取做字节上限控制

## TTS 压测脚本 (src/scripts/tts-stress-test.js)

```
main():
    解析命令行参数:
        --url 服务端地址
        --text 合成文本
        --voice 音色
        --speed 语速
        --total 总请求数
        --concurrency 并发数
        --timeout 单请求超时
        --output-every 输出频率
        --stats-interval 服务端指标采样间隔
        --no-system-stats 关闭服务端指标采样

    如果启用服务端指标采样:
        周期拉取 /api/system-stats
        记录并输出服务端 CPU 与进程内存指标

    启动 worker 并发请求 /api/tts/generate:
        统计 success / failed
        统计平均延迟与最大延迟
        周期输出压测进度和本地进程内存

    压测结束后:
        输出汇总结果
        输出服务端峰值与 RSS/External/ArrayBuffers ASCII 曲线
```
