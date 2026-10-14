# AI模型发布/下载实现伪代码

## TTS / LLM 归档实际流程（2026-10-14，源码完成、未发布资源）

```text
已有声明 := ai-model-common规则 + 发布器Python事务 + 同步器 + 源码可信模型目录
新增组 := tts / llm；根清单schemaVersion仍为1
TTS输入 := manifest的14个唯一必要名字 → 全部文件摘要验证 → 加入主清单
LLM输入 := 安全唯一modelId/directory + 声明文件 → 完整目录逐项验证
缺整个LLM目录 → 未发布/只保留定义；已有目录缺项或坏hash → 发布前失败
本地/远端路径 := 两段TTS及llm/manifest + 三段LLM必要文件；未知目录/脚本/cache拒绝
可信目录 := src内固定小型目录；APK读取相同资产，code持有服务定义
APK下载 := 可信定义 与 aimodel实际发布项逐项相等 → 专用LAN/WAN → 流式完整校验
缓存所有者 := APK files/models；LLM定义查询不物化或下载Node权重
镜像 := 无-aimodel无模型请求；启用后全部选中项成功再原子提交根清单
发布顺序 := 先部署兼容同步器 → 实物模型上传与HTTP摘要验收 → 新运行契约代码包 → 新min
本轮结果 := 模型36/36通过；未上传TTS/LLM实物，公开清单未切换
```

## 2026-10-14 已确认实施增量（进行中）

```text
新增组 := tts、llm；所有本地/远端/镜像路径校验同步扩展
收集策略 := 声明驱动；存在但不完整模型阻止发布，完全缺失目录仅保留定义
可信目录 := 小型定义从源码声明/已核验文件生成，独立进入APK及签名code
模型可用 := aimodel实际文件集合与可信定义逐项大小/摘要匹配
下载策略 := 已验缓存优先；固定LAN专用HTTP + WAN HTTPS；状态查询不触发下载
```

## TTS / LLM 归档与可信目录实施草案（2026-10-13，尚未实现）

```text
已有声明:
  rootManifest := schemaVersion=1 + files/path/size/sha256 + totalBytes
  TTS声明 := manifest中的14项name/sha256；LLM声明 := 5种定义及每种必要文件
  当前完整LLM := Qwen9项544130168字节；其余4种只有定义
新增定义:
  expandedGroups := 原五组 + tts + llm
  ttsPaths := tts/manifest.json + 声明文件 + 已有README/LICENSE白名单
  llmPaths := llm/manifest.json + 安全唯一directory/单段声明文件名
  runtimeCatalog := modelId + revision + files/name/path/size/sha256 + totalBytes
操作流程:
  本地规则/远端Python/镜像选组与路径校验 → 同步扩展并先部署兼容同步器
  TTS声明 → 必需文件完整/哈希校验 → 实测大小 → 运行目录定义
  LLM定义 → 安全路径/唯一ID检查 → 完整目录逐项校验
  完全缺失LLM目录 → 未发布并跳过；存在但不完整/坏哈希 → 阻止发布
  .manifest.json缓存/脚本/测试音频/未知文件/链接 → 排除
  APK资产 + code ZIP中src生成目录 → 使用同一可信定义生成器
  小型LLM定义独立于权重打包；只含定义 → 不能宣称模型可下载或ready
  运行目录必要文件集合 与 aimodel主清单相同大小/摘要 → 可下载模型
  LAN HTTP固定源 + 可信定义摘要 → 专用Offline来源适配；WAN HTTPS → 校验TLS
  选择modelId → 映射所需文件 → 保持同revision指纹 → 原生缓存；不下载全部归档
  上传暂存/远端校验 → 主清单最后切换 → WAN HTTP大小/摘要核验
  镜像缺-aimodel → 不读模型清单；带开关 → 成功完成选中项后原子提交
  旧客户端不接受新分类 → 升级或保留旧镜像；不忽略未知项后覆盖清单
```

## TTS / LLM 外置评审（2026-10-13，尚未实现）

```text
当前分类 := 五组固定分类；只允许 group/filename 两段路径
当前远端发布校验 := 独立 Python 白名单，同样只接受上述五组与两段路径
路径探测 := tts/MSTTSLocZhCN.dat → 拒绝；llm/<modelId>/llm.mnn → 拒绝
现有 APK 下载清单 := models[{id,revision,files[{name,size,sha256}]}]
aimodel 主清单 := files[{path,size,sha256}]；不能直接传给 APK 现有解析器
候选分类 := 原五组 + tts + llm；相对路径规则按分类限定，不改成任意递归上传
候选 TTS 输入 := 已声明的必要模型文件 + tts/manifest.json
候选 LLM 输入 := llm 定义元数据 + 本机完整的模型目录内声明文件 / 必要校验元数据
候选发布 := 本地与远端统一规则 → 完整模型校验 → 增量上传 → 清单最后切换 → HTTPS 校验
候选运行时 := 按产品模型 ID 选择主清单项 → 模型定义映射 → 原下载器的元数据 / URL 适配
LLM 可下载 := 对应声明文件在已发布主清单中全部存在；仅有定义不能宣称可下载
源选择 := 优先已有有效本地文件 → LAN 镜像 / WAN aimodel；同一模型文件集合保持一致
LAN 约束 := 当前 RemoteModelManager 拒绝非回环 HTTP；需要专门确定 LAN 下载适配契约
缓存所有者 := APK 持有推理权重；服务端持有定义并消费原生就绪状态，避免重复缓存 Qwen
旧同步器 := 遇到新增分类会拒绝整个主清单；扩展主清单前应部署新版同步器或采用版本化入口
Offline 镜像 := -aimodel 开关继续显式开启；无开关不新增模型同步或网络请求
```

