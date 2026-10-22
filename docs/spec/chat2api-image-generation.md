# Chat2API生图伪代码（待确认实现）

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
Qwen图片解析 := 尚未拿到最终图片响应，保持待实现，不猜字段
```
仅为计划及已观察协议，当前代码尚未实现统一路由和UI选择。
