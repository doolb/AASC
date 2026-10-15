# 豆包Chat音色目录、显示端快选与回复播放

日期：2026-10-15。状态：目录与筛选已落地；本轮完成共享音色面板、显示端保存修复和语速滑条，服务v100已通过ADB验收并发布LAN/WAN。此前合并远端1fb11b7c的记录保留于历史任务。

## 三下拉筛选、选中样式和打开定位（2026-10-15）

用户已看过独立HTML并确认第二版：性别、年龄、口音为同排三个原生下拉框。正式面板已接入相同交互，复用真实94项目录及原声纹页全局权威配置。初版Tab已被用户反馈替换。

性别读取gender；年龄只认标签小孩、少年、青年、中年，口音读取实际口音/话后缀标签。缺少属性显示未标注，不从名称或成熟等风格标签猜测。每个下拉含全部和计数，三维度与搜索取交集，可一键清除；筛选只改变面板内存，不提交配置。

当前音色在顶部显示名称，点击可定位。列表当前项使用主题强调渐变、白字、边框及勾选，其余使用中性背景和普通文字且隐藏勾选，保留aria-selected。选中以服务器回显为准，保存中/失败仍保留旧值，成功才切换；没有匹配ID不静默选第一项。系统原生显示系统默认。

每次打开面板清搜索和筛选，异步目录到达或已有缓存渲染后，仅滚动列表到当前音色。定位使用代次和Provider/模型key，关闭、主动筛选、断线使旧定位失效，不反复抢滚动。切换方式清条件，迟到目录不能覆盖其它方式；当前名称同时随配置与目录更新。

正式修改为display.html、js/display-tts-voices.js、css/display-mmd.css；常规高度固定头部/筛选，沿用舞台安全区，列表独立滚动；短屏保留120px列表并允许面板内部滚动，确保当前音色仍可见，不移动页面。无服务端接口、目录JSON或配置结构变化。卡片重绘时用事件composedPath识别面板内部，避免点击音色后误关闭。

只读自测display_voice_filters核对部署HTML入口；真实Chrome回归覆盖94项/女32/三条件交集1项、搜索、选中CSS、失败/成功回显、首开/缓存定位、其它Provider未标注、未知ID/原生、断线重连及手机390×740、横屏740×390和短屏390×400边界。与旧聊天/舞台/TTS UI共19/19，既有手动/并发21/21通过；未重启运行服务或出包，Android实物验收保留。

交互预览历史保留在.cache/voice-selection/voice-panel-preview.html，仅为离线演示；正式模块连接AASC/WS权威保存。任务见../task/20261015_音色面板筛选Tab与选中定位.md。
## 用户需求

- 将本次整理的94项音色接入Chat2API豆包Chat Provider，由Provider提供目录和合成能力。
- 单独保存一份JSON，按男/女分组，每项包含名称、style_id、标签。
- 正式显示端右下角、灯光按钮上方增加音色选择，支持快速切换。
- 显示端AI完成回复后增加播放图标，与控制端一样，点击播放该条回复的TTS。
- 用户补充：界面再增加TTS方式选择，音色选项随当前方式变化，并修改对应方式的音色。

## 实施前代码证据（历史基线）

- `chat2api-speech-service.js`、`chat2api-doubao-speech-protocol.js`、`tts-provider-policy.js`、`tts-provider-settings.js`及`doubao-chat-tts.js`均存在固定温柔桃子约束；需要贯通参数，不能仅新增UI。
- `speechService.voices(model)`已有业务目录方法；TTS Provider已有`voices()`及`getTtsProviderVoices`查询消息。当前后者仅允许控制端；显示端读取目录需独立的窄权限接线，不开放完整控制端权限。
- `display.html`的`.display-stage-lighting-control`是真正灯光/动作/定位入口；`display-stage.js`控制初始化及层级，适合新增独立快选模块。
- `display-chat.js`已有完成回复、流式节点和历史渲染；控制端`chat.js`已有`tts/play`与`chatReplyContext`。服务端显示端入口当前只处理tts/stop，不能直接假定新增播放按钮即可播放。
- 当前目录来源为官网实际五类第一页卡片，94个唯一style_id，按性别归并女32/男62。接口全部分页不是本次需求范围。