```text
已有声明:
  modelRoot = 项目res/models
  groups = yolo11, sensevoice, streaming-zipformer, voiceprint, speech-enhancement
  httpRoot = https://c.aasc.us/mnt/aimodel/
  sshTarget = as@120.79.245.103
  remoteRoot = /home/as/a/aimodel
新增定义:
  fileRules = 各分类允许的模型/配套文件规则；排除WAV/代码/日志/其他目录
  modelFile = group + relativePath + size + sha256
  manifest = schemaVersion + 按relativePath排序的modelFile列表 + totalBytes
  report = 复用项 + 已传输项 + 已校验项 + 失败项
操作流程:
  普通文件与分类规则 → 选择模型输入 → 流式读取大小/哈希 → 稳定manifest
  30项现有输入 → 1042798505字节；不把该计数硬编码为以后不能扩展的限制
```

```text
上传:
  本地manifest + 远端已有文件指纹 → 变化项
  变化项 → SSH暂存目录 → 远端大小/哈希校验
  校验通过项 → 逐文件原子替换 → 最后原子替换manifest.json
  已发布清单 → HTTPS逐项大小/哈希验证 → report
  任一校验失败 → 不切换清单；原文件/额外文件保持；报告失败
下载:
  HTTPS manifest.json → 有界JSON读取 → 结构/分类/路径/数量/大小校验
  选择分类 + 本地现有指纹 → 复用项与待下载项
  待下载项 → HTTPS流 → 同目录临时文件 + 流式哈希 + 长度上限
  大小与sha256一致 → 原子替换目标文件 → report
  网络/HTTP/长度/哈希失败 → 清理本次临时文件 → 原目标保持
边界:
  只处理允许分类内的普通文件；拒绝符号链接、绝对路径、..、重复项
  SSH命令显式/bin/sh -c；引用经过校验和shell引用，不依赖登录shell
  不递归删除额外资源，不git add模型，不改变Android模型下载API
```

```text
验证:
  模型/配套规则 → 测试文件/未知目录不会进入manifest
  稳定清单/哈希 → 重复生成结果相同，内容变化才传输
  下载有效响应 → 指纹一致；重复下载 → 复用
  截断/超限/坏哈希/路径越界/符号链接 → 拒绝且原文件保留
  上传假SSH/远端暂存 → 文件先就位、清单最后；失败不删除额外资源
  实际首次发布 → 30项HTTPS完整验证；模型始终不新增Git跟踪
当前状态:
  用户2026-10-12回复“上传”确认实施，按已告知代码方案新增脚本并发布
  已实现发布/下载/清单快照和27项自测；30项远端文件及回环HTTPS全量校验通过
  客户端外网目录/清单HTTP200 + 13项小文件完整校验 + GTCRN实际下载/重复复用通过
  本地全分类同步复用30项；没有新增Git模型或改变APK/API模型规则
```

```text
清单汇总 := yolo11 465456802 + sensevoice 239550040 + streaming-zipformer 49752335 + voiceprint 287503690 + speech-enhancement 535638
模型项 := YOLO 6 + 普通/流式ASR 4 + 声纹/分段 7 + 降噪 1 = 18
配套项 := 类别JSON 5 + 词表 2 + SHA-256文件 2 + README 2 + LICENSE 1 = 12
总计 := 30项 / 1042798505字节；完整文件表见对应design，范围保持全部模型
```

```text
清单结构 := schemaVersion=1 + files[{path,size,sha256}] + totalBytes
分类 := path第一段；只允许五组内两段路径和已允许文件名
上传事务 := 先复制到本次暂存 → 验证所有变化项 → 正式目录同名文件备份 → 逐项替换
失败回滚 := 本次已替换项从备份还原；新项移回暂存；旧清单保持
发布前提 := 远端root与父目录均无符号链接；路径/主机参数使用安全规则与显式shell引用
下载入口 := 默认全分类；--groups允许按分类恢复；失败保留旧文件，成功文件可被下次复用
CLI入口 := npm run publish:ai-models / npm run sync:ai-models / npm run test:ai-models / npm run test:offline-sync
Offline同步入口 := 默认只映射aasc-offline与mmd/服务更新；-aimodel或--aimodel显式开启时映射同级aimodel源和目标，单次/watch共用开关
模型同步入口 := 独立sync:ai-models → 默认项目res/models且不保存根manifest；Offline显式镜像时传mirrorManifest=true
镜像清单 := 模型全部成功 → 安全解析根manifest路径 → 内容一致复用，否则同目录临时写入/原子替换；失败保留旧manifest
完整性验证 := 发布后HTTPS清单一致 + 全文件流式大小/SHA-256校验
校验位置 := 默认客户端完整校验；--verify-from server使SSH远端通过同一HTTP(S)地址完整校验，并保留客户端清单比对
校验服务器 := HTTPS通过服务器回环地址连接，公开URL/Host/SNI保持不变，默认CA及主机名验证保持，禁止代理/重定向，文件流式读取
外网可用验证 := 客户端读取同一公开清单 + 客户端实际下载/哈希检查；回环校验不冒充跨WAN逐项传输
Git清单快照 := 上传成功且HTTPS校验完成 → 更新scripts/models/ai-model-catalog.json；--catalog允许指定其他快照路径
正式模型边界 := 普通APK按需下载默认YOLO11n与base FP32；完整Offline按既有白名单内置
```
