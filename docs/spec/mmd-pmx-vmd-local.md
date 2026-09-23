# 本地 PMX 模型与 VMD 动作实现规范

## PMX 物理单位缩放容差

```text
MMDPhysics.update(delta):
  世界矩阵分解为 position、quaternion、scale
  非单位缩放 = 任一分量 abs(scale分量 - 1) > 0.001
  仅非单位缩放进入既有临时脱离父节点的尺度处理
  容差内保持父节点与中心枢轴世界变换，继续正常刚体更新、模拟和骨骼回写
  不重置刚体，不清零或改写线速度与角速度
```

内置 Three.js r160 `MMDPhysics.js` 保留此本地补丁；升级 vendor 时需要重验。回归直接加载内置源码，覆盖 180 帧 yaw/pitch/组合缓动及容差内外的缩放分支。

## 1. 资源声明

```text
结构 MmdLocalResource
  resourceId
  modelType = "pmx"
  modelUrl = "/models/mmd/miya/miya.pmx"
  motionUrl = "/models/mmd/motions/miya-default.vmd"
  playMode = "loop"
  version
```

```text
声明 AllowedMmdResources
  只包含已登记的 resourceId
  resourceId 不允许包含 URL、路径分隔符或路径穿越片段
```

## 2. 默认资源解析

```text
过程 resolveLocalMmdResource(resourceId)
  从 AllowedMmdResources 查找 resourceId
  如果找不到
    返回资源不存在错误
  返回固定的 modelUrl、motionUrl、modelType 和 playMode
```

## 3. PMX 加载

```text
过程 loadPmxResource(resource)
  检查 resource.modelType == "pmx"
  为本次模型加载创建独立 LoadingManager 和 MMDLoader
  用 MMDLoader 加载 resource.modelUrl 到 stagedModel
  让 loader 按 PMX 所在目录解析 tex/ 和 toon/ 相对纹理
  等待 LoadingManager 完成 PMX 引用的全部纹理请求
  遍历 stagedModel 的所有网格材质，将 MMDLoader 由 PMX 环境色映射出的 emissive 设为黑色
  保留 diffuse、贴图、透明度、toon 阶调与现有场景灯光，不修改 Three.js vendor 文件
  不把 stagedModel 加入 MMD 场景
  如果 resource.motionUrl 存在
    用 stagedModel 解析 VMD 并创建 stagedHelper
    等待动作资源完成
  全部资源准备成功后
    停止并释放旧动作和旧模型
    将 stagedModel 一次性加入 MMD 场景
    提交 stagedHelper 为当前动作
  计算模型包围盒并应用舞台缩放、居中和朝向
  如果模型或纹理加载失败
    释放 stagedModel 和 stagedHelper
    如果没有可用旧模型
      显示占位角色
    否则
      保留旧模型，避免加载失败时闪烁或穿帮
    保持聊天和媒体可用
```

## 4. VMD 播放

```text
过程 playDefaultVmd(resource, model)
  检查 resource.motionUrl 是已登记的同源动作资源
  为动作加载创建独立 LoadingManager
  用 MMDLoader.loadAnimation 读取 VMD
  将动作绑定到当前 PMX 模型并构造 nextHelper
  动作准备成功后再替换当前 helper
  如果 playMode == "loop"
    设置 AnimationAction 为 LoopRepeat，重复次数为 Infinity
  否则
    设置 AnimationAction 为 LoopOnce，并保持最后一帧姿势
  VMD 播放结束后不得回退到模型绑定的 T-pose
  如果动作加载失败
    保留模型静止显示
    记录可观察错误
```

## 5. 帧更新与释放

```text
过程 renderMmdFrame(delta)
  如果 MMD 可见且 helper 存在
    helper.update(delta)
  渲染场景
```

```text
过程 disposeMmdRuntime()
  停止 requestAnimationFrame
  清除 helper 中的动作和物理状态
  深度释放模型几何、材质和纹理
  清理当前模型与动作引用
```

## 6. 本地显示端灯光设置

