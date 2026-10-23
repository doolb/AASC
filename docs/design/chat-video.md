# 聊天视频生成与主AI原生视频展示（2026-10-23）

已实现主AI原生结果接收和SubAI独立生视频两条入口，共用本地视频资产、原消息更新、双端播放器与历史。视频上传开关仍默认false；视频作为模型输入的上传入口尚未接入，这不限制视频生成输出。本轮未构建或部署服务包，Android实际更新后的播放仍待验收。

## 用户交互

用户自然语言→主AI输出 `SubAI,生视频,"提示词"[,参考图ID...]` →任务分流→立即持久化生成中卡片→后台创建/查询→视频及封面落盘→原卡片显示播放器。独立生视频Provider/模型在控制端与显示端共用模型面板选择，通过既有WS/config.set保存/广播，不改变主聊天或生图模型。

主AI也可直接调用官网原生视频功能，不必输出SubAI标签。明确的原生视频状态/作品经Provider→Responses流或非流→LLM回调→游戏/SubAI桥→服务端媒体协调器，在主AI原回复展示。文字、图片、视频共用一条assistant记录；仅视频回复有效。同轮已有原生视频时，桥接层不再执行重复的SubAI生视频行。

## Provider实现与现场证据

| Provider | 创建与查询 | 验证边界 |
| --- | --- | --- |
| 豆包 | Samantha视频输入，ACK立即记录原conversation_id/message_id。作品可能不在首段SSE中；用官网捕获的 `/im/chain/single` cmd3100查询原会话，读取9998消息ext中的明确视频工具和creation_material_info.result.video.download_url。按based_message_id_list/已知taskId过滤，长ID保留字符串；旧async_task路径仍兼容 | 当前账号实际生成Seedance2.0 Mini作品，未重发生成，按已有会话定位恢复查询并下载；Chrome双端播放器实际解码通过 |
| Qwen | `zaodian_generate_video` / `genVideo`，官网前端模型定义happyhorse/wan26/wan27，默认5秒/720P，参考图走workspace上传；原session/req_id查询snap，明确ai_generate_video作品归一化 | 当前保存账号实际返回创作积分不足，已立即失败而非空轮询；成功生成仍待有积分账号。协议、模型选择、异步任务及错误路径测试通过 |
| GLM | 清影 `/chatglm/video-api/v1/chat`，source_list使用上传得到的ID数组；刷新认证后查 `/chat/{id}`。当前结果是status=finished的平铺video_url/cover_url，兼容旧output.file_list | 当前账号实际生成一段视频，5.129秒、H.264、512×688，约1.24MB；模拟进程重启后只查询已有任务并下载，Chrome双端实际解码通过 |

豆包与GLM均使用独立官网会话/任务，没有写AASC当前对话。主AI原生三家协议的流式/非流式、真实LLM模块和原会话续聊使用隔离测试验证；不把SubAI实际生成等同于每家主模型都已在真实账号触发原生视频工具。原始抓取、凭据、样片只留私有临时目录，不入Git。

## 状态、存储与恢复

Chat2API任务独立于聊天Responses连接：创建后立即返回任务ID，后台等待/查询，不占用主聊天或TTS收尾。`video-jobs.json`位于Chat2API用户目录，私有权限，最多128条、16个未完成任务；仅保存账号/Provider/定位字段、状态与结果，不保存原提示、Cookie、请求签名或参考图字节。重启只查询已有定位；无定位的中断提交不重发。Qwen同一session/req和豆包相同任务只登记一次。

AASC历史保存videos与videoGeneration。视频流式下载，单文件最多256MiB，校验MP4/WebM文件头并原子改名；可选封面保存在图片目录，历史使用本地URL，不依赖上游地址长期有效。空正文的媒体/pending记录可持久化，避免下载期间失去恢复任务ID。一段下载失败保留其他已保存视频及失败说明。

生成、查询、下载、完成/失败/取消分开；取消停止本地等待/下载，不承诺官网撤销或退还额度。清空与删除轮次取消已移除记录的controller；同一用户轮次绑定的多个媒体/回复一并删除，迟到结果不复活。已有任务的原生输出不会再次分派SubAI，生成开始后的断流也不自动重发消息。

## 代码与自测

共用chat-output-videos、Native视频/媒体流归一化、video-catalog/jobs/service、doubao-video-result；扩展Provider/Responses/runtime/proxy、LLM/history、SubAI协议/worker、媒体协调器、游戏回调、模型快选与双端渲染。通用Provider头提取为独立模块，原适配器保持1000行以内。

`npm run test:chat-videos`覆盖任务API鉴权、原生仅视频/多视频、流/非流、原会话续聊、重启查询、长ID和原消息隔离、模型WS配置、实际DOM/播放、取消与历史。配套图片、Chat2API、流式回归；确切结果见changelog与任务。控制端自测入口只检查播放器标记，不生成视频、不改当前聊天。
