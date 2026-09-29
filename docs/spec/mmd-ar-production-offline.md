# 正式 Offline 显示端 MMD AR 同步实现规范（伪代码）

## 测试页用户功能合并（2026-09-29）

```text
已有声明:
  DisplayMmdLighting.open / close / update
  DisplayMmdAr.startTracking / stopAr / closePanel
  DisplayMmd.setLighting / setMotionPlaybackEnabled / setPhysicsEnabled
  PmxRuntime.setArCameraPose / getArCameraSyncState

新增定义:
  MotionPanel { toggle, panel, playback, physics, progress, time }
  LightingGroups { base, specular, ao, key, fill, rim1, rim2 }
  TrackingGroups { target, operation, gyro, cameraFollow }
  ProductionRenderOptions { keyShadow, specular, aoBoundaryCorrection }

操作流程:
  正式显示端保留现有控件 ID 和本地配置键，将动作与物理控件移入独立动作面板
  正式显示页把 DisplayMmd 的 onLoadProgress 接到非阻塞进度卡，显示阶段和百分比，完成后延迟隐藏，错误时清除进度
  灯光面板按基础光照、高光、AO、主光、补光、边缘光分类；定位面板按目标、操作、体感、相机跟随分类
  各面板互斥，标题开合不误触标题前的开关；窄屏内容在面板内部滚动
  动作面板显示真实 VMD 时长与播放时间，只读、不跳帧；无有效动作显示未知，面板隐藏时停止轮询
  AO 使用高精度深度读取和像素对齐；半分辨率轮廓按原深度重建，默认启用边界修正
  高光、主光与补光阴影的用户配置进入正式灯光状态；不暴露法线预览、near/far 诊断、模拟摄像头
  MindAR 找到定位图后以锚点和投影矩阵同步 PMX 相机；事件漏帧或模型未就绪时继续逐帧重试
  失锁保持最后相机姿态，重锁再次同步；停用时释放视频流、识别器并恢复普通相机
  正式显示端静态代码随 Offline 服务代码包发布；不因本次改动重打原生 APK 或依赖包
```

## 输入与发布边界

```text
已有声明:
  DisplayMmdAr.startTracking / stopAr / setCameraEnabled
  DisplayMmd.setArCameraPose / setArCameraSettings / setPhysicsEnabled / setMotionPlaybackEnabled
  PmxRuntime.setArCameraPose / renderFrame
  Offline code-only 更新包收录 src 下的显示端静态资源

新增定义:
  LocalArVendor { aframeScript, mindarAframeScript, mindarCompilerModule, license, sha256 }
  ProductionArSettings { targetPlane, translationDeadZonePercent, rotationDeadZoneDegrees, smoothingMs, distancePercent }
  MindArSession { targetId, cameraStream, targetData, targetAspect, lastPose, trackingState }

操作流程:
  发布准备从固定版本来源取得 A-Frame 1.5.0 与 MindAR 1.2.5 文件
  校验大小和 SHA-256，保留许可证；所有运行时 URL 都指向本地静态目录
  不修改 package-lock，不通过 CDN 取 AR 脚本或模型文件
  正式显示页创建隐藏的 A-Frame 锚点舞台、物理/动作开关和相机跟随设置
  页面普通启动不解析 A-Frame；用户开始定位时才加载本地脚本和目标编译器
  从 IndexedDB 读取所选定位图；透视校正选区后在本机编译 MindAR 目标
  停止校准摄像头流；MindAR 独占后置摄像头流并持续输出锚点矩阵、投影矩阵
  PMX 运行时以定位图中心/底边为基准换算相机；模型根节点和布料刚体世界保持原样
  相机死区基于定位图位姿，缓动只影响已采纳的相机目标；距离沿相机到目标中心连线缩放
  失锁时冻结最后相机并保持模型，重锁继续跟随；停止时释放视频轨道和识别器并恢复普通相机
  摄像头能力关闭、页面隐藏和显示端退出时终止会话；非 AR 的 MMD/VRM 不启动定位依赖
  PMX 首次模型提交后首个渲染帧不显示模型但更新物理，第二帧推进 VMD 并显示
  物理关闭时重建无 Ammo helper；动作关闭时只暂停 VMD，不暂停物理
  定位依赖加载失败时显示明确错误并保持定位关闭；旧 JS 跟踪器作为显式回退选项
  代码变更只发布 Offline code 包；原生库、min APK 和 npm dependencies 包不因静态脚本变化而重打
  code-only 指定复用已发布 Node-min 种子，清单沿用其版本和 SHA-256；不重新收集 release/task/results
```

## 验收约束

```text
脚本加载: 断开公网，正式显示页初启与定位均不请求 CDN；脚本只在首次进入定位时加载
目标编译: 自拍图矩形/四边形目标可以保存、重新选取、重新编译；编译失败有提示
相机定位: 首锁、连续更新、失锁冻结、重锁、停止恢复、底面/立面切换均不移动 PMX 根节点
物理动作: 首帧无姿态闪现、第二帧显示；开关物理/动作互不误改；布料仍可模拟
生命周期: 摄像头关闭/页面后台/定位停止后轨道释放，恢复前不暗中占用相机
发布: 校验 code ZIP 大小、SHA-256、签名和依赖版本；LAN/WAN manifest 原子切换后分别验证
```

## 已落地的资源阶段

```text
prepare:mmd-ar-vendor:
  对每个固定资源读取 src/apps/web-mediacenter/ui/public 下的本地文件
  若存在，校验大小和 SHA-256；若缺失，从固定 URL 下载并校验后写入

build:web:mmd-ar-test:
  复制本地 A-Frame、MindAR 脚本和官方 .mind 到 web-dist
  HTML 引用 ./js/vendor/...，测试适配器从自身 URL 定位 ../assets/...

build:apk:mmd-ar-test:
  从正式显示端静态目录读取已校验 MindAR 资源，不重复下载
```

正式显示端运行时已接入并通过 code-v41 发布内外网；目标 Android 相机视觉验收仍待完成。

```text
DisplayMmdMindArTracker.load:
  读取当前 display-mmd-ar-mindar.js 的脚本 URL 作为本地 vendor 基址
  用户开始定位后才依次注入 A-Frame 与 MindAR A-Frame；失败时清除待加载状态

DisplayMmdMindArTracker.start(target):
  校验 IndexedDB 目标照片和四角选区
  限宽加载照片，按四点单应矩阵透视校正到最大 512 像素的目标画布
  动态导入本地 MindAR Compiler，附进度回调，导出内存中的目标数据
  创建 A-Frame 场景、相机及目标锚点，独占摄像头流启动识别
  锚点更新时输出 anchorMatrix/projectionMatrix/targetAspect 到 DisplayMmd.setArCameraPose
  丢失目标时 suspendArCameraPose，保持最后视角；停止时释放视频轨道、识别器和临时 URL

DisplayMmdAr.startTracking:
  默认选择 MindAR，按需 load 后停止校准流，由 MindAR 建立跟踪会话
  若选择 legacy，复用旧 DisplayMmdImageTargetTracker 和屏幕锚点映射
  在切换算法、摄像头关闭、页面隐藏时统一停止当前会话

DisplayMmdAr.initializeCameraControls:
  从本地持久化读取底面/立面、平移/旋转死区、缓动和距离
  规范化范围并通过 DisplayMmd.setArCameraSettings 提交给 PMX runtime
  动作开关仅切换 VMD 播放，物理开关通过重新加载 PMX helper 生效
```
