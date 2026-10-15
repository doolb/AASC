# 正式 Android 显示端完整离线 APK 实现规格（伪代码）

## 豆包Node登录捕获（2026-10-14）

```text
服务profile标记doubao → 固定官网两存储键 + 当前UA + Cookie.fp → Chat2ApiDoubaoNodeCapture校验
Cookie-only或字段不完整 → 不完成；点击完成显示资料未就绪，可等待/取消
合法快照 → Map内部字符串 → Activity嵌套JSONObject → 原OAuth回调 → 私有credentials.nodeProfile
已有账号只读account-web → 不走捕获/保存；不读取未声明网页存储
原生271项0失败/1既有跳过；新增采集6项全部通过；min56/code90已发布并覆盖安装，原模型和账号保留；登录实际采集待用户补资料
```

## min首次语音模型与分组伪代码（2026-10-14，min55已实现）

```text
已有 := OfflineModelStore可信定义/缓存/原子prepare + NativeBridge本机模型入口 + MainActivity服务健康/显示页成功
新增 := OfflineModelPreparationPlan(groups/所选模型/待下载量/汇总进度) + OfflineVoiceFirstRunState(健康/页面/首次标记)
下载组 := TTS{tts} + ASR/声纹{sensevoice,voiceprint} + 各LLM独立组；原ID/路径/摘要不变
首次门槛 := offline + updateOnly + 服务健康 + 显示页成功 + 尚未提示
默认语音组均有验证缓存 → 记录已处理/不弹框；缺项 → 默认两组勾选/按缺项显示下载量
首次提示成功展示或完整缓存跳过 → 本机记录已处理；未确认不下载；日常重连/重启不重复弹框
手动入口 → 选择组 → 本地已有则校验/加载；缺项需明确确认下载
所选组 → 模型ID去重/定义顺序 → prepare串行复用或下载 → 字节加权汇总进度
每项完整后 → 仅仍有效的UI回调加载TTS/ASR；声纹不改变配置；旧业务不重发
取消 → 所选项取消令牌 + 当前Store.cancel → 后续项不启动/迟到回调忽略 → 保留已完成缓存
失败 → 显示具体错误/重新准备入口 → 已完成项复用；组目录不合并/不伪造全组ready
测试 := 健康/页面顺序与重连去重 + min/profile隔离 + 默认勾选/取消/缺项量 + 分组完整性/缓存/失败/进度/迟到回调
```


## min51 空实例首装故障与修复实施（2026-10-14）

```text
实际输入 := seeds85的llm-server/40f3b6b1与time.announce/728486a7为空目录 + latest文本指向它们
历史min51行为 := 只复制文件 → 空目录遗漏 → latest目标缺失 → 首装失败/无active服务/无API
已验证 := full50卸载 + 空应用单装min51 + LAN原生确认 + code/common/android/种子准备
最终min54 := 空应用独立安装 → 目录/latest恢复 → Node26启动 → code87/deps10健康提交；历史失败不计成功
修复 := 用户追加报告ADB启动失败后按已告知方案实施 → 受限映射遍历目录和文件 → 目标及父目录链接检查 → 补缺失目录 → 补缺失文件 → 目录就绪后转换latest
兼容 := 已有用户数据保留；合法相对链接复用；部分恢复补目录；无效指针/越界/链接拒绝
已验证 := 空/非空实例 + 文本latest中断恢复 + 重复执行 + 父目录链接 + 无效指针；Android254项0失败/1环境跳过
发布 := min54签名构建/两端发布 → 再次卸载单装 → API版本路径及pendingHealth=false；其他后续原生改动保留minApk=true
```

## min52 首装动态链接故障修复伪代码（2026-10-14）

```text
现场 := 空实例/latest已恢复 → Node启动报libc++_shared.so缺失 → 候选回滚
对照 := APK的NDK libc++提供后仍缺Node所需C++符号；Node运行库配套libc++提供后--version=v26.4.0/退出0
修复 := prepare-android-node-runtime必需库增加配套libc++_shared.so → min复制并记录大小/SHA → NodeRuntimeManifest共享精确白名单供解析器和NodeRuntimeInstaller同时使用 → 既有暂存/校验/安装 → 原LD_LIBRARY_PATH正确加载
边界 := 不使用APK另一套NDK库替代、不放宽任意动态库/源码/模型白名单；无需改变服务依赖或Node-major契约
验证 := JS打包保证配套文件真实字节 + Kotlin解析和安装都允许对应Runtime路径/拒绝外部路径 + 新min54干净首装/真实Node服务健康；min53因安装器旧白名单拒绝，未通过首装
```

## 整包首次启动强制内置版本增量（2026-10-14，已实现并发布full50）

```text
已有 := NodeRuntimeInstaller.ensureInstalled + updates可变目录 + NodeServerService健康监视 + active-release指针
新增 := OfflineFullApkActivation + 安装身份/切换状态/清理进度
profile=offline full 且非updateOnly → 读取versionCode/lastUpdateTime/内置Runtime版本
安装身份未处理 → 禁用安装器快速复用 → 从当前APK安装/校验源码与生产依赖
Runtime事务搬回updates → 保存额外下载的模型文件（新包同路径定义优先，移动失败可回退）
暂存旧active指针与切换状态 → 切到APK根目录环境；清理本次换根备份不跟随模型/依赖链接
Node启动 → 预期code/dependency来自内置client metadata，预期codePath=root/dependencies=root/node_modules
切换前冻结旧目录清单 → 健康前阻止新热更新事务；仅退休同一旧指针，拒绝并发替换
健康成功且启动代次仍一致 → 同时核对代码/依赖版本与路径 → 提交此安装身份 → 精确删除旧code-vN/dependencies-vN目录 → 清理失败可重试
清理重试 → 排除后续active/previous引用目录 → 不误删新热更新
安装阶段失败 → 恢复旧指针与原切换状态；运行失败 → 保留旧目录并恢复存在的旧指针
健康失败/安装失败/并发更新 → 不清理旧下载目录 → 按切换记录/既有回滚反馈处理，不误报成功
同安装身份再次启动 → 不强制重置 → 继续已确认热更新active release
同versionCode重新安装但lastUpdateTime变化 → 新一次切回内置
min或普通APK → 既有路径；不新增该切换或清理动作
删除 → 普通版本根目录+受限父目录 → 无FOLLOW_LINKS → 保留未匹配项/配置/账号/模型/任务/修复/ZIP
自测 → 首装/高版本active覆盖/同版本重装/日常重启保留热更/失败不删/链接保护/中断重试/profile隔离
APK共享versionCode → full候选48高于已发布min47 → 下一次min候选49（未构建）；发布索引仍min47
```


