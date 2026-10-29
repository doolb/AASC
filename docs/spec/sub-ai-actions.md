# SubAI与AI对话动作实现伪代码

状态：2026-10-29已升级为IK目标生成和统一执行；2026-10-23首版MPL候选仍兼容。复用当前生图/生视频SubAI CSV桥和模型面板；对应design/sub-ai-actions.md中的实施说明为当前边界。

## 独立模型配置

```text
已有 := ChatModelTierPicker、chat-model-tier-service、Chat2API账号/Provider/模型映射、config.set
新增 := motion-model-service；chat.subAi.motion={enabled,providerId,model}；配置摘要revision
模型面板动作SubAI → 选择Provider/具体文字模型/启用 → setChatModelTierSelection purpose=motion
服务端提交队列 → 校验revision、账号启用、Provider/模型一致及非TTS → 再查revision
  → config.set(chat.subAi.motion叶子键) → chatModelTierConfig广播motionSelection/motionRevision/motionProviders
失败 → 原权威快照+错误；重连 → 原初始化快照补发；未配置默认enabled=false
不可用旧选择 → 面板保留不可用占位，允许关闭；不静默借用主模型
主模型设置/生图/生视频 → 原分支；动作保存不切activeProfile，不改主聊天历史或Responses会话
生成调用 := coreAdapter.forwardChatCompletion，显式preferredProviderId、signal、独立messages、stream=false
```

## 对话动作入口

```text
显示端Human及默认physics IK就绪且无手动目标接管 → 上报catalog：actionKey、ready、当前本地动作/服务器动作/内置模板名、模型signature与骨骼/Morph/映射/ikTargets
身份 := 服务端使用登记WebSocket及displayId；旧连接回执不处理
主AI系统提示 := 仅目标具备Human能力才注入动作CSV说明与有界名称摘要
调用 := SubAI,动作,"描述"[,时长秒,强度,次数]；参数仅尾部可省略，时长0.2～15/强度0～1/整数次数1～8
原SubAI流式桥 → 完整调用行解析/去重 → 移除正文和TTS中的控制行 → 注册表动作worker
新轮次 → 取消目标旧任务，固定effectiveRequestId/ttsConversationId → 每端独立任务，当前每轮最多两次请求
动作worker → resolve给已绑定目标；无Human或未就绪返回错误，不调用生成
resolve → 本地同名默认版本优先 → 服务器目录 → 内置别名模板 → Human.prepare，仅准备；MPL/VMD身体采样转IK目标
无法精确命中 → missing → 使用动作SubAI生成；普通引用/否定由主AI说明禁止提交，解析器保护引用/围栏
原[动作]随TTS机制保持；明确动作CSV独立执行，可无音频；提示主AI不重复输出两种相同动作标记
```

## 生成与校验

```text
任务状态 := resolving → generating → preparing → playing → completed/failed/cancelled
准备时限 := 20秒；播放回执时限 := max(30秒,duration×10+10秒)，最多1小时，主动停止仍立即取消
生成条件 := 启用且所选Provider/模型仍有效；每端一个任务，全局最多两生成
source缓存 := 描述+参数+模型signature/能力/映射+配置；最多16项/10分钟，通过端侧准备校验才缓存
输入 := 最小描述/参数/真实ikTargets及Morph能力与IK格式示例；不带主会话历史、previous_response_id、工具权限
输出 := 单个JSON {status,plan} → normalizeIKPlan → {source:规范化JSON字符串,format:ik-targets,policyVersion:2}；原始文本最多32KiB、source最多16KiB
显示端prepareMotion → 共享IK格式校验 → createIKSampler → IK目标混合 → 同一物理IK求解
约束 := duration 0.2..15秒；2..48帧，首0末duration，严格递增，同一目标通道齐全，首尾所有增量/表情为0
位置 := 相对绑定姿态的模型局部增量/身高，每轴<=0.5，采样点变化<=2身高/秒；旋转每轴<=90度、变化<=360度/秒
执行器 := 原关节限位、碰撞和有界力矩；旧MPL仍经原Worker/轨道验证，之后同样转换为IK身体目标
IK校验/准备诊断（旧MPL仍支持编译诊断） → 至多一次SubAI修复；错误信息最多1000字符，仍属原任务20秒截止
截止/停止/模型变更 → AbortSignal；本地等待立即退出并释放并发槽，上游迟到结果丢弃
缓存只复用source，各端独立准备与求解；当前不合并同时在途生成请求
```

## 端侧两阶段与生命周期

```text
prepareMpl → 原operation代次/停止保护、编译与采样 → WeakMap准备句柄，不调用mixer.start
ready → 回ticketId/实际duration；服务端只接受resolving/preparing当前任务的回执
start → 校验requestId/actionKey/ticket/截止与未开始 → Human.startPrepared owner=subai:requestId priority40
actionKey := 当前模型token+generation+库revision+基础动作/Helper引用变化epoch
每次异步完成/轮询 → 核对Human实例/actionKey/连接/可见性；换模型/库/基础动作/后台/断线取消
手动priority>=50出现 → 取消自动动作；自然结束须getRequest.completed=true
已知动作原TTS时钟继续工作；生成动作首版独立direct，不进入原kind=mpl被过滤的TTS队列
停止原对话 → 服务端cancelConversation及端侧tts.stop；新轮次/请求替换仅停止所属owner
重连补配置/catalog，不重放旧start；重复start/ready不重复执行
```

## 候选库与面板

```text
库schema1读取/导入 → 校验原actions/active → 返回内存schema2+candidates空数组；下一次保存原子写入
旧磁盘记录在写入失败时保持；原程序不能读schema2，部署前可导出备份
生成动作实际completed → 暂停本任务catalog刷新 → 候选保存前核对当前actionKey
  → 等待原保存队列 → 从最新库复制 → 按requestId或source+description+parameters去重 → 只追加候选
候选 := id/requestId/description/parameters/source/format/providerId/model/policyVersion/createdAt，不改变actions.active
限制 := 最多32候选，计入总128版本及1MiB元数据；不保存重复VMD，不自动清理默认动作
保存失败 → 已完成播放回执附候选保存失败，内存可导出/点重试保存；不重播
取消/抢占/失败/过期/仅编译或start → 不保存候选
Human面板 := 预览/查看动作代码/采用默认版本/删除/重试保存/停止自动动作
预览 → prepareMotion后手动priority100；IK按保存的时长/强度/次数，旧MPL保持原参数语义，默认版本不变
采用 → 当前模型重新校验、revision检查、规范化行为名称 → 新建或追加版本并显式切active → 移除候选
导入/导出/配额校验 := 同时包含候选与旧动作，保存仍使用IndexedDB单记录事务
```

## 验证与边界

```text
npm run test:sub-ai-motion := 16通过，含14定向与2浏览器
真实浏览器 := 正式米娅PMX、真实MPL Worker/轨道播放；已有库动作零生成；固定测试生成结果播放后入候选/采用才换默认
模型调用 := 假上游验证实际参数/Provider/signal/隔离；没有向真实账号请求模型
回归 := test:chat-images 35通过；test:mmd-production 223通过/1既有跳过；test:chat-streaming 66通过（部分用例重叠）
范围 := 生成动作direct；原已知动作随TTS保持；生成随语音锚点、同时在途去重、多设备/手机实屏仍列后续项
发布 := servicePackage保持true，其他状态保留；无APK/服务包构建或发布
```