```text
结构 MmdLightingSettings
  ambientColor = "#ffffff"
  ambientIntensity = 1.8
  keyColor = "#ffffff"
  keyIntensity = 2.3
  keyDirection = { longitude: 31, latitude: 46 }
  keyDistance = 4.183
  shadowEnabled = true
  physicsFps = 65
  pmxAoEnabled = true
  pmxAoColor = "#931231"
  pmxAoIntensity = 0.6
  pmxAoRadiusPercent = 6
  pmxAoResolution = "half"
```

```text
过程 normalizeMmdLighting(input)
  对颜色只接受 #RRGGBB，不合法时使用白色
  将环境光强度限制在 0..4
  将主光强度限制在 0..5
  将主光 longitude 限制在 -180..180 度
  将主光 latitude 限制在 -90..90 度
  将 keyDistance 固定为运行时光源距离，不接受界面输入
  shadowEnabled 只接受布尔值，缺省为 true
  physicsFps 限制在 30..90 并按 5 Hz 对齐，缺省为 65
  pmxAoEnabled 只接受布尔值，旧设置缺失时为 true
  pmxAoColor 只接受 #RRGGBB，缺省为 #931231
  pmxAoIntensity 限制在 0..2，缺省为 0.6
  pmxAoRadiusPercent 限制在 1..20，缺省为 6
  pmxAoResolution 仅接受 half/full，旧设置缺失或非法时为 half
  对已保存且合法的 AO 参数保留原值，不强制迁移为新默认值
  返回完整的 MmdLightingSettings
```

```text
过程 setMmdLighting(settings)
  规范化 settings 并保存到显示端内存状态
  如果 PMX 或 VRM runtime 已创建
    更新当前 runtime 的 AmbientLight 和 DirectionalLight
    根据 shadowEnabled 开关 renderer 阴影贴图、主光投影、人物网格投射/接收自阴影和透明接收阴影平面
    将 keyDirection 的经度/纬度转换为固定距离的 Three.js 光源坐标
    主光目标定位到当前模型中心，并按模型包围盒动态收紧阴影相机范围
    如果当前为 PMX，将现有 physics.unitStep 更新为 1 / physicsFps
    如果当前为 PMX，按 pmxAoEnabled 切换环境遮蔽渲染路径
    如果当前为 PMX，将 AO 颜色、强度和相对模型身高的半径即时传给渲染器
    如果当前为 PMX，将 AO 分辨率模式即时传给渲染器，模式变化时重建 AO 与模糊目标尺寸
    不重新加载模型、纹理或 VMD
  将规范化设置返回给面板，由面板保存至当前显示端浏览器 localStorage
```

```text
过程 initializeMmdLightingPanel()
  面板新增“PMX 环境遮蔽”开关，默认开启，并保存到现有灯光设置
  面板在开关下提供颜色、强度和半径输入；改变时即时保存和渲染
  面板在 AO 参数中提供半分辨率/全分辨率选择；默认半分辨率，沿用灯光 localStorage 保存
  面板新增“PMX 物理计算频率”滑块，范围 30..90 Hz、步长 5 Hz、默认 65 Hz
  将滑块值加入既有 MmdLightingSettings 保存和恢复流程
  调整设置后立即调用 DisplayMmd.setLighting()，更新当前 PMX 物理 fixed step
  选择灯光预设时保留当前 physicsFps；点击恢复默认时恢复 65 Hz
  提示该值是物理目标步进频率，实际步数受渲染帧率及 maxStepNum=3 限制
  VRM runtime 忽略 physicsFps
  VRM runtime 忽略 pmxAoEnabled
```

```text
过程 fitMmdShadowCamera(modelRoot)
  计算模型世界包围盒和包围球半径
  将主光 target 定位到包围盒中心，并把阴影相机左右/上下范围设置为半径乘安全边距
  根据主光到模型中心的距离计算 near/far
  更新阴影相机投影矩阵并标记阴影贴图需要更新
  使用 1024x1024 阴影贴图，避免固定大范围导致人物自阴影分辨率不足
```