## origion 同步与冲突处理（2026-10-14）

```text
已有 := 独立min源码提交 + origion/master远端提交 + 工作区其他任务改动
获取origion → 仅保存重叠未提交文件 → 合并提交历史
自测/待办冲突 → 保留两边有效记录，消除合并引入的相同待办
发布状态冲突 → minApk/servicePackage保留true；未出包不得清除
校验合并快照 → 提交到master → 恢复其他任务未提交改动 → 推送origion/master
未提交dependenciesPackage状态 → 连同对应分层依赖工作继续保留，不代为发布或提交
```

## 独立 min / 无 LLM 权重完整包实际流程（2026-10-14，源码完成）

```text
已有声明:
  OfflineBootstrapManager + OfflineRuntimeState + OfflineBootstrapHealth
  OfflineModelStore + OfflineModelRecovery + OfflineModelPreparationDialog + OfflineModelStatusBridge
  现有安装器/更新器/Node服务/ASR/TTS/声纹/LLM管理器
新增定义:
  standalone := bootstrap-state标记独立首装；文件完整与pendingHealth/ready分别判断
  runtimeCompatibility := ABI arm64-v8a + Node主版本26 + contractVersion1
  bootstrapAssets := HTTPS证书对 + offline-model-catalog；独立于Runtime动态库files
  本机模型状态 := filesPresent / filesReady / downloading；引擎ready另查原生管理器
操作流程:
  min环境缺失 → 原生读取并验签小型清单 → 显示来源/下载量 → 用户确认
  捕获同一签名code/依赖/种子 + lock/运行契约匹配 → 下载摘要固定的组件
  文件锁 → 清理本模块严格命名且无链接的中断staging → 校验大小/摘要/ZIP/空间
  config/userconfig/task → 缺失才补种 → 有效latest文本按同results实例恢复相对链接
  APK动态库 + bootstrap资产 → code/dependencies版本目录 → client元数据 + pendingHealth指针
  API真实版本/代码路径 + HTTPS控制/显示页 + 无业务角色WebSocket握手 → 健康提交
  首装失败无previous → 撤候选指针；原有用户数据/验过的下载保留 → 下次重新确认
  cancel → 固定本轮AtomicBoolean令牌；新请求换令牌，不重置旧令牌
  启动代次变化 → 忽略排队旧启动/旧失败，避免多次拉起Node争抢端口
  full配置 := v43/0.2.41-offline，模型SenseVoice/TTS/声纹，待发布code79/依赖8
  min配置 := v44/0.2.42-offline-min，updateOnly=true/models=[]；未生成APK
  小型LLM定义 → 单独进APK及服务src；所有LLM运行文件 → 不内置full
  模型状态/自测查询 → 只读小型目录/属性/验证标记；不触发网络或加载
  本机模型按钮 → 原生选择/确认 → 已验缓存或固定aimodel来源 → 流式下载及校验
  模型目录同卷切换 → 被中断时恢复旧备份/仅清理自身暂存 → 原生管理器动态选择目录
  本地加载确认 + 文件损坏 → 提示重新确认下载；不隐式开始网络
  ASR/TTS → 缓存就绪后显式准备引擎；不重播历史业务；LLM → 选择该模型revision后加载
  旧Qwen缓存 → 文件集/摘要匹配则复用；Node不另存一份权重
  新min签名清单 → 旧字段优先保留已签名旧cohort；新增运行兼容字段 → 空models也可更新
  发布需求 := minApk=true / servicePackage=true / dependenciesPackage=false
```

历史设计中的通用跨revision模型目录热更新尚无设备验证；当前APK读取自身可信目录，服务代码携带同源定义。真实首装/升级/无网推理与实物发布待验收，不以单元测试替代。

## 2026-10-14 已确认实施增量（进行中）

```text
用户确认 := 继续实施前轮列明的源码方案；当前min已41，full仍38
版本策略 := 新min42；新full配置高于两包，出包仍需用户明确要求
运行检查 := OfflineRuntimeState解析active-release或legacy根，服务完整独立于models集合
首装协调 := 原生确认捕获签名快照 → OfflineBootstrapManager复用受限ZIP/摘要工具
首装资源 := update-only动态库 + 独立bootstrap资产清单；配置/任务种子由nodeMinSeeds恢复
候选安装 := 版本目录 + client元数据 + pendingHealth指针；健康失败无previous则撤销指针
模型准备 := 同一可信目录生成器 → 固定aimodel来源适配 → 原生确认 → 缓存/加载
查询语义 := 状态查询不触发网络或模型切换；模型缺失不阻断服务启动/更新
过渡发布 := 旧指纹从既有签名清单保留；新版使用runtimeCompatibility
进度边界 := 本节记录实施目标，完成验证后再记录实际实现和剩余设备验收
```

