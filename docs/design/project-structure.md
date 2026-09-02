# 工程目录结构设计

## 背景

当前工程已从早期 `core/*` 单层结构迁移到 `src/core + src/framework + src/external + src/apps` 的分层结构，但根目录说明文档仍有旧结构残留，导致新成员定位模块成本偏高。

## 目标

1. 统一根目录结构说明，以当前真实代码布局为准。
2. 明确各顶层目录职责，减少跨目录误放文件。
3. 将目录治理文档挂载到 design/spec 索引，保持可追踪。

## 根目录职责

```text
src/apps/server/boot/server-app.js -> 服务端主入口
3rd/                -> 第三方组件
config/             -> 配置数据
docs/               -> 设计/实现/任务/TODO
docs/self-test-results/ -> 自测结果归档
res/                -> 模型、上传、临时文件、证书
skills/             -> 技能配置
src/framework/aasc/ -> Actor 与消息总线
src/framework/auto-brain/ -> 独立决策分层
tests/              -> 自动化测试用例
scripts/test-runners/ -> 可直接运行的测试启动器
scripts/api/        -> 手动或 AI 调用接口的 Node.js 脚本
scripts/ops/        -> 重启、APK 部署和启动脚本
scripts/stress/     -> ASR、TTS、RSS 压测脚本
scripts/models/     -> 模型下载脚本
src/apps/web-mediacenter/ui/public/ -> 控制端与显示端静态页面
src/                -> 分层主代码（core/framework/external/apps）
```

## 治理规则

1. 新增业务代码优先进入 `src/` 分层目录，不直接放根目录。
2. 新增运行时资源文件优先进入 `res/` 对应子目录。
3. 新增任务完成后必须同步更新：`readme.md`、`docs/design.md`、`docs/spec.md`、`changelog.md`。

## 验收标准

1. `readme.md` 中项目结构与当前仓库目录一致。
2. design/spec 索引均可导航到工程目录结构文档。
3. 目录职责说明可直接指导新文件落位。

## 2026-04-27 结构归位补充

1. 清理根目录历史残留目录：`uploads/`、`temp/`、`models/`、`routes/`、`viewbind/`、`voice-display/`、`voice-display-node/`。
2. 运行时资源统一归位到 `res/`：
   - 上传资源：`res/uploads/`
   - 临时资源：`res/temp/asr/`、`res/temp/uploads/`
   - 模型资源：`res/models/sensevoice/`
3. 压测脚本默认样本路径统一为 `res/temp/asr/asr-stress-sample.wav`，与资源目录规范保持一致。
4. 文档示例路径统一为当前结构：
   - 服务端入口统一写为 `src/apps/server/boot/server-app.js`
   - 静态页面目录统一写为 `src/apps/web-mediacenter/ui/public/`
   - 子显示端 Node 实现目录统一写为 `src/apps/voice-display-node/`
   - ViewBind/DataSnapshot 示例统一写为 `src/core/*`
