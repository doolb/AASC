# AI模型发布/下载实现伪代码

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
