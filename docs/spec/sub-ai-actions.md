# SubAI与AI对话动作伪代码草案

状态：设计阶段，2026-10-23。以下全部为拟实现流程，不表示现有程序具备SubAI；动作完成后自动存候选已获用户确认。对应设计：docs/design/sub-ai-actions.md。

## 已有声明

```text
聊天入口 := 普通LLM流式回复、Agent回复与统一TTS生成
动作入口 := Human.capabilities/getState/learn.list/serverActions/prepare/startPrepared/stop/getRequest
MPL入口 := Human.mpl.play立即播放；compileHumanMpl Worker编译；真实轨道过滤/模型代次保护
现有对白动作 := generateChatTtsActions与createTtsActionPlayer；双方排除原始mpl事件
当前库 := schema1，IndexedDB按模型签名存储；register/revise会切active
模型面板 := ChatModelTierPicker共用主profile Provider/三档；服务端配置经WebSocket与config.set
传输 := Chat2API runtime.responsesService及底层LLM客户端；不能借全局switchProfile临时调用
```

## 新增定义

```text
SubAiConfig := schema、revision、workers；motion配置enabled/providerId/modelId/tier/生成参数/总预算/修复次数/提示词版本
MotionIntent := description、可选actionRef、参数duration/strength/count、mode、可选sentenceId/语音字符锚点
MotionJob := 服务端requestId、conversationId、turnId、targetDisplayId、modelToken/modelEpoch、catalogRevision、owner、截止时间、状态
ModelCatalog := 模型signature/本次加载token/递增epoch、映射摘要、可用骨骼与Morph、动态骨骼、动作名及版本摘要、能力revision
MotionArtifact := schema、status、解释摘要、MPL source、声明duration、所需能力、生成配置与策略版本
PreparedTicket := 当前显示端requestId与本地WeakMap准备句柄映射；服务端只能引用ticketId，不能传入运行对象
Candidate := candidateId、请求ID/内容摘要、描述/参数/source、Provider/模型、版本与模型摘要、创建时间；不含active指令
LibraryV2 := 原actions/assets/presets/rules/mappings/physiology/gaze + schema2 + 独立candidates
```

## 配置消息与隔离

```text
控制端或被授权显示端模型面板 → 主AI/SubAI动作角色选择 → 只修改选中角色的Provider和具体模型
getSubAiConfig → 当前权威subAiConfig；断线/缺字段默认enabled=false
setSubAiConfig + requestId + expectedRevision + worker草稿
  → 校验消息角色/worker/Provider模型一致性/可用状态/参数范围
  → 在提交队列内再检查revision，合并最新chat字段 → config.set(chat.subAi)
  → 成功广播规范化subAiConfig；失败回当前权威值与error；重连初始化补发
主AIprofile更新 + SubAI保存 → 共用提交协调/最新值合并，互不覆盖
业务模型目录 → 复用Provider/映射只读查询；不新增HTTP配置读写
SubAI调用 → 冻结worker配置/任务快照 → 独立无状态传输与AbortSignal
  → 不切activeProfile、不追加主聊天历史、不复用previous_response_id、不调用TTS或递归SubAI
```

## 意图、解析与消息契约

```text
主AI上文 := 有界动作/能力摘要 + 受控动作协议；非执行性提及/否定/引用不生成请求
完整工具调用 或 完整action围栏JSON → schema校验 → MotionIntent；半截协议不提交/不进入TTS
旧[动作:名称] → 同一意图适配器；明确未知动作保留，普通代码/引用/思考保持保护
服务端绑定目标/owner/轮次/ID → 按turn+sentence+序号去重 → 创建MotionJob
显示端消息 := type=chatAction、op、requestId、jobRevision、载荷；op由表注册白名单
server→display resolve := 绑定任务+意图+预期modelToken/catalogRevision
  → 当前本地active精确命中 → 服务器目录命中 → 可完整表达的内置模板 → 准备KnownAction
  → 无完整命中则返回missing与有界能力快照；语义不确定返回needClarification
server→display prepare := 本任务MotionArtifact → 校验/Worker编译 → 本地PreparedTicket
  → display→server ready := ticketId、实际duration、轨道摘要或有界编译诊断
server→display start := requestId+ticketId+时钟绑定 → 当前有效才提交Human
display→server result := started/completed/failed/cancelled；只有实际轨道completed=true才允许候选保存
server→display cancel := 只取消绑定owner；角色/来源/目标需服务端验证，显示端不能伪造其他端状态
过期/重复/未知op/错误来源/错误轮次或token → 丢弃或返回明确错误，不播放
```

