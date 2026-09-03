# AutoHelper Node.js OCR 辅助

## 任务描述

在现有 Node.js 图片流程中接入 `/mnt/AASC/scripts/api` 对应的 AASC OCR 接口，为图片节点增加 `ocr@文字` 附加条件。OpenCV 继续负责模板匹配和点击位置，OCR 只负责确认当前画面文字。

## Design 需求

- 文件名使用 `图片@阈值,ocr@文字,goto@目标Flow.png`。
- 当前 Flow 只要存在 OCR 条件，每轮截图调用 OCR 一次，结果供所有候选共享。
- OCR 失败时返回 `ocr-error`，本轮不点击，下一轮继续。
- 支持 `--ocr-url`、`--ocr-short-side`，显示器由 OCR 服务调度，并兼容 `AASC_URL`、`AASC_INSECURE`、`AASC_TIMEOUT_SECONDS`。
- 第一版不实现纯 OCR 节点和 OCR 文字框中心点击。

## Spec 设计

```text
parseImageDescriptor(): 解析 ocr@value -> descriptor.ocrText
OcrClient.recognize(frame): POST JSON 到 /api/vision/ocr 并解析 boxes
selectAction(..., ocrResult): 过滤不包含目标 OCR 文本的候选
AutomationLoop.tick(): 当前 Flow 有 OCR 条件时对同一截图请求一次
```

## 受影响的功能模块和代码

- `src/types.ts`
- `src/flow/filename-parser.ts`
- `src/vision/ocr-client.ts`
- `src/runtime/action-selector.ts`
- `src/runtime/automation-loop.ts`
- `src/cli.ts`
- `test/flow/filename-parser.test.ts`
- `test/vision/ocr-client.test.ts`
- `test/runtime/action-selector.test.ts`
- `test/runtime/automation-loop.test.ts`
- `test/cli/cli.test.ts`

## 自测用例

- 解析 `ocr@放弃福利` 并拒绝空 OCR 参数。
- 校验 OCR JSON 请求字段和文字框点格式。
- OCR 响应错误时抛出服务端错误信息。
- OCR 条件满足时选择高队列图片，不满足时过滤候选。
- 一轮多个 OCR 节点只请求一次 OCR。
- CLI 正确解析 OCR URL 和短边参数，不暴露显示器选择。

## 兼容性测试

- 不含 `ocr@` 的旧图片文件名行为不变。
- 预编译 OpenCV.js 依赖不变，不增加系统 OpenCV 或 node-gyp 依赖。
- ADB 截图仍以 Buffer 传递，不生成固定临时截图文件。

## 性能测试

- 同一 tick 的 OCR 请求次数固定为 0 或 1，与 OCR 图片数量无关。
- 无 OCR 条件的 Flow 不创建或调用 OCR 请求。

## 风险评估

- OCR API 依赖在线显示设备的 OCR 能力；请求超时或服务异常只会跳过动作。
- OCR 文字按包含关系判断；包含逗号的文字不适合作为当前逗号分隔 DSL 的单个参数。
- OCR 坐标本版只保留用于后续扩展，不参与点击坐标计算。

## 预计工时

约 1 小时，包含实现、测试、文档和构建验证。

## 执行结果

- ✅ 已完成 `ocr@文字` 文件名解析、AASC OCR HTTP 客户端、候选筛选和自动循环集成。
- ✅ 已完成 CLI OCR 参数、使用说明、design/spec/todo/ref/rules 和 changelog 同步。
- ✅ `npm test`：10 个测试文件、38 个测试通过。
- ✅ `npm run build`：通过。
- ✅ `git diff --check`：通过。
