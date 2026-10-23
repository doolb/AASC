# Chat2API生图伪代码

```text
模型目录 := 区分text/image能力，记录Provider、公开请求名、上游模型参数、实测状态
生图配置 := 现有AASC WS type请求 → 服务端校验 → config.set → 广播权威选择 → 两端初始化补发
POST /v1/images/generations := model+prompt → 目录解析 → 可用账号 → Provider生图适配 → 收集最终图片 → created/data
无模型/未知模型/无账号/不支持参数 := 明确错误，不静默切换其他模型
生成取消/超时 := 终止上游，不自动重复提交可能已执行的生成
GLM聊天 := selected_model=glm-5.3或glm-5.3-flash；复用官网签名/PC认证头
GLM生图 := refresh_token换access_token → assistant/stream
  assistant_id := 65a232c082ff90a2ad2f15e2
  新conversation_id := 空
  meta_data.cogview := aspect_ratio + style=none + scene=none + chat_model(空或glm_image) + rm_label_watermark=false
  messages := 用户prompt；SSE parts.content[type=image].image[].image_url → 去重
  全局status=finish且图片非空 → 成功；last_error/空图片/未完成 → 失败
豆包当前网页 := /chat/completion，client_meta/messages.content_block/option/chat_ability
  chat_ability.ability_type := 3
  chat_ability.ability_param := JSON字符串{ability_type:1,ability_param:{model,ratio,input_box_content}}
  SSE patch_op.patch_value.content_block.content.creation_block.creations[].image.image_ori.url → 最终图片
  排除ack_client_meta里的头像，不把占位图片算成功
豆包允许模型 := Seedream 5.0 Flash、Seedream 4.5、Seedream 4.0；排除5.0 Pro，不自动升级
Qwen已观察请求 := /api/v2/chat，model=Qwen，ai_tool_scene=zaodian_generate_image，chat_mode=quick
  biz_data := {req:{rootModel:qwen2,prompt,originPrompt,params:{size,features:[qwen_image_2]}},bizScene:genImage}
Qwen验证 := Chat2API保存ticket → 仅千问父域Cookie → 浏览器会员接口成功 → 提交生图
  FAIL_SYS_USER_VALIDATE := 安全验证未完成，禁止标记图片成功；等待用户手动验证后再测
Qwen早期图片解析 := 当时尚未拿到最终响应；当前实现见下方补充
```
以上保留初期协议调查；统一路由和UI已在2026-10-23实现，当前补充如下。

## 2026-10-23 已确认：SubAI 生图与多图聊天持久化

```text
已有声明 := 模型档位服务、共享picker、Game聊天桥、chat.addMessage、historyStore、两端images展示
新增定义 := 图像模型目录、SubAI任务注册表、CSV调用解析、图片组任务、图片资产存储
生图选择 := 同一chatModelTierConfig增加imageSelection/imageProviders；set消息携带purpose=image
配置更新 := 校验已登录Provider与目录模型 → config.set(chat.imageSelection) → 广播权威快照
主AI提示 := raw System正文加入SubAI,生图,"提示词",参考图ID...，不用额外system角色
参考图片 := 当前聊天已保存图片分配稳定ID → 提示给模型 → 只解析当前会话可访问ID
调用行 := 按完整独立行解析CSV，支持引号内英文逗号与双引号转义；不解析代码块
分流 := 任务名查注册表；生图绑定image.generate；动作保持既有链路，不混用模型
流式输出 := 隐藏完整及未完成SubAI前缀；正文照常流式展示/朗读
执行 := 本次回复调用行去重 → 保存pending图片组 → 广播消息 → 当前配置图像服务
结果 := 全部有效图片去重并下载到本地持久目录 → 同一消息更新images数组与completed
错误 := 同一消息更新failed并保留原因；取消终止请求；不自动重复提交
重连/重启 := 从历史恢复图片组与本地图片；未完成记录标为interrupted，不自动再生成
会话隔离 := 更新按稳定messageId，广播携带mode/target/sessionId；晚到结果不写入其他会话
多图 := 一次任务一个图片组，实际返回几张保存几张，不截取第一张
兼容 := GLM三档轻量/普通使用Flash，专业使用5.3；旧媒体路由保留
测试 := CSV/流式半截/代码块/多图/错误/隔离/持久恢复/WS配置/两端界面/Provider路由
```

