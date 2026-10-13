> 2026-10-13 用户回复“可以”批准首批聊天＋四路TTS、扩展默认音色映射及手动API账户准备。首批代码与离线回归完成，未授权真实请求/密钥迁移。

# Chat2API 统一多模态入口与四路 Provider 应用分流（首批已实现）

> 2026-10-13 按用户继续设置的要求修订；**首批统一分流已实现，真实API/设备待验收**。用户已明确四路来源和模型→Provider→应用的方向；用户已批准首批范围与接口、TTS音色映射，以下记录实际实现。API账户由用户手动配置，未迁移真实秘密。

## 目标与现状

用户希望将 qwen-chat（国内千问网页）、qwen-api（百炼）、doubao-api（豆包 API）和 doubaochat（豆包网页）统一由 Chat2API 提供，调用语义为“input（text/audio/image/video）＋ model 名＋系统提示词（可包含 TTS 音色）→ output（text/audio/image/video）”。Chat2API 先用模型名确定 Provider，再由 Provider 根据应用场景解析受控的系统提示词选取相应上游接口。

当前 qwen-chat 与 doubao-chat TTS 已通过 Chat2API speechService；后者为默认关闭、严格账号绑定的实验能力，Frontier Ogg Opus经校验解码为WAV。qwen-api、doubao-api 的 TTS 已迁入 Chat2API API适配器；两个专用API Provider已注册，生成从Chat2API账号库读取凭据。原TTS Registry仅转换业务模型与参数，speechService使用统一能力目录和应用规划。旧TTS私有密钥保留但不参与新生成。豆包普通文字已验证纯 Node 和两轮会话复用，不能沿用旧文档“Node未测试/不可用”的总括结论。

`/v1/responses` 与旧聊天入口在 normalizeInput/extractText 前检查类型，首批不支持的媒体明确拒绝。以下 `/v1/*` 均指 Chat2API 代理实例，控制端沿用 `/api/chat2api-gateway/:instanceId`；不占用主服务已有的裸 `/v1/*`。现有拍照聊天和签名场景 qwen_audio_asr 不代表 Chat2API 已提供图片或ASR能力。豆包 `seed-tts-2.0` 是资源ID，不能直接当作上游复刻 model 发送。

## 已实现范围与保留边界

首批实现现有文字聊天＋四路现有TTS统一；新增图片理解、ASR、图片/视频生成另按明确模型接入。用户已回复“可以”批准首批。结构允许四类输入输出，不代表所有Provider支持任意模态转换。

| 用户名称 | Chat2API Provider ID | 首批应用与证据 |
|---|---|---|
| `qwen`（用户指定名称） | 保留 `qwen`，旧qwen-chat业务名称兼容 | 既有文字聊天/原生续接；既有网页TTS |
| `qwen-api`（用户指定名称） | 新增 `qwen-api` | 迁入现有百炼TTS；API聊天、ASR、图像/视频不因注册而自动宣称可用 |
| `doubaapi`（用户指定名称） | 新增 `doubaapi`，旧doubao-api业务选择转成此归属 | 迁入现有豆包API TTS；资源ID和复刻模型分开保存 |
| `doubao`（用户指定名称） | 对外使用doubao，原账号/会话内部 `doubaochat` ID由别名层兼容 | 既有Node文字/会话复用；已接线但真实整链待验收的网页TTS |

普通文字/工具/SSE、Qwen和豆包会话锁与绑定沿用现有实现。TTS业务继续负责分句、模板、队列、缓存和播放；所有四路云端/网页上游请求归Chat2API。system原生播报仍走本机/显示端。首批不自动把一次聊天追加为TTS，也不额外启动付费/真实请求。

## 已实现的一次请求契约

继续使用 `/v1/responses`，必需字段为 `model`、`input`，可选系统提示词使用现有 `instructions` 字符串。input沿用字符串或message/content数组；`input_text`、`input_audio`、`input_image`、`input_video` 均以类型保存到规范化层，未知类型拒绝。首批只有文字进入已实现适配器；媒体在能力检查处返回 `unsupported_modality`，不会下载URL、读取文件或转成空文字。大媒体上传/临时引用服务属于后续接入，不在本轮制造不可用链接。

TTS输入规则：接受非空字符串，或恰好一条显式`role=user`消息且content只含非空input_text片段；多片段按一个换行符连接，合并后再执行模型字符限制。多消息、assistant/system/developer/tool角色或工具项均在上游前返回400，绝不把聊天历史或instructions朗读。chat应用继续原有多角色/工具契约。

示例（本项目Responses扩展）：

```json
{
  "model": "qwen-api/qwen-audio-3.1-tts-flash",
  "input": [{"role": "user", "content": [{"type": "input_text", "text": "你好，欢迎回来。"}]}],
  "instructions": "<chat2api>{\"application\":\"tts\",\"voice\":\"qiaoxiaojiao_v3.1\"}</chat2api>"
}
```

