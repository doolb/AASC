# 聊天视频任务实现伪代码（2026-10-23）

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
豆包已接入 := ACK定位原会话后IM查询，兼容旧async_task；本轮实际模型为官网默认Seedance2.0 Mini
Qwen官网公开源码 := ai_tool_scene=zaodian_generate_video；bizScene=genVideo
Qwen请求 := req { rootModel, prompt, originPrompt, genMode, params { gen_mode,duration,audio,resolution,size,attachments } }
Qwen待核实 := 账号下发模型配置、实际创建响应、ai_generate_video/loading卡片和最终任务查询/视频字段
GLM官网公开源码 := POST /chatglm/video-api/v1/chat
GLM请求 := prompt + conversation_id + base_parameter_extra + 可选source_list/advanced_parameter_extra
GLM查询 := GET /chatglm/video-api/v1/chat/status/{id} 与 GET /chatglm/video-api/v1/chat/{id}
GLM结果 := output.file_list；参考图使用/video-api/v1/static/upload
GLM实测 := source_list为ID数组，创建result.chat_id；查询status=finished、平铺video_url/cover_url；兼容output.file_list
证据边界 := 首轮只核查；本次豆包/GLM独立任务已生成/下载/播放，Qwen积分不足；主AI协议用隔离Responses测试验证
```


## 主AI原生视频展示契约

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

## 已确认实施分解（2026-10-23）

```text
用户已确认 := 完整视频接入含主AI原生和SubAI生成；遵循现有raw提示/WS配置/历史
共用结果 := output_video + videos数组 + video_generation(status,taskId)；不从普通文字猜视频URL
原生入口 := 三家显式视频作品/任务 → 内部注册已有任务 → Responses完成并释放聊天连接 → 后台查询/下载
任务存储 := Chat2API用户目录私有video-jobs.json，保留账号/Provider/任务ID和状态，不存Cookie/签名
重启 := 仅恢复已有上游标识查询；无任务标识的提交中状态标interrupted，不再次创建
服务API := POST /v1/video/generations创建任务，GET /v1/video/generations/{id}查询，沿既有鉴权
独立生成 := 模型选择video purpose复用既有WS消息；SubAI生视频注册同一后台任务服务
聊天保存 := 主回复图片/视频共用一个记录；异步资产保存不阻塞聊天/TTS计时；视频数组和状态立即持久化
视频下载 := 流式临时文件、格式/大小校验、取消清理、原子改名；本地URL进入历史
验收 := 增量/完成重复不重存；一轮多视频；无标签原生作品不二次提交；清空取消/恢复/原会话续聊
```

```text
豆包现场修正 := 首段Samantha回复可能只有ACK和说明，作品稍后写入IM会话9998消息ext
定位 := 首段ACK conversation_id/message_id/conversation_type；不是靠自然语言宣称生成完成
查询 := POST /im/chain/single，cmd3100，pull_singe_chain_uplink_body，固定原账号和会话
作品 := ext.ai_creation_tool_list明确video任务；ext.creation_material_info[taskId].result.video.download_url
关联 := based_message_id_list匹配原用户消息，或已知taskId；不读取/返回同会话其他轮次作品
整数 := 工具任务JSON中的长整型ID按字符串读取，不能经Number损失精度
恢复 := 只恢复原会话查询，已有生成不再发消息；读到实际作品后正常落盘/播放器
```

```text
清空/删除轮次 := LLM完成删除后调用内部onHistoryDeleted回调，服务端取消已无记录的媒体controller
删除范围 := 兼容旧相邻问答，并删除同一用户messageId绑定的全部媒体/回复记录
约束 := 回调只属初始化依赖，不接受远程JSON函数；取消失败不影响历史删除结果
```

```text
历史规范化 := 空正文但含视频/图片或pending媒体状态也是有效消息；无正文且无媒体仍拒绝
保存窗口 := 主流结束到后台下载完成之间允许保存pending卡片，不能因空正文丢掉恢复任务ID
空流帧 := choices为空的usage/保活帧不读取delta字段，不影响后续视频与完成态
```
