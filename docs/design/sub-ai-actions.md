# SubAI专用工作AI与对话动作接入

状态：2026-10-23已完成首版接入。用户已确认方案、独立Provider/模型以及完整播放后自动保存候选。以下实施说明优先于后面的原始设计草案。

## 首版实施与验证

当前仓库已有生图/生视频SubAI，因此复用现有CSV调用桥和模型面板配置消息：新增“动作 SubAI”独立设置区，保存chat.subAi.motion；不再新增平行的配置消息或action围栏。支持现有账号可用Provider的具体文字模型，调用底层coreAdapter独立请求；配置缺省关闭。主AI使用Agent profile时也可独立配置动作生成。

主AI输出SubAI,动作,"描述"及可选时长/强度/次数；服务端固定目标和请求身份，端侧优先查询真实本地库、服务器目录及内置模板。缺失才调用所选模型生成，Worker编译后按实际轨道检查时长、幅度、速度、位置、动态骨骼和表情。一次修复与原20秒总预算、停止/断线/换模型及库修订取消已接通。每轮最多两次动作请求、每端一任务、全局两生成；16项source短缓存不合并同时在途调用。

自动播放新增prepareMpl，沿用startPrepared和priority40；原手动MPL与TTS时钟路径保留。首版显式CSV动作独立播放，主AI按提示避免重复[动作]标记；没有把任意未知对白标记自动升级为生成请求。生成动作随语音精确锚点作为后续扩展，当前不为生成等待或延迟TTS。

schema2使用独立候选集合，完整自然结束后自动保存；停止、抢占、失败不入库。保存候选保留默认版本，用户在Human候选区预览、看源码、采用或删除；采用才切active。schema1读入内存迁移，后续保存通过原IndexedDB事务写入；失败保留原磁盘记录并提示导出/重试。候选上限32，计入128总版本及1MiB元数据。

实际模块为server/modules/sub-ai/motion-model-service.js、motion-coordinator.js（src/apps/下），配合既有chat-model-tier-service、sub-ai-chat-bridge及server-app；前端新增mmd-chat-actions.mjs/mmd-motion-policy.mjs，调整模型面板、Human接口/存储/UI与舞台消息接线。未改Node mpv能力。

验证：专项16/16，真实米娅PMX/Worker验证已登记动作零生成、固定测试生成MPL自然完成后保存候选及采用才切默认；两端模型面板独立选择也通过。既有生图35/35、MMD223通过/1跳过、流式聊天66/66。浏览器使用固定测试模型响应，不代表真实Provider已联调；真实账号生成质量、手机/多显示端画面仍需部署验收。servicePackage保持true，其余发布状态保留，未构建发布包。

## 原始方案记录（以以上实施说明及spec为准）

## 目标与角色

主AI处理用户对话并提交动作意图；SubAI承担受控的专门任务，首个工作类型为motion.generate。服务端协调查询、调用、取消及结果路由；显示端负责本地资源解析、真实模型校验和播放。首版同进程模块协作，不要求新增服务进程或安装完整Agent运行时。

SubAI是功能角色，可与主AI使用相同或不同Provider/模型；选择相同模型时，请求、上下文和预算仍独立。后续可登记其他worker类型，首期仅开放动作生成；任务注册表统一处理职责，避免逐项if/else。此SubAI不等于现有Codex/Claude工作AI聊天角色，不共享其threadId、权限或历史。

用户说“右手举起来，慢慢挥两下”：主AI给出动作意图 → 当前显示端优先查本地动作库/服务动作目录/内置模板 → 可实现则直接准备 → 都不能满足时调用动作SubAI → MPL经过校验与编译 → Human层播放。主AI不必生成骨骼代码；SubAI返回工作结果，不向用户再发一轮聊天或触发TTS。

## 已核实的现状与接入断点

