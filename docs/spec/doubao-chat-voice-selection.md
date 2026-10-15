# 豆包Chat音色快选与显示端回复重播伪代码

状态：2026-10-15已实现，复用声纹页全局TTS设置；以下伪代码与当前源码同步。

## 下拉筛选与当前项定位（2026-10-15已实现）

```text
当前授权 := 用户确认三下拉框HTML效果，正式接入原音色面板
预览数据 := 复用本地94项JSON并嵌入HTML，可直接离线打开
预览状态 := 当前音色桂乡甜妞 + 三维度筛选 + 搜索；点卡片只更新预览内存
预览布局 := 右下角音色入口在灯光上方；面板含当前项、方式、性别/年龄/口音三个下拉框、列表/数量
最新交互 := 按用户圈选反馈，性别/年龄/口音改为同一行三个原生select；替代Tab及下方标签按钮
下拉变更 := 各维度含全部，选择保留其它条件并立即筛选；选项计数按其它条件计算
下拉布局 := 三等分列，label始终显示维度名，长口音值保持框内；窄屏不溢出
横屏追加 := 用户明确选择左侧设置/筛选、右侧音色列表，已授权正式接入
横屏预览 := landscape且宽度>=620 → 面板宽度min(640px,100vw-100px) → 左列当前项/TTS/搜索/筛选，右列数量/音色列表独立滚动
正式分组 := settings包裹当前项/TTS/搜索/筛选/摘要；results包裹数量与列表；标题/状态跨列
竖屏 := 分组display:contents恢复单列；保留短屏面板内滚动降级
横屏 := landscape且宽度>=620 → 扩展面板至安全区内最多640px，grid两列；左设置独立滚动，右列表获得整列剩余高度
横屏紧凑 := TTS及搜索保留无障碍名称但省略重复可见标签，缩小间距；保留三个筛选label
横屏定位 := 仍按渲染代次/目录key，在右列表内定位；旋转后再次打开按新尺寸计算
外部点击 := 依据事件composedPath识别面板内部，卡片点击触发重绘移除旧节点时不误关闭
预览定位 := 打开清空筛选/搜索 → 渲染 → 列表滚动到当前项；不滚动页面
预览交付 := 本地HTML + 浏览器页；不调用真实TTS/WS、不更改正式配置或生产源码
预览实现 := .cache/voice-selection/voice-panel-preview.html；94项内嵌JSON，当前项默认桂乡甜妞
预览核对 := 女声32；女声∩青年∩广西口音=1；搜索桂乡=1；末项改选/重开可见；手机边界通过
```

```text
已有声明 := DisplayTtsVoices目录缓存/权威配置/请求ID/音色列表；Voice{id,name,gender,tags}
新增定义 := FilterState{gender:all,age:all,accent:all,query:空,locatePending:false}
维度 := 性别gender；年龄标签∩{小孩,少年,青年,中年}；口音标签匹配口音或话后缀
未知属性 := 未标注；不按名称推断，不将成熟等风格标签当年龄
打开面板 := 重置筛选与搜索 → locatePending=true → 当前方式目录加载/缓存渲染
选择下拉项 := 更新当前维度，保留其它维度条件；不再维护activeTab
显示列表 := 当前Provider目录 ∩ 性别条件 ∩ 年龄条件 ∩ 口音条件 ∩ 搜索条件
筛选副作用 := 仅本面板内存；不发配置保存、不改变已选音色
权威当前项 := aiReplyDefault同Provider的voice，否则对应Provider.defaultVoice
列表样式 := id=权威当前项 → aria-selected=true + 选中底色/边框/勾选；其它未选中
保存中/失败 := 旧权威项保持选中；成功配置回显后更新选中状态与顶部音色名称
定位执行 := 面板可见且目录匹配当前Provider → 完成DOM渲染 → 只滚动列表使当前项可见 → 清locatePending
短屏降级 := 列表最小120px；头部超出可用高度时允许面板内部滚动，定位同时调整面板使当前项进入可见范围，页面保持不动
定位代次 := 打开/方式或模型变化推进epoch；动画帧校验epoch及目录key，关闭/断线/主动筛选使旧定位失效
当前名称 := 配置与目录变化均重算，未知id显示原id；断线等待同步，原生显示系统默认
方式变化 := 清筛选/搜索并等待对应目录；配置失败回原Provider并加载其目录，选中不提前切换
定位缺项 := 当前项不存在或系统原生无列表 → 明确当前状态；不选第一项、不发保存
迟到目录 := 沿用Provider/requestId匹配，不能触发其它方式定位
搜索/筛选 := 更新结果/条件摘要/数量；不重复自动跳转，重新打开才清条件并定位
验证 := 三下拉框/交集/清除/真实标签/样式唯一性/保存失败/异步定位/缓存重开/手机可见边界
发布 := 实施后保持servicePackage=true；其它产物原值不变
```

