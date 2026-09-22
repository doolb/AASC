# MMD 图片基准图 AR 实现规范（伪代码）

## 1. 模块边界

```text
MmdImageArController
  ├── CameraSession          摄像头流和视频层
  ├── CalibrationOverlay     拍照、四角选区和校准交互
  ├── ImageTargetTracker     本地图像目标识别适配器
  ├── ArTargetStore          IndexedDB 目标存储
  ├── ArPoseSmoother          姿态平滑和丢失保持
  └── MmdArPoseAdapter        VRM/PMX 运行时姿态映射
```

首期 `MmdImageArController` 只在 `display.html` 中运行，不向服务器上传图像，也不新增 WebSocket 协议。

## 1.1 显示端入口伪代码

```text
显示端右上角 displayInteractionLayer:
  保留按钮 displayMmdLightingToggle = "灯光"
  在灯光按钮正下方新增 displayArTargetToggle = "定位"

过程 onArTargetToggle()
  打开 ArTargetPanel
  展示已保存目标、当前目标状态和“拍照校准”入口
  如果 tracking 状态为 true:
    展示“切换定位图”和“停止定位”操作

过程 updateArEntryLabel(runtimeState)
  如果 runtimeState.status == "tracking":
    displayArTargetToggle.text = "定位中"
  否则如果 runtimeState.status == "lost":
    displayArTargetToggle.text = "重新定位"
  否则:
    displayArTargetToggle.text = "定位"
```

入口只负责打开面板和显示状态；AI/聊天继续复用现有聊天入口。目标保存、摄像头生命周期、目标切换和 MMD 姿态更新仍由 `MmdImageArController` 管理。

## 1.2 第一阶段页面实现边界

```text
display.html:
  在右上角现有灯光按钮下方放置 displayArTargetToggle = "定位"
  创建隐藏的 displayArTargetPanel
  加载 display-mmd-ar.js

display-mmd-ar.js:
  实现 ArTargetStore 的 IndexedDB 保存、读取、删除和当前目标选择
  实现 CameraSession 的后置摄像头启动、拍照和释放
  实现 CalibrationOverlay 的默认四角、拖动校准、透视裁剪前的质量校验
  实现定位图列表、拍照校准、重新选择和运行中切换入口
  通过 ImageTargetTracker 契约预留识别实现

当前第一阶段实现:
  可以完成目标图片和四角选区的本地保存与管理
  未接入具体图像目标识别库时，状态显示为“识别引擎未就绪”
  不上传摄像头帧，不新增服务端接口和 WebSocket 消息

实际文件:
  `display.html` 提供右上角入口和面板 DOM
  `css/display-mmd.css` 提供入口纵向布局和面板样式
  `js/display-mmd-ar.js` 提供本地目标、摄像头和四角选区控制器
  `js/display-mmd.js` 转发虚拟相机视角
  `js/display-pmx-runtime.js` 和 `js/display-vrm-runtime.js` 实现相机环绕与缓动

## 1.3 六轴体感观察与角色旋转边界

```text
声明 ArMotionView {
  enabled,
  sensitivity,
  center: { alpha, beta, gamma },
  viewRotation: { yaw, pitch },
  permission: "unknown" | "granted" | "denied" | "unsupported"
}

过程 enableArMotionView()
  在用户点击事件中申请 DeviceOrientationEvent 权限（如果平台要求）
  记录当前 alpha/beta/gamma 作为体感中心
  将 enabled 设为 true

过程 onDeviceOrientation(sample)
  计算当前姿态相对 center 的 yaw/pitch
  乘以 sensitivity 并限制最大俯仰角
  调用 DisplayMmd.setCameraViewRotation(yaw, pitch)
  不调用 DisplayMmd 的 rotateModelBy

过程 recenterArMotionView()
  用最近一次有效传感器姿态替换 center
  将相机观察偏移恢复为零

过程 disableArMotionView()
  移除传感器监听
  调用 DisplayMmd.resetCameraViewRotation()
  角色继续保留屏幕拖动旋转结果
```

六轴数据只改变虚拟相机观察角度，不改变角色自身旋转、定位图锚点、位置或尺度。屏幕拖动继续调用现有 `rotateModelBy`，因此 AR 体感和手动角色旋转互不覆盖。
```

页面实现不得把摄像头帧写入日志、WebSocket 或 HTTP 请求；停止定位、页面隐藏和权限失败必须释放视频轨道。

## 2. 数据声明