## 当前实现补充（2026-10-23）

```text
接口约束 := response_format默认url；其他格式拒绝；n拒绝（数量由官网实际结果决定）
参考图输入 := reference_images(data URL数组) 或内部references(Buffer+mimeType)
参考图上限 := GLM快速1；GLM Image0；豆包8（现有上传单图10MiB）；Qwen2
GLM参考图 := chat_upload → drawing-api/v1/image/reference(Intelligent Editing) → image_url
豆包参考图 := upload_image → get_file_url → 独立10052附件消息 + 10000文字消息
豆包完成 := 收集creation图片且end_type=3，否则报流中断
Qwen完成 := 首轮api/v2/chat → 处理中则同一请求api/v1/chat/snap递增snap_index
  multi_load.ai_generate_image_list.content.display_list每个作品取watermark_image或image
  忽略resource_infos内同一作品的缩略图/变体；失败不重新提交生成
Qwen参考图 := 桌面共享profile新建临时页 → 官方requestPromise签名OSS授权/回调 → attachments
  Android无桌面浏览器环境 := 明确返回暂不支持参考图；文字生图仍走Node
资产 := 单图20MiB限制、60秒下载时限 → UUID文件持久保存
失败中已有图片 := 保留已保存图片并标记failed/cancelled，不清空已完成部分
API总时限 := 180秒；失败/取消明确回执，不重发生成
```

```text
GLM文字SSE := meta_data.if_increase_push=true时拼接增量；false时按累计快照取后缀，避免截断SubAI调用
豆包参考图管线 := 上传/地址解析复用同一执行页，不在两个相邻步骤间关闭；最终生成完成才释放临时页
```

## 已确认修复伪代码：唯一生图入口（2026-10-23）

```text
已有声明 := SUB_AI_PROMPT、parseSubAiReply、SubAI任务注册表
新增约束 := 用户生成/改图请求必须输出SubAI调用；禁止调用官网/模型原生生图
提示组装 := 唯一入口约束 + CSV格式/简短调用例 + 可用参考图ID + 原角色设定
验证 := 隔离Responses请求 → 检查完整标签 → 本地分流产生占位；不写当前用户聊天
边界 := 提示词不能等同Provider硬关闭；不新增未经验证的开关参数
状态 := 已实现并验证，保持提示约束与平台能力边界
```

## 2026-10-23 已确认实现：生图提示约束

```text
主AI职责 := 生成/修改图片只规划提示词并输出SubAI；SubAI为唯一生图入口
禁止 := 原生生图/官网画图工具/附件或Markdown图片代替调用
输出 := 独立CSV行 + 简短自然语言；示例展示无参考图调用
信号 := 分流前检查本次options.signal，聊天被清空取消则不执行迟到SubAI调用
界限 := 仅强化提示和已有分流契约，不宣称上游原生能力被硬关闭
```

```text
生图提示用户精简 := 删除“调用行不朗读，未收到应用生成结果不得声称已生成；”两项提示文本
```

```text
Android测试 := ADB当前Offline WebView → 查询实际display-chat能力；code-v148图片事件不识别
隔离新版验证 := 临时frame装载新版聊天模块 → 临时本地HTTPS图片HTTP200 → 单占位更新4图 → naturalWidth>0且不越界 → 历史恢复4图
清理 := 移除frame、精确删除本次临时图片；不保存测试消息，不替换已安装代码
账号核查 := 只读取本机账号摘要；单个豆包已启用，无个人身份字段；凭据不输出
```

```text
双APK核查 := com.aasc.display.offline→127.0.0.1旧code-v148；com.aasc.display→192.168.1.39新版
前台验证 := 普通端已加载处理函数支持图片事件 → 当前源码在同WebView隔离frame → 四图及历史恢复通过
物理截图 := 内屏OFF默认截图无效 → ADB screencap -d 1捕获HDMI实际四图；不用后台WebView截图判断前台结果
账号范围 := Offline本机1条豆包；192.168.1.39共5条Provider记录；不把active摘要当作官网实时身份验证
```

