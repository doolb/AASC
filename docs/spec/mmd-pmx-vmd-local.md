# 本地 PMX 模型与 VMD 动作实现规范

## 1. 资源声明

```text
结构 MmdLocalResource
  resourceId
  modelType = "pmx"
  modelUrl = "/models/mmd/miya/miya.pmx"
  motionUrl = "/models/mmd/motions/miya-default.vmd"
  playMode = "once"
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
  按 playMode == "once" 播放一次
  VMD 播放结束后停止动作，不重新创建加载任务
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
  keyPosition = { x: 1.5, y: 3, z: 2.5 }
  shadowEnabled = true
```

```text
过程 normalizeMmdLighting(input)
  对颜色只接受 #RRGGBB，不合法时使用白色
  将环境光强度限制在 0..4
  将主光强度限制在 0..5
  将主光 x/y/z 限制在 -10..10
  shadowEnabled 只接受布尔值，缺省为 true
  返回完整的 MmdLightingSettings
```

```text
过程 setMmdLighting(settings)
  规范化 settings 并保存到显示端内存状态
  如果 PMX 或 VRM runtime 已创建
    更新当前 runtime 的 AmbientLight 和 DirectionalLight
    根据 shadowEnabled 开关 renderer 阴影贴图、主光投影、人物网格投射/接收自阴影和透明接收阴影平面
    主光目标定位到当前模型中心，并按模型包围盒动态收紧阴影相机范围
    不重新加载模型、纹理或 VMD
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
  滑块、颜色和方向改变时立即应用并保存
  选择亮度预设时应用预设并保存
  点击“恢复默认”时恢复 DEFAULT_MMD_LIGHTING
```

## 7. 安全与范围

```text
过程 handleMmdProfile(message)
  校验 message.resourceId
  通过资源注册表解析固定 URL
  禁止使用 message 中的任意 URL、文件系统路径或脚本
  只允许本地同源 /models 资源
```

本阶段不实现 APK 资源清单、Android Runtime 内置资源、外网资源上传和 WAN 发布切换。

## 8. 已实现伪代码与验证结果

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
  校验 modelType=pmx、playMode=once、相对路径和 regular file
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
    用 MMDAnimationHelper 绑定 VMD，设置 LoopOnce
  否则
    动态加载既有 display-vrm-runtime.js
  如果运行时类型改变
    先 dispose 旧运行时和 requestAnimationFrame
  失败时释放部分资源并继续保留聊天、媒体和 Canvas 占位
```

自动化验证：资源安装、MMD 服务和显示端定向测试 40/40；本轮灯光/阴影契约测试 3/3，MMD 资源、服务与 runtime 定向测试 17/17；相关 JavaScript 语法检查和 `git diff --check` 通过。完整 `npm test` 仍有本机证书信任、Windows 工具/权限和上游基线测试不匹配等既有失败，本阶段不通过绕过证书校验解决。
