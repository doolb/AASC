# 完整 Offline APK 同步伪代码

```text
已有声明
  Offline服务签名清单及生产发布密钥
  同步文件校验、进度、原子安装与精确版本清理
  full构建profile allserver及构建清单
新增定义
  FullApkIndex包含payload和signature
  payload包含format=aasc-offline-full-apk、schemaVersion=1、generatedAt、apkFull
  apkFull包含versionCode、versionName、relativeUrl、size、sha256、packageName、profile、updateOnly、signerSha256、source
  固定索引full-apk-manifest.json；固定版本路径apk/aasc-display-offline-v<versionCode>.apk
操作流程：发布
  校验普通APK文件、构建profile/版本/哈希与APK包名和签名证书
  生成并签署独立full索引
  LAN与WAN各上传并校验版本APK，再原子替换full索引
  验证HTTP索引签名与内容、APK大小及文件哈希
  清理该发布根下严格数字版本旧full普通文件，保留当前full
  任何情况不替换服务manifest.json，清理失败保留已发布结果并可重试
操作流程：同步
  校验服务清单，并读取独立full索引
  full索引404只跳过该资源；其它读取或校验错误失败
  合并现有服务组件与独立apkFull到下载计划
  预校验两份索引落点，拒绝链接或非普通文件，失败前不下载或提交服务清单
  校验本地同版本文件；相同复用，不同或链接拒绝
  逐文件下载并校验声明大小/SHA-256，更新统一进度
  全部成功后原子保存两份索引；原有服务清单保持原格式
  full索引存在才执行full版本精确清理，未发现时保留本地full
  返回installed/skipped、清理结果与full索引
操作流程：构建
  allserver版本38、版本名0.2.36-offline；基线代码69、依赖8
  保持原有模型及release/config/userconfig/task输入
  校验固定MNN revision与已编译库，跳过MNN prepare编译
  使用既有构建编排生成APK，签名/ZIP/版本/源码及内置依赖验证
```