## 采用行为：复用当前声纹页的TTS设置

用户已选定沿用当前声纹页中的语音服务与音色设置。显示端是同一份全局AI/Agent默认配置的快捷编辑入口，模板继续使用现有优先级。此前按显示端分别保存和本端覆盖模板的候选方案不采用。

- 面板先选择TTS方式，再选择对应音色。复用项目现有AI/Agent可用方式及其Provider目录，豆包Chat使用女声32项/男声62项，可按名称/标签搜索；其它方式使用各自目录，不能将豆包style_id传给其他Provider。系统原生按现有默认路径处理，没有目录时不展示错误的豆包音色。
- 现有`qwen-chat`目录只返回固定单项，并未随settings.model切换完整目录；本次沿用这一已知能力，不宣称为其它方式补齐未验证的音色库。无完整目录时显示已知默认/已有受支持选择，不从豆包或API音色表拼接。
- 当前方式复用`tts.aiReplyDefault.provider`；对应音色复用`tts.aiReplyDefault.voice`和现有`providers[provider].defaultVoice`。切方式恢复该Provider已保存的defaultVoice，并写入AI/Agent默认选择；改音色仅patch当前Provider的defaultVoice及AI/Agent选择，不覆盖其它方式设置。系统原生保留现有原生路径，业务voice为null。
- 各方式音色记忆使用既有Provider配置，不新增按端配置表。模板显式Provider/音色仍优先；模板“继承AI默认”随当前全局默认变化。其它业务若按现有规则继承Provider默认音色，也沿用原生效语义，不另设例外。
- 复用`setTtsProviderSettings`/`ttsProviderConfig`的规范化、保存和权威回显，向控制端和显示端补发所需公开配置；未收到初始配置时禁用提交并显示等待同步，朗读继续原服务端默认路径。持久化失败回传旧值，UI不假定成功。
- 保存采用字段级patch，避免旧整表覆盖其它Provider或并发修改。显示端入口只允许修改AI/Agent默认Provider及对应音色，不开放启用、凭据、端点、模型或其它业务配置的写权限。
- 保持已有Provider启用和账号管理边界；未启用或无可用账号时明确提示，不自动登录、换号或修改全局Provider启用状态。
- 当前播放/分句批次捕获既定配置，切换只影响下一次播放，避免一句一音色；沿用当前全局/模板解析及目标路由，不新增按端选择或多目标音色分组功能。原生生成设备、并发上限、分句顺序和取消代次均保持原约定。

## 目录与Provider契约

已新增`src/apps/server/modules/chat2api/doubao-chat-voices.json`，顶层`female/male`数组，每项仅`name/style_id/tags`。从已验证94项快照生成，不保存Cookie、预览签名URL或调研元数据。

已新增目录读取模块，为Chat2API及业务TTS层提供同一目录、style_id集合与缺省音色。Provider返回UI兼容的`id=style_id`、中文名称、gender、tags；未知style_id明确拒绝，不从名称推测、不回退另一个音色。目录发现不代表94项均已完成真实合成验收。

`/v1/audio/speech`继续接收`model=doubao-chat`与`voice=style_id`；沿用现有账号调度、每账号队列、1倍速、默认上游音量及WAV解码。目录只读查询不调用豆包上游，无新增配置HTTP读写入口。

豆包静态目录查询直接读取共享JSON，不先调用依赖模型映射/账号的planner；无账号或Provider禁用时目录仍可离线查看，启用/可合成状态单独表示。生成请求仍严格走已有账号/配置校验。

### Chat2API对外音色目录接口（已实现）

原实现只有内部目录；本次已在`chat2api-proxy-service.js`接入Chat2API扩展接口`GET /v1/audio/voices?model=doubao-chat`，由代理服务复用相同目录方法；各方式通过对应语音模型查询，不在页面维护各自副本。

