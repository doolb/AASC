# MindAR Basic 独立 HTTPS 测试页实现规范（伪代码）

```text
固定世界锚点与相机预测（2026-09-30）:
  MindAR targetIndex 0 节点仅保留原始测量，不挂可渲染的模型或参考图
  相机挂在 mindBasicCameraRig，关闭 look-controls 和 wasd-controls
  参考图和角色挂在 mindBasicImuStage，世界位置=0，世界朝向=单位四元数
  首次有效观测记录 referenceScale = targetPose.scale.x，stage.scale = referenceScale
  MindAR postMatrix 使用目标像素宽度作为均匀缩放；保留该单位以兼容原 near/far
  原始视觉或融合预测 targetPose 均转换成世界相机姿态:
    cameraQuaternion = inverse(targetPose.quaternion)
    cameraPosition = rotate(-targetPose.position * referenceScale / targetPose.scale.x, cameraQuaternion)
    cameraRig.position/quaternion = cameraPosition/cameraQuaternion；cameraRig.scale 恒为 1
    每次更新只写相机，不写 stage/参考图/模型的世界变换；立即刷新相机世界矩阵
    lastRenderedCameraPose = 已应用相机姿态的独立副本
  图片可见/不可见两个开关均控制相机旋转和平移，视觉只纠正相机姿态
  预测暂不可用时冻结最后相机姿态，保留已定位模型；首次定位前隐藏模型
  重校准、开关切换、重新识别不移动世界锚点；目标切换/停止清除世界尺度并重置相机
  角色本身的示例动画保持原局部动画，与定位预测无关

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
  mindar-image.uiScanning ← no；首锁等待及 targetLost 均不创建扫描遮罩
  renderer.alpha ← true；场景/画布使用透明背景；启动时明确清除场景背景并将 clearAlpha 设为 0
  本地 CSS/JS 使用统一资源版本参数，避免 HTML 更新后仍命中旧样式缓存
  跟踪视频在 start 后设置 muted/playsInline 并显式播放；失败时显示重试提示
  MindAR 创建在 body 下的跟踪 video: z-index ← 0，禁止接收指针事件
  a-scene: z-index ← 1；控制面板/署名/校准弹窗维持更高层级
  未识别/失锁时保留摄像头画面；停止定位时沿用原逻辑释放相机

MindAR 可信度（估算）:
  arReady 时为当前 Controller 安装只读观测包装；停止/切换时恢复原方法并丢弃未完成回调
  tracker.track 原样执行并返回原结果，记录有效 worldCoords/screenCoords 与关键帧点总数
  Controller._trackAndUpdate 原样执行并返回原位姿/异常，完成后从已记录点对计算质量
  指标: 有效点数量、数量/关键帧总数、世界点包围框面积/目标面积、拟合后重投影 RMSE（输入像素）
  投影: cameraPoint = modelViewTransform × worldPoint；pixel = K × cameraPoint，除齐次深度
  少于 4 点/无有效位姿: 质量分 0；接口/几何字段无效: 不可用，不虚构分数
  分数 = round(100 × min(1, 点数/12) × sqrt(有效比例) × sqrt(min(1, 面积占比/0.25)) × exp(-归一化误差/3))
  归一化误差 = RMSE × 640 / max(输入宽, 输入高)；分数范围 0..100，非官方概率
  面板每 100ms 至多刷新一次，IMU 关闭时也显示；结果年龄超过 500ms 标记过期并隐藏分数
  targetLost 标记丢失并清除旧分数，停止显示已停止，重启等待新的采样
  质量指标只观察，不改变官方矩阵/识别阈值/One Euro 参数，也不改变已有融合接纳门槛

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
  Softmind glTF 与参考图固定在世界锚点，逐帧融合模块仅驱动相机
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
  参考平面与 Softmind glTF 均位于 mindBasicImuStage 固定世界锚点，targetIndex 0 只提供测量
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

IMU 主导旋转、视觉纠偏:
  默认关闭 IMU；用户授权后才监听 devicemotion
  静止校准: 收集低角速度、低线性加速度、低方差的连续样本；运动时清空窗口
  无样本/拒绝权限/校准期间/陀螺仪超过 250ms 未更新: 使用可见目标的视觉姿态
  从 MindAR 的 object3D.matrix 分解位置、朝向和缩放；targetUpdate 后用 microtask 读取已提交矩阵
  首次有效视觉观测建立锚点；记录单调时间；拒绝非有限、零四元数、零缩放输入
  两个场景开关:
    页面只有“图片可见时预测相机运动”和“图片不可见时预测相机运动”，默认均选中
    每个开关同时控制陀螺仪旋转和加速度平移；页面始终将 translationEnabled 设为 true
    可靠新视觉<=500ms 且目标可见: 使用可见开关；否则使用不可见开关
    可见开关关闭: 原始视觉姿态直接显示；失锁开关关闭: 冻结最后显示姿态
    关闭预测的场景仍处理传感器/滤波/校准，但不积分相机旋转或平移
    进入关闭场景时吸收已预测位移到当前姿态，清空速度/位移增量，保留失锁时间
    重新开启从当前姿态继续；切换场景开关不隐藏模型，不清空已定位姿态
    图宽或坐标系改变才重新锚定；平移时间/距离限制继续生效
  旋转/平移抗漂移:
    静止校准: 至少 1200ms 且 24 样本；时间逆序/间断>120ms/明显运动清空窗口
    校准同时估计设备坐标陀螺仪和去重力加速度的均值及标准差；无加速度时仅校准陀螺仪
    扣零偏后应用噪声自适应陀螺仪迟滞死区；计算结果整体×2，低门限=2×max(0.03,min(0.25,3σ))，高门限=低门限×1.8；低速轻量低通，高速直接响应
    加速度同样扣零偏并轻量低通，再使用原有加速度死区和积分保护
    原始视觉相对固定基准变化<3mm且<0.25度、持续600ms，最近视觉<=200ms，且传感器持续安静600ms:
      确认静止，速度置零；用15秒时间常数缓慢更新设备坐标零偏
    无视觉/视觉运动时不启用静止归零或在线零偏学习，避免把匀速移动当静止
    首帧/异常间隔/断流清除滤波记忆和静止计时，不跨缺失时间积分
    面板显示原始/校正后角速度、原始/校正后加速度和静止状态
  每个有效陀螺仪时间步:
    dt 必须 > 0 且 <= 120ms；异常步仅重建时间基准，不跨间断积分
    按屏幕方向转换扣除偏置后的角速度
    inverse(cameraRotationDelta) 同时左乘目标朝向及旋转目标位置
    旋转待确认的视觉异常候选，保持同一相机坐标
  每个新视觉观测:
    按经过的秒数计算 gain = 1 - exp(-dt / correctionTime)
    默认方向纠正时间 800ms；快速转动时减小方向纠正增益，减弱视觉延迟的回拉
    平移在跟踪及短时失锁期间均使用 IMU 预测，视觉以 250ms 时间常数纠偏
    纠偏后将剩余速度旋转到当前相机坐标，归零位移增量但保留速度连续性
    大角度/大位置跳变需连续三次相近观测才接受
    失锁重获需要连续三次相近的新观测，确认后从预测姿态平滑纠偏；不直接跳到新视觉位姿
    MindAR trackingStates.isTracking=false 首帧立即进入失锁补偿，忽略重复输出旧矩阵，不等待正式 targetLost
    每个失败帧清空重获候选计数，但不延长原失锁时间；只有连续三帧新观测稳定后接纳
    视觉事件只有到达时间，不宣称相机曝光和传感器硬件时间已对齐
  每个渲染帧:
    目标可见且传感器新鲜时应用最新预测，不等待下一视觉帧
    500ms 无被接受的视觉观测时进入短时保持；有新视觉更新时允许恢复
    关闭融合预测时使用原始视觉；传感器过期但融合开启时，视觉仍经稳定性确认及平滑纠偏，不直接使用候选矩阵；失锁补偿独立启用
  失锁保持:
    每次实际应用相机姿态后保存 lastRenderedCameraPose 的独立副本
    targetLost / 预测无结果 / 关闭 IMU: 有已显示姿态且定位仍运行则保持模型显示
    首次识别前不显示；停止定位、切换目标或重置坐标系时清除保存姿态
    默认平移预测窗口 1800ms，范围 200..3000ms，从最后接受的视觉时间计时
    平移超时/达位移上限: 停止平移积分并清空速度，陀螺仪新鲜时继续旋转
    传感器中断: 冻结已有姿态，恢复采样后不得跨中断补积分
    场景开关同时控制平移积分；IMU 仍需用户主动授权启用，仅接受已去重力 acceleration
    用户输入目标实际宽度（默认示例 20cm，须按实物修改）
    米到场景单位 = 锚点 scale.x / 目标宽度米数
    在最近接受视觉的相机坐标系积分速度和位移，使用当前逆旋转转换回当前相机坐标后补偿
    保留死区、阻尼、1.2m/s 速度及 0.25m 位移上限；达到位移上限停止平移预测，旋转继续
  横竖屏切换/后台切换/积分开关或实物宽度改变:
    清除旧预测、速度和时间基准，等待新视觉观测锚定
  停止/关闭/离开页面:
    移除传感器监听；清除状态；关闭 IMU 后仍可持续接收视觉 targetUpdate
  面板显示视觉纠正时间、保持时间、位移实验及目标宽度，角速度/位移/失锁时间
  原始视频不处理；旋转主导不等同于纯惯性六自由度定位

发布 MindAR Basic:
  目标目录 ← 外网站点 /home/as/a/mind-basic/
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