| 现有模块 | 已有能力 | 本设计补充 |
| --- | --- | --- |
| mmd-human-interface.mjs | 本地同名默认版本、服务器VMD、有限MPL模板依次解析；prepare/startPrepared、owner停止、模型代次与物理骨骼过滤 | 自由动作描述解析结果、无播放副作用的prepareMpl、可取消句柄与准备结果回执 |
| mmd-human-storage.mjs | 动作库按模型保存在浏览器IndexedDB，人工登记与多版本 | 上报有界摘要、库修订失效；完整播放成功后保存候选，不覆盖已有默认版本 |
| chat-tts-actions.js / mmd-tts-actions.mjs | 服务端准备标记、显示端准备资源、音频playing/currentTime驱动动作；实时对话双方过滤kind=mpl | 独立动作意图与生成产物消息，继续借用音频时钟和取消机制 |
| mmd-reply-parser.mjs | 已登记名称及有限别名匹配，未知明确动作给warning且不生成事件 | 在白名单解析前保留明确未知意图，避免缺库请求被丢弃；普通引用/代码继续保护 |
| Human mpl.play | 编译后立即播放，默认手动优先级100 | 不能直接拿它做自动动作准备；新增prepareMpl后由startPrepared统一提交 |
| chat-model-tier-picker.js / chat-model-tier-service.js | 控制端/显示端共用Provider三档面板，修改当前普通LLM profile.model | 增加工作角色选择，SubAI绑定独立，不调用saveActiveModel或切换主activeProfile |
| pi-profile-config.js / llm-responses-client.js | WebSocket配置修订与config.set持久化；底层模型传输适配 | 复用配置流程和无状态传输；不能借临时switchProfile调用SubAI |

服务端不知道浏览器本地动作库，不能仅查mmd-actions.json就宣布“动作不存在”。静态目录只含部分动作。模型能力快照现有字段包括token、signature、真实骨骼/动态标记、Morph及语义映射；另由显示端动作协调器提供递增modelEpoch绑定当前Human实例、基础动作和映射。相同mesh token重绑定也使旧epoch失效，不把模型签名当作一次加载的代次标记。

## 模型面板与配置

现有“模型”面板增加角色选择：主AI、SubAI·动作。选择SubAI后显示启用开关、Provider、具体模型、可选轻量/普通/专业快捷档位及当前任务状态；切回主AI继续显示既有设置。

Provider与模型独立保存；更换Provider时清除待保存的旧模型，必须从所选Provider可用文字模型中重新选择，服务端检查显式绑定一致，不靠模型名猜Provider。现有三档仍作为快捷选择，不能把“模型”限定成三档；复用现有Provider/模型映射与注册表生成可用目录，不依赖另一个尚未实施的通用模型目录设计。

推荐配置归于chat.subAi：schema、revision、workers；workers.motion包含enabled、providerId、modelId、可选tier、temperature、maxOutputTokens、timeoutMs、maxRepairAttempts和promptVersion。模型ID是目录稳定引用，实际请求模型名由服务端解析；凭证复用已有Provider账号引用，不复制到面板或消息。首版Provider范围为现有Chat2API支持的文字模型；独立外部API配置可后续用已有LLM profile引用扩展，不能把尚无认证/协议契约的端点当作已经支持。

配置读取/保存走已有AASC WebSocket：getSubAiConfig/setSubAiConfig → 服务端规范化、权限和revision检查 → config.set → subAiConfig权威快照广播 → 重连初始化补发。没有独立HTTP配置读写接口。Provider/模型业务目录可以复用现有只读查询职责。权限沿用当前模型面板允许的控制端及显示端角色；服务器分别检查，不能因为新增面板扩大其他显示端控制权限。

旧配置、配置未到达或SubAI未启用时默认关闭生成，已知动作仍按既有链路播放。坏配置返回明确错误及当前权威值，不静默借用主AI。主AIprofile保存与SubAI配置都保留chat其他字段，串行提交并避免陈旧完整chat快照覆盖另一类设置；revision检查必须在实际提交时再次执行。

## 对话意图与本地优先