## 独立 min / 无 LLM 完整包实施伪代码（2026-10-13，尚未实现）

```text
已有声明:
  原生资产 := libaasc_node + ABI动态库 + MNN/JNI + Offline验签公钥
  发布快照 := 已验签payload中的code / dependencies / nodeMinSeeds / apkMin
  活动版本 := updates/active-release.json；版本目录 / 旧根目录由兼容适配解析
  用户目录 := config + home/.config/aasc-user + res/tasks + 现有可变目录
新增定义:
  bootstrapAssets := 独立资产清单中的HTTPS证书对 + Offline模式元数据 + 小型模型定义
  runtimeRequirements := ABI + Node主版本 + 运行契约版本；来自签名发布元数据
  runtimeReady := 原生资产匹配 + 服务/依赖/lock有效 + 配置与HTTPS有效 + 健康提交
  modelFilesReady := 该modelId/revision所有必要文件的大小及摘要已验证
  modelReady := modelFilesReady + 引擎自检/预热通过
  bootstrapState := missing / awaiting_confirmation / downloading / verifying / installing / starting / ready / error / cancelled
  modelPreparation := modelId + revision + generation + 等待者 + 验证目录 + 当前状态
操作流程:
  当前full版本38、min版本37 → 下次min高于两profile及发布索引最高值；出包时重新求值
  现有环境 → 解析active-release或legacy目录 → 模型无关的完整性检查
  runtimeReady为真 → 复用环境并启动；模型缺失独立报告
  runtimeReady为假 → 原生初始化页 → 明确用户确认 → 捕获并验签一个发布快照
  同快照code/依赖/种子 + lock/运行契约匹配 → 流式下载到同卷staging
  备用源只能返回捕获快照相同的版本/大小/摘要 → 不拼接各源最新组件
  首装缺nodeMinSeeds或运行契约 → 拒绝并提示发布端补齐；旧环境更新保持兼容
  ZIP大小/摘要 + 条目/重复/链接/路径/展开空间 → 验证后解包
  APK原生运行文件 → 安装受限库目录；bootstrapAssets → 单独校验安装
  config种子 → config；userconfig种子 → home/.config/aasc-user；task种子 → res/tasks
  latest文本实例ID + 同results真实实例目录 → 恢复相对链接；未知链接拒绝
  已有文件 → 保留；缺失种子文件 → 补齐；现有NodeServerConfig → 本机main/native模式
  code-vN + dependencies-vN + lock → 候选active-release + offline-update-client
  HTTPS状态/实际版本 + 控制页资源 + WebSocket初始化 → pendingHealth提交 → 环境确认标记
  无previous且健康失败 → 撤候选指针 → 首装可重试；有previous → 回滚旧环境
  进程退出 → 读事务记录 → 未提交候选不判ready；保留已验下载及旧数据
```

```text
已有声明:
  内置模型 := APK实际资产 / 旧解包模型；下载缓存 := files/models
  aimodel文件清单 := 已发布files/path/size/sha256；可信定义 := APK或签名code生成目录
新增定义:
  localSources := 已验内置目录 / 已验下载缓存；不能按offlineMode伪造bundled来源
  downloadSources := 固定LAN aimodel / HTTPS WAN；专用策略不放宽通用下载器
  definitionOnly := llm/manifest.json及统一目录；不包含LLM目录内任何运行文件
操作流程:
  status查询 / 自动预热 / 定时业务 → 仅检查状态；不开始网络、不隐式弹窗
  用户明确准备modelId → 查本地完整文件 → 可用则加载；缺失则显示体积/来源并等待确认
  同意 → 按modelId/revision归并任务 → 可信定义与已发布清单交集校验
  相同文件指纹 + 专用LAN或WAN来源 → 流式下载 → staging大小/摘要验证 → 同卷切换
  modelFilesReady → 原生加载/自检 → modelReady；内存不足保留文件、状态为加载失败
  ASR/TTS指定Offline目录缺文件 → 缓存/远端来源回退；不能永久只查内置目录
  LLM默认ID + 无实际资产 → missing；旧Qwen缓存完整 → 可显式加载；Node不复制权重
  下载完成 → ASR可重新开始 / TTS新请求可播放 / LLM输入可重试；不自动重放过时请求
  取消 → 通知所有等待者 + 撤本轮临时项；保留已验文件和旧revision
  新模型选择 → generation换代 → 旧请求不再恢复；不同revision串行
  断网重启 → 本地定义/验证缓存 → 无网可加载；坏模型只影响对应modelId
  完整profile目标models := sensevoice + tts + voiceprint；小型定义单独保留
  min目标models := 空；update-only动态库白名单不含bootstrapAssets
```

```text
新增定义:
  legacyCompatibility := 已发布旧full真实模型指纹，保留在过渡apkMin旧字段
  runtimeCompatibility := 新版更新器使用的ABI / Node主版本 / 运行契约
操作流程:
  旧full23/full38/min36/min37 → 核对指纹cohort；单字段不能覆盖不同指纹
  相同旧指纹 → 旧更新器预物化资产 → 新min系统覆盖安装 → 新运行环境检查
  不同旧指纹 → 明确手动升级路径；不能伪称自动迁移成功
  新full空bundled集合 / 干净min → 新运行兼容契约 → 允许后续min更新
  合法空models → 可解析；字段缺失/损坏 → 对应模型异常；不替代环境损坏判断
  每次APK替换前 → 仅保护当前APK实际持有且缓存未就绪的模型；空集合无需物化
  新full空集合 → 不覆盖legacyCompatibility来源，不生成虚构模型条目
  发布顺序 := 同步器兼容 → 模型HTTP核验 → 环境契约与种子发布 → 过渡min → 兼容验收
  完整APK仅用户明确要求才构建；沿用独立full-apk-manifest，不进入服务manifest
  本轮状态 := 仅设计；源码/app.json/发布需求状态保持原值
```

