# 聊天图片输入与续聊

在控制端“LLM服务器配置”编辑每个配置的“支持上传图片／支持上传视频”，新配置和旧配置缺省均开启。保存、其他控制端同步和重连沿用现有权威配置流程。关闭图片上传后，已有图片继续显示，未发送的文字和附件保留；历史图片不再传给模型。

直接 LLM 的 raw 格式仍把 System/User/AI 组织为文字，图片作为独立附件。普通 Responses 使用 input_image，Chat Completions 使用 image_url。本地图片读成 Data URL，不把本地路径传给模型。豆包、Qwen和GLM网页账号会上传真实字节，再引用官网资源；Chat2API这三种网页Provider目前只接受图片Data URL，HTTPS图片链接会明确报错，其他网页Provider尚未接入。

图片结果后续追问继续使用原 Responses 会话。主模型在同会话生成的图沿用上游上下文；独立SubAI生图和用户附件按本地ID补传一次。引用失效时重新读取当前会话本地图片恢复，不影响本地历史中的多图显示。切换配置或新会话仍按正常规则建立独立上下文。

支持PNG/JPEG/WebP/GIF。Chat2API最多32张，单图20MiB，总计40MiB；豆包现有上传器单图10MiB，图片仍受实际Provider能力限制。Agent入口尚未接入图片附件，会明确提示切换直接LLM配置。

视频本轮只加入能力配置，视频选择和上传入口尚未实现。此变更只需更新服务代码包并刷新网页；未构建或部署本轮服务包，Android实际入口仍待更新后验收。

开发自测：`npm run test:chat-images`、`npm run check:chat2api`、`npm run test:chat-streaming`、`npm run test:chat-context`。控制端“聊天媒体上传配置”自测只读检查入口与字段，不发测试消息。