```text
声明 ArTarget {
  targetId,
  name,
  referenceImageBlob,
  selectedQuad: [{x, y}, {x, y}, {x, y}, {x, y}],
  compiledTargetData,
  physicalWidthMm?,
  createdAt,
  updatedAt
}

声明 ArModelCalibration {
  anchor: "feet" | "center" | "custom",
  offset: {x, y, z},
  rotation: {x, y, z},
  scale,
  mirror
}

声明 ArPose {
  visible,
  confidence,
  position: {x, y, z},
  quaternion: {x, y, z, w},
  scale,
  timestamp
}

声明 ArRuntimeState {
  status: "idle" | "requestingCamera" | "calibrationCapture"
    | "selectingRegion" | "compilingTarget" | "ready"
    | "tracking" | "lost" | "stopped",
  targetId,
  error,
  confidence,
  cameraFacingMode
}
```

## 3. IndexedDB 存储

```text
过程 openArTargetStore()
  打开 IndexedDB 数据库 "aasc-mmd-ar"
  创建版本表 "targets"
  为 targetId 建立唯一索引
  返回数据库连接

过程 saveArTarget(target)
  校验 targetId、referenceImageBlob、selectedQuad 和 compiledTargetData
  以 targetId 原子写入 targets
  返回保存后的 target

过程 loadArTarget(targetId)
  从 targets 读取 targetId
  如果不存在返回 null
  校验 compiledTargetData 版本
  返回目标或提示需要重新校准

过程 deleteArTarget(targetId)
  删除目标图片、特征索引和模型校准参数

过程 listArTargets()
  读取 targets 对象仓库
  按 updatedAt 倒序返回目标摘要

过程 replaceArTarget(targetId, nextTarget)
  先完成 nextTarget 的图片和选区校验
  校验通过后原子替换目标记录
  校验失败时保留旧目标
```

## 4. 摄像头会话

```text
过程 startCamera(facingMode)
  如果 cameraStream 已存在，先停止旧轨道
  请求 navigator.mediaDevices.getUserMedia({
    video: { facingMode, width: 1280, height: 720 },
    audio: false
  })
  将 stream 绑定到 arCameraVideo
  等待 video.loadedmetadata 和 video.play()
  将状态设为 calibrationCapture 或 ready

过程 stopCamera()
  停止 cameraStream 的所有 video tracks
  清空 arCameraVideo.srcObject
  取消帧检测定时器或 requestVideoFrameCallback
  将状态设为 stopped
```

## 5. 拍照和四边形选区

```text
过程 captureCalibrationImage()
  从 arCameraVideo 读取当前视频帧
  写入临时 calibrationCanvas
  创建四个默认角点覆盖层
  将状态设为 selectingRegion

过程 updateSelectedQuad(points)
  要求 points 恰好包含四个点
  限制点坐标在照片边界内
  拒绝自交四边形和面积低于最小阈值的选区
  更新 CalibrationOverlay

过程 compileSelectedTarget()
  将 selectedQuad 对应区域做透视校正
  检查纹理、角点数量、清晰度和最小尺寸
  调用 ImageTargetTracker.compile(referenceImage)
  如果质量不足，状态回到 selectingRegion 并显示原因
  否则保存 referenceImageBlob、selectedQuad 和 compiledTargetData
  将状态设为 ready
```

## 6. 图像目标跟踪适配器

```text
接口 ImageTargetTracker
  compile(referenceImage) -> compiledTargetData
  start(compiledTargetData, cameraInfo) -> trackerSession
  processFrame(videoFrame, timestamp) -> {
    visible,
    confidence,
    targetCorners,
    cameraPose?
  }
  stop()
  dispose()

过程 trackFrame(timestamp)
  如果状态不是 ready、tracking 或 lost，跳过本帧
  从 arCameraVideo 读取当前帧
  调用 trackerSession.processFrame(frame, timestamp)
  如果 result.visible:
    计算目标平面姿态
    将姿态交给 ArPoseSmoother
    将状态设为 tracking
  否则:
    将状态设为 lost
    在丢失保持时间内继续使用最后平滑姿态
    超过保持时间后停止新的模型姿态更新
  按检测帧率安排下一次 trackFrame
```

识别库通过适配器隔离，首期可以使用本地 WebAssembly 图像目标识别实现；识别库升级不能改变 `ImageTargetTracker` 契约。

## 7. 姿态平滑和模型映射

