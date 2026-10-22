# Chat2API多Provider生图与模型选择

状态：2026-10-23 已实现；下方早期现场证据保留调查时间语义，当前行为以“实现结果”为准。

## 需求分析
主等级L6（接口与两端模型面板），次等级L5（鉴权、生成、模型路由）。依据：用户要求“Chat2API支持生图接口”和“控制端和显示模型面板加入生图模型选择”。建议下放L4：模型目录→账号解析→Provider适配→图片结果→WS共享选择。风险是官网协议变化、登录失效与模型名称不能证明实际路由成功。需补充：两模型到三档的对应关系、Qwen风控验证后的最终图片结果，以及代码范围确认。

## 范围与方案
GLM聊天模型新增GLM-5.3与GLM-Flash（5.3-Flash）；建议轻量/普通映射Flash，专业映射5.3，用户尚未确认。模型面板额外提供独立生图选择，经AASC WS持久化、初始化快照和权威广播。Chat2API /v1/images/generations按model解析Provider；图片和聊天模型不得混用。GLM/Qwen新增适配器，豆包升级到当前网页协议；保留原媒体接口兼容边界。

## 当前浏览器现场证据
- GLM官网两种聊天模型是GLM-5.3、GLM-Flash；Node按selected_model分别发送“早”，均HTTP200、finish并有正文。旧登记GLM-5.1经Responses stream=true也完成，但不能据此证明调用的是5.1。
- GLM生图两模式：快速（cogview.chat_model为空）与GLM Image（glm_image）。网页均测试；Node两模式均HTTP200/finish，各4张图片，下载探测image/jpeg；单次约14秒和63秒，不作为性能保证。
- 豆包官网生图菜单：Seedream 5.0 Flash、5.0 Pro（4倍消耗）、4.5、4.0。本轮仅测试默认5.0 Flash，网页生成成功；其他模型仅确认可见，未声称实测通过。
- Qwen（国内qianwen，非国际qwen-ai）：使用Chat2API保存票据导入统一profile；旧恢复仅三个host-only域，当前官网还请求api.qianwen.com。现场将同一票据设置为.qianwen.com父域后会员信息success=true、登录提示消失。浏览器提交生图命中FAIL_SYS_USER_VALIDATE并弹安全验证框，尚未返回图片。已观察功能参数qwen_image_2，不将其宣称为已验证底层模型权重。
- 当前Chat2API /v1/images/generations仅连接豆包旧媒体服务，实测503 doubao_media_unavailable；不把网页成功等同API已接入。

## 验收
登录账号隔离；新会话测试不写AASC当前聊天；三档实际模型可辨；两端图像选择保存/断线/重连一致；API按model正确路由、未知模型拒绝、认证失败保留原始安全错误；必须取得图片URL及真实图片类型，纯正文不算生图成功。

## 用户后续约束与Qwen证据

豆包生图只注册Seedream 5.0 Flash、4.5、4.0；用户明确5.0 Pro需要升级会员，必须排除，不作为可选项或回退目标。官网菜单曾显示Pro的事实只保留在调查记录。

Qwen请求为/api/v2/chat，model=Qwen，scene=chat，sub_scene为空，ai_tool_scene=zaodian_generate_image，chat_mode=quick。biz_data.req使用rootModel=qwen2、prompt/originPrompt和params{size,features:[qwen_image_2]}，bizScene=genImage。当前结果是风控失败而非成功图片，不自动反复请求。

此次仅用户授权的浏览器凭证导入和实测，未改登录恢复生产代码；父域Cookie持久导入范围仅千问域，不触碰其他Provider。原代码方案仍待确认。

## 2026-10-23 确认实施
用户已确认模型面板独立生图Provider/模型选择，主AI以SubAI位置参数调用生图，服务端任务注册分流，聊天保存生成占位与全部图片。原有动作链路保留，动作SubAI设计稿不等同已实现。图像使用独立选择，不覆盖主模型。提示词含英文逗号用CSV双引号；参考图仅引用当前聊天图片ID。
本次L6接口契约与L5任务生命周期已下放为上述L4伪代码；以多图、持久化和不重复提交为验收核心。

## 实现结果（2026-10-23）

- 两端共享picker增加独立生图Provider/模型，沿用现有WebSocket配置、持久化及初始化快照。GLM三档使用Flash/Flash/5.3，独立别名保留档位。
- 主AI通过CSV行`SubAI,生图,"提示词",参考图ID...`调用任务注册表；桥接层过滤标签，不进入正文和TTS，动作路径继续独立运行。
- 每个生成任务一个持久占位；所有图片下载到`res/uploads/chat-images/`，原消息更新全部图片；失败、取消、重启中断可见，不自动重复生成。已删除消息不会复活。
- Chat2API统一`/v1/images/generations`按模型路由，`/v1/models`公开六个图像模型。数量由官网决定，返回全部作品；不接受n或非url输出格式。
- GLM快速/GLM Image、豆包5.0 Flash、Qwen文字生图已实测；GLM快速参考图1张、豆包参考图1张、Qwen参考图2张结果已实测。豆包4.5/4.0保留官网模型选项，未逐一实际生成。
- Qwen通过同一请求snap轮询最终作品，忽略缩略图变体。参考图上传使用桌面共享profile内官方SDK签名，Android当前明确拒绝参考图上传；不影响文字生图。
- 自测入口`npm run test:chat-images`，覆盖21项；流式聊天回归63项，runtime/proxy/provider回归31项。无新增依赖，无APK构建；servicePackage保持待构建。

- 最终隔离Responses实测：GLM返回完整SubAI生图调用；修正GLM的if_increase_push增量处理。正式豆包images接口参考图返回HTTP200及1张图片，下载为image/png、2,045,361字节；上传/解析复用页面，避免关闭竞态。