- 使用代理现有Bearer或X-API-Key鉴权，不需要客户端提供豆包Cookie；缺少/无效Key返回现有401语义。缺少、重复或不支持的model查询参数返回400，不能静默变为另一个方式。
- 成功响应为`{object: list, model: 请求模型, data: 音色数组}`。豆包每项含`id=style_id`、`style_id`、`name`、`gender=female/male`、`tags`，共94项；其它方式沿用其真实目录能力及统一基础字段，不承诺不存在的男女标签。
- 这是只读业务数据查询，不读取或保存当前选择，不新增配置HTTP接口；选择仍通过AASC/WS权威保存/回显。
- 豆包目录由Provider静态JSON离线提供，不要求存在可合成账号，不访问豆包、不触发合成；读取目录不代表Provider已启用或账号可用。
- 显示端通过已有主服务WebSocket目录查询能力，由主服务调用同一目录服务；不把Chat2API代理Key放进显示端网页。对外API和内部WS共享数据源及规范化逻辑。
- HTTP目录路由、鉴权、查询参数、94项字段结构、无账号目录、其它方式兼容及根路径能力列表均纳入代理测试。

## 显示端回复播放

完成且非空的AI/Agent消息提供播放按钮，流式未完成/错误消息不提供可用按钮。保留消息speech、所属模板/角色、会话和原输入等上下文，优先朗读speech，否则正文；不朗读reasoning。

服务端复用并抽取现有手动TTS处理，剥离Markdown、分句、排队、缓存、播放回执/错误及停止逻辑不复制。显示端请求只能播放到自身，目标由服务端已登记连接确定，不接受伪造displayId、displayIds、broadcastAll或控制端播放目标；请求不接受客户端任意覆盖账号/模板配置。

同一权限边界覆盖播放和停止：现有显示端`tts/stop`的chatOnly分支仍转交客户端displayIds/playOnControl，新增重播接线时必须一并收口为自身目标，控制端已有合法多端停止仍保持。

点击后调用TTS重播该回复，不重新请求LLM；处理重复点击、生成中/播放中状态和停止/失败后的恢复，回归字幕、口型与聊天关闭时现有层级。

现有控制端手动播放没有完整生成状态回执；抽取服务时新增有requestId/本端播放代次的开始、生成失败和结束状态，使按钮恢复不依赖猜测时限。播放/停止/取消均使用服务端绑定目标及代次过滤迟到结果。

## 实际修改文件与职责

| 范围 | 文件（相对项目根） | 变更 |
|---|---|---|
| Provider目录 | 新增`src/apps/server/modules/chat2api/doubao-chat-voices.json`、`chat2api-doubao-voices.js` | 精简94项目录、读取/校验/分组映射 |
| 豆包合成 | 同目录`chat2api-speech-service.js`、`chat2api-doubao-speech-protocol.js`、`chat2api-doubao-speech-adapter.js` | 接受已登记音色并传入tts.speaker，缺省兼容 |
| 对外目录 | 同目录`chat2api-proxy-service.js`及其测试 | 新增GET /v1/audio/voices?model=，复用目录服务、现有鉴权及错误格式，更新能力入口 |
| 业务TTS | `src/apps/server/modules/tts/doubao-chat-tts.js`、`tts-provider-policy.js`、`tts-provider-settings.js`及必要的`tts-provider-service.js` | 移除固定单音色约束，复用目录与参数校验 |
| 权威配置 | `src/apps/server/modules/tts/tts-provider-ws.js`与`server-app.js`接线 | 复用现有AI/Agent默认和Provider音色配置，显示端仅获方式/音色写权限；回显/广播/初始化，不新增持久化配置结构 |
| 回复重播 | 新增`src/apps/server/modules/chat/chat-manual-tts.js`及`server-app.js` | 抽取既有手动TTS流程，本端播放权限及原模板/默认音色解析 |
| 快选UI | `src/apps/web-mediacenter/ui/public/display.html`、新增`js/display-tts-voices.js`、`js/display-stage.js`、`css/display-mmd.css` | 灯光上方入口、TTS方式、该方式音色、豆包男女目录、搜索/选择/权威回显 |
| 播放UI | `js/display-chat.js`、`css/display-chat.css` | 完成回复和历史重播按钮及上下文 |
| 控制端一致性 | `src/apps/web-mediacenter/ui/public/js/tts-provider-settings.js` | 豆包音色可选并共享Provider目录，移除只读单音色UI约束 |
| 验证与说明 | 相关Chat2API/TTS/显示端测试、`js/self-test.js`、`docs/spec/self-test.md`、`docs/self-test.md`及usage | 真实流程回归与能力自测，不自动逐个上游合成 |
| 发布标记 | `release/offline-release-status.json` | 代码实施后仅将servicePackage设true；不更改minApk/dependenciesPackage，不构建发布APK |

