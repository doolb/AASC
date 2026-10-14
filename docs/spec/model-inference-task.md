# 模型推理任务实现规格

## 任务依赖按需准备（2026-10-14，源码已实现，待发布）

```text
已有声明:
  model.inference 目标是 display
  任务管理器先执行内置任务，再派发 task:execute
  显示页从负责派发任务的 Node 服务加载 ORT 资源
  Offline 基础依赖保持 common、android、linux64、win64 四组

新增定义:
  任务声明 dependencies = [onnxruntime-web]
  根 package 将 onnxruntime-web 声明为 optionalDependencies
  签名 components.taskDependencies 记录包名、真实版本、ZIP版本、大小、SHA与内容指纹
  ZIP 路径 = dependencies/task-onnxruntime-web/dependencies-v数字.zip
  独立缓存 = projectRoot/updates/task-dependencies/包名/版本与SHA目录
  服务只为任务声明的已注册依赖提供准备能力

生成依赖:
  三个平台生产树仍按同一锁文件生成
  可选 ORT 包文件从所有基础组剔除
  要求 ORT 文件在三个目标中跨平台且内容一致
  把 ORT 包文件写入独立 node_modules/onnxruntime-web
  元数据写入 dependency-group.json
  内容与真实包版本不变则复用已校验的独立包版本
  签名清单附加 taskDependencies，不增加基础组名称
  完整Offline APK暂存服务资产时，也剔除已声明可选的ORT目录
  all 发布上传并校验独立依赖；清理只匹配该目录的 dependencies-v数字.zip

准备任务:
  从任务定义读取 dependencies，不采用客户端传入的下载地址
  本机 npm 安装包版本与代码锁一致时直接复用
  已验证持久缓存与代码锁版本一致时复用，不联网
  缺失则按现有 LAN/WAN 更新源读取并验证签名清单
  同一 AASC_OFFLINE_UPDATE_BASE_URLS 环境变量可覆盖镜像列表，不增加配置接口
  查找依赖ID，要求签名包版本与当前代码锁一致
  同一包并发请求共享准备过程，进度回传任务日志与 task:progress
  下载到唯一暂存目录，核对大小与SHA
  安全解压，只允许目标包路径与组元数据，拒绝链接与路径越界
  核对元数据、实际包版本、内容指纹，原子保存缓存
  缓存独立于活动基础依赖树，不修改基础组的内容指纹
  停止任务后准备结果不再触发该实例的执行
  失败则通过任务结果报告错误，后续任务允许重试
  清空失败依赖的就绪指针；只清理本次唯一暂存目录

执行显示端:
  普通页面打开不加载 ORT
  model.inference 准备完成后转发到显示端
  显示页在模型加载前检查 WebGPU，再异步加载 ort.webgpu.min.js
  同页并发加载共享一个Promise，加载失败清除Promise以允许重试
  显式设定 WASM 同源资源前缀，再加载模型执行推理
```

## 验收场景

任务声明透传、首次任务下载、缓存重启离线复用、并发去重、失败重试、停止后不执行；签名/大小/SHA/版本/元数据/内容篡改及危险ZIP拒绝；四组清单保持兼容；真实common中排除ORT，页面首次打开不请求ORT。

定向106项及真实Chromium1项通过；正式新common/任务ZIP未出包，生产归档大小与Android真实模型推理待发布验收。
