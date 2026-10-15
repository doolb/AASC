#skill: ai-code-translation

## framework / Qwen API 旧默认配置累计修复

已有声明
- config.getPublicTtsProviderSettings、config.setTtsProviderSettings、createDataRepairRunner // 使用业务持久化和脱敏读取
- readVersion、v3历史阶段、chat2api.listModelMappings、3.1官方68项目录 // 修复脚本不读取凭证或文件
- prepareReleaseRepairs、seed-worker、签名修复及种子构建 // 复用原子提交和版本门控

新增定义
- LegacyQwen { model: qwen3-tts-flash, voices: Cherry、Serena、Ethan、Chelsie }
- TargetQwen { model: qwen-audio-3.1-tts-flash, voice: qiaoxiaojiao_v3.1 }
- Repair4 { compatibleDataVersions: 0、1、2、3, targetDataVersion: 4 }

操作流程
- 扩展config能力到公开TTS读取和现有TTS保存 // 不提供原始用户配置读取
- 读取dataVersion → 对0补声纹与状态栏、对1补状态栏、对2只补缺失映射、对3跳过历史阶段 // 已完成阶段不重置用户偏好
- 读取原始自定义映射 → 仅前置版本低于3时补v3公开默认映射 // 用户覆盖优先
- 读取公开TTS配置为current → 提取qwen-api配置为qwen // 脱敏值不用于整对象回写
- 匹配源模型和目标模型的自定义精确或通配映射 → 有覆盖则跳过Qwen迁移并记录 // 保护自定义实际模型和映射参数
- 检查qwen.model → 非旧默认或3.1则跳过并记录 // 保留用户自选模型
- 检查默认及三个qwen-api业务显式音色 → 未知音色则整体跳过并记录 // 不生成模型与音色不兼容的组合
- 创建最小patch → 旧模型换3.1，已知旧音色换乔小娇，官方有效音色保持 // 不传凭证或速度音量
- patch非空 → 业务保存 → 重新读取并逐项断言 // 避免把保存失败记为完成
- TTS保存读取原始已存Qwen语速 → 前一模型隐藏语速时补回规范化输入 → 显式语速补丁仍优先 // 切换到3.1不丢失休眠语速
- seed-worker登记config与userconfig快照 → 同脚本隔离执行 → 实际配置、基线4、归档及签名共同提交 // 失败还原两份配置
- 成功写repairId与版本 → 重复执行跳过；失败恢复快照与服务内存 // 重试不伪造成功记录

## framework / 自测映射

已有声明
- qwen-api-data-repair.test.js、tts-provider-settings.test.js、data-repair-js-runner.test.js、offline-data-repair-seeds.test.js // 映射本轮迁移与保存回归

新增定义
- MigrationCases { oldDefault, staleVoice, validVoice, customModel, customVoice, mappingConflict, nonQwenBusiness }
- FailureCases { secondSaveFailure, assertionFailure, waitingCode, unknownData, repeat }

操作流程
- 使用真实runner和业务服务隔离临时配置 → 遍历MigrationCases → 比较模型、音色与所有其他配置 // 不触碰运行实例
- 数据0至3 → 同脚本执行 → 核对历史偏好和基线4 // 验证累计路径
- 自定义精确、通配映射 → 断言迁移跳过及原映射保留 // 保护模型别名
- 保存失败或执行后断言失败 → 核对双配置磁盘与业务内存、数据版本恢复 // 验证事务边界
- 同repairId重复执行 → 验证幂等；未知版本和低代码版本 → 验证门控拒绝 // 不写虚假成功状态
- 真实种子prepare与commit → 核对配置、公开目录与基线4 → 首装状态初始化 // 对应种子自测
- 休眠语速4 → 切换3.1且不提交语速保留4；显式提交负2优先 // 对应tts-provider-settings.test.js
- runner只注入脱敏getter → 私人getter不存在且返回值无凭证 // 防止权限扩展泄露账号
