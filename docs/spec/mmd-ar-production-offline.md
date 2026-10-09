# 正式 Offline 显示端 MMD AR 同步实现规范（伪代码）

## 正式刚体气动同步（2026-10-02，已发布code46）

```text
已有声明 := 测试wind数值函数、XPBD包装、Ammo受风方法；正式风模块及共享适配标记
新增契约 := 正式与测试受风算法一致，独立构建幂等复用正式新风方法
操作流程 := 已验证wind模块复制到mmd-physics-wind（不改既有参数归一化）
    已验证XPBD包装改mmd导入名同步 -> 正式Ammo仅替换风方法/风缓存/世界采样
    原始物理/模型/动画/灯光迁移保持
    独立构建检测已含新刚体气动实现 -> 保留并更新导入指纹，不重复注入
风计算 := 同测试sqrt(20*S)、球/盒/胶囊投影、气流减受力点速度
    非负阻力隐式衰减；type2使用受力点逆质量矩阵迹上界并限幅12rad/s²
验证 := 模块同源/返回受风值一致、真实正式Ammo/XPBD、独立网页回归与重复注入
状态 := 源码920030f0 -> code46已发布LAN/WAN；servicePackage=false
    dependencies6/Node-min种子39/min APK34复用；minApk=true/dependenciesPackage=false保持
结果 := 31项风/光照回归、ZIP/922文件/签名/两端全组件HTTP大小与SHA256通过；清理无错误
发布 := 提交并推送origion/master -> 签名code-only包（复用Node-min种子和依赖）
    校验ZIP/正式模块内容/签名/大小SHA256 -> LAN/WAN版本文件 -> 原子切换清单
    验证两端HTTP与SHA256 -> 按数字版本普通文件规则精确清理；保留其他APK状态
```

## 用户功能补齐（2026-10-02，已发布，待现场验收）

```text
已有声明:
  DisplayMmd / DisplayMmdAr / DisplayMmdMindArTracker
  PmxRuntime / PmxHelper / MMDAnimationHelper / MMDPhysics
  正式面板状态与本地偏好、摄像头能力控制、Offline 服务包收录规则

新增定义:
  ProductionPhysicsOptions { solver: ammo|xpbd, physicsFps, baseline, wind }
  ProductionTrackingOptions { filterMinCF, filterBeta, imuVisible, imuLost, calibration }
  ProductionGravityOptions { enabled, cameraBackground, deadZone, smoothingMs: 20 }
  ProductionShadowOptions { bias, normalBias, mapSize, rangeScale, fillFacingRange }
  LocalModelResources / CharacterMotion / CameraMotion
  拆分的 IMU、重力、资源、风场、物理频率、刚体 XPBD、阴影适配模块
  createDisplayMmdSettings: 恢复/补发重力、风场、基准参数
  createPmxModelResources(context): load/loadSelectedMotion/loadMotion/validateMotionResource
  createPmxArCamera(context): set/reset/suspend AR 相机与参数
  createPmxCameraMotion(context): 相机 VMD 加载、播放、进度、释放
  createPmxLighting(context): setLighting
  以上模块通过状态访问器读取同一个运行时实例，不复制可变模型/物理/相机状态

操作流程:
  读取正式状态；保留已有模型、动作、定位目标和配置键
  规范化 Ammo/XPBD 选择，默认 Ammo；旧 THREE-XPBD 偏好迁移为 XPBD
  Ammo 根据物理 Hz 子步积分并按基准缩放纠错，应用现有 PMX 六轴 K 与限制
  XPBD 使用基准整数 N(3..180) 每帧子步，每子步 1 轮；不使用物理 Hz
  XPBD 复用当前质量、弹簧、碰撞、速度投影与直接锁轴实现；锁定不沿动态链传播
  每次 helper 重建保留动作与本地资源，安全释放自己拥有的 Ammo 对象
  风场使用当前源方向、强度、阵风与两后端已有质量处理，不引入新的风倍率规则
  本地加载 PMX/纹理或 VMD 前保留旧状态；成功切换后释放旧资源，失败回滚
  普通视图可使用相机 VMD；AR 激活时只由定位相机流程控制视图
  MindAR 首次识别后建立视觉坐标与 IMU 预测状态，静止校准后才预测
  图片可见与不可见分别按对应开关应用相机旋转/平移预测；零偏/死区与丢失时限复用现实现
  将相机预测结果送入正式相机跟随层，保留第二层缓动；不修改角色和物理世界姿态
  独立重力模式把重力旋转与手动旋转叠加到角色锚点，非 SLAM
  摄像头背景只有用户启用且能力允许时申请；停用、后台、权限关闭统一释放
  阴影设置由正式状态提交，按硬件上限选贴图尺寸，拟合范围并对齐像素网格
  角色移动/缩放时更新阴影范围；背光过渡使用现有补光 shader 与可配置范围
  AO 浅凹抑制参数由正式状态输入，不依赖测试全局变量
  用户面板默认透明度 50%；诊断/预览/顶点布料/SLAM 控件与模块不载入正式页
  测试构建复用已合并功能核心，仅追加测试专有适配，避免重复注入
  正式控制脚本恢复求解器/基准/风/重力/阴影/滤波偏好，保留原灯光/相机键
  模型选择、求解器切换与物理重建时互相禁用相关控件，成功后才持久化，失败回显原值
  相机 VMD 先建立新的动画 helper，成功后替换旧绑定；运行时退出作废异步请求并释放 helper
  正式重力模式按需导入 Three 数学模块，不因重力启用加载 A-Frame/MindAR
  独立构建识别 aasc-shared 标记；复用源码时转换测试参数入口并更新导入指纹
  独立构建展开 mmd-model-runtime 的共享函数体，仅在副本模型提交点加入诊断
  独立构建单独追加顶点后端/阴影预览/物理帧计时，正式包不载入这些模块
  标记 servicePackage=true；实现完成不等同已构建发布

已完成的构建/静态检查:
  build:web:mmd-ar-test 成功；源码语法、控件唯一性、新资源引用与模块依赖核对完成
  正式求解器选项严格为 ammo/xpbd；没有顶点/骨骼/刚体/质量/阴影预览/SLAM 控件
  初始迁移检查之后 -> 31项风/光照及浏览器回归 -> code46已发布LAN/WAN
  当前servicePackage=false；全功能真机验收仍未执行

待现场验收(未执行):
  普通显示/聊天启动、模型和动作切换、失败回滚、配置恢复及换后端
  相机 VMD 与 AR 互斥、可见/不可见 IMU、重力加手动旋转、权限关闭/后台释放
  Ammo/XPBD、锁轴与自由末端、风场、帧率变化及手机耗时
  阴影贴图尺寸/范围/网格/随模型变化、补光背光过渡、AO 浅凹
  正式页无诊断/顶点布料/SLAM 加载，独立测试页构建保留原有专属功能
```

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

