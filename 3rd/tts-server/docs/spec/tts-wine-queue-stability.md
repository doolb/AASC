# Wine TTS 队列与稳定性实现伪代码

## 请求数据

```text
WineTask {
  type: tts 或 voices
  text: 文本
  voice: 语音名
  speed: 语速
  response: HTTP 响应
  queuedTimer: 排队超时计时器
  started: 是否已绑定 worker
  cancelled: 是否已断连取消
}
```

## 队列流程

```text
收到 HTTP 请求
  如果文本为空 -> 返回 400
  如果响应已销毁 -> 丢弃任务
  如果队列达到上限 -> 返回 503
  创建 WineTask 并加入 FIFO 队列
  启动排队超时计时器
  drain()

drain()
  当队列非空
    查找 ready 且 idle 的 WineWorker
    如果没有 -> 等待 worker ready 或任务完成
    从队列取出一个任务
    清理排队超时计时器
    如果响应已销毁 -> 继续下一个任务
    标记任务 started
    将任务和当前 worker 传给处理函数
    处理成功/失败后释放 worker
    继续 drain()
```

## TTS 处理流程

```text
handleTts(worker, task)
  audio = worker.synthesize(task.text, task.voice, task.speed)
  如果响应已销毁 -> 丢弃 audio
  设置 audio/wav 响应头
  返回音频字节
  finally -> worker.busy = false，继续 drain()
```

## 队列状态输出

```text
status = {
  queueLength,
  workerCount,
  readyWorkers,
  workers: [{ name, ready, busy, pending }],
  maxQueueLength,
  queueTimeoutMs
}
```

## 实测结果

```text
textChars = 100
total = 100
concurrency = 3
success = 100
errors = 0
tps ≈ 0.55
avg ≈ 5434ms
p95 ≈ 6809ms
p99 ≈ 8302ms
rss.ready ≈ 269552KB
rss.peak ≈ 521776KB
rss.final ≈ 429924KB
rss.delta ≈ +160372KB
queue.final = 0
worker.finalBusy = 0
```