```text
过程 initializeMmdLightingPanel()
  从显示端浏览器 localStorage 读取上一组规范化灯光
  没有可用值时使用默认灯光
  将表单值同步到 DisplayMmd.setLighting()
  右上角时间区域下方的“灯光”按钮切换详细设置面板
  阴影开关默认打开并随灯光设置保存
  滑块、颜色和经纬度改变时立即应用并保存
  选择亮度预设时应用预设并保存
  点击“恢复默认”时恢复 DEFAULT_MMD_LIGHTING
```

## 7. 安全与范围

```text
过程 handleMmdProfile(message)
  校验 message.resourceId
  通过资源注册表解析固定 URL
  禁止使用 message 中的任意 URL、文件系统路径或脚本
  只允许本地同源 /models/mmd/ 资源或固定 /api/mmd/static/mmd/ 资源
```

```text
过程 publishMmdStaticMirror(manifest, releaseRoot, version = "miya-v1")
  只读取已校验的 res/models/mmd/manifest.json 和其中声明的普通文件
  将 manifest.json 与 mmd/ 目录上传至 releaseRoot 下的唯一隐藏暂存目录
  对每个上传文件复核大小和 SHA-256
  只有全部通过且目标 version 目录不存在时
    在同一文件系统将暂存目录原子改名为 version
  将目录和文件权限分别设为 0755 与 0644
  通过公网 HTTP HEAD 验证所有文件状态为 200、Content-Length 与清单一致
  完整下载 manifest、PMX 和 VMD 后复算 SHA-256
  失败时不创建默认资源切换，不覆盖既有版本目录
```

当前镜像版本为 `miya-v1`，公网根为 `http://120.79.245.103/mnt/mmd/miya-v1/`。本阶段不实现 APK 资源清单、Android Runtime 内置资源或显示端远端配置；桌面运行时继续优先解析本地同源 `/models/mmd/...`，而 Offline 缺失本地清单时按下一节使用固定公网同源代理。

## 8. Offline 静态 MMD profile 与代理

```text
常量 StaticMmdRelease
  host = "c.aasc.us"
  publicRoot = "/mnt/mmd/miya-v1/"
  resourceId = "miya-default"
  motionResourceId = "miya-default-motion"
  version = 本次 miya manifest 的固定版本
  files = 本次 manifest 声明的 14 个 { path, size, sha256 }
```

```text
过程 resolveMmdProfile(modelRoot)
  尝试读取并校验 modelRoot/mmd/manifest.json
  本地清单有效时
    返回本地 /models/mmd/... profile
  本地清单不存在时
    返回 StaticMmdRelease 的同源 profile
    modelUrl = "/api/mmd/static/mmd/miya/miya.pmx"
    motionUrl = "/api/mmd/static/mmd/motions/miya-default.vmd"
  本地清单存在但无效时
    返回 503，不回退到公网
```

```text
过程 GET /api/mmd/static/<relativePath>
  将 URL 路径解码为 POSIX 相对路径
  拒绝空路径、查询指定路径、反斜杠、绝对路径、.、..、重复编码和未声明路径
  在 StaticMmdRelease.files 中查找完全匹配的文件
  不存在时返回 404
  将 c.aasc.us 解析为 IPv4，并仅请求 /mnt/mmd/miya-v1/<relativePath>
  上游必须返回 200，Content-Length 必须等于声明 size，且下载不得超过声明 size
  对完整受限缓冲区计算 SHA-256，必须等于声明 sha256
  成功时按声明扩展名返回 PMX/VMD 二进制或 image/png
  任一 DNS、网络、超时、状态、长度或 hash 失败时返回结构化 502
  不写入磁盘、不建立持久缓存、不允许重定向
```

```text
过程 validateBrowserMmdProfile(profile)
  接受 /models/mmd/... 本地路径
  或接受 /api/mmd/static/mmd/... 固定同源路径
  PMX 和 VMD 仍分别要求 .pmx 与 .vmd 后缀
  拒绝 http(s)、//、查询 URL、其他 API 前缀和路径穿越
```

