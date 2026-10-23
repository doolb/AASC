# 聊天视频任务伪代码（待方案确认，尚未实现）

```text
已有声明 := SubAI指令注册、图片任务占位、模型快选WS配置、聊天scope/history、豆包媒体服务
新增定义 := VideoJob { id, messageId, scope, provider, account, upstreamTask, status, videos, error }
新增定义 := VideoAsset { id, url, posterUrl, mimeType, width, height, duration }
模型设置 := 独立video provider/model与Provider允许的参数，通过既有WS保存/校验/config.set/权威广播
AI调用 := SubAI,生视频,"提示词"[,当前聊天参考图ID...]
调用解析 → 注册生视频任务 → 保存queued卡片并推送同一消息ID → 释放聊天流
账号调度 → 提交一次 → 保存任务ID → submitted/running
状态查询 → 按Provider同账号等待 → 完成后流式下载并校验视频/封面 → 原子提交本地资产
结果 := videos数组写入同一聊天消息 → completed广播 → 两端video controls播放
主模型原生视频 → 明确作品类型提取 → 同一保存/展示流程，不再触发SubAI
失败 := 保留失败卡片与原因；不能把封面或未完成任务当生成完成
取消/清空 := 标记旧请求失效并取消等待下载，迟到结果不能恢复消息；不承诺官网撤销
重启 := 已知上游任务只查询；未知提交状态标interrupted，不重发可能消耗额度的任务
视频上传配置 := supportsVideoUpload缺省false；不作为视频生成输出开关
```

```text
豆包现有代码 := makePayload(video) → 2020/skill17 → async_task.id → 同账号第二阶段 → extractVideo(2021)
豆包待核实 := 旧请求与当前官网协议、可用模型/额度、是否需要新的任务查询路径
Qwen官网公开源码 := ai_tool_scene=zaodian_generate_video；bizScene=genVideo
Qwen请求 := req { rootModel, prompt, originPrompt, genMode, params { gen_mode,duration,audio,resolution,size,attachments } }
Qwen待核实 := 账号下发模型配置、实际创建响应、ai_generate_video/loading卡片和最终任务查询/视频字段
GLM官网公开源码 := POST /chatglm/video-api/v1/chat
GLM请求 := prompt + conversation_id + base_parameter_extra + 可选source_list/advanced_parameter_extra
GLM查询 := GET /chatglm/video-api/v1/chat/status/{id} 与 GET /chatglm/video-api/v1/chat/{id}
GLM结果 := output.file_list；参考图使用/video-api/v1/static/upload
GLM待核实 := 真实创建响应/状态枚举/文件地址结构及账号实际参数与消耗
证据边界 := 本轮未发视频生成请求，不宣称真实视频闭环成功
```


## 主AI原生视频展示契约（待实现）

```text
触发 := 主模型正常回复的明确视频任务/作品数据；无需SubAI调用行
分类 := 原生视频只接收已有任务/结果，不再次调用生成；不使用独立SubAI生视频配置替换原模型
归一化 := provider视频状态/任务/作品 → videos数组与generation状态；普通链接/搜索视频/封面不猜测
传递 := Provider → Responses流式增量及非流式完成 → LLM onVideos → 游戏桥转发 → server原生视频协调器
记录 := 复用主AI assistant messageId；正文+视频及仅视频均有效，不新增重复气泡
保存 := 明确视频URL后流式下载视频/封面 → 原子保存本地URL与元数据 → 同一记录更新播放器
去重 := 作品标识优先；分片与完成态重复结果只保存/展示一次，多个视频不丢失
会话 := 当前聊天scope/requestId/主上游会话保持；清空/切换/取消后的迟到回调不复活
重试 := 明确生成开始即标记不可重发；断连只恢复已知任务查询，不再次提交可能产生新作品的原消息
完成 := 上游确认完成且本地资产可播放后置completed；封面或队列状态不算完成
历史 := videos与generation字段和正文一起持久化；重启恢复状态，不丢已保存视频
配置 := 视频上传默认false仅限制输入，不屏蔽输出；原生作品不经过SubAI任务再次分派
验收 := 三Provider/Responses流与非流；仅视频、文视频、多视频、去重、失败/断流、原会话续聊、双端历史与Android播放
```