## 验收与风险

- 94项、女32/男62、style_id唯一、字段符合精简JSON；缺省音色存在，错误音色拒绝。
- 对外目录接口通过代理Key鉴权，query参数明确，响应与内部目录一致；无可合成账号也能读取豆包静态目录，无配置副作用或豆包请求。
- Chat2API及业务TTS音色贯通，目录查询无上游访问，旧缺省请求、其它Provider及语速/音量约束保持。
- 权威保存失败、重连、控制端与显示端修改同一份配置、并发patch、越权写其它参数、无账号/未启用、非法消息均有确定结果。
- 方式切换只显示对应目录，各方式独立记忆；切回恢复原音色，目录异步响应按Provider/requestId匹配，迟到响应不能覆盖当前方式。系统原生无目录、其它Provider缺少音色/凭据以及切换失败均有明确状态。
- AI/Agent完成回复及历史重播正确；流式/失败/reasoning不误播，长正文仍分句，模板/原输入上下文正确；重复点击、停止和会话切换不出现迟到音频。
- 控制端/显示端自动回复和手动重播均遵守原模板覆盖全局默认优先级；仅继承默认的模板跟随快选，显式模板保持其既有选择。
- 浏览器检查按钮在灯光上方、手机竖屏、键盘/旋转安全区、面板与聊天层级；Android实机及多音色真实听感未验证前保持待验收。
- 优先运行`npm run check:chat2api`、`npm run test:mmd-production:tts`及必要的现有TTS/显示端定向测试；没有script的定向用`node --test`。不因mock通过宣称94项真实合成通过。

## 需求等级分析（enterprise，方案阶段）

主等级L6（目录、Provider参数、回复播放三个模块契约），次等级L5（选择/重播流程）、L7（AASC权威同步）；必须拆到L4数据流实施。证据分别为“由Provider支持提供”“一份JSON男/女名称style_id标签”“回复后播放对应TTS”；流程和同步为中等证据。强证据权重9、总权重13、邻层一致系数0.90，置信度约0.62。配置作用范围和优先级已由用户补充为复用现有声纹页TTS设置；评分：层级24/25、证据18/20、完备19/20、风险19/20、L4落地14/15，总94/100。结论为方案可开发，用户后续已确认并要求先同步Git，现已完成实现；具体验证边界见任务记录。

## L4草案

```text
已有声明 := speechService.voices、createTextTtsSession、ttsProviderService、DisplayChat、手动tts/play
新增定义 := VoiceCatalog { female, male }；VoiceEntry { name, style_id, tags }
已有配置 := tts.aiReplyDefault { provider, voice } + providers[provider].defaultVoice
目录 := 已验证快照 -> 保留94个style_id -> 按gender提取name/style_id/tags -> Provider读取
选择 := 当前TTS方式 + 对应音色 -> 窄权限/Provider/目录校验 -> patch对应默认音色及AI默认选择 -> 原权威保存/广播
合成 := 原模板/AI默认/Provider默认优先级 -> 捕获批次参数 -> Chat2API账号 -> speaker=style_id -> WAV
重播 := 完成回复speech/正文 + 来源上下文 -> 本端权限 -> 既有分句TTS -> 自身播放与回执
```