## min 独立安装与 Qwen 外置设计评审（2026-10-13，尚未实现）

```text
当前证据:
  min profile = allserver-min + updateOnly=true + models=[]
  min 已携带 Node 可执行库与 allowlist 动态库；不包含服务代码、生产依赖和初始化种子
  Activity 发现没有 hasFullOfflineInstall → 显示要求完整 APK 的提示 → 结束启动
  hasFullOfflineInstall / Offline 快速复用 → 检查非空的 offline-model-manifest.models
  offline-model-manifest.models := 仅从 display-models 的内置 LLM 权重生成
  只保留 sensevoice / tts / voiceprint → 29 个模型配套文件 + 空 LLM models
  空 LLM models → 当前快速复用、min 安装前提和模型兼容解析失败
  Offline NativeBridge → 固定向 MnnLlmModelManager 注入 bundled Qwen
  当前模型选择移除 Qwen → 同时没有选中 llm/manifest.json → 服务 LLM 目录定义缺失
```

```text
候选已有声明:
  runtimeAssets := APK 中的 Node 本体 + 动态库 + 更新验签公钥
  releaseManifest := 已签名的 code + dependencies + nodeMinSeeds + apkMin
  nativeModelStatus := APK 上报的模型准备和推理状态
候选新增定义:
  runtimeReady := 服务代码 / dependencies / 配置与任务种子 / 本机 HTTPS / ABI 都就绪
  modelReady := 指定模型的完整文件及指纹已验证；独立于 runtimeReady
  bootstrapState := missing → awaiting_confirmation → downloading → verifying → installing → starting → ready
  modelState := missing → awaiting_confirmation → downloading → verifying → ready
  legacyModelCompatibility := 旧更新器读取的兼容字段；不能直接换成空集合的新指纹
候选操作流程:
  已有有效 runtimeReady → 复用安装 → 原有原生更新路径 → 本机 Node 启动
  缺少 runtimeReady → 原生界面确认 → LAN/WAN 获取并验签同一次发布快照
  code / dependencies / nodeMinSeeds → 校验大小和 SHA-256 → 同级 staging
  APK runtimeAssets + staging 服务文件 + 首次种子恢复 + 本机 HTTPS 资源 → 完整启动目录
  code.requiredDependencyVersion = dependencies.version 且 code.requiredLockSha256 = dependencies.lockSha256 → 初始化版本化 active-release
  启动与健康检查通过 → 确认发布；失败或退出 → 保留旧目录 / 下次可重试
  声音 / LLM 首次使用 → 已验证内置目录或旧 bundled 缓存优先复用
  没有完整缓存 → 提示对应模型体积与来源 → 同意后下载 → 校验 → 原子安装
  查询状态 / 环境安装结束 → 不隐式开始模型下载，不误报模型 ready
  full 模型配置 := sensevoice + tts + voiceprint；LLM 定义和默认选择独立保留为小型元数据
  首个过渡 min 清单保留旧更新器可识别的兼容字段 → 升级到新逻辑后按运行环境 / ABI 判断原生兼容
  无内置 LLM / 已按需下载 LLM → 均允许后续 min 更新；旧 APK 替换前仍保护其尚未物化的内置权重
```

```text
评审待补齐:
  Android 需解析并初始化 nodeMinSeeds；当前 OfflineUpdateManifest 未建模该组件
  首次初始化不得依赖尚未启动的 WebView / 本地服务接口
  本机 HTTPS 启动资源缺失时不得继续沿用 https://127.0.0.1:8081 并误报健康
  模型缺失时的业务恢复 / 取消规则、并发下载归并、磁盘预算与中断恢复需在实施前写实
  缺少元数据是安装损坏，合法空的内置 LLM 集合不是损坏；不能简单删除全部检查
  本节是候选设计；现行实现仍按后续“现行模型选择”执行
```

## 现行模型选择（2026-10-12核查）

```text
profile := loadApkProfile(allserver) → release/apkbuild/allserver/app.json
modelIds := Qwen 0.8B + sensevoice + tts + voiceprint
模型输入 := resolveSelectedModelFiles(modelRoot, modelIds)
voiceprint选择 := MODEL_FILE_SELECTIONS.voiceprint → base FP32 + Pyannote两文件
实际已发布完整v23 := 本次YOLO/ASR/声纹范围内包含SenseVoice/base FP32/Pyannote三个ONNX
allserver-min := updateOnly=true, models=[] → 不内置模型
其他分类 := 未列入当前profile时，不因res/models已有文件或外网aimodel归档而自动打包
历史OFFLINE_MODEL_FILES常量 := 兼容测试参考；不能代替profile模型选择或实际APK目录
```

现行入口为`npm run build:apk:offline`与`scripts/ops/build-apk.js`，打包输入及路径以profile规则为准。以下原始构建/固定列表保留为历史参考，不作为当前实包模型范围。

## 原构建伪代码（历史参考）

```text
build:apk:offline:
    projectRoot = 当前仓库根目录
    runtimeDir = AASC_ANDROID_NODE_RUNTIME_DIR 或 projectRoot/3rd/android-node-runtime/arm64-v8a
    packageDir = AASC_ANDROID_NODE_PACKAGE_DIR（必填）
    certDir = AASC_ANDROID_NODE_CERT_DIR 或 projectRoot/res/certs
    modelRoot = projectRoot/res/models

    prepareAndroidNodeRuntime(
        runtimeDir,
        packageDir,
        certDir,
        includeOfflineModels = true,
        modelRoot
    )
    生成 runtime-manifest.json、runtime-version.txt、runtime-mode.txt
    生成离线模型元数据并将每个模型文件加入 server/res/models

    gradle :app:assembleDebug -PaascOffline=true
    将 app-debug.apk 复制为 app/build/outputs/apk/debug/aasc-display-offline.apk
```