## 已实现行为

```text
输入目录 := docs/ref/doubao-web-gender-voices-20261015.json中94个已去重条目
生产目录 := {female: 女32项, male: 男62项}
每项 := {name, style_id, tags}；不含凭据、预览地址或调研元数据
目录模块 := 一次加载/校验 -> style_id索引 + Provider目录映射
Provider音色项 := {id:style_id, name, gender, tags}；不以available宣称所有音色真实验收通过
目录查询 := Chat2API语音服务及业务Provider复用；只读，无上游请求
豆包目录前置 := 直接读共享JSON，不调用依赖映射/账号的planner；禁用/无账号不阻止读目录，生成另行校验
对外目录接口 := 新增GET /v1/audio/voices?model=doubao-chat（Chat2API扩展，已实现）
目录鉴权 := 复用代理Bearer/X-API-Key；缺少或无效Key按既有401错误响应
查询校验 := model必须唯一且属于受支持语音模型；缺少/重复/不支持返回400，不静默换方式
HTTP目录响应 := {object:list, model:请求模型, data:音色数组}
豆包响应条目 := {id:style_id, style_id, name, gender:female/male, tags}，共94项
目录副作用 := 无；不保存选择，不依赖合成账号，不触发豆包请求
显示端查询 := 主服务WS -> 同一目录服务；不在网页放代理Key，不新增配置HTTP读写接口
HTTP目录回归 := 鉴权/参数/字段/94项/无账号/其它方式兼容及根路径能力入口

请求校验 := voice缺省使用温柔桃子，显式voice须存在于目录
参数贯通 := TTS配置/请求voice -> normalizeSpeechRequest -> adapter -> createTextTtsSession -> tts.speaker
保持约束 := doubao-chat上游speed=1/volume=100，WAV解码及账号队列不变

采用作用域 := 当前「声纹 -> 语音服务与音色」的同一份全局AI/Agent默认及Provider配置
用户补充 := 界面增加TTS方式选择，音色列表和修改归属对应方式
采用选择值 := tts.aiReplyDefault.provider/voice，以及providers[provider].defaultVoice；不新增按端持久化结构
方式切换 := 读取所选Provider目录与已保存defaultVoice，写入AI默认Provider/voice
方式记忆 := patch当前Provider.defaultVoice和AI默认voice，切回恢复原值；不覆盖其它方式
目录异步 := Provider及requestId匹配响应，迟到目录不覆盖当前方式；系统原生走原有默认路径
其它方式目录 := 沿用实际能力，qwen-chat目前单项且不随model展开完整音色；不拼接未验证音色
配置消息 := 带type/requestId，复用原权威保存；显示端只可写AI默认方式/对应音色
保存过程 := 校验来源与目录 -> config权威持久化 -> 成功才更新内存 -> 回传/广播规范化值
保存粒度 := 只patch AI默认选择及当前Provider.defaultVoice，不用旧整表覆盖并发修改
配置广播 := 同步控制端和显示端所需公开配置，不暴露凭据
保存失败 := 返回旧权威选择，UI回退；不得假定成功或静默改默认
连接初始化 := 补发原AI默认配置和目录；未同步时禁用提交，服务端继续现有默认路径
采用优先级 := 原模板显式设置 > AI默认选择 > 对应Provider默认；继承模板随快选变化
禁用或无账号 := 提示明确错误，不自动修改全局启用或账号
批次快照 := 开始播放时捕获Provider与style_id；当前批次不随快选变化
多目标 := 沿用现有全局/模板解析与生成设备路由，不新增按端音色分组

快选布局 := display.html右下角灯光入口上方，独立模块初始化
快选内容 := TTS方式选择 + 当前方式音色 + 豆包女/男分组 + 搜索 + 已选权威名称
面板层级 := 沿用舞台安全区/旋转/键盘与聊天可见性规则

可重播消息 := 成功完成且有speech或正文的AI/Agent消息，包括当前会话历史
播放正文 := speech优先，否则assistant正文；不包含reasoning/think
实时协议 := 同时接受字符串message+顶层speech及对象message.speech；本端发送时保存原输入/模板上下文，重复chatInput不覆盖
自动批次 := 普通AI/旧Chat/Agent在开始生成前复制模板和权威TTS配置；调度与全部分句共用快照，快选只影响新批次
远端停止 := 清除目标端手动生成代次并丢弃迟到音频；原生队列停止逐项通知重播按钮结束
客户端发送 := 原消息来源上下文 + 本端重播意图，不发送账号或任意Provider覆盖
服务端重播 := 已登记显示端确定目标 -> 验证上下文 -> 复用抽取的控制端手动TTS服务
重播流程 := 剥离Markdown -> 分句 -> 捕获配置 -> 调度/合成 -> 缓存URL -> 本端播放 -> 完成/错误回执
拒绝越权 := 伪造目标、广播、控制端播放目标不得从显示端生效
停止同边界 := 显示端tts/stop亦锁定自身，不转交客户端displayIds/playOnControl；控制端合法多端逻辑保留
状态处理 := 未完成/失败无播放；生成中防重复；停止/断线/会话切换释放状态和迟到结果
共享服务回执 := requestId/本端代次标识开始、生成错误及结束，避免按钮等待无回执状态

自测 := 目录94/32/62/唯一性 + 动态speaker传递 + 未知音色 + 旧默认兼容
配置回归 := 持久化失败/重连补发/控制与显示端同步/模板原优先级/并发patch/窄权限
方式回归 := 各方式音色记忆、切回恢复、不跨Provider串值、迟到目录响应、无目录/未启用/错误恢复
播放回归 := AI/Agent/历史/长文分句/模板上下文/错误/重复点击/停止/口型字幕
UI回归 := 灯光上方按钮/女男目录/搜索/权威回显/手机尺寸和安全区
发布状态 := servicePackage=true；其它三项保持原值；尚未构建发布或重启运行实例
```