实现及独立终审已完成：本端输入上下文、顶层speech、普通AI/Agent整批快照和远程停止均补充回归。TTS及浏览器定向201/201、既有手动/并发21/21通过；Chat2API259/262，3项为既有Windows权限断言。Android真机和94项逐一真实听感待验收。

## 横屏两列追加（2026-10-15已确认接入）

用户明确选择左侧设置/筛选、右侧音色列表，并已接入正式页面。新增settings/results分组；横屏且可用宽度≥620px时，面板扩到安全区内最多640px，两列分别可滚动，标题与状态跨列。左侧省略重复可见标签但保留无障碍名称，三个下拉维度label始终可见。竖屏及较窄屏幕维持单列，短高度继续保留面板内滚动降级。

真实Chromium740×390：左右列同顶不重叠，面板边界内，右侧列表及当前项可见，页面scrollY=0；回到390×400/390×740仍保持原单列及定位。独立HTML亦同步更新。执行记录见../task/20261015_音色面板横屏两列.md。


## 显示端保存修复与控制端共享快选（2026-10-15，已完成实现与ADB验证）

用户报告显示端方式与音色切换均不生效，并要求控制端右下角增加浮动音色入口，已授权使用ADB设备验证。SM-N9500 Android9/min58/code96上已复现两类操作均返回“TTS快选参数不合法”；同一设备通过控制端连接发送相同合法选择可成功保存，恢复原设置也成功。当前角色小爱没有模板TTS覆盖，排除本次现象由模板优先级导致。

根因：server-app.js显示端WebSocket入口将已登记的displayId补入消息，随后传至tts-provider-ws.js；后者快选白名单仅允许type/provider/voice/requestId，因额外displayId拒绝。拟在显示端快选转交边界移除这一个服务端传输字段，保留所有业务字段及未知字段拒绝、连接身份校验。无需放宽完整Provider配置权限。

控制端新增右下角“音色”浮动按钮，沿用当前浮动工具组的间距与手机安全区，避让齿轮、自测和暂停录音入口；面板含方式、当前音色、搜索、性别/年龄/口音筛选、列表和保存状态，点击关闭/外部点击/Escape可收起。显示端和控制端共享选择组件与目录，继续编辑声纹页同一份全局AI/Agent默认配置，保留角色模板原优先级，并清楚标注配置范围。切换只影响后续语音批次，已在播放的语音沿用原快照。

继续使用getChatTtsConfig/getTtsProviderVoices/setChatTtsSelection及ttsProviderConfig权威广播；服务端规范化并经config.set持久化，首次连接/重连补发。控制端声纹设置页与两端快捷面板同时回显，失败恢复权威值；不新增HTTP配置接口。未启用方式明确提示，保持原有启用配置职责。

拟修改server-app.js、display-tts-voices.js、upload.html、websocket.js，新增共享快选模块/样式与控制端接入；现有显示面板样式按需提取，确保横竖屏/旋转/主题/短屏可用。增加真实入口字段注入回归、两端组件与多端配置回显用例。实施后仅servicePackage=true；min/依赖/任务ZIP不因本功能重建。生产代码已完成；只构建服务v100本地签名候选并在ADB设备验收，未发布LAN/WAN。候选覆盖当前源码，servicePackage=false，其它产物保持false。

ADB证据保留在忽略目录.cache/adb-tts-panel-20261015/；只记录脱敏语音选择与配置状态，不记录凭据/聊天正文，原默认qwen-chat/voice=null及豆包温柔桃子音色已恢复。执行计划见../task/20261015_音色快选修复与控制端浮动面板.md。


### 本轮补充：共享语速滑条（用户已确认）

显示端和控制端音色面板增加同一套语速滑条，范围-10到10，拖动预览、松手保存。复用每Provider独立defaultSpeed及原生能力规则，不使用新全局参数；豆包网页朗读与不支持原生rate的Qwen3模型隐藏。窄权限setChatTtsSelection增加可选speed，仅写目标Provider的语速，不同时改音色或AI默认选择；服务端验证能力/数值并规范化、持久化及广播。新批次生效，当前批次保留原快照。