```text
offlineModelFiles = 固定白名单：
    sensevoice/model.int8.onnx
    sensevoice/model.int8.onnx.sha256
    sensevoice/tokens.txt
    sensevoice/tokens.txt.sha256
    streaming-zipformer/encoder.int8.onnx
    streaming-zipformer/decoder.int8.onnx
    streaming-zipformer/joiner.int8.onnx
    streaming-zipformer/tokens.txt
    voiceprint/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx
    voiceprint/pyannote_segmentation_3_0_int8.onnx
    speech-enhancement/gtcrn_simple.onnx
    tts/manifest.json 以及 TtsModelFiles 全部文件
    rapidocr/VisionModelFiles 全部文件
    yolo11/yolo11n.onnx
    yolo11/yolo11n.classes.json
```

## Runtime 安装伪代码

```text
NodeRuntimeInstaller.ensureInstalled:
    读取 runtime-mode.txt（不存在时按 online 兼容）
    读取 runtime-version.txt
    如果版本一致且关键入口、Node 动态库存在：
        如果 mode == offline：
            读取 offline-model-manifest.json
            校验每个 res/models 文件存在且大小一致
            任一失败则进入完整安装
        否则直接复用
    读取 runtime-manifest.json
    解压 manifest 所有条目到 staging
    校验大小和 SHA-256
    替换 runtime、src、node_modules、package 文件、res/certs、res/models
    替换离线模式元数据文件
    保留 config、res/uploads、res/temp、logs
    写入版本标记
```

## Android 启动伪代码