主AI收到有界的目标能力及动作名称摘要，看到能做什么，不收到VMD文件、账号凭证或整库MPL。模型、库版本、服务目录或映射变化时刷新摘要；本地解析始终是最终权威，摘要过期时最多刷新一次。

主AI输出正文与结构化动作意图。原生工具调用可映射requestMotion；不支持工具的普通LLM用专门action围栏中的单个JSON意图适配。流式适配器只有完整结束且通过schema校验才提交，半截内容缓冲并有界丢弃，不执行半个请求，也不把控制区段送去TTS。不把任意正文、用户引用、思考或历史代码块扫描成新动作。已知[动作:名称]继续兼容，经同一协调器去重，防止工具和文字标记各播一次。

意图包含description、可选actionRef、duration/strength/count、mode（direct或withSpeech）、可选sentenceId与语音字符锚点。conversationId、turnId、requestId、targetDisplayId、modelToken/modelEpoch、catalogRevision及owner由服务端创建/绑定；模型不能自行选择其他设备、owner、配置角色、播放优先级或root权限。

优先解析当前模型本地登记版本，再查服务器动作，再查可完整表达的有限模板。别名精确匹配和参数化组合可复用；不能因“举手”近似“举手后转手腕比心”就误报完整命中。语义不确定时交主AI澄清，或生成准确意图，不能悄悄替换成近似动作。明确意图未知仍保留给SubAI，不能被原解析器的warning分支吞掉。

普通情绪标记仍走当前廉价模板，不为每句/每个Emoji调用SubAI。动作命令由用户明确执行请求触发；主AI自发表演是否开放作为后续可选项。提及、否定、引用或讨论动作不等于要求执行。

## SubAI输入、结果和编译反馈

输入为最小任务快照：用户动作描述、必要的上一条修正、参数、当前PMX可用语义骨骼及Morph白名单、禁止控制的动态骨骼、允许部位、MPL语法版本/少量样例、时长/幅度/帧数预算。只取本任务所需上下文，不带整段聊天、历史工具或系统控制权限。调用使用冻结的worker配置和模型快照，不修改全局activeProfile；独立会话键按worker/会话/turn/请求划分，不复用主Responses previous_response_id。

返回schema版本、status（ok/unsupported/needClarification）、解释摘要、MPL source、声明duration、可选标签/所需能力。只接受单个结构化结果；外部脚本、下载地址或任意工具不能成为动作产物。MPL作为受限DSL进入现有编译器，不进入eval、Function、shell或任意JS执行。

服务端先校验schema、大小、时长、声明部位与能力；显示端再次对当前token/库revision校验，在Worker编译并检查实际输出的时长、数值有限、帧数、骨骼/Morph和当前模型允许轨道。实际输出不以SubAI自报字段为准。生成策略首版拒绝root/center位移、动态骨骼强写、无限循环及未声明轨道；关节角度和变化率限额来自明确策略表，不假设现有编译器已经实现人体合理性检查。

建议默认源码不超过16KiB、动作0.2～15秒、每请求初次生成加最多一次修复、整任务20秒截止、同显示端一个生成任务、全局并发2、每轮最多2次生成；均为待实测调优值。Worker仍受原64KiB/30秒硬上限，外层任务截止先到则主动取消，不额外顺延30秒。流式输出、排队、修复、回执都计入总预算。

语法/静态轨道错误可把有界诊断和原source发回同一SubAI修复一次；模型切换、断线、能力不支持、超时及播放失败不进入修复循环。编译成功仅证明代码可播放，不证明动作优美、无穿模或解剖合理，须实际PMX画面验收。

## 播放时机与冲突

动作分两阶段：prepare仅编译并产生本地不可由远端构造的准备句柄；start必须匹配当前requestId、模型token/epoch、库修订与owner，才能通过Human.startPrepared提交。自动优先级沿用TTS的40，不使用手动mpl.play的默认100。手动动作/调试、口型和现有物理骨骼规则保持优先。