```text
过程 packageOfflineMmdCode
  服务代码更新包包含新的 MMD profile 与代理源码
  APK Runtime 不复制 res/models/mmd
  不修改 allserver/app.json、allserver-min/app.json、Android assets 或原生代码
  本任务不执行 build:apk:offline、build:apk:offline:min 或发布命令
```

## 9. 已实现伪代码与验证结果

```text
过程 installMmdAssets(modelZip, motionZip, outputRoot)
  读取 ZIP 条目
  拒绝绝对路径、..、未知目录条目和非普通文件
  跳过模型 ZIP 中 spa/、tex/、toon/ 的普通目录元数据条目
  查找唯一 .pmx 和唯一 .vmd
  校验 PMX 头部为 PMX + 版本 2.0
  校验 VMD 头部为 Vocaloid Motion Data 0002
  将 PMX 重命名为 mmd/miya/miya.pmx
  将 tex/ 和 toon/ 下的文件保留在 mmd/miya/ 相对目录
  将 VMD 重命名为 mmd/motions/miya-default.vmd
  计算每个声明文件的 SHA-256 和大小
  原子替换任务专属的 miya/、motions/ 和 manifest.json
  返回 schemaVersion=1 的资源清单
```

```text
过程 GET /api/mmd/resources()
  从 res/models/mmd/manifest.json 读取清单
  校验 modelType=pmx、playMode=loop 或 once、相对路径和 regular file
  校验声明文件大小与 SHA-256
  为每个资源构造 /models/{encoded relative path} 同源地址
  忽略请求查询参数，不接受外部 URL
  返回 { status: success, resources }
```

```text
过程 loadDisplayModel(profile)
  如果 profile.modelType == pmx
    动态加载 display-pmx-runtime.js
    用 MMDLoader 加载 PMX 和相对纹理
    用 MMDAnimationHelper 绑定 VMD；默认设置 LoopRepeat + Infinity，显式 once 时设置 LoopOnce 并保持最后一帧
  否则
    动态加载既有 display-vrm-runtime.js
  如果运行时类型改变
    先 dispose 旧运行时和 requestAnimationFrame
  失败时释放部分资源并继续保留聊天、媒体和 Canvas 占位
```

自动化验证：资源安装、MMD 服务和显示端定向测试 40/40；本轮灯光/阴影契约测试 3/3，MMD 资源、服务与 runtime 定向测试 17/17；相关 JavaScript 语法检查和 `git diff --check` 通过。完整 `npm test` 仍有本机证书信任、Windows 工具/权限和上游基线测试不匹配等既有失败，本阶段不通过绕过证书校验解决。

## 10. Offline 静态代理实际实现

```text
过程 loadPreferredMmdResources(modelRoot)
  尝试 loadMmdResourceManifest(modelRoot)
  成功时为每个本地 resource 创建 /models/mmd/ profile
  捕获错误时
    如果 error.code == "MMD_MANIFEST_MISSING"
      返回唯一固定 miya-v1 static profile
    否则重新抛出错误
```

```text
过程 requestStaticMmdAsset(relativePath)
  先按固定 14 文件表校验 relativePath
  使用 c.aasc.us 的 IPv4 DNS 结果组装唯一上游 URL
  以 redirect = manual 和超时信号发起请求
  要求 status == 200 且 Content-Length == 声明 size
  受声明 size 限制读取整个响应并计算 SHA-256
  仅 hash == 声明 sha256 时返回 Buffer 和声明 MIME
  否则丢弃全部内容并返回结构化错误
```

```text
过程 validateBrowserMmdUrl(url, extension)
  允许前缀集合 = ["/models/mmd/", "/api/mmd/static/mmd/"]
  拒绝 ://、//、..、反斜杠、?、#
  仅当路径在允许前缀集合内且后缀匹配 extension 时接受
```

```text
过程 prepareAndroidNodeRuntime(packageDir)
  无论 includeOfflineModels 是否开启
    从 server Runtime 文件复制集合排除 res/models/mmd
  因此 PMX、VMD、PNG 纹理只经服务同源代理按需读取
```

