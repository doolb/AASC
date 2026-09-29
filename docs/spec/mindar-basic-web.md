# MindAR Basic 独立 HTTPS 测试页实现规范（伪代码）

```text
MindAR Basic 页面启动:
  读取 3rd/mind-basic/index.html
  保留官方 A-Frame 场景和 MindAR target 属性
  固定 A-Frame 1.5.0、MindAR 1.2.5 和官方 v1.2.2 示例目标/图片/glTF URL
  加载独立几何模块，使用同一矩形校验及旧选区兼容逻辑
  显示 Softmind 作者与 CC BY 4.0 署名
  不加载 AASC 服务、MMD runtime 或项目显示端代码
  打开 IndexedDB mind-basic-targets
  读取用户自定义目标及上次选择
  无有效选择时选择只读官方示例
  将 mindar-image 的 autoStart 设为 false，由页面控制 MindAR system 生命周期
  页面进入后启动当前选择的目标

拍摄并保存自定义目标:
  用户点击“拍摄自定义定位图”后停止当前 MindAR system并释放跟踪摄像头
  请求后置摄像头权限，显示实时预览
  预览尺寸随相机帧宽高比适配，不在拍摄前显示裁剪框
  用户拍摄完整相机帧；保存完整原图并显示裁剪编辑器
  初始化 cropRect: x=10%, y=10%, width=80%, height=80%
  在完整照片上覆盖蓝色矩形裁剪框及四角/四边手柄，不显示单独的裁剪预览图
  拖动矩形内部时移动选区；拖动边/角手柄时调整位置和尺寸
  将矩形选区约束在照片边界内，保持轴对齐矩形，不允许旋转或透视变形
  每次拖动后只更新照片上的蓝色矩形框；编译定位图时才按 cropRect 裁剪
  用户确认后保存；允许返回重拍
  用户可填写名称
  若原照片宽高为 sourceWidth/sourceHeight，将 cropRect 映射为像素裁剪范围并校验边界及非零尺寸
  将 {targetId, name, imageBlob, cropRect, createdAt, updatedAt} 保存到 IndexedDB
  将该目标设为当前选择，关闭校准流并释放摄像头
  只保存原照片和 cropRect；不上传照片，也不持久化编译结果
  遇到旧版 selectedQuad 记录时，读取其最小/最大 x/y 作为 axis-aligned 外接矩形继续使用

开始官方目标定位:
  停止旧 MindAR system 并释放旧流/Controller
  system.imageTargetSrc ← 固定官方 card.mind URL
  target 图片平面 ← 官方 card.png，宽高比 ← 0.552
  Softmind glTF 保持在 mindBasicImuStage 独立场景节点；由逐帧融合模块跟随目标锚点，不嵌套在 MindAR 锚点节点
  system.start()

开始自定义目标定位:
  从 IndexedDB 读取选中目标的 imageBlob 和 cropRect
  对旧记录则将 selectedQuad 转为 axis-aligned 外接矩形
  按 cropRect 从原始图片裁剪矩形 Canvas；不做透视变换
  用 MINDAR.IMAGE.Compiler.compileImageTargets 编译目标并显示百分比
  编译完成后调用 exportData 得到 .mind buffer
  将 buffer 包装为临时 Blob URL
  停止旧 MindAR system 并释放旧跟踪流/Controller
  system.imageTargetSrc ← 临时 Blob URL
  target 图片平面 ← 校正后的目标图，宽高比 ← 目标图高度/宽度
  保持参考平面挂在 targetIndex 0 的锚点；Softmind glTF entity 位于 mindBasicImuStage 独立场景节点
  system.start() 并等待 arReady；错误显示可读状态并允许重试
  本次停止或切换前保持 Blob URL 有效

切换/删除/离开页面:
  停止当前 MindAR system，停止摄像头轨道并销毁 Controller
  确认旧跟踪器已释放后撤销不再使用的临时 Blob URL
  移除固定引用的 MindAR resize listener，避免重复启动产生监听泄漏
  删除操作只移除 IndexedDB 中选中的用户目标；官方目标不可删除
  当前目标被删除时切回官方目标
  切换目标时更新 localStorage 选择；刷新后恢复目标选择
  pagehide 时停止相机和 MindAR system
  从浏览器前进/后退缓存恢复时重新启动已选择的目标

控制面板:
  每次页面加载时 controlPanel.expanded ← true
  用户点击收起按钮时隐藏面板内容，仅保留小型展开按钮
  用户点击展开按钮时恢复面板内容
  aria-expanded 与实际显示状态保持同步

IMU 辅助实验:
  页面加载时 imu.enabled ← false；不得自动申请传感器权限
  用户点击“启用 IMU”时检查 HTTPS/安全上下文和设备运动事件支持
  若浏览器提供 DeviceMotionEvent.requestPermission，则在该用户手势内请求授权
  用户拒绝、接口不支持或事件字段为空时，保留纯 MindAR 模式并显示具体原因
  授权成功后注册唯一 devicemotion、orientationchange、visibilitychange 监听器
  用户保持设备静止完成短时陀螺仪偏置采样，记录 gyroBias 与当前 screen.orientation
  接收样本时使用单调时间戳；dt 超过上限时丢弃该步，避免后台恢复产生位置跳变
  用 rotationRate 减去 gyroBias 并积分相对四元数，按屏幕方向换算传感器坐标
  用 MindAR targetUpdate 提供的目标姿态校正预测姿态，并按滤波增益配置抑制视觉姿态高频抖动
  姿态防抖关闭时，模型姿态直接采用 MindAR 视觉姿态
  位置补偿开启且 targetLost 时，仅接受 acceleration（已去重力）样本
  将加速度按 IMU 相对朝向变换到初始场景坐标，更新速度/相对位移并施加静止死区与速度阻尼
  模型位置沿相机位移的反方向更新；超过 maxLossDuration 或 maxTranslation 后停止推算并隐藏模型
  targetFound 后以新视觉姿态校正场景位置/朝向，将旧速度清零并重新建立丢失计时基准
  acceleration 不可用时仅禁用位移补偿，陀螺仪姿态实验仍可单独运行
  页面进入后台时清空积分时间基准；离开页面、停止定位或关闭 IMU 时移除监听器并清零临时状态
  状态面板显示权限、样本可用性、角速度、线性加速度、校正后姿态、积分位移和失锁时长
  原始相机视频不经过 IMU 变换；IMU 仅用于虚拟模型/场景姿态测试

发布 MindAR Basic:
  目标目录 ← 外网站点 /var/www/html/mnt/mind-basic/
  先上传几何脚本/CSS/JS，再原子替换 index.html
  不读写 /mnt/mmd-ar/ 或 Offline 发布目录
  通过 HTTPS 请求首页和固定 CDN 资源
  校验首页/JS/CSS/几何脚本 200 与 SHA-256，确认 MindAR Basic 和 MMD AR 路径隔离

浏览器运行:
  打开 HTTPS 页面
  浏览器获得用户摄像头授权后启动 MindAR
  当前为官方目标时，匹配 card.mind 后显示官方卡片平面和动画 glTF 模型
  当前为自定义目标时，匹配浏览器生成的 .mind 后显示裁正参考图平面和动画 glTF 模型
  目标丢失时由 MindAR/A-Frame 示例组件恢复目标可见性
  用户刷新后从 IndexedDB 恢复用户目标；开始定位时在浏览器内重新编译
  自动化回归使用模拟摄像头执行整帧拍摄/默认裁剪框/移动与缩放/矩形裁剪/保存/编译/Blob target 切换/arReady/停止
  自动化回归验证控制面板默认展开，且可收起和再次展开
```
