# MNN 双 runtime 线程配置同步

## 任务描述

真机日志显示 LLM 重载后顶层 `thread_num` 已按控制端配置变化，但视觉模型配置中的 `mllm.thread_num` 仍保留模型目录默认值 4。需要让同一份 LLM CPU policy 同时覆盖文本主 runtime 和视觉/多模态 processor runtime，避免实际推理路径仍使用旧线程数。

## design 需求

- JNI 创建官方 `LlmSession` 主配置时，同时设置顶层 `thread_num` 和 `mllm.thread_num`。
- 两个字段使用同一个 `max(1, LLM policy 总核心数)`，不读取模型目录默认线程数。
- 保留现有推理结束后预检查、下一次推理前最终校验和 native runtime 安全换代逻辑。

## spec 设计

```text
loadMnnModel(modelDirectory, llmPolicy):
  threadCount = max(1, llmPolicy.totalCoreCount)
  sessionConfig.thread_num = threadCount
  sessionConfig.mllm.thread_num = threadCount
  extraOptions.keep_history = false
  extraOptions.mmap_dir = modelDirectory/.mmap
  create official LlmSession(modelDirectory, sessionConfig, extraOptions)
  require dumped top-level thread_num == threadCount
  require dumped mllm.thread_num == threadCount
```

## 受影响的功能模块和代码

- `src/apps/android-display/app/src/main/cpp/aasc_mnn_jni.cpp`：同步写入两个 MNN 主配置线程字段。
- `tests/apk-llm-explicit-thread-count.test.js`：增加双字段同步回归契约。
- `docs/design/android-mnnchat-llm.md`、`docs/spec/android-mnnchat-llm.md`：记录文本和视觉/多模态 runtime 的线程配置约束。

## 自测用例

1. JNI 主配置包含顶层 `sessionConfig["thread_num"]`。
2. JNI 主配置包含 `sessionConfig["mllm"]["thread_num"]`，且值来自同一个 `threadNum`。
3. 原有 LLM policy 变化后的 runtime 换代契约继续通过。
4. 真机重载日志中顶层和 `mllm` 两处线程数随配置同步变化。

## 兼容性测试

- 非视觉文本模型忽略未使用的 `mllm` 配置对象，不改变顶层文本 runtime 行为。
- 视觉/多模态模型使用同步后的 processor runtime 线程数。
- 旧模型配置仍保留其它 `mllm` 字段，只覆盖线程数，不重新下载模型。

## 性能测试

- 只增加一次 JSON 主配置字段写入，不增加推理阶段计算。
- runtime 换代仍只发生在配置变化后的安全时机，不增加正常同配置请求的重建。

## 风险评估

- MNN 模型若依赖特殊的 `mllm` 线程配置，统一 policy 可能降低视觉预处理并行度；这是控制端明确要求的统一线程约束，失败时由已有 runtime 加载错误状态上报。
- 仅修改 APK native 代码，服务端协议和旧显示端兼容行为不变。

## 预计工时

约 20 分钟，包含契约测试、APK 构建安装和真机配置切换验证。

## 实施结果

- 已在 JNI 创建 `LlmSession` 主配置时同时写入顶层 `thread_num` 和 `mllm.thread_num`，两者均来自当前 LLM policy 的 `threadNum`。
- RED：新增双字段同步断言后，旧实现按预期失败；GREEN：`tests/apk-llm-explicit-thread-count.test.js` 4/4 通过。
- 固定 MNN revision 下 Gradle Debug 构建成功，APK 安装到 `192.168.1.6:5555` 并重启加载新 native 库。
- 真机同一 APK 进程 PID `27146` 的下一条请求日志同时显示 `thread_num=2` 与 `mllm.thread_num=2`；服务端请求正常返回，未重新下载模型。