## 方式/音色保存修复与控制端共享入口（2026-10-15，用户已确认实施）

```text
已有声明 := 显示端WS入口的权威displayId；ttsProviderWs.handle；DisplayTtsVoices；WebSocketManager；声纹页TtsProviderSettings
新增定义 := TtsVoicePicker.create建立宿主实例，沿用refs/send/bus/config/pending/catalogs/filters
新增入口 := 控制页右下角音色浮钮及可收起面板，沿用现有工具组间距/安全区
显示端合法消息 → 入口覆盖displayId为登记连接身份 → 快选转交时移除传输displayId → 原业务白名单校验
未知业务字段/未登记连接/完整配置越权 → 原拒绝流程，不通过挑选已知字段吞掉非法输入
控制端连接 → 现有初始化权威快照 → 声纹页与共享面板同时接收
两端选择方式/音色 → setChatTtsSelection{type,provider,voice?,requestId}
服务端规范化 → config.set持久化 → ttsProviderConfig广播所有控制与显示连接
回显成功 → 两端当前项/方式/状态更新；失败 → 恢复权威值并显示原因
断线 → 默认system/无音色选择、控件等待同步；重连 → 补当前配置，不提交本地旧值
目录查询 → 当前Provider与模型；迟到响应不覆盖已切换方式
共享筛选 := 性别/年龄/口音/搜索交集；打开定位当前项；关闭失效迟到定位
配置范围 := 全局AI/Agent默认；角色显式TTS仍按原优先级；当前语音批次不被中途切换
控制端布局 := 右下浮钮避让齿轮/自测/录音暂停；短屏列表可滚动；主题与安全区沿用现有变量
实施状态 := 用户确认代码与自测；源码/伪代码已同步；修改后servicePackage=true，成功构建匹配源码的候选100后false
ADB复现 := 方式改豆包失败 + 豆包目录94项的其它音色点击失败，均为TTS快选参数不合法
控制连接同选择 := 成功；恢复qwen-chat/null及豆包原默认成功；本次角色无模板TTS覆盖
```