withSpeech复用已有ttsAction.id、音频entry及currentTime。已知动作按当前机制预备；SubAI生成并行进行，不延长原TTS等待。到锚点仍没准备好的生成动作跳过本句，完成后可显示待预览结果，不补播成与下一句错位的动作。若产品后续要求“等动作生成后一起说”，另设显式模式，不能默认阻塞整条语音队列。

direct用于“给我比个心”等只做动作请求：准备成功后独立start，无需造空WAV、TTS音频或ttsAction；TTS关闭、空文本不会自动cancel它。若同时有一句简短口头确认，仍以意图mode决定时钟，避免身体动作执行两次。

新轮次替换、停止、换模型/动作库默认版本/基础动作、后台/离页、断线与过期均取消相关owner和准备请求，迟到的模型结果、修复结果和ready/start全部丢弃。重连可补配置与能力摘要，不重放已取消或已完成的动作。

## 动作库、缓存与多端

按用户确认：生成动作实际完整播放成功后自动保存候选版本，编译成功或start回执不算播放成功。候选保留原MPL、用户描述/参数、来源Provider/模型、提示词/编译器/策略版本、模型能力摘要与来源请求ID；中断、失败、被手动抢占、过期或模型切换不保存。面板分别显示生成、编译、播放、候选保存状态；存储失败不得把已经完成的播放改报失败或触发重播，应提示重试保存。

已有learn.register和learn.revise都会改写active，现有schema1还要求每个动作必须有有效active，不能拿它们直接实现候选。拟将库记录迁移到schema2，新增独立candidates集合，普通actions及active保持原值；旧schema1读取后在内存补空候选并原子保存，失败保留旧记录。旧版程序不能读schema2，需明确备份与回退要求；导入/导出、校验和UI同时适配，不忽略丢弃候选。

候选只有“预览/采用为新动作或新默认版本/删除”操作；采用需要用户明确选择，预览不改变active，常用动作匹配不自动消费候选。候选按来源请求ID和内容摘要幂等，重连/重复完成回执不能重复入库。初期最多32候选，候选数量计入总128版本/1MiB元数据预算，不因自动保存无限增长；满额明确提示清理，不自动删除用户默认版本。无需持久VMD副本，保存MPL，预览/采用时针对当前模型重新编译。

写入在显示端串行存储队列内读取最新库，只追加候选；要求当前模型/映射仍相符，不能拿生成开始时的整库副本覆盖后来人工更改。导入、版本切换等变更触发当前请求失效，不保存到新库。候选名由显示端规范化并避开已有名称冲突。

缓存区分生成source和模型准备句柄：source键包含规范化意图/参数、能力摘要摘要值、映射/策略/提示词/MPL版本、worker配置及Provider/模型；准备句柄仅属当前显示端当前模型代次。短期缓存有容量/TTL，不等同持久动作库；停止/截止结果不缓存，生成期间相同请求可合并，取消一个订阅者不取消其他仍有效的订阅者。

多显示端分别按modelSignature、能力摘要、动作库摘要及请求参数分组；每端先查库。仅同组可复用一次生成source，各端独立编译/校验/开始与回执；不广播同一VMD字节或模型准备句柄，也不让慢端阻塞其他端。Node mpv本轮没有Human/MPL能力，返回unsupported，原TTS/媒体继续可用。

## 模块切片与拟改文件

