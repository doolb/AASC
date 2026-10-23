# 聊天附件上传（2026-10-23）

已在控制端与显示端聊天输入框增加共享“📎”附件入口，支持TXT/MD/LOG/CSV/JSON文本、PNG/JPEG/GIF/WebP图片、MP4/WebM/MOV视频。可预览与移除，发送后归入本轮历史，刷新仍可查看。文本按UTF-8、BOM UTF-16或GB18030解码为用户数据，带文件名进入上下文，不执行内容；超过当前输入预算明确报错。

共享chat-attachments.js/CSS按需加载，两端复用；chat-attachment-service.js接收独立multipart业务上传。原WS chatMessage仅传附件ID，服务端校验后绑定历史；新附件不以Base64占用WS。每条最多4附件，文本1MiB、图片20MiB、视频100MiB；浏览器与服务端均校验。切会话、清空和迟到上传用作用域/版本隔离，不能复活旧草稿。既有相机和图片入口保留。

图片遵循supportsImageUpload默认true，视频遵循supportsVideoUpload默认false；能力沿既有chatModelTierConfig权威WS同步，服务端再次校验。Agent入口明确不支持附件，普通LLM入口可用。文本文件保留本地下载链接，图片/视频使用已有聊天渲染；上传附件和生成作品均参与全局引用回收。

视频原件经流式文件通道上传，Responses消息仅放不透明file_id；内置模型在进程内沿同一缓存服务保存，外置服务使用POST /v1/chat/files扩展。缓存私有、鉴权、24小时失效，最多64文件、单文件100MiB。这个扩展并非所有Responses服务都提供；缺接口明确报错。原会话续聊去重，失效会话重建后从本地原件恢复上传。

当前GLM使用官网chat_upload与type=video数组，独立真实Responses测试正确识别蓝色视频且下一轮确认无人。GLM日志HTTP包装器只保证request，上传显式适配post。Qwen普通非图片files使用doc/url卡，会转chat_office异步任务；resource/video卡不属于普通聊天视频理解，实测不能得到有效回答。因此当前正式路径对Qwen/豆包原始视频明确unsupported_modality，不把成功上传或空回复视为视频理解成功。Qwen异步速读后续独立接入。

验证：test:chat-attachments覆盖真实multipart上传、文本编码、能力/格式/大小/数量、当前及备份引用、草稿/生成租约、迟到取消、两端浏览器实际选择/发送/恢复和视频解码、鉴权文件通道、真实LLM上下文及原会话/重建、进程内模型上传。实际官网仅使用独立会话，不写当前AASC聊天；凭据/抓包/样片不入Git。服务包仍待构建部署。