```text
MainActivity.onCreate:
    offlineMode = resources.getBoolean(aasc_offline_mode)
    selectedUrl = chooseUrl(intentUrl, savedUrl, offlineMode)
    如果离线模式且无 intent/saved 地址：使用 https://127.0.0.1:8081
    现有共享存储权限流程完成后调用 continueStartup()
    continueStartup():
        如果已经继续过启动：返回
        如果 offlineMode 或 serverInput 非空：connect()
        申请音频焦点
        requestNextStartupPermission()

requestNextStartupPermission:
    依次检查 RECORD_AUDIO、CAMERA、Android 13+ POST_NOTIFICATIONS
    找到第一个尚未授权的权限：
        requestPermissions(该权限)
        等待 onRequestPermissionsResult 后再次调用 requestNextStartupPermission
        不因用户拒绝当前权限而中断后续检查
        返回
    如果本轮音频或摄像头权限已获准：
        webView.reload()
    否则不重载 WebView

onRequestPermissionsResult:
    REQ_STORAGE_PERMISSION -> 延续现有存储提示与 continueStartup()
    REQ_AUDIO_PERMISSION -> 记录是否获准；requestNextStartupPermission()
    REQ_CAMERA_PERMISSION -> 记录是否获准；requestNextStartupPermission()
    REQ_NOTIFICATION_PERMISSION -> requestNextStartupPermission()

connect:
    baseUrl = ServerConfig.baseUrl(input)
    start NodeServerService(mainServerUrl = baseUrl, offlineMode = offlineMode)
    displayId = offlineMode ? "offline-display" : null
    displayUrl = ServerConfig.pageUrl(baseUrl, displayId)
    创建显示 WebView(context, offlineMode) 并加载 displayUrl
    在 webContainer 左上角（top|start）创建控制按钮并显示
    创建控制 WebView(context, offlineMode)（仍在按钮下方）但初始隐藏

MainActivity.onPageStarted(displayView):
    如果 offlineMode：在页面脚本执行前将 localStorage.displayId 预置为 "offline-display"
    兼容已安装 full APK 尚未通过服务 code-only 热更更新 display.html 的情况

WebViewScalePolicy.deviceClass(smallestScreenWidthDp):
    如果 smallestScreenWidthDp > 0 且 smallestScreenWidthDp < 600：返回 PHONE
    返回 COMPUTER

WebViewScalePolicy.scaleFactor(offlineMode, widthPixels, heightPixels, densityDpi, deviceClass):
    如果 offlineMode 为 false：返回 1.0
    如果 widthPixels <= 0 或 heightPixels <= 0 或 densityDpi <= 0：返回 1.0
    longEdgePixels = max(widthPixels, heightPixels)
    resolutionRatio = longEdgePixels / 1280
    densityRatio = densityDpi / 320
    deviceCoefficient = deviceClass == PHONE ? 1.108705 : 1.0
    rawScaleFactor = resolutionRatio × densityRatio × deviceCoefficient
    返回 clamp(rawScaleFactor, 1.0, 3.0)

WebViewScalePolicy.initialScalePercent(offlineMode, widthPixels, heightPixels, densityDpi, deviceClass):
    scaleFactor = scaleFactor(offlineMode, widthPixels, heightPixels, densityDpi, deviceClass)
    返回 round(scaleFactor × 100)

DisplayWebView.init(context, offlineMode):
    初始化现有 WebSettings
    metrics = context.resources.displayMetrics
    deviceClass = WebViewScalePolicy.deviceClass(context.resources.configuration.smallestScreenWidthDp)
    scale = WebViewScalePolicy.initialScalePercent(
        offlineMode, metrics.widthPixels, metrics.heightPixels, metrics.densityDpi, deviceClass
    )
    setInitialScale(scale)
    保存 scale 为 initialScalePercent

MainActivity.setupWebView:
    创建显示 WebView 后，将该 WebView 的 initialScalePercent 传给 NativeBridge

NativeBridge.getDisplayWebViewInitialScalePercent:
    返回创建显示 WebView 时保存的 initialScalePercent
    不从控制 WebView 或系统全局设置重新推导，确保与 setInitialScale 使用同一数值

display.html.applyVoiceTopCenterLayout:
    scalePercent = NativeDisplay.getDisplayWebViewInitialScalePercent()；缺少原生桥或读取失败时使用 100
    voiceStatusRow 使用原有边距
    voiceTextDisplay 在 0°/180°的固定偏移 = rotationLayout.margin × 8 / (scalePercent / 100)
    voiceTextDisplay 在 90°/270°保留旋转包围盒中心锚点
    不修改 Offline WebView 初始缩放、控制 WebView、普通浏览器 CSS 或其他显示元素

DisplayWebView.initControlPageZoomPolicy(disableInputAutoZoom):
    如果 disableInputAutoZoom == false：不注入控制端专用 viewport
    否则：页面完成加载后查找 meta[name="viewport"]
        如果不存在：创建 viewport meta 并加入 head
        将 content 规范化为 width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no
    不修改显示 WebView、普通 APK 或服务端 upload.html 源文件

MainActivity.registerWebViewFileChooser:
    创建 Activity Result 文件选择启动器
    保存当前等待结果的 WebChromeClient.ValueCallback<Array<Uri>>
    收到新选择请求时：
        若旧 callback 尚未完成：以 null 完成旧 callback
        使用 WebChromeClient.FileChooserParams.createIntent() 创建系统文件选择 Intent
        启动系统文件选择器
        启动失败时：以 null 完成当前 callback，并记录可诊断错误
    收到选择器结果时：
        使用 WebChromeClient.FileChooserParams.parseResult(resultCode, data) 解析 URI 数组
        以解析结果（取消时为 null）完成当前 callback，并清空等待状态
    Activity 销毁时：以 null 完成等待中的 callback

DisplayWebView.onShowFileChooser(callback, chooserParams):
    将 callback 和 chooserParams 交给 MainActivity 的系统文件选择流程
    显示 WebView 与控制 WebView 使用同一选择流程
    选择器取消或不可启动时结束本次选择，不申请通用存储权限

实现状态（2026-10-13）：
    MainActivity 以 ActivityResultContracts.StartActivityForResult 注册系统选择器
    显示与控制 DisplayWebView 均将文件选择请求绑定到同一个 MainActivity 回调
    选择结果由 FileChooserParams.parseResult 转换为 URI 数组；取消/异常/Activity 销毁会清理 pending callback
    release/offline-release-status.json 的 minApk=true，等待签名构建；当前未构建或发布 APK

实现状态（2026-09-18）：
    DisplayWebView 增加 disableInputAutoZoom 参数，MainActivity 仅为 Offline 控制 WebView 传入 true
    onPageFinished 调用 applyInputAutoZoomPolicy()
    Offline 静态回归 26/26 通过，Android :app:testDebugUnitTest BUILD SUCCESSFUL

发布状态（2026-09-18）：
    min v11（versionCode 11、versionName 0.2.9-offline-min）已发布到 LAN/WAN
    APK 大小 89235646 bytes，SHA-256 为 0b3ab8871ca17e32fa1dc5db767ef8b31049a973d8d678faa471e1ad4ac396da
    两站点 HTTP 200、Content-Length、远端 hash、签名清单和 APK ZIP 完整性校验通过

toggleControl:
    如果 controlWebView 可见：隐藏并将按钮文字设为“控制端”
    否则：显示 controlWebView，加载 baseUrl/control，并将按钮文字设为“隐藏控制端”

DisplayWebView 页面 ID:
    configuredId = 从当前 /display URL 的 displayId 查询参数读取
    如果 configuredId 非空且符合显示端 ID 格式：
        localStorage.displayId = configuredId
        WebSocket 连接使用 configuredId
    否则：沿用原有 localStorage 持久化 ID；不存在时生成 display-* 随机 ID

OfflineDisplayInfo:
    如果 offlineMode == false：隐藏诊断浮层
    metrics = 当前 display Context.resources.displayMetrics
    scale = WebViewScalePolicy.initialScalePercent(
        true, metrics.widthPixels, metrics.heightPixels, metrics.densityDpi
    )
    将浮层文字设置为“分辨率 {width}×{height} | DPI {densityDpi} | 缩放 {scale}%”
    将浮层放在 webContainer 右下角，保持非交互、低于启动遮罩和更新卡片

MainActivity.onConfigurationChanged:
    如果 Offline 模式：重新读取 displayMetrics 并刷新 OfflineDisplayInfo

Release 任务恢复:
    Offline APK 的 render-display 任务结果 target/displayId = "offline-display"
    显示端 WebSocket 连接后以 displayId 查找并恢复该任务

NodeServerService Offline 启动迁移:
    Runtime 安装和服务更新完成后读取 res/tasks/render-display/results/index.json
    只对 taskName == "render-display" 的实例替换 displayId 为 "offline-display"
    保留实例状态、参数和其他任务；文件不存在或已是固定 ID 时跳过

onBackPressed:
    如果控制页可见：先隐藏控制页
    否则：隐藏显示 WebView 和控制按钮，恢复配置栏
```

## 本机模型入口位置与边缘收起（2026-10-15）