### 共享面板实施结果（2026-10-15）

- 已由tts-voice-picker.js的实例工厂统一两端状态、目录、请求ID、筛选、定位与语速；display-tts-voices.js保留原显示入口，control-tts-voices.js适配现有WebSocketManager，tts-voice-picker.css统一面板内容并保留宿主定位。
- server-app显示快选转交仅剔除权威传输displayId；业务白名单保持，speed仅更新指定Provider.defaultSpeed，拒绝无效数值、无原生能力及同时提交voice。
- 新增test:tts-voice-picker脚本及控制端真实WS/双页面回归；全量20/20，既有聊天手动/并发播放21/21。真实生成服务验证旧批次保留0、新批次使用3，不依赖实网合成。
- 发现正式源已被其他流程推进99，按最新签名基线构建本地候选100，不覆盖97/98/99或正式清单。服务ZIP17,808,097字节，SHA256 cbd160f3dea59be7a00e13963de2a6e5063736a5bc23a4c92721a36d4c03db75，1096项与当前源码一致；复用min58/deps10/task1/seeds86/repair3。
- SM-N9500 Android9原生99→100只下载服务ZIP，Node健康pending=false。显示端实际改方式/豆包94项中改选均成功，控制端同步；ADB物理点击浮钮及拖动滑条0→3成功，两端权威语速为3。截图确认面板在屏幕内，浮钮避让录音/自测/齿轮。原全局选择、各方式音色/语速/启用/模型已逐字段核对恢复。
- 正式旧99源检查CURRENT/0字节/无错误；无新聊天/官方合成请求，未以配置验证宣称全部音色听感已验收。证据保留忽略目录.cache/adb-tts-panel-20261015/，本轮未发布LAN/WAN。

## 音色列表按钮状态（2026-10-15，已完成源码与浏览器验证）

用户要求音色列表的选中和未选中采用项目按钮状态样式，两端共享。已将选中项呈现为主题强调渐变、白字和强调边框，未选中项呈现为中性背景、普通文字和边框；保留选中勾选，并保证副标题可读。浅色主题的全局button重要规则目前覆盖列表背景和文字，已在共享组件内按状态明确覆盖；深色主题保持同样的状态区分。

选中依据仍为服务端权威音色，保存失败或等待中保持原项；悬停、键盘焦点、禁用状态应可辨识。修改共享tts-voice-picker.css，直接使用aria-selected，无新增active变量；补充双端light/mint/深色主题、悬停/键盘焦点/禁用样式断言，扩展只读SelfTest识别普通项被渐变覆盖。定向20/20通过，仅servicePackage=true，尚未出包发布或ADB验收本次样式。详见任务20261015_音色列表按钮选中状态.md。

## 豆包Chat表情分句中断（2026-10-15，待确认）

用户报告“喵呜～主人好呀！✨\n\n人家是妲己，一只拥有九条尾巴的电子猫娘哦！🐱💻⚡”中途停止。本机logs/server.jsonl在三次同一原文的手动重播后均记录doubao_speech_incomplete；手动链路只清Markdown再分句，没有自动播报的parseReply。按现有分句规则，✨及句末🐱💻⚡会成为独立分句，豆包Provider直接发送上游；Promise.all任一句失败便取消整批。自动解析能识别✨/🐱，但💻/⚡等未知emoji保留，豆包仍无最终过滤。尚未实网验证纯emoji是否直接导致上游incomplete，不能把相关性当成已证实根因。

计划复用千问现有字素过滤，抽为公共tts-speech-text-filter.js，保留qwen-chat-text-filter.js旧导出；豆包Provider过滤emoji并在无正文时返回null；tts-provider-service.js允许豆包的null跳过结果，沿用播放调度继续正文。原回复、显示表情和MMD解析源保持，真正上游错误仍报错。拟补充用户原文、混合/纯emoji、ZWJ及后续句继续回归；待确认后实施。任务：20261015_豆包Chat纯表情分句中断修复.md。
