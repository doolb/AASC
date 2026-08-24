# 实施计划：批量媒体筛选与文本 TTS 路由预生成

> **For the implementer:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan task-by-task, with a fresh implementer and reviewer for each task.

## 目标

实现服务器权威媒体类型筛选、手动语音能力路由、远程文本 TTS 播放回执，以及最多一条下一句预生成缓存。

## 任务顺序

## Task 1：批量媒体类型协议与服务器筛选
   - 控制端批量设置增加五类复选框，默认全部勾选，只发送 `mediaTypes`。
   - PlaylistManager 在 library/temp 两条路径统一规范化并筛选；server-app 透传字段。
   - 补充 playlist、控制端协议测试。

## Task 2：手动能力语音路由与远程播放回执
   - 复用能力编辑器，明确 `voicePlayback` 是手动路由开关。
   - 服务器为文本媒体和播放列表保存选中设备集合及语音目标。
   - 新增远程文本音频消息和 `textSentenceTtsFinished` 回执，校验播放上下文。

## Task 3：下一句 TTS 预生成与显示端缓存
   - TTS 服务按播放上下文限制一条预生成句，支持取消和 token 失效。
   - 显示端在当前音频开始后预取下一句，当前句结束优先消费缓存；远程语音设备保持同样的串行语义。
   - 补充 TTS service、text player 和集成协议测试。

## Task 4：文档、回归与交付检查
   - 更新 design/spec/todo/changelog/task 文档。
   - 运行聚焦测试、语法检查、`git diff --check`及相关回归，记录环境限制。

## 约束

- 直接在 `/mnt/AASC` 的 `master` 工作区修改，不创建 worktree。
- 每个任务完成后由独立 reviewer 检查并修正，再进入下一任务。
- 不改动当前工作区中与本需求无关的用户修改。