## 正式渲染同步（2026-10-09）
```text
已有声明: PMX runtime、AO合成、灯光面板、独立构建注入、签名Offline code-only发布
新增定义: 正式RenderSettings、ScreenLightingSettings、TAA历史、屏幕光照/HZB/滤波资源
操作流程:
  正式显示页加载本地mmd-render-settings和mmd-screen-lighting-panel模块
  用aasc.display.mmd专用键规范化并保存设置，旧正式灯光参数继续使用
  Canvas倍率0.25至2，乘以原DPR并按GPU纹理/渲染缓冲上限限制；设置变更触发舞台resize
  resize保留当前预览相机位置和目标，只调整投影及实际Canvas大小
  TAA默认关闭，历史权重0.9，抖动强度1，周期8，可选4/8/16/32
  启用TAA时每帧一次空间渲染，pingpong历史按深度重投影拒绝无效样本
  模型/动作切换、动作开关、尺寸/配置/相机突变时清历史；离屏输出绕过TAA
  AO合成同时接入接触阴影和SSGI，分别默认关闭；保留已有接触bias/normalBias对齐修正
  接触阴影4至64步独立于SSGI质量，两个效果各0至3轮保边滤波/逐轮1至5像素半径
  透明颜色先还原直色再色调映射，最后预乘，TAA呈现与空间合成语义一致
  WebGL2不可用时关闭对应入口并直接渲染；销毁实例释放所有历史及滤波目标
  独立构建识别共享渲染标记，仅映射测试命名空间与内容指纹，跳过重复注入/控件
  验证正式面板保存/恢复/复位、真实GPU合成、独立构建及语音控件不丢失
  提交推送origion，构建code48，复用已发布依赖/种子/min，签名校验后发布LAN/WAN
```

## code48发布状态（2026-10-09）
```text
发布输入: ed5469f3源码快照931文件，签名code48清单
发布结果: LAN/WAN code48 + dependencies6 + apkMin34 + nodeMinSeeds39 + dataRepair2
校验结果: ZIP逐文件一致、RSA签名、两端全组件HTTP大小和SHA-256一致、精确清理无错误
待出包状态: servicePackage=false，minApk沿用true，dependenciesPackage=false
后续验收: 手机视觉/硬件GPU耗时及真实物理组合；不以软件GPU结果代替
```

## FSR2正式同步（2026-10-09，已实现）
```text
已有声明: 正式抗锯齿总开关、TAA历史与空间合成、独立构建共享标记
新增定义: aaMode、fsr2Scale、输入尺寸、输出尺寸、前景覆盖率、升采样活动状态
操作流程:
  规范化正式设置，旧值缺少模式时使用taa，内部比例默认0.67并夹取0.5至1
  正式灯光面板增加TAA/FSR2选择与内部比例，总开关仍默认关闭
  FSR2输入尺寸取输出尺寸乘内部比例并向下取整，至少1像素
  当前颜色/深度、AO及屏幕光照使用输入尺寸；历史颜色/深度和Canvas保持输出尺寸
  按输入像素施加抖动，每帧空间绘制一次，模式或比例变化释放目标并清历史
  重建保留前景与背景的空间覆盖权重，只在前景内部规范化深度相似权重
  输入比例1时保持像素中心，呈现时用边缘切线滤波改善斜边并保持平坦颜色
  离屏、法线诊断或显式旁路恢复全尺寸；异常后恢复相机矩阵、目标和活动状态
  独立构建仅转换共享正式内部尺寸逻辑和内容指纹，避免重复注入
  自测正式保存/刷新/复位、输入输出尺寸、TAA互斥切换和旁路恢复
  对正式Shader运行96组解析轮廓GPU参考，验证面积、覆盖重心和透明色
  提交origion；构建更高版本code-only包，复用已发布其他组件并校验发布LAN/WAN
```

同步验证：参数/历史/面板/语音37项、正式集成2项、正式真实Shader3项（96组轮廓参考）通过，无跳过；独立构建及共享注入唯一性/静态模块引用通过。正式模式与旁路尺寸、存储复位和释放已验证。独立真实模型/导出回归与签名服务包发布继续执行。
