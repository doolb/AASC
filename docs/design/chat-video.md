# 聊天视频生成接入核查（2026-10-23，尚未实现）

用户要求检查豆包、Qwen、GLM生成视频如何接入聊天。本轮仅查看现有源码、共享Vivaldi profile官网入口和当前官网加载的公开前端模块，没有发送视频生成请求，未验证额度、实际生成成功、视频下载、三家账号完整模型列表。以下为方案，不等于已可用。

| Provider | 本地/官网证据 | 拟接入路径与待核实项 |
| --- | --- | --- |
| 豆包 | 项目chat2api-doubao-web-media已有content_type=2020/skill17创建、异步task_id与2021视频解析，网页任务有/v1/video/generations；当前官网公开bundle存在视频生成与Seedance2.0标识 | 复用同账号浏览器与媒体服务，先实测当前协议；不能把旧协议mock通过或前端标识当作当前账号可生成 |
| Qwen | 当前官网“更多→AI生视频”；公开模块46818组装ai_tool_scene=zaodian_generate_video、bizScene=genVideo，req含rootModel/prompt/originPrompt/genMode/params；params含duration/audio/resolution/size/attachments | 接入现有Qwen网页聊天发送与作品卡片处理，补视频异步结果查询。前端含Wan2.5/2.6/2.7和HappyHorse1.0定义，实际可见模型与额度需读取账号配置，不能全部硬编码为可用 |
| GLM | 当前https://chatglm.cn/video清影页；公开模块18882定义POST /chatglm/video-api/v1/chat、GET /chat/status/{id}和GET /chat/{id}，static/upload用于参考图；模块39655从output.file_list读取结果 | 复用GLM账号认证，独立创建/查询视频任务；prompt/conversation_id/base_parameter_extra/source_list等按官网配置组装。清影页面提示按参数消耗积分，但本轮未提交任务或确认具体消耗 |

Qwen参考素材字段包含materialId和类型；GLM输入含画幅、fps、duration、generation_pattern等配置；不同Provider参数不能用同一个数值枚举猜测映射。豆包当前模型可用性与请求体仍需现场真实任务验证。

## 拟定统一交互

玩家/用户自然语言→主AI在回复开头输出 `SubAI,生视频,"提示词"[,参考图ID1,...]` →任务注册分流→立即保存生成中卡片→按账号提交一次并保存上游任务标识→后台等待/查询→视频与封面下载为本地资产→同一聊天消息替换为video controls播放器。一次多条视频保留为数组；刷新/重启后历史仍可播放。主模型原生返回视频也应归一化后复用同一保存/展示流程，不能重复触发生成。

模型面板新增独立“生视频Provider/模型”，可再按Provider显示有效比例/时长/分辨率。沿现有chat-model-tier-service与共用picker、WS权威配置流程保存，不用主聊天模型推测视频模型。指令只承载提示词与参考图ID，生成参数从权威设置读取。

接入拟涉及chat-model-tier-service/共用picker、sub-ai-protocol/task注册、独立video service与本地assets、chat2api-proxy/runtime/Provider视频适配、Responses输出媒体归一化、llm-service/history-store、chat.js/display-chat.js及定向测试。视频生成任务不能长期占用当前聊天Responses连接；复用已有视频接口并增加可查询的任务状态，避免再为同一设置新增HTTP配置接口。

## 状态与生命周期

卡片区分queued/submitted/running/downloading/completed/failed/cancelled/interrupted。取消停止本地等待与下载；未证实官网取消能力前，不承诺撤销已提交任务或返还额度。停止后迟到结果不能复活已删除消息。

服务重启只恢复已知task_id的查询，不能自动重新提交生成；明确失败与状态不确定分开。视频URL可能过期，使用流式落盘、文件大小/类型检查与原子提交，历史仅保存本地URL及必要元数据。封面不是生成图片本身，不混入生图结果列表。

supportsVideoUpload默认false是视频作为模型输入的能力，与生视频输出独立；图片上传默认true，显式保存的布尔值保持。生视频功能不应因关闭视频上传而不可用。

## 下一步验收

方案确认后再实现。先完成每家独立自然提示任务的创建/状态/下载闭环，确认可用模型和额度提示；测试隔离账号任务与AASC会话，避免在用户旧聊天发送。随后验证双端占位→多视频播放器、历史恢复、清空/取消防迟到、重启只查询不重发，以及Android实际MP4编码与播放。仅网页/source检查不能记为真实生成成功。
