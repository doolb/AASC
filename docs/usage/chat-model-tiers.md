# 聊天模型三档快选

控制端和显示端右下角点击“模型”，选择当前已配置账号的 Qwen 或豆包，再选择轻量、普通、专业。两端显示实际提交给 Chat2API 的请求模型名、Provider 和档位；Qwen 轻量显示 `aasc-qwen-mini`，普通显示 `aasc-qwen-flash`，专业显示 `aasc-qwen-pro`。选中档位使用当前主题的强调色渐变和外圈，未选中档位使用中性按钮样式。Qwen 初始为普通，豆包初始为轻量；切换 Provider 会恢复各自上次选的档位。

| 档位 | Qwen 目标 | 豆包现有模式 |
|------|-----------|--------------|
| 轻量 | Qwen3.6-Flash | doubao（思考0） |
| 普通 | Qwen3.7 | doubao-think → doubao（思考0） |
| 专业 | Qwen3.7-Max | doubao-expert（思考3） |

选档会修改控制端“LLM 服务器配置”中当前普通 LLM profile 的“模型”字段，保存的值与提交给 Chat2API 的请求名相同：Qwen 为 `aasc-qwen-mini/flash/pro`，豆包为 `doubao/doubao-think/doubao-expert`。控制端手工修改该字段或切换 profile 后，两端也会按当前模型名重新识别并显示请求名。豆包轻量和普通默认映射到 `doubao` 思考 0。旧 `Qwen3.6-Flash` 配置名仍识别为 Qwen 轻量，再次选档会写成 `aasc-qwen-mini`；面板不读取 Chat2API 的自定义映射。未知模型名原样显示并标注未匹配三档。当前 profile 为 Agent 时显示不适用且不可快选，角色 Agent 使用自己的配置。列表按 Chat2API 当前运行实例中已启用、有凭据的账号筛选，账号出现在列表不代表远端登录仍有效。代理未运行或账号失效时，聊天会返回错误，不自动换 Provider 或档位。两端断线时不能提交，重连后以服务器保存的模型名和档位偏好为准。

三档映射由开发统一在 `src/apps/server/modules/chat2api/chat2api-default-model-mappings.js` 维护，界面不编辑映射。面板中的“外部登录（后续开放）”暂不可点；当前仍从控制端 Chat2API 任务卡片进入账户管理和外部认证。Qwen 目标的真实上游可调用性及 Offline APK/ADB 页面还需现场验收。

## 生图

同一“模型”面板下方选择“生图模型”的 Provider 和模型，选择会同步两端，独立于主聊天档位。GLM聊天三档为Flash/Flash/5.3（请求别名`aasc-glm-mini/flash/pro`）。

| 生图 Provider | 模型请求名 | 参考图上限 |
|---|---|---|
| GLM | `glm-image-fast` / `glm-image` | 1 / 0 |
| 豆包 | `seedream-5.0-flash` / `seedream-4.5` / `seedream-4.0` | 8 |
| Qwen国内网页 | `qwen-image` | 桌面2；Android暂不支持参考图 |

告诉主AI“帮我生成一张图”，AI会调用独立一行 `SubAI,生图,"提示词"`；修改已有图片时使用聊天提供的参考图ID，如 `SubAI,生图,"背景改成浅绿色",图片ID`。提示词含英文逗号时必须加双引号，内嵌双引号用两个双引号转义。图片ID由服务端提供，无需用户手写。

聊天先显示生成占位，完成后在同一条消息显示全部返回图片；图片保存在服务端，重新打开聊天仍可查看。可点击“取消生成”；失败或重启中断会显示状态，不自动重新生成。图片数量由官网模型决定。

Chat2API提供 `POST /v1/images/generations`，请求例如 `{"model":"glm-image-fast","prompt":"浅绿色背景的小猫"}`，返回`created`和`data:[{"url":"..."},...]`。参考图通过`reference_images`传图片data URL数组；只支持URL结果，不传`n`，非URL格式会报错。接口保留当前Chat2API的鉴权规则。豆包复用专用浏览器宿主及其登录态；Qwen参考图使用桌面共用浏览器profile的官方上传签名。


主AI提示现已要求生成/改图只调用`SubAI,生图`，禁止调用模型或官网自带的绘图工具、用Markdown图片或附件替代指令；只编写绘画提示词时不提交生图。此约束来自提示词，上游原生绘图能力没有通用的已验证关闭参数。