```text
显示页初始化 Offline 原生模型入口
  如果 NativeDisplay/模型管理能力存在
    显示本机模型入口容器
    初始状态 = 收起
  否则
    隐藏本机模型入口容器

点击边缘把手
  显示“本机模型”主按钮和收起按钮
  把手不可见
  aria-expanded = true

点击“本机模型”主按钮
  调用 NativeDisplay.offlineShowModels()
  保持入口当前展开状态

点击收起按钮
  隐藏主按钮和收起按钮
  显示贴左边缘的把手
  aria-expanded = false

显示交互舞台布局
  聊天/MMD/语音入口沿用左下角 flex 组
  本机模型入口独立绝对定位在 FPS 下方
  top 至少为 84 CSS px，并叠加旋转映射后的安全区/键盘顶部内缩与间距
  收起把手贴左边缘；展开按钮遵守安全区和键盘左侧内缩
  入口与左上角原生控制端按钮（收起高度 72 dp）保持纵向分离
  不改变其他按钮位置和模型下载/加载确认流程
```

## Node 配置伪代码

```text
NodeServerService.onStartCommand:
    offlineMode = intent.offlineMode 或保存的 offline_mode
    selectedUrl = intent.mainServerUrl 或保存地址
    NodeServerConfig.write(root, selectedUrl, nodeName, offlineMode)

NodeServerConfig.write(..., offlineMode):
    aasc.role = offlineMode ? main : subserver
    aasc.mainServerUrl = 规范化地址
    写入稳定 nodeId 和节点名称
    关闭 Android 节点不支持的 ASR/TTS 服务能力

buildNodeEnvironment:
    AASC_ANDROID_NODE = 1
    AASC_OFFLINE_MODE = offlineMode ? 1 : 0
```

## 测试伪代码

```text
Node 构建测试：
    普通 Runtime 不包含 res/models
    离线 Runtime 包含固定白名单全部模型且不包含测试 WAV/其他 YOLO/PT
    缺失白名单模型时构建失败
    runtime manifest 的离线模型路径均有大小和 SHA-256

Android JVM 测试：
    离线无地址时选择 127.0.0.1:8081
    离线配置 role == main，普通配置 role == subserver
    离线环境包含 AASC_OFFLINE_MODE=1，普通环境为 0
    WebViewScalePolicy 对 1920×1080@320dpi 电脑类返回 150%，对 720×1480@280dpi 手机类返回 112%
    NativeBridge 返回与显示 DisplayWebView.setInitialScale 相同的百分比

Chromium 浏览器布局测试：
    以相同物理视口模拟 100%、112%、150%、300% 初始缩放
    使用相同 TTS 文本覆盖 0°/90°/180°/270°
    0°/180°TTS 固定边距换算回物理像素后保持 160px
    90°/270°旋转包围盒继续贴合原有自适应边缘锚点

静态构建/UI 测试：
    Gradle 离线属性设置 applicationId、label、versionName
    新 npm 命令调用离线准备和 -PaascOffline=true
    activity_main.xml 含控制按钮且按钮位于 webContainer 顶层

验证：
    运行 Node 定向测试
    运行 Android :app:testDebugUnitTest
    在可用环境运行 npm run build:apk:offline
    检查 APK 包名、版本名、文件名和模型 assets
    Offline APK 启动页固定使用 displayId = "offline-display"；min 热更原生代码在旧 display.html 上预置同名 localStorage
```

## 已验证结果

```text
Node 离线构建/Runtime/HTTPS 定向测试：20/20 通过
Android :app:testDebugUnitTest：BUILD SUCCESSFUL
普通 :app:assembleDebug：BUILD SUCCESSFUL
离线 :app:assembleDebug -PaascOffline=true：BUILD SUCCESSFUL
离线 APK applicationId：com.aasc.display.offline
离线 APK versionName：0.1.0-offline
离线 APK 模型条目：32，451266757 bytes
离线 APK Runtime manifest：无重复路径，runtime-mode=offline
```

## Offline 发布更新日志伪代码

```text
OfflineUpdateManifest.parse:
    apkMin.releaseNotes 缺失时返回 null
    存在时校验为非空字符串且长度不超过 4096 个 Unicode 字符

MainActivity.showMinApkUpdatePrompt:
    显示版本和大小
    releaseNotes 非空时显示更新内容 TextView，最多 6 行并省略尾部
    releaseNotes 为空时隐藏更新内容 TextView

MainActivity 更新卡片自动收起:
    更新卡片显示或用户触摸卡片时启动 10 秒无触摸计时
    如果计时结束且卡片仍可见:
        隐藏完整更新卡片
        显示右侧收起入口
    如果服务更新或 min APK 下载/校验正在进行:
        不取消后台任务
        不因进度回调自动展开卡片
    用户点击右侧收起入口:
        显示完整更新卡片
        重新启动 10 秒无触摸计时
    下载失败或需要系统安装确认:
        显示完整更新卡片

MainActivity Offline 缩放诊断提示:
    Node 服务状态变为 starting:
        显示分辨率、DPI 和 WebView 缩放值
        设置 10 秒后的隐藏时间
    到达隐藏时间:
        隐藏 offlineDisplayInfo
    配置变化时:
        重新计算并刷新提示文本
        保留原隐藏截止时间
```

实现验证：更新内容使用原生 `TextView` 纯文本显示，布局限制最多 6 行并省略尾部；Node 静态回归 39/39、Android `OfflineUpdateManifestTest` 均通过。

## v10 缩放曲线验证记录（2026-09-18）

- min v10（`0.2.8-offline-min`）已正式发布到 LAN 和 WAN 直连 IP；清单签名有效，APK v2 签名有效。
- APK SHA-256：`713a0ecd53536afadf5115864e1ea28a90409717aa2bbd95655fbad155ce139e`；发布清单 SHA-256：`bc613aba55e41fced9b01d38cbfc83d0541c4eb5b8b61b4b0d6545dbd6134ac0`。
- SM-N9500 Display 2 UI 自动化读取 `分辨率 1920×1018 | DPI 160 | 缩放 100%`；固定显示端 ID `offline-display` 和服务健康接口正常。