## 11. PMX Ammo 物理解算

```text
常量 AmmoScriptUrl = "/js/vendor/three/libs/ammo.wasm.js"
常量 AmmoWasmUrl = "/js/vendor/three/libs/ammo.wasm.wasm"
常量 PmxPhysicsWarmupSteps = 0
状态 ammoLoadPromise = null

过程 hasMmdPhysics(mesh)
  rigidBodies = mesh.geometry.userData.MMD.rigidBodies
  返回 rigidBodies 是非空数组
```

```text
过程 ensureAmmoPhysics()
  如果 globalThis.Ammo 已是含 btVector3 的初始化模块
    返回该模块
  如果 ammoLoadPromise 存在
    返回同一个 Promise
  以 data-aasc-ammo 标记同源 script，避免重复插入 AmmoScriptUrl
  script 加载后读取 globalThis.Ammo 工厂
  使用 locateFile 始终返回 AmmoWasmUrl 调用工厂
  验证结果含 btVector3，然后写回 globalThis.Ammo
  成功后缓存并返回模块
  任何脚本或 WASM 初始化失败时
    清空 ammoLoadPromise
    让本次加载失败，以便后续模型可重新尝试
```

```text
过程 createPmxMotionHelper(mesh, clip, playMode, physicsFps = 65)
  如果 hasMmdPhysics(mesh) 为假
    用 physics=false 创建 helper
    返回 { helper, physicsEnabled=false, physicsError=null }
  尝试 await ensureAmmoPhysics()
    成功时用 physics=true 创建 helper，并传入 unitStep = 1 / physicsFps、warmup = 0
    返回 { helper, physicsEnabled=true, physicsError=null }
  捕获 Ammo 初始化或 physics helper 创建错误
    用 physics=false 重新创建 helper，保留 clip、IK、grant 与动作循环设置
    返回 { helper, physicsEnabled=false, physicsError=规范化错误 }

过程 buildMotionHelper(mesh, clip, playMode, physics)
  创建 MMDAnimationHelper(sync=false, pmxAnimation=true)
  options.physics = physics
  physics 为真时设置 options.warmup = PmxPhysicsWarmupSteps
  clip 存在时才设置 options.animation
  helper.add(mesh, options)
  动作存在时
    playMode == "once" -> LoopOnce、重复 1 次、clampWhenFinished=true
    否则 -> LoopRepeat、重复 Infinity 次
  reset 后播放动作
  返回 helper
```

```text
过程 preparePmxHelper(mesh, profile, resourceId = profile.motionResourceId)
  resourceId 和 motionUrl 同时存在时
    校验白名单并加载 VMD 为 clip
  否则 clip = null
  返回 createPmxMotionHelper(mesh, clip, profile.playMode)

过程 loadPmxResource(profile)
  加载 stagedMesh
  stagedMesh.scale 设为 (1, 1, 1)
  根据原始 bounds 只平移 stagedMesh 至水平中心和地面，不缩放
  创建 stagedPivot，并将 stagedMesh 挂到模型中心枢轴
  stagedPivot.visible = false
  将 stagedPivot 加入最终 MMD 场景并更新完整世界矩阵
  在不可见的最终场景层级内
    prepared = await preparePmxHelper(stagedMesh, profile)
  任何加载失败或过期时，从场景移除 stagedPivot 并释放 stagedMesh/helper
  提交 prepared.helper、stagedMesh 与 stagedPivot
  stagedPivot.visible = true
  根据原始 bounds 更新相机距离、near/far、方向光相对位置和阴影平面范围
  prepared.physicsError 存在时
    显示“PMX 物理不可用，已回退骨骼动画”
  否则显示模型加载成功

过程 renderMmdFrame(delta)
  更新中心枢轴的目标 yaw/pitch 缓动
  刷新 pivot、mesh 和骨骼的世界矩阵
  helper 存在时调用 helper.update(delta)
  MMDAnimationHelper 依次维持 VMD、IK/grant 与已启用的 MMDPhysics
  MMDPhysics 从旋转后的骨骼更新 type=0 运动学刚体锚点
  type=1/2 动态刚体保留 Bullet 世界坐标、姿态及线/角速度
  Bullet 约束牵引动态刚体跟随锚点，形成旋转惯性与自然摆动
  MMDPhysics 将动态刚体结果回写到当前 pivot 下的骨骼
  渲染当前场景

约束：PmxPhysicsWarmupSteps 固定为 0，因此 helper.add 只初始化/重置刚体；首个 helper.update(delta) 由模型显示后的下一次 requestAnimationFrame 触发。旋转时只由 MMDPhysics 更新运动学锚点，不再对动态刚体做整体位置传送或速度补偿，也不调用 physics.reset()、清零速度/角速度。物理目标频率和 maxStepNum=3 不变；低渲染帧率下的多子步仍须现场验证。无 physics 的 PMX 和 VRM 不受影响。
```

