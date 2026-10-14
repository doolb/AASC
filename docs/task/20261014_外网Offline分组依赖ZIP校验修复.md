# 外网Offline分组依赖ZIP校验修复

## 任务与需求
用户报告外网真机更新失败，提示缺少dependency-manifest.json。接续已确认OfflineUpdateManager及整包/热更新完整方案，在同一原生安装路径修复。enterprise沿用L5安装事务、L4组件契约：分组归档与组合依赖分别校验，避免降低安全要求。设计/spec见android-display-offline-apk模块，伪代码已先更新。

## 代码与实施
OfflineUpdateManager.kt将归档验证置于可测试的纯文件入口，显式dependencyGroup类型；OfflineDependencyGroups.kt组下载使用该类型。测试真实common/Android ZIP无需global manifest或Express，单包仍必须完整，两类型交叉使用、越界/不允许路径、缺失组元数据/空组拒绝。真实线上v9包通过同一归档入口，并解压、实际组内容指纹及排他组合验收。

## 发布与兼容
full48已经完成两端发布；不可覆盖。新候选full50/min51，保留code85/deps9/repair3/seeds85，不重新打服务或依赖包；签名/package/大小/目标文件SHA及公网验证后精确清理。先构建/发布full50，再发布min51；用户从旧min47可选择安装full50或min51，已装更高版本不能用较低full覆盖。

## 自测、性能、风险
运行Android全部单元和npm test:offline-bootstrap；真实归档检查大common需遍历文件，仅自测增加成本，生产仍只检查一次。组缓存已有内容验证保留；失败不切指针或删用户数据。不能靠数据修复JS修复原生校验，旧客户端必须安装新APK。预计源码/验证30分钟，构建及公网传输另计。真实设备安装后的最终效果需用户验收。

## 执行记录
尚未开始源码修改，伪代码/设计已就绪。

### 真实包发现的第二层错误
真实v9 ZIP已通过新归档入口、解压、组内容指纹和排他组合；生产锁检查失败“生产锁文件路径无效”。旧isSafeRelativePath是下载地址白名单，不允许npm @scope。本地packages路径改用既有安全归档路径检查，仍限定node_modules/前缀、越界/反斜杠/绝对路径/链接拒绝和实际版本相等；补充scope/嵌套/错版本/链接/越界测试。先更新spec再修改。

### 源码与自测完成
Android全部251/251通过，0失败/错误/跳过（包括出包机真实v9归档）；test:offline-bootstrap62/62与diff空白检查通过。分组入口/完整单包/空组和非法路径/内容篡改/@scope及嵌套生产锁/版本不符/链接拒绝覆盖。真实common35502条目，421633741展开bytes；同一生产解压代码逐文件sync在磁盘较慢，主动停止仅本次测试worker143并改内存盘后重跑完成，已清理唯一中断临时目录。初次测试字符串插值编译错误已修正。真实包自测需AASC_OFFLINE_GROUP_ARCHIVE_ROOT、AASC_OFFLINE_GROUP_MANIFEST和AASC_OFFLINE_GROUP_PUBLIC_KEY；开发机缺少fixture时仅该项跳过。

用户追加允许ADB Android真机测试；当前192.168.1.6:5555 SM-N9500上offline min41，普通APK v2。构建后覆盖安装并核对实际版本/路径/健康与更新链；保留普通APK8071，不清空应用数据。源码与状态先提交origion，再构建full50/min51并发布。