## APK 原生 OpenAI `_vendor` 资源路径（2026-09-21）

```text
prepareAndroidNodeRuntime:
    从服务器生产依赖读取 node_modules/openai/_vendor/**
    运行包逻辑路径继续保留 node_modules/openai/_vendor/**
    写入 APK assets 时，将该目录映射为 node_modules/openai/aasc-openai-vendor/**
    runtime-manifest 使用映射后的可打包路径，避免 Gradle 的 <dir>_* 过滤规则丢失资源

NodeRuntimeInstaller:
    从 manifest 读取并校验 aasc-openai-vendor/**
    安装到 staging 后，将 node_modules/openai/aasc-openai-vendor 重命名为 node_modules/openai/_vendor
    之后才切换 staging 为正式 aasc-server 目录

验证：
    APK 中必须存在 aasc-openai-vendor/partial-json-parser/parser.mjs
    APK 中不得依赖 openai/_vendor 物理目录
    安装完成后的私有目录必须存在 openai/_vendor/partial-json-parser/parser.mjs
    Pi SDK 内嵌的 node_modules/openai/_vendor/** 使用同样的映射和恢复规则
    ChatCompletionStream.mjs 的 ../_vendor 导入必须可解析
```

实现验证：完整 Offline APK v22（`0.2.20-offline`）已生成；APK ZIP 中顶层和 Pi SDK
嵌套 OpenAI 包均包含 `aasc-openai-vendor/partial-json-parser/parser.mjs`，不存在物理
`openai/_vendor` assets 路径；`unzip -t` 全量校验通过。Node 定向测试 25/25、Android
JVM `:app:testDebugUnitTest` BUILD SUCCESSFUL。

发布验证（2026-09-21）：完整 APK 升级为 v23（`0.2.21-offline`），min APK 升级为 v32
（`0.2.30-offline-min`）；两端发布根目录仅保留当前完整/min 版本，服务清单保留 code v19
和 dependencies v4。LAN/WAN 的完整 APK 和 min APK 均返回 HTTP 200，Content-Length 与
本地构建产物一致。

## 完整 APK 基线 active release 初始化（待处理，2026-09-21）

```text
首次完整 Offline APK 安装:
    安装根目录代码与 node_modules
    读取 offline-update-client.json 作为 bundled-baseline
    不创建 updates/active-release.json

首次 code-only 更新且没有对应版本化 dependencies:
    代码安装到 updates/code/code-vN
    依赖回退到 Runtime 根目录 node_modules
    写入 active-release.json(legacyDependencies = true)
```

该行为暂时保留，后续需要决定是否在首次安装时生成版本化基线 release，或增加独立的
`bundled-baseline` 依赖来源字段，避免把完整包内置依赖显示为 `legacy-root`。

## 平台依赖组合伪代码（2026-10-14）

```text
Manifest.dependencies.groups 存在 → 四组键/路径/target + SHA(canonical(groups)) + 总大小校验
androidLayers := common+android；nodeMajor26、ARM64/Bionic、ABI147或NAPI<=10
下载预算 := 所选两组大小，缓存复用前验证元数据与node_modules路径/内容SHA
未缓存组 → 下载与压缩包SHA校验 → 受限ZIP → 内容SHA校验 → 原子写组缓存
组装 → common与android普通文件排他复制 → 冲突拒绝 → dependency-manifest版本/lock
真实生产包版本与代码锁一致 → 安装原有dependencies-vN目录 → 原有pending指针/本机健康/回滚
min首装与热更新 → 同一prepare函数；legacy单依赖包 → 原有读法
用户配置/results/models/logs与APK JNI → 保持原职责
```

## 分组ZIP校验修复（2026-10-14，先更新伪代码）

```text
validateComponentArchive(archive, component):
    inspection := inspectZipArchive(archive)  // 保持ZIP路径、重复项、链接和膨胀大小检查
    每个条目必须属于对应组件白名单
    按component分派必需条目:
        code := launcher + package.json + package-lock.json
        dependencies := dependency-manifest.json + node_modules/express/package.json
        dependencyGroup := dependency-group.json + 至少一个node_modules普通文件
        dataRepair := repair.js
        未知组件 := 拒绝
    返回inspection
OfflineDependencyGroups.prepare:
    legacy单包调用dependencies校验
    common/android各ZIP调用dependencyGroup校验
    解压后仍验证签名绑定的组名称/版本/target及真实内容SHA
    合并后生成dependency-manifest.json，再执行完整依赖及生产锁版本校验
发布:
    full48已发布且不可覆盖；修复版候选full50/min51
    只改变Android原生验证，复用code85/deps9/repair3/seeds85
    minApk保持true，待实际修复APK构建成功后清零
```

```text
validateLock(directory, codeLock):
    读取已通过签名归档/锁SHA校验的packages
    跳过根项及dev/optional
    relative必须以node_modules/开始且通过本地归档路径安全检查
    本地包路径允许@scope和嵌套node_modules；不套用下载URL白名单
    assertSafePath逐级拒绝符号链接
    校验实际package.json存在且版本与锁一致
```
实际v9组合测试追加生产锁校验时发现旧URL白名单不允许@scope；修复属于同一依赖安装校验链。

```text
已发布 := LAN/WAN full50 + min51；manifest服务组合85/9/51/repair3/seeds85
ADB当前 := full50 / HTTPS status ok / 根code85+根dependencies9 / activation.ready
健康后旧code76删除；日常重启Runtime标记未变
公网回归 := actual50 DEX + 独立76/8基线目录 + 仅公网源 → applyServerUpdate.applied=true
隔离指针pendingHealth不代替服务启动；真实根环境另验健康，fixture与自有转发已清理
minApk/servicePackage/dependenciesPackage := false/false/false
```
