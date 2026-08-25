# Wine TTS SDK RSS 稳定性实现伪代码

## worker synthesizer 与进程生命周期

```text
每个 synthesize 请求:
    config.setSynthesisVoice(voice, license)
    synthesizer = createSynthesizer(config)
    ssml = buildSsml(text, voice, speed)
    result = synthesizer.speakSsml(ssml)
    从 result 读取 WAV 数据
    release(result)
    release(synthesizer)
    返回 WAV 或错误

worker 完成一个 S 请求后:
    completedRequests += 1
    如果 maxRequests > 0 且 completedRequests >= maxRequests:
        ready = false
        recycleAfterTask = true

run(task):
    标记 runActive = true，执行完整 HTTP 任务
    如果 recycleAfterTask:
        kill 当前 Wine 子进程并延迟重启
    finally:
        runActive = false，继续 drain FIFO 队列
```

## RSS 回归测试

```text
启动 Node/Wine worker 子进程并等待 READY
readyRss = 统计 worker 及其 Wine 子进程 RSS
重复 N 次（默认 30）:
    发送固定 100 字、同一 voice 的 S 请求
    断言响应成功且包含音频
    记录当前进程树 RSS
finalRss = 最后一次 RSS
断言请求成功数 == N
断言 finalRss - readyRss 小于回归阈值
无论断言结果如何，关闭 worker 并等待退出
```