### 固定物理子步中的枢轴同步（备选设计，待现场试验结果，尚未实现）

当前先试验上述“先移动角色与运动学锚点、动态布料由约束牵引”的顺序；若现场仍有明显布料扰动，再重新评审以下未实施的固定子步方案。该备选方案的整批刚体传送和速度重写并非当前行为，不能未经验证直接沿用。

```text
过程 installPmxPivotStepper(helper, mesh, pivot, physicsPivotState)
  physics = helper.objects.get(mesh).physics
  如果 physics 不存在则返回空卸载句柄
  保存 physics 原始 _stepSimulation
  替换 physics._stepSimulation(delta)
    totalTime = physicsPivotState.accumulator + delta
    availableSteps = floor(totalTime / physics.unitStep)
    stepCount = min(availableSteps, physics.maxStepNum)
    physicsPivotState.accumulator = totalTime - availableSteps * physics.unitStep
    跳过超过 physics.maxStepNum 的最旧完整子步，不累计无限欠账
    对每个实际固定子步 i
      alpha = 该子步在上一个已模拟时刻与当前时刻间的归一化位置
      stepPivot = 在 physicsPivotState.previousMatrix 与当前 pivot.matrixWorld 间插值得到
      临时将 pivot 设置为 stepPivot 并递归刷新骨骼世界矩阵
      对每个动态 Bullet 刚体
        刚体位置与姿态沿相邻子步 pivot 的增量变换
        线速度 = 枢轴参考系中的相对线速度经旋转后 + 新枢轴的点速度
        角速度 = 枢轴参考系中的相对角速度经旋转后 + 新枢轴角速度
        将刚体变换和线/角速度同步到 Bullet body 与 MotionState
      依据当前插值骨骼更新 type=0 的运动学锚点
      world.stepSimulation(physics.unitStep, 0)
      保存 stepPivot 为下一固定子步的 previousMatrix
    world.stepSimulation 的 maxSubSteps=0 表示单步调用，timeStep 必须恒定为 physics.unitStep
    恢复渲染帧最终 pivot 并更新骨骼世界矩阵
  安装成功时返回卸载句柄，用于 helper/模型替换时恢复原始 _stepSimulation

过程 renderPmxFrame(delta)
  先更新角色中心枢轴的 yaw/pitch 缓动
  helper.update(delta)
    MMDAnimationHelper 更新 VMD、IK/grant 与 MMDPhysics
    MMDPhysics 调用实例专属 _stepSimulation
      每个 Bullet 固定子步先插值并同步 pivot、动态刚体和运动学锚点，再执行 Bullet 单步
    MMDPhysics 按最终场景姿态回写动态骨骼
  渲染场景
```

设计约束：不修改 Three.js vendor 文件；只为启用 Ammo 的 PMX helper 安装实例级步进包装。继续使用灯光面板的 `physicsFps`（`unitStep = 1 / physicsFps`）、`maxStepNum = 3` 和 `warmup = 0`；不清零或丢弃布料自身的相对线速度/角速度，不更改重力、风、刚体、关节及阻尼。无 physics 的 PMX 与 VRM SpringBone 不变。若实例私有 `_stepSimulation` 无法在当前 Ammo 绑定上安全进行单固定步调用，应停止实现并重新评审，不回退到逐渲染帧整体传送。