`qwen-api/qwen-audio-3.1-tts-flash` 是已注册的确切公开别名，真实上游model仍是 `qwen-audio-3.1-tts-flash`。前缀本身不授权任意模型或地址。已增加 `doubaapi/tts` 公开别名，绑定账号侧 resourceId=`seed-tts-2.0`、upstreamModel为空；其它复刻模型通过显式映射另登记。四个对外来源名称按用户最新要求使用qwen/qwen-api/doubao/doubaapi；现有网页ID与旧业务名称只在兼容层转换，不批量改写账户或聊天会话。

统一输出沿用Responses外壳 `id/object/status/model/output/output_text`：文字仍用既有message/output_text；TTS的message/content含 `{type:output_audio, format:wav, mime_type:audio/wav, data:Base64}`，output_text为空。音频项属于本项目扩展，不宣称第三方Responses客户端天然支持。内部适配器返回Buffer，到HTTP JSON边界才编码；旧 `/v1/audio/speech` 直接返回同一Buffer的audio/wav二进制。

首批TTS仅非流式、单次合成，音频解码后≤16MiB，外壳Base64预算≤24MiB，沿用代理现有50MiB总请求上限而不提高它。TTS `stream=true`、tools、previous_response_id/conversation/Pi续接字段在请求前拒绝；纯文字流式与会话复用继续原契约。TTS响应不进入聊天会话库；不声称已有多用户媒体下载或音频会话续接。text+audio联合输出首批不支持。

## 模型归属和Provider内部分流

1. 模型目录登记确切公开别名、Provider、上游model/resource、默认应用和应用能力；显式模型映射优先。同名模型的新统一调用须通过限定别名/显式映射消歧，不新增按前缀随意透传。
2. 已有纯文字请求无新控制块时继续既有映射/调度规则，避免改变共享同名模型的旧行为；显式绑定的Qwen/豆包续聊沿用原会话Provider/账号核验。统一入口的新增分支不重新选取已绑定账号。
3. 确定Provider后，它解析受控instructions并从应用表选chat/tts等适配器，校验模型允许的输入输出组合，再读取该Provider账号。明确模型不支持tts时，不能仅凭提示词偷偷替换成另一模型。允许多应用的公开别名必须明确登记每个应用的实际映射。
4. 应用路由使用注册表/函数映射，不增加长if/else链。业务TTS的四路名称只在薄层转换为已登记模型别名，薄层不保存密钥、不构造上游HTTP。

装配按“规划、执行”分开：统一Responses入口先取得应用计划，chat计划进入原会话流程，tts计划进入应用执行服务；应用服务不反向调用统一Responses入口。旧chat入口同样先做类型/能力检查。聊天加载既有会话后再核对计划的Provider/模型与原绑定，保持只选择一次账号，不递归分流或绕过续接锁。

### 文字与TTS共用模型映射（2026-10-13用户追加）

已有modelMappings继续有效，包括用户提到的qwen3.6flash别名；不改变原model/actualModel/preferredProviderId/preferredAccountId、大小写与通配符匹配语义，不在本轮读取用户实际映射配置来猜具体目标。映射现在同时解析上游模型、Provider/账号偏好及可选application/parameters；旧记录返回结构和匹配规则不变。

扩展同一模型映射记录，增加可选application和parameters；旧记录无新字段时按原规则处理。用户给出的别名配置：

```json
{
  "model": "qiaoxiaojiao",
  "actualModel": "qwen-api/qwen-audio-3.1-tts-flash",
  "preferredProviderId": "qwen-api",
  "application": "tts",
  "parameters": {"voice": "qiaoxiaojiao_v3.1"}
}
```

调用者只需传 `model=qiaoxiaojiao`、input文字，就可取映射默认tts应用与音色；无需重复在instructions写同一音色。映射actualModel在统一目录解析为上述限定模型，再生成真实上游model=qwen-audio-3.1-tts-flash。Provider/账号偏好跨两次解析不得丢失；限定模型与映射Provider冲突就报错，不切换来源。单次映射解析，不递归追逐别名链。

参数顺序为“请求显式参数（speech字段或instructions控制块）→映射parameters默认值→模型/Provider默认值”；显式来源之间冲突仍报错。应用须符合映射及目标模型的允许集合，不能把tts别名用来绕过能力检查。parameters首版只接受voice/speed/volume/format，禁止任意endpoint、headers、凭据或上游body透传。

模型映射编辑器增加应用/默认音色及可选合成默认值，保存、列表、再次编辑、导出、导入均保留；旧文字记录不自动填tts字段。新tts别名可用于统一Responses、旧speech和TTS业务模型配置，应用仍为tts；旧chat/completions使用tts别名时明确报应用不支持。映射变更不改写既有会话的Provider/账号/上游模型：文字续接保留绑定并核验，目标变化冲突要求新建会话，避免把历史转到新模型。

