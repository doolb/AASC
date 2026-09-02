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
