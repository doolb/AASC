# 完整 Offline APK 同步与重建

状态：源码已实现并通过自测，待 full APK 构建与发布，2026-10-13。

需求：将 offline-fullapk 加入现有 `npm run sync:offline-update` 默认同步列表，并重出完整 APK。沿用 allserver、当前模型集合与已编译 MNN；不实施另一项尚未确认的 min 首装/模型外置方案。

完整 APK 不写入服务 `manifest.json`，发布独立 RSA 签名 `full-apk-manifest.json`：payload 包含 format、schemaVersion、generatedAt、apkFull（版本、固定版本路径、大小、SHA-256、包名、allserver profile、updateOnly=false、APK签名证书指纹和来源）。复用现有发布密钥、公钥、大小/哈希下载和精确清理。

同步默认读取该索引，将 apkFull 纳入现有进度与 installed/skipped 结果；缺索引 HTTP404时兼容旧源、保留旧full文件。签名/路径/大小/哈希错误失败，不切换清单或清理旧版本。全部下载校验后原子保存服务清单与full独立索引，清理仅在有效full索引存在时执行；保留min、配置、日志、模型、非版本文件与链接。

发布先验证构建哈希、版本、包名/profile及APK签名，再上传版本文件，最后原子替换独立索引，核对LAN/WAN索引和HTTP大小/远端文件哈希，之后精确清理旧full APK。服务清单保持不变。

完整 APK 升级v38/0.2.36-offline，内置当前代码v69与依赖v8、release/config/userconfig/task种子；复用已编译MNN。脚本改变不影响热更服务/网页或min资源，三项发布状态维持原值；full只有此次明确请求构建发布。

需求评审：主L6（full资源与索引契约），次L5（校验、安装和清理）；证据为用户明确full入同步、重出full、确认文件方案。置信度0.69；评分92/100，风险中，结论可开发；建议下放L4：签名索引、组件计划、流式下载、原子落点、独立索引提交、限范围清理。自测覆盖旧源、完整往返和重复复用、坏签名/路径/截断/哈希/链接、不影响服务清单以及失败不清理。