当前 Ammo WASM 绑定未向 JavaScript 暴露可用的函数指针注册 API，故不使用 Bullet 内部 tick callback。单步拆分时 Bullet 会在每次 stepSimulation 调用后清除累计力；当前显示端 PMX 路径没有显式 applyForce/applyTorque 调用，重力由 Bullet 每步统一施加。后续如引入外部力/风力，须另行增加跨子步保持规则。

```text
过程 applyMmdPhysicsFrequency(settings, runtime)
  physicsFps = 将 settings.physicsFps 限制在 30..90 并按 5 Hz 对齐
  如果 runtime 是 PMX 且当前 helper.physics 存在
    helper.physics.unitStep = 1 / physicsFps
  新建 PMX helper 时也传入 unitStep = 1 / physicsFps
  physics.maxStepNum 保持默认 3
  VRM 和没有 PMX physics 的 helper 不执行物理步长更新
```

自动化验证：当前锚点牵引试验的 PMX/显示端相关测试 63/63 通过，包含 yaw/pitch 内置 Ammo 约束用例；相关 JavaScript 语法与 `git diff --check` 通过。完整 `npm test` 在本机 Windows 环境为 900/955 通过、55 失败，失败用例不在本次 PMX 相关测试中，涉及证书、符号链接权限、Linux 固定路径和 Chromium 缺失等环境问题。早期物理频率面板变更的历史验证记录见 `docs/task/20260923_PMX物理计算频率面板设置.md`；现场自测见 `docs/self-test.md` 与 `docs/task/20260923_PMX旋转锚点牵引布料试验.md`。

## 12. PMX 屏幕空间环境遮蔽

```text
过程 calculatePmxAoSize(drawingWidth, drawingHeight, resolutionMode)
  对绘制缓冲区宽高取至少 1 像素
  如果 resolutionMode == full，返回绘制缓冲区原始尺寸
  否则 AO 分辨率最多是绘制缓冲区的一半，且不超过 1280×720
  半分辨率模式按同一比例缩放宽高，返回至少 1 像素的 AO 尺寸

过程 renderPmxWithAo(scene, camera, renderer, aoResources)
  如果 AO 未开启、没有模型或 WebGL2 不可用
    直接 renderer.render(scene, camera)
    返回
  将原场景渲染到带深度纹理的透明色彩目标
  从深度纹理重建人物可见像素的视空间位置和局部表面法线
  在半分辨率 AO 目标中采样邻近深度，估计局部遮蔽
  用水平、垂直两次半分辨率深度感知模糊抑制逐像素随机采样噪点
  模糊与最终合成均按线性视空间深度过滤，避免跨前后景和透明轮廓串色
  以 pmxAoIntensity 调整遮蔽量，以 pmxAoColor 混合遮蔽色
  仅修改人物已绘制的 RGB，保留原色彩目标的 alpha
  输出到透明显示画布

过程 updatePmxAo(settings, width, height)
  根据 pmxAoEnabled 切换 AO，开关关闭时不执行额外渲染通道
  pmxAoRadiusPercent 乘以当前模型包围盒高度得到世界空间采样半径
  颜色、强度、半径修改立即更新当前 runtime，不重新加载 PMX/VMD
  resize 时按绘制缓冲区大小调整色彩、深度和 AO 目标
  pmxAoResolution 从 half 切到 full 或反向切换时，只调整 AO 与模糊目标尺寸及相应采样 uniform
  模型切换时重用 AO 渲染资源
  runtime dispose 时释放 AO 目标、临时模糊目标、材质和全屏网格
```

约束：AO 只作用于 PMX 角色显示，现有 VRM、物理步进、动作、阴影开关和透明画布层级不变。无 WebGL2 时保留原渲染路径；不因 AO 不可用阻断角色加载。AO 开关沿用本地灯光设置，不新建远端配置接口。