## 2026-10-23 用户指定SubAI提示词

```text
SubAI说明 := 用户最终原文，命令示例为SubAI,生图, "提示词"[, 参考图 ID1, 参考图 ID2...]
替换 := 移除旧唯一入口、禁止原生生图及额外示例说明，只保留用户这次指定的三行说明
有游戏通用说明 := 在该完整说明之后、NowGame之前插入SubAI说明及已有可用参考图ID
无游戏通用说明 := 保持SubAI说明 → 参考图ID → 原角色提示的现有顺序
约束 := 只调整提示及拼接；现有CSV解析、任务调度、取消和图片展示保持现有实现
```

## 2026-10-23 主模型原生图片（已确认实施）

```text
原生输出 := 文字、思考、images[{url或dataUrl}]及image_generation状态并行；仅图也为有效回复
Provider采集 := GLM读取image内容且finish确认，豆包读取creation_block/image_ori且总结束确认，Qwen按作品display_list去重
生成中 := 仅收到明确生图卡片/creation_block时报告pending，不通过普通文字猜测
Qwen续查 := 仅检测到pending生图卡片后，沿原prepared请求调用snap，完成或超时/取消结束，禁止重新提交生成
Responses扩展 := response.output_images事件携带status及本次图片；完成消息content含output_image，URL或dataUrl保持至应用保存
Responses持久 := 会话历史记录images；文本与工具内容仍保留；失败不能提交completed
LLM接收 := 流式消费图片事件及completed/output_item图片，非流式提取output_image/image_generation_call，归一化去重
游戏/SubAI桥 := onImages独立转发，游戏多轮共享本次图片生命周期；不把图片转换为文字或语音
应用保存 := 第一次pending/图片通知创建同一原生回复记录，下载到chat-images，最终文字写回该记录，错误/取消保留状态
图片消息 := 原有chatImageMessage携带requestId，双端将本次原生图片显示到对应流式回复；最终历史按同一ID恢复
删除/清空 := 更新前必须确认记录存在，晚到内容不得复活；取消只终止原图片任务，不补发生成
验收 := 图文/仅图/多图去重、三个Provider、流式/非流式Responses、双桥、保存恢复及取消/失败
```

```text
迟到首图保护 := 每次创建占位/更新/最终保存前检查原用户消息仍在权威历史，临时会话ID仍相同；不依赖当前模型配置
已清空 := 原消息不存在 → 中断本请求signal → 不创建首个图片占位，也不写最终助手消息
重启中断 := pending主模型图片标interrupted时保留已有正文，另附中断说明
```

## 主模型原生图片已实现接口与验证

```text
公共图片工具 := chat-output-images归一化https/dataUrl、明确图片字段与原生base64结果；文字内容单独提取，按URL/dataUrl去重
原生协议 := chat2api-native-images只读GLM的image、豆包creation_block/image_ori、Qwen作品卡片；不匹配正文链接/头像
提供器 := 生成pending只发一次，原流完整完成后才交付图片；仅图非空可成功；Qwen未完成原任务snap，不重新生成
Responses := delta.images/image_generation → response.output_images{status,images}；完成消息content追加output_image；私有会话保留images
LLM := 流式图片事件、output_item.done、completed及非流式图片都归一化；无正文但有图仍成功
重发防护 := 文字/图片/明确生图开始均记为已有输出，中断后不重放；signal穿过三档客户端和HTTP层
应用生命周期 := native-chat-images持有控制器/下载队列 → 第一次明确事件存占位 → 完成正文更新同ID → 落盘完更新图片与状态
持久内容 := 本地URL/图片ID + source=main/requestId/status；reasoning/speech/gameTrace随同一记录更新
双端流式 := chatImageMessage.requestId定位流节点，图片面板独立于正文；匹配范围时保留节点，完成按历史同ID恢复
清空 := 原用户记录与临时会话均仍有效才接收；首图迟到不重建；已清空请求ID在双端丢弃，控制端清空释放流式节点
自测 := chat-images30、chat-streaming63、game-chat80、control-clear4；Chat2API385与后续边界43、签名原生针对性通过
边界 := 官网真实生图与服务包部署另验；本轮不改最终提示词、Android原生或生产依赖
```