### 系统提示词中的控制块

只识别 `instructions` 开头一个 `<chat2api>JSON对象</chat2api>`，上限4096 UTF-8字节；仅允许 `application/voice/speed/volume/format`，重复块、坏JSON、未知字段、冲突参数均返回400。其余自然语言在chat应用原样作为系统指令。user/tool正文和历史内容中的相同标记永远不能切换应用。控制块不会透传给LLM。

单用途模型可以省略application；已有chat默认chat，唯一tts模型默认tts；用途仍不唯一则返回 `ambiguous_application`。`output_modalities` 可选，作为输出约束而非覆盖模型能力；与控制块冲突明确拒绝。旧speech端点voice等字段与控制块同时存在时要求值一致，不以隐含优先级覆盖。TTS适配器不支持自然语言风格指令时，对非空剩余instructions明确报错，不承诺自动理解“更温柔”等描述。

统一speed为倍率（0.25–4），volume为0–100。TTS业务-10..10只转换一次：倍率=2^(旧speed/10)。Qwen API保留本地PCM重采样语义；豆包API保留上游speech_rate；网页豆包仍固定默认音色/1倍速/100音量及1000 UTF-16字符、4000 UTF-8字节。Qwen API仍600 Unicode字符/句；旧业务分句不移到协议路由。voice受Provider/模型格式和目录约束，目录非穷尽时不把未知合法ID当已验证可用。

## 账号与配置

运行时凭证统一由Chat2API账号库读取：网页继续既有账号；两个API Provider使用 `credentials.apiKey`，端点和资源参数由管理配置指定，不能从系统提示词取endpoint/headers/accountId/密钥。主服务内部业务复用相同应用服务工厂及账号根目录，不启动第二个HTTP代理；代理自定义rootDir继续显式隔离，不扫描别人的账号目录。

首版通过现有Chat2API账号管理/凭证包导入配置两个API账号。默认不自动读取、搬迁或清除旧TTS密钥；旧私有字段保留供用户回滚，但切换后的生成不回退使用旧密钥。缺账号时返回“请在Chat2API配置账号”，部署切换前须先准备账户与模型映射。用户如要求一次性迁移现有值，再将预览、冲突保护与回滚纳入具体方案；本轮未访问实际凭据。

TTS页面保留业务选择、启用、模型、音色、速度和音量；API密钥及上游endpoint/resource改在Chat2API管理，页面显示账号管理说明；账号格式验证状态在Chat2API账户页显示。TTS参数保存/权威回传/重连仍使用setTtsProviderConfig与config.set，不新增平行HTTP配置接口。API手动入库只做格式校验且显示“未做远端鉴权验证”，不在保存时自动合成或聊天；豆包网页的既有安全登录校验限制保留。

API凭证的“未远端验证”单独记录于验证元数据，不占用现有账号active/disabled调度状态；可调度只表示已启用且格式完整，不能在UI上显示为远端登录成功。

## 实施文件与验证范围

具体文件、L4数据流和验收步骤分别见对应spec与 `docs/task/20261013_Chat2API四路统一模型应用分流.md`。先建共享应用服务和能力目录，再接兼容入口、迁入API TTS、替换业务直连，最后调整配置UI；每步跑现有离线测试。TTS上游网络工具需补AbortSignal贯通，单次60秒总时限覆盖调度/合成/下载/解码，避免HTTP断连后继续下载；豆包文字沿用既有120秒会话截止，不混用TTS时限。

日志无论full/compact都只记录媒体类型、大小和格式，不写Base64、Buffer、签名音频URL或凭据；错误固定脱敏。沿用现有WAV验证和缓存下载，Ogg不得伪装成WAV。首次真实端到端验收另需明确授权，不用之前诊断的成功代替本次统一接口测试。

## 验证与后续边界

两项独立终审Important已修复：Responses规划阶段纳入总时限/取消，TTS拒绝实际Pi metadata续接语义。当前计划入口最多60秒，规划后只向语音传剩余预算；文字仍原有120秒会话截止。所有验收使用虚构账户/本地HTTP/本地音频，不发送真实聊天或合成。

API账号手动表单新增可选endpoint（两路）和resourceId（doubaapi），秘密只留credentials.apiKey，非秘密字段校验后留accountInfo，生成以所选账号为准。业务页面不再编辑这些值；旧私有TTS配置仅供回滚，不参与生成。

网页qwen新保存映射别名带mappedModel标记，重载保留；升级前无标记的旧错误模型恢复原QUARK_VOICE，避免把拼写错误误当可用别名。网页qwen原始API模型不可误用；首版别名规范为非空短标识。

后续可选：明确模型的ASR/图片/视频应用、媒体上传引用及混合/流式音频输出；实际API账户、网页朗读完整业务、长期维护与设备声音仍另行验收。首版统一不代表四路所有模态互转，不代表服务已重启或Offline已经出包。