```text
共享实现 := tts-voice-picker.js的create实例；显示端旧init仅转接display前缀/原bus
控制实现 := control-tts-voices.js通过现有WebSocketManager.ws发送；共享实例使用control前缀/宿主总线
控制消息 := ttsProviderConfig/ttsProviderVoices同时分发原声纹页与快捷面板
工具定位 := floatingControl内音色按钮bottom180px，面板right60px/bottom0，手机沿用父组底栏安全区
共享样式 := tts-voice-picker.css；display-mmd保留舞台位置，控制宿主限定viewport内宽高
未知字段 := 仅剔除入口覆盖的displayId；不挑选其余字段，继续原白名单拒绝
```


## 共享面板语速滑条（2026-10-15，用户已确认）

已有声明
- providers.defaultSpeed、supportsNativeSpeed、normalizeNumber、setChatTtsSelection // 复用既有每方式偏好与权威保存

新增定义
- setChatTtsSelection.speed // 可选数值，范围-10到10；仅更新当前Provider语速，不重选AI默认或音色
- TtsSpeedControl { wrapper, slider, output } // 两端共享，input本地预览、change松手提交

操作流程
- 根据权威Provider.defaultSpeed是否为有限数值显示滑条，否则隐藏 // 规范化输出只给原生支持调速的方式该字段
- 接收speed消息并校验有限数值、方式/模型原生能力、不得同时带voice // 保持窄权限，防止无效调速被假报成功
- 规范化speed到-10到10并仅构造providers目标项defaultSpeed补丁 // 不覆盖其它方式、业务选择或凭据
- 经setTtsProviderSettings持久化并广播ttsProviderConfig // 保持声纹页及两端面板一致
- 拖动显示数值，松手提交；pending期间禁止重复提交；失败/超时/断线恢复权威值 // 不在每个input事件刷远端配置
- 下一次语音批次读取新偏好，已播放批次保持快照；豆包网页/Qwen3不支持原生语速时隐藏 // 不新增本地音频变速


## 共享面板交付验证（2026-10-15）

```text
映射 := TtsVoicePicker.create → 两端各一实例；display wrapper保留原舞台总线；control wrapper复用WebSocketManager
样式 := tts-voice-picker.css负责内容/语速/控制宿主；display-mmd.css继续提供舞台位置与安全区
只读自测 := control_tts_voice_picker检查当前控制DOM/共享入口，不发送选择或合成请求
回归 := npm run test:tts-voice-picker → 20/20；npm run test:mmd-production:tts → 21/21
真实生成服务fixture := 旧批次捕获0 → 快选保存3 → 旧批次生成speed0/新批次speed3
浏览器 := 真实WS/生产快选handler/显示转交，双端方式音色/语速回显，断线/失败恢复，重复init无重复DOM
布局 := 1280x800、390x740、740x390、390x400内完整可见，浮钮不遮挡齿轮/录音/自测
候选 := code100基于正式99签名清单，17808097字节/1096源文件；APK58/deps10/task1保持
ADB := 原生99→100，仅服务ZIP；健康pending=false/previous=null
ADB方式与音色 := 显示端切doubao-chat → 94项 → 改选成功并同步控制端
ADB语速 := 控制端实体点击浮钮、实体滑条0→3 → Provider持久化3/显示端回显3
ADB结束 := 恢复原选择/各方式音色/语速/启用/模型；正式99源CURRENT/0字节/无失败
出包状态 := 生成最新源码候选后servicePackage=false；其它三项false；未发布LAN/WAN
验证边界 := 配置及后续批次参数已验证；未向官方合成接口发送实网请求，不代表逐音色听感验收
```
