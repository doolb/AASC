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
Qwen旧原生聊天兼容 := ai_tool_scene=zaodian_generate_video；bizScene=genVideo；仅已提交session/req任务沿旧snap查询
Qwen新任务 := 下文千问创作接口；不再通过聊天工具提交SubAI视频
Qwen已核实 := 官网截留创建字段、新入口认证、recordId独立查询/resultVideos；成功创建及参考图最终生成待账号额度
GLM官网公开源码 := POST /chatglm/video-api/v1/chat
GLM请求 := prompt + conversation_id + base_parameter_extra + 可选source_list/advanced_parameter_extra
GLM查询 := GET /chatglm/video-api/v1/chat/status/{id} 与 GET /chatglm/video-api/v1/chat/{id}
GLM结果 := output.file_list；参考图使用/video-api/v1/static/upload
GLM实测 := source_list为ID数组，创建result.chat_id；查询status=finished、平铺video_url/cover_url；兼容output.file_list
证据边界 := 首轮只核查；本次豆包/GLM独立任务已生成/下载/播放，Qwen新入口查询/下载/播放通过，新提交明确15004额度不足；主AI协议用隔离Responses测试验证
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

```text
Qwen核查修正 := 用户确认HappyHorse可用，撤回本次Wan3.0普通/480p意向；运行目录和请求暂不变
现场 := 当前Vivaldi的千问创作HappyHorse1.1/720P/16:9/5s已有任务，进度36%→完成
入口差异 := 旧chat2.qianwen.com聊天工具错误不能等同create.qianwen.com创作任务失败
新页观测 := ai-studio-create.qianwen.com的video/function、assets/v1/list、assets/v1/batch/get与WS
边界 := 只读页面，不二次生成；最终视频Node下载1483029字节，ffprobe确认H264/1280×720/5.162667秒；新入口Node创建/查询尚未接入
```

## Qwen千问创作入口修复（已确认实施，2026-10-23）

```text
已有声明 := video-service/jobs/catalog、Qwen账号ticket、workspace参考图上传、原生聊天snap定位
新增定义 := QwenStudioTask { recordId, scene }；仅私有任务文件持久化定位，不保存认证参数
认证 := 固定HTTPS千问创作页带当前账号Cookie读取__sm_req_token__的nonceId/signKey；不执行网页脚本
签名 := 随机browserId与chid、当前毫秒timestamp；MD5(browserId_nonceId_signKey_timestamp_chid)
请求 := 固定ai-studio-create主机；JSON正文合并业务参数、product=ai_studio、platform=pc和当次认证字段
模型 := qwen-happyhorse沿用稳定ID，显示HappyHorse1.1，按截留的官网model/rootModel请求，场景由服务端选择；720P/5秒
创建 := 参考图workspace上传 → 按文本/参考模式构造请求 → POST /api/web/ai/video/function一次 → 保存recordId和可选scene
查询 := POST /api/web/ai/video/record/query固定原账号和recordId、可选scene；未finish不使用预览
完成 := resultVideos全部显式作品(downloadUrl/cdnUrl/url)，coverCdnUrl仅作封面；归一化进入原有资产/双端历史
兼容 := 已登记旧sessionId/reqId的原生任务仍查询旧snap；新SubAI创建不再调用旧聊天工具
错误 := HTTP/认证/额度/审核/未知状态安全错误；无recordId不重发创建；取消沿用既有signal
验收 := Node保存票据查询已有真实任务；截留官网创建请求核对参数不重复生成；独立协议/签名/失败/旧任务兼容测试
```

```text
官网创建样本 := model=rootModel=happyhorse11；genMode=multi_ref；params(size,resolution=720P,duration=5,attachmentType=1,attachments)
核查方式 := 独立页拦截创建请求并本地响应，不向上游发送生成；仅一次样本，关闭自建页
```

```text
现场Node查询 := 保存ticket → 正式任务adopt(recordId) → 同账号query → finish.resultVideos → 627730字节下载版 → 两端播放器
现场Node创建 := 仅提交一次，官网code15004；当前余额5/界面费用30，不购买额度或改模型
错误实现 := HTTP401/403/429映射认证/频率错误；未知正文/HTML/Cookie/签名不传入公开错误
兼容验收 := 缺scene的recordId查询成功；有scene也保留；重启旧record只查询；旧session/req走原snap
范围边界 := 独立接口成功创建/参考图最终作品与Android部署后播放仍待验，不把查询成功记作新生成成功
```

```text
媒体保留现状 := clearHistory/deleteConversationRound移除记录并通知onHistoryDeleted → 取消无记录的controller；不unlink既有资产
历史回收 := trimHistory按条数切片，pruneHistorySessions过滤过旧会话 → 保存历史；不回收图片/视频/封面文件
上下文裁剪 := trimHistoryToBudget复制recentHistory再裁剪 → 只影响本轮输入；不删除原历史或媒体
资产接口 := 图片save/read、视频save；视频异常分支unlink仅本次temporary/target，不是历史引用回收
尚未实现 := 按所有保留历史/下载中的任务引用回收无引用资产；本次不执行文件删除或变更策略
```

## 受管媒体回收草案（待实施确认）

```text
已有声明 := chatHistories全profile/群私临时会话、历史持久化、每日一份快照、image/video资产、媒体controller
新增定义 := MediaLease { assetId, state, expiresAt }；ChatMediaGC { managedRoots, currentRefs, backupRefs, liveLeases }
备份策略 := 用户选保留备份引用；按现有每日/单份轮换，替换后失去引用才能回收
删除事件 := 清空/轮次删除/条数淘汰/临时会话淘汰/导入替换 → 成功保存历史 → 取消失去记录的任务 → 排队回收
引用扫描 := 全部当前历史 + 当前保留快照 + 上传/生成/下载租约 → 图片/视频/封面/附件ID引用集合
执行 := 只枚举受管目录UUID普通文件，排除有引用/有租约者；删前再次校验；异常停止并报告，不跟随链接
补偿 := 启动和周期补扫；未发送附件到期释放租约；备份轮换后重扫
约束 := trimHistoryToBudget仅上下文选择，不删除历史/文件；回收失败不恢复已清空聊天
```
