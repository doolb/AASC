# 变更日志

### AutoHelper Node.js 图片流程

- ✅ [2026-09-02] 创建 Node.js 工程设计、实现伪代码和任务文档。
  - 目标路径：`/mnt/AASC/3rd/autohelper-node`
  - 资源规则：图片文件名携带匹配和点击参数，使用 `goto@flowId` 切换目录。
- ✅ [2026-09-02] 完成 Node.js 工程初始化。
  - 改动文件：`package.json`、`tsconfig.json`、`vitest.config.ts`、`src/types.ts`、项目说明和 AASC 同步文档。
  - 验证结果：`npm install`、`npm test`（1 个测试）、`npm run build` 通过。
- ✅ [2026-09-02] 完成图片文件名解析器。
  - 改动文件：`src/flow/filename-parser.ts`、`test/flow/filename-parser.test.ts`、`src/types.ts` 和 spec 文档。
  - 资源规则：支持旧参数并新增 `goto@flowId`，拒绝非法 Flow ID 和越界点击点。
  - 验证结果：3 个解析测试和 TypeScript 构建通过。
- ✅ [2026-09-02] 完成活动 Flow 加载和模板缓存。
  - 改动文件：`src/flow/flow-loader.ts`、`src/vision/template-cache.ts`、`test/flow/flow-loader.test.ts` 和 spec 文档。
  - 行为：只加载当前 Flow 的 PNG/BMP，安全拒绝路径遍历，按文件路径缓存模板。
  - 验证结果：4 个 Flow Loader 测试和 TypeScript 构建通过。
- ✅ [2026-09-02] 完成 Linux ADB Client。
  - 改动文件：`src/adb/adb-client.ts`、`test/adb/adb-client.test.ts` 和 spec 文档。
  - 行为：显式 serial、二进制截图、ADB tap 和离线设备拒绝。

- ✅ [2026-09-02] 切换到预编译 OpenCV.js/WASM 匹配器。
  - 改动文件：`src/vision/opencv-runtime.ts`、`src/vision/image-decoder.ts`、`src/vision/image-matcher.ts`、匹配测试和 npm 依赖。
  - 行为：不再依赖 `opencv4nodejs`、系统 OpenCV 或本机 C++ 编译；支持 PNG/BMP 模板、`TM_CCOEFF_NORMED` 模板匹配和可选 ORB。
  - 验证结果：3 个 OpenCV 匹配测试和 TypeScript 构建通过。

- ✅ [2026-09-02] 完成动作选择和点击坐标计算。
  - 改动文件：`src/runtime/action-selector.ts`、`test/runtime/action-selector.test.ts`、`src/types.ts`。
  - 行为：支持队列/分数排序、负队列过滤、`select`/`default` 和归一化/中心点击坐标边界限制。
  - 验证结果：5 个动作选择测试和 TypeScript 构建通过。

- ✅ [2026-09-02] 完成图片自动循环和 Flow 跳转状态机。
  - 改动文件：`src/runtime/automation-loop.ts`、`src/runtime/record-store.ts`、`test/runtime/automation-loop.test.ts`。
  - 行为：支持截图、匹配、队列选择、wait、dry-run、ADB tap、delay、`goto`、非 loop 抑制和跳转上限；记录使用 JSONL。
  - 验证结果：4 个自动循环测试和 TypeScript 构建通过。
  - 验证结果：3 个 ADB 测试、真实 `adb devices -l` 和 TypeScript 构建通过。
