# TTS 失败返回实现伪代码

## 服务端伪代码

```text
定义 sendJsonError(res, statusCode, message, details)
  如果 res 已经发送响应头
    直接返回
  返回 status(statusCode).json({ success: false, error: message, details })

处理 /api/tts 请求
  如果 text 为空
    调用 sendJsonError 返回 400
    结束

  将请求加入队列
  执行生成任务
    调用 balcon 生成 wav
    如果 wav 文件不存在
      抛出“音频文件生成失败”错误
    成功时返回 audio/wav
    失败时调用 sendJsonError 返回 500 和具体原因

处理 /api/voices 请求
  如果读取语音列表失败
    调用 sendJsonError 返回 500 和具体原因
```

## 前端伪代码

```text
调用 /api/tts
  如果响应状态不是成功
    尝试解析 JSON
    优先展示 details
    如果没有 details 则展示 error
    如果 JSON 解析失败则提示服务器错误
    结束

  将响应体按 blob 读取并播放
```