## 缺库生成与校验

```text
missing + SubAI启用 + 目标有Human能力 → 截止/额度/并发检查 → 查询同组source短缓存
  → 未命中则构造最小描述/参数/模型白名单/MPL语法和预算 → 请求motion.generate
原模型输出 → 单个结构化结果校验 → ok/unsupported/needClarification
ok → 服务端schema/长度/声明能力初检 → prepare消息 → 显示端再次核对当前模型及库
显示端编译 := source进入现有compileHumanMpl，AbortSignal受外层总预算约束
  → 校验实际帧/时长/finite/允许骨骼与Morph/部位及幅度变化策略
  → 不允许生成root/center位移、强写动态骨骼/未知轨道/无限循环；不执行JS或shell
可修复语法或轨道诊断 + 预算允许 + repairCount<1 → 同SubAI一次修复 → 再校验
超时/断线/换模型/取消/unsupported/播放失败 → 不修复，不切其他Provider，不改主AI回复
建议预算 := 源16KiB、时长0.2～15秒、总20秒、修复最多1、每端1个/全局2并发、每轮最多2生成
硬上限 := 原Worker64KiB/30秒继续存在；总预算先到立即取消，不把等待/修复额外续期
```

## 两阶段播放与取消

```text
已知资源 → Human.prepare；生成source → 新增Human.prepareMpl（复用编译/采样，只准备、不调用mixer.start）
准备句柄 → 复用startPrepared的WeakMap/模型generation/基础动作检查 → 自动priority40/本任务owner
mode=direct → 有效ready即可start；无TTS也可完成，不依赖空音频
mode=withSpeech → 绑定原ttsAction/entry及音频currentTime → 原锚点到达且ready才start
  → 缺时跳过本句，不延长原TTS准备等待，不在下一句补播；只展示待预览source
手动priority>=50、口型、物理骨骼规则 → 保持原优先及轨道控制
同owner停止/新轮次替换/模型或库变更/后台/离页/断线 → abort任务/编译、释放ticket、停止本owner
任一await之后 → 再查轮次/目标/modelToken/modelEpoch/catalogRevision/截止；失效立即丢弃
相同mesh重新绑定Human/基础动作/映射 → 递增modelEpoch；签名或token相同也不能复活旧请求
重连 → 配置与新能力摘要；不重放旧start/完成动作
```

## 完成后自动候选保存（用户已确认）

```text
旧schema1 → 校验原库 → 内存补空candidates并转schema2 → 完整校验 → 原子保存；失败不覆盖旧库
读取schema2 → candidates单独校验；普通actions/active不变；旧程序不兼容需导出备份/明确回退限制
完整实际播放completed + 本任务仍有效 + model/映射相符
  → 保存队列内读取最新库 → 按requestId或内容摘要判重 → 只追加Candidate
start/编译成功/取消/抢占/超时/失败/迟到 → 不保存候选
候选最多32且计入总128版本/1MiB元数据预算 → 满额报错，不删默认动作；不持久重复VMD
存储失败 → 单独candidateSaveFailed提示/重试保存，不重播已成功动作
预览候选 → 当前模型重新编译/单独owner，不改active
用户明确采用 → 已有动作新版本或新动作 → 事务内变更active；不直接使用会改active的register保存候选
删除/导入/导出 → 同时支持候选；人工旧版本、默认版本和来源元数据保留
```

## 缓存、多端与验收

```text
source缓存键 := 规范化描述/参数 + 能力/映射/策略/MPL/提示词/worker配置/Provider模型摘要
缓存 := 有界TTL与容量；完成有效结果才加入；candidate存储与source缓存分开
模型准备ticket := 仅本端当前加载代次；不同端不共享ticket/VMD
多端 := 先逐端查库 → 按模型/能力/库摘要分组复用生成source → 每端独立校验/编译/回执，不等待慢端
Node mpv无Human/MPL := unsupported；已知媒体和原TTS照常工作
自测 := 配置权威与并发保存、主/SubAI隔离、本地命中零调用、未知触发、受控协议去重、半截不执行
  + direct无音频、withSpeech迟到跳过、一次修复/总预算、取消迟到/手动优先、两PMX/多端
  + 候选completed后一次保存/active不变/停止无保存、schema1迁移/配额/存储失败/导入导出
验证状态 := 仅文档与真实源码核查，未实现/运行本功能自动测试或实际模型生成；发布状态保持原值
```
