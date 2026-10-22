# Chat2API多Provider生图与模型选择

状态：2026-10-22已现场调查，代码方案待用户确认。

## 需求分析
主等级L6（接口与两端模型面板），次等级L5（鉴权、生成、模型路由）。依据：用户要求“Chat2API支持生图接口”和“控制端和显示模型面板加入生图模型选择”。建议下放L4：模型目录→账号解析→Provider适配→图片结果→WS共享选择。风险是官网协议变化、登录失效与模型名称不能证明实际路由成功。需补充：两模型到三档的对应关系、Qwen当前生图登录与模型参数，以及代码范围确认。

## 范围与方案
GLM聊天模型新增GLM-5.3与GLM-Flash（5.3-Flash）；建议轻量/普通映射Flash，专业映射5.3，用户尚未确认。模型面板额外提供独立生图选择，经AASC WS持久化、初始化快照和权威广播。Chat2API /v1/images/generations按model解析Provider；图片和聊天模型不得混用。GLM/Qwen新增适配器，豆包升级到当前网页协议；保留原媒体接口兼容边界。

## 当前浏览器现场证据
- GLM官网两种聊天模型是GLM-5.3、GLM-Flash；Node按selected_model分别发送“早”，均HTTP200、finish并有正文。旧登记GLM-5.1经Responses stream=true也完成，但不能据此证明调用的是5.1。
- GLM生图两模式：快速（cogview.chat_model为空）与GLM Image（glm_image）。网页均测试；Node两模式均HTTP200/finish，各4张图片，下载探测image/jpeg；单次约14秒和63秒，不作为性能保证。
- 豆包官网生图菜单：Seedream 5.0 Flash、5.0 Pro（4倍消耗）、4.5、4.0。本轮仅测试默认5.0 Flash，网页生成成功；其他模型仅确认可见，未声称实测通过。
- Qwen（国内qianwen，非国际qwen-ai）网页仅看到AI生图/比例入口；恢复现有账号票据后提交出现扫码登录，等待用户登录，不猜测底层模型。
- 当前Chat2API /v1/images/generations仅连接豆包旧媒体服务，实测503 doubao_media_unavailable；不把网页成功等同API已接入。

## 验收
登录账号隔离；新会话测试不写AASC当前聊天；三档实际模型可辨；两端图像选择保存/断线/重连一致；API按model正确路由、未知模型拒绝、认证失败保留原始安全错误；必须取得图片URL及真实图片类型，纯正文不算生图成功。