```text
过程 smoothPose(previousPose, nextPose, delta)
  对 position 使用带时间常数的线性插值
  对 quaternion 使用球面插值
  对 scale 使用限制范围的线性插值
  限制单帧最大位移、旋转和缩放变化
  返回平滑后的 ArPose

过程 applyArPose(pose, modelCalibration)
  如果 pose.visible 为 false，暂停新的姿态写入
  将目标平面坐标转换为 Three.js 世界坐标
  加入 modelCalibration.offset、rotation 和 scale
  根据 anchor 将角色脚底或中心放到目标平面
  调用 DisplayMmd.setArPose(pose)

DisplayMmd.setArPose(pose):
  将 pose 交给当前 VRM 或 PMX runtime
  runtime 更新模型矩阵或相机矩阵
  保留 VRM SpringBone、PMX 刚体和动作帧更新
```

## 8. 显示端生命周期

```text
过程 startAr(targetId)
  读取 ArTargetStore 中的 targetId
  如果目标不存在，显示“请先拍照校准”
  启动摄像头
  启动 ImageTargetTracker
  启动姿态平滑器
  将状态设为 ready

过程 stopAr()
  停止 trackerSession
  清除 DisplayMmd 的 AR 外部姿态
  停止摄像头
  隐藏 arCameraLayer
  恢复普通 MMD Canvas 显示策略
  将状态设为 stopped

页面 pagehide 或 beforeunload:
  调用 stopAr()
  不删除 IndexedDB 目标
```

## 9. 与 MMD 显示开关的关系

```text
过程 onMmdVisibilityChanged(visible)
  如果 visible 为 false:
    隐藏 MMD Canvas 和 AR 角色
    降低或暂停 trackerSession 的检测频率
  如果 visible 为 true 且 AR 已启动:
    恢复 trackerSession
    恢复 MMD 渲染和 SpringBone/PMX 动作更新
```

首期不新增服务端消息；显示端 MMD 状态仍由现有 `mmdVisibility` 同步机制维护。

## 10. 错误处理

```text
摄像头权限拒绝:
  状态 = stopped
  显示摄像头权限说明
  保持普通 MMD、媒体、聊天和 WebSocket 正常

选区质量不足:
  状态 = selectingRegion
  显示需要更多纹理、提高光线或扩大选区的提示

目标编译失败:
  删除临时 compiledTargetData
  保留原有目标
  允许用户重新选择区域

实时跟踪失败:
  状态 = lost
  保留最后姿态一段时间
  超时后冻结或隐藏角色，但不销毁模型

IndexedDB 失败:
  允许当前页面临时使用目标
  显示刷新后需要重新校准
```

## 11. 测试伪代码

```text
测试 captureCalibrationImage
  模拟摄像头 video 帧
  触发拍照
  断言生成四个默认角点

测试 updateSelectedQuad
  输入合法四边形
  断言四角坐标归一化并限制在边界
  输入自交或低面积四边形
  断言返回质量错误

测试 targetPersistence
  保存 ArTarget
  刷新模块并读取 targetId
  断言图片、四角、compiledTargetData 和校准参数一致

测试 trackingLifecycle
  模拟 visible=true 的目标帧
  断言状态变为 tracking 并调用 DisplayMmd.setArPose
  模拟短暂丢失
  断言保留最后姿态
  模拟超时丢失
  断言停止姿态更新但模型未崩溃

测试 privacyBoundary
  启动和运行跟踪
  断言没有发送 camera frame、referenceImageBlob 或 compiledTargetData 的 HTTP/WS 消息
```

## 12. Offline 发布伪代码

```text
声明 OfflineArRelease {
  codeVersion = 32,
  dependencyVersion = 6,
  fullApkPublished = false,
  targets = ["192.168.1.39", "120.79.245.103"]
}

过程 publishArServiceCode()
  从当前已发布 manifest 读取 dependencies-v6 和 apk-min-v33
  复制 src 服务代码并排除 Android display 工程
  生成 code-v32.zip
  生成带签名的 manifest-code-v32.json
  在局域网和外网先原子安装 code-v32.zip
  原子替换 manifest.json
  验证 manifest 签名和 code-v32 的大小、SHA-256
  仅清理名称严格匹配的旧 code/dependencies/data/apk-min 版本文件
  保留完整 APK、日志、模型、配置、任务和结果文件
```

本次发布使用 `code-only`，依赖锁文件指纹未变化，因此不生成新的 dependencies 包；完整 APK 不参与发布和清理。
