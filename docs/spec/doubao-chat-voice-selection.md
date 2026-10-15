# 豆包Chat音色快选与显示端回复重播伪代码

状态：2026-10-15已实现，复用声纹页全局TTS设置；以下伪代码与当前源码同步。

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
