# GLM三档及多Provider生图

## 任务
用户要求GLM两种聊天模型进入三档、Node实测，GLM两种生图、豆包/Qwen网页生图测试与模型调查，Chat2API生图接口和两端生图模型选择。

## 设计与实现方案
见design/spec/chat2api-image-generation.md。拟改default-model-mappings、provider-registry/adapters、runtime/proxy-service、chat-model-tier-service及共用picker，新增image-service和GLM/Qwen图像适配器；补相关定向测试。代码范围与三档映射已发确认，尚未收到回复。

## 已验证
GLM两种聊天Node成功；两种图像Node各4张JPEG；豆包默认Seedream5.0Flash网页生成成功，四模型菜单已确认；Qwen已用保存凭证恢复网页登录，生图触发风控待手动验证；现有图片API503。未改业务代码、未切换用户当前模型配置、未写AASC聊天消息。现场样本仅保留/tmp，不提交凭据/截图或用户历史。

## 自测计划与风险
路由/模型能力/账号选择/错误/取消/图片去重及头像过滤；控制与显示端WS配置一致；旧豆包媒体接口兼容；生产Responses流式与图像真实下载校验。性能用有限单次探测，不批量生成收费模型；网页UI或接口变更需按实际结果修订。预计1～2工作日，依赖官网稳定和已登录会话。

## 待确认
三档映射；实施方案；Qwen安全验证后的生图复验。未完成项保留todo，后续完成再移除。

用户补充：豆包图像选择仅保留5.0 Flash/4.5/4.0，排除会员5.0 Pro；已更新design/spec。Qwen父域导入后登录成功，当前停在官网安全验证，未改业务代码。