| 切片 | 拟新增/修改 | 职责 |
| --- | --- | --- |
| SubAI配置与调用 | 新增server/modules/chat/sub-ai-config.js、sub-ai-service.js（均位于src/apps/）；复用Chat2API runtime与底层LLM适配 | 角色注册、独立模型选择、配置权威回包、无状态受限调用 |
| 动作协调 | 新增src/apps/server/modules/chat/chat-action-coordinator.js、motion-sub-ai.js | 意图解析适配、请求状态/预算、库缺失后派发、反馈修复与取消 |
| 服务装配 | src/apps/server/boot/server-app.js、chat/agent-chat-tts.js、chat/chat-tts-actions.js及消息注册位置 | 统一普通/Agent聊天出口，实际改动前按引用定位最小接线位置 |
| 模型面板 | chat-model-tier-picker.js、control-chat-model-tier.js、display-chat-model-tier.js及对应样式/消息订阅 | 主AI/SubAI角色与独立Provider/具体模型选择；主AI原档位行为保留 |
| 显示端动作 | 新增mmd-chat-actions.mjs；调整mmd-human-interface.mjs、mmd-tts-actions.mjs和受控解析器 | 能力/库摘要、prepareMpl、真实编译反馈、直接/音频时钟播放 |
| 自测 | 新增sub-ai-config、motion-sub-ai、chat-action-coordinator专项，扩展现有模型面板/Human/TTS测试 | 同模型不同角色隔离、取消/重复/迟到、两端权威配置、候选迁移/幂等保存、真实编译与画面 |

路径均为候选，尚未新增运行代码。分三阶段交付：先已知库动作接入完整对话和direct；再做SubAI配置/模型面板、缺库生成及成功后候选保存；最后补有限修复、缓存和多端实测。每阶段都需独立验收，不能把面板出现等同生成链路已经可用。

## 验收与风险

必须覆盖：本地登记动作优先且零SubAI调用；服务器VMD/模板命中；未知动作确实触发所选Provider/模型；主AI选择/历史/会话不变；半截action围栏与重复标记不执行；引用和否定不触发；纯动作无TTS也播放；完整播放后候选仅一条且active不变，停止/失败无候选，schema1迁移/存储失败/导入导出/候选满额不丢默认动作；随语音缺时跳过；失败不阻断原聊天；编译失败至多修复一次；modelToken/库revision/轮次改变后迟到结果零播放；手动优先、口型和物理保持；未启用/离线/Node无能力明确降级；多控制端冲突、Provider退出或模型下架明确错误。

设计阶段不调用真实模型、不播放生成动作、不增加测试实现或声明测试通过；运行检查只核对源代码/文档引用与工作区差异。性能基线后续量测：命中库延迟、生成与编译p50/p95、预算命中率、请求数/输出token、移动端帧时，不在设计稿编造性能结果。

## 需求分析（enterprise）

步骤0：主目标、模型面板和完整播放后自动保存候选均已明确；外部自定义Provider、主AI自发动作与跨句等待不默认纳入。现有真实代码已核对，推荐方案可进入开发确认，当前仅完成设计。

证据：[L6|强] 用户要求“SubAI专用工作AI辅助主AI”；[L6|强] 用户要求“模型面板选择Provider和模型”；[L5|中] 用户要求“动作库没有则调用专用AI生成MPL播放”。主L6，次L5，邻层混合，一致性0.90；置信度6/8×0.90=0.675。层级清晰24/25、证据19/20、实现完备18/20、风险18/20、L4可落地14/15，共93/100；评审结论可开发（以本稿建议边界获确认后为准），直接开发风险中。

必须下放到L4：独立配置/无状态调用、库摘要与解析、动作意图与请求状态、编译回执与一次修复、prepare/start/取消、临时保存各拆成数据契约与流程，不能直接把“让AI做动作”当作一个prompt补丁。

开发前确认建议边界：首版现有Chat2API文字Provider、用户明确动作请求、随语音不等待且迟到跳过、生成完成后候选保存。目标设备及PMX在实施验收时指定，不作为已完成视觉验收。主要断点修复行动：增加显示端库/能力摘要及最终解析回执；新增prepareMpl、实际完成回执和schema2候选存储；调用底层传输隔离主profile；统一协议适配与去重以免工具/标签重复。

后续可选：ai-code-translation（当前L4草案翻译流程）、project-pseudocode-sync（同步项目伪代码）或仅保留设计；未经用户选择不调用这些后续技能。本次按用户设计请求直接记录本模块伪代码草案，不把它视为已实现代码。
