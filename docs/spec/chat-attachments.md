# 聊天附件实现（2026-10-23）

```text
已有声明 := chatMessage/WS权威历史、LLM上传能力开关、图片上下文、Provider上传、资产回收
新增定义 := ChatAttachment { id, kind, name, mimeType, size, url }；AttachmentDraft { scope, lease, attachments }
选择 := 双端共享附件入口 → 文本/图片/视频白名单与限制 → 显示待发送附件，可移除
上传 := 独立业务上传通道流式收文件 → 服务端再校验 → 受管UUID文件与租约 → 返回附件ID/预览元数据
发送 := 原有chatMessage携带附件ID/文字 → 校验存在/类型/能力/作用域 → 绑定用户轮次并保存历史 → 释放草稿租约
文本 := 按文本数据解码，带文件名进入用户输入，计入上下文；超容量明确失败，不执行文件
图片 := 使用现有真实图片上传与上下文去重；默认允许
视频 := 检查supportsVideoUpload默认false → 文件通道/ID → LLM协议及Chat2API原生附件上传 → 当前账号/原会话
上游 := GLM按官网当前视频字段；豆包/Qwen未接通普通聊天原始视频理解时明确拒绝，不丢附件
历史 := 保存原文件元数据，双端渲染图片/视频/文本文件入口；迟到上传不能复活已清空轮次
回收 := 草稿取消/过期、聊天删除/历史淘汰 → 与当前/备份/在途任务一起算引用
```

```text
传输实现 := AASC /api/chat/attachments受管文件 → WS只送attachments ID → LLM客户端流式POST /v1/chat/files → input_video.file_id
Chat2API文件缓存 := 私有chat-input-files，100MiB/文件、24小时，原件不进入聊天JSON；鉴权沿用v1入口
原生字段证据 := GLM官方加载源码type=video/video数组，上传仍chat_upload；Qwen普通files/doc卡会转异步工作助理，当前明确拒绝
豆包现场 := 当前官网上传accept不含视频；保留明确unsupported_modality，不发只有文字的伪视频请求
LLM := 文本附件计入原上下文预算，过大明确拒绝；历史文本按上下文条数展开；视频文件ID沿Responses引用去重，失效会话重建时重新上传
边界 := 当前网页Provider视频输入适配GLM；其他服务需提供Chat2API视频文件协议，不支持明确报错；Agent入口不静默忽略附件
```

```text
GLM上传装配 := 日志HTTP包装器只暴露request → 上传前显式适配post，保留原鉴权和取消信号，不能假定包装器有axios快捷方法
Qwen视频验证 := 普通聊天composeMessages把非图片this.files放入doc/url附件卡；resource/url属于创作多参考入口，不用于普通视频理解；必须用真实模型识别内容验收，上传HTTP成功不代表视频被读取
睡眠回归 := Node新测试脚本仅跑可隔离的Node/优先级/TTS用例；依赖已运行服务端的网页全链路测试单独运行，不能混入离线Node套件
```

```text
真实输入验收 := GLM独立Responses原始蓝色视频→正确识别蓝色；previous_response_id续聊→正确确认无人
Qwen边界 := 普通files/doc卡路由chat_office异步工作流，当前聊天解析不能得到视频理解结果；resource/video卡被普通聊天忽略。正式路径在发送前返回unsupported_modality，不把空回复或已上传当验收通过
```
