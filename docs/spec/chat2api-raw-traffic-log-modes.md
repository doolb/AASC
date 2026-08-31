# Chat2API 原始流量日志模式实现规范

## 配置伪代码

```text
chat2apiConfig:
    rawTrafficMode = "full"

saveConfig(input):
    如果 rawTrafficMode 不在 ["full", "compact"]:
        返回配置错误
    保存 rawTrafficMode
```

## 日志伪代码

```text
createRawTrafficLogger:
    createHttpClient({ mode }):
        normalizedMode = mode 或 "full"
        createTrace(request):
            如果 normalizedMode == "compact":
                emit request { model: extractModel(request), text: extractText(request.data) }
            否则:
                emit 完整请求 URL、headers、data

        request(requestConfig):
            trace = createTrace(requestConfig)
            response = 原始 HTTP 请求(requestConfig)
            如果 normalizedMode == "compact":
                如果 response.data 是流:
                    透传流并聚合可解析的最终文本
                    流结束后 emit response { output }
                否则:
                    递归提取 choices、messages、data.messages 等结构
                    emit response { output: extractOutput(response.data) }
            否则:
                记录状态、headers、响应体或原始流块
            日志异常不能影响 response

        聚合流:
            按 maxBytes 限制仅在内存中暂存待解析的流
            按 content-encoding 解压 gzip、deflate 或 br
            SSE 的 delta 按顺序拼接，累计式 messages 取最长结果
            解析失败时不输出原始二进制内容
```

## 控制端伪代码

```text
render(config):
    渲染 rawTrafficMode 下拉框
    选项 = 完整模式 / 简洁模式

saveConfig():
    提交 debugRawTraffic、rawTrafficMode、rawTrafficMaxBytes
    提示下一次 Provider 请求生效
```

## 测试契约

```text
默认配置 -> rawTrafficMode == "full"
compact 非流式 -> 只有 request(model,text) 和 response(output)
compact SSE -> 不产生 response_chunk，结束时输出聚合 output
compact 压缩 SSE -> 解压后输出文本，不泄露 URL/headers
非法 rawTrafficMode -> 拒绝保存
```
