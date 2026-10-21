# 六轴IMU共享3D测试网页实现规范（伪代码）

日期：2026-10-03。已实现；以下伪代码先于对应代码更新，并与最终实现同步。

```text
已有声明
  项目three 0.160.0、ws、Node HTTP/HTTPS、浏览器DeviceMotion、WebSocket、requestAnimationFrame
  现有MindBasicImu仅作轴向/时间/零偏处理参考；不改原MindAR或APK实现
新增定义
  SixAxisSample { time、gyro三轴(rad/s)、accel三轴(m/s²)、kind(gravity/linear) }
  ImuCalibration { gyroBias、gyroNoise、gravityReference、accelBias、accelScale、faceSamples、quality }
  ImuState { quaternion、velocity、position、previousTime、filterState、calibration、streamQuality }
  ImuProfile { gyroDeadZone、accelDeadZone、noiseFilter、tiltCorrection、assumedRestEnabled }
  ThemePalette { pageBackground、panelBackground、controlBackground、readoutBackground、text、mutedText、border、accent、status、deviceColors }
  Simulator { seed、truthTrajectory、sampleRate、constantBias、whiteNoise、randomWalk、jitter、dropout }
  SimulatorView { 独立右侧视口/相机、虚拟设备、移动/旋转手柄、拖拽目标、连续运动状态 }
  RoomDevice { assignedId、ownerSocket、generation、sequence、latestPose、status、displayColor }
  PublishedFrame { type、room、deviceId、generation、sequence、sourceTime、pose、sixAxisSummary、quality }
  SceneDevice { pose、trail、lastReceiveTime、displayState、optionalTruth、errorMetrics }
操作流程
  桌面打开 -> 应用固定亮色ThemePalette -> 加载固定本地Three/OrbitControls/TransformControls -> 左右分栏
  页面背景/面板/控件/读数 -> 使用浅色表面与深色文字 -> 边框、次级文字和焦点状态保持可辨
  左右3D视口 -> 使用与页面协调的浅色背景和低干扰网格 -> 使用高对比设备色、坐标轴和轨迹色
  手机加入 -> 复用同一亮色样式 -> 保留窄屏单列布局和所有操作状态
  左侧 -> 接收/估计场景、米制网格/方向物体/轨迹与设备面板
  右侧 -> 独立模拟视口、虚拟设备及XYZ移动/旋转手柄、噪声参数、六轴只读显示
  鼠标操作右侧手柄 -> 拖拽目标；拖拽期间停用右侧相机操作，左侧相机保持独立
  右侧设备位移 -> 同步平移右相机和观察目标 -> 保留观察距离/方向，设备在视野内
  开始拖拽 -> 保存固定交互相机供射线计算；结束 -> 恢复当前相机
  相机跟随 -> 不传入测量生成器
  创建房间 -> WebSocket握手 -> 返回加入码/源端ID -> 手机链接包含房间参数
  手机点击开始 -> 立即请求需要的DeviceMotion权限 -> 监听六轴数据
  权限拒绝/非可信HTTPS/数据缺失 -> 明确状态，不生成有效六轴样本
  rotationRate(beta,gamma,alpha) -> 设备x/y/z -> 度/秒转换弧度/秒
  accelerationIncludingGravity或acceleration -> 标记含重力/平台线性种类，不能混用
  设备自然坐标固定 -> 屏幕旋转只调整布局，不重复变换传感器轴
  sourceTime -> 同源单调时间；重复/回退/长断流 -> 拒绝或重置积分时间段

  用户点击静置校准 -> 有限窗口均值/方差/模长检查
  未达到静置条件 -> 提示保持静止，不更新零偏
  静置合格 -> gyroBias/gyroNoise/重力方向 -> 标记单姿态校准
  未完成六面 -> accelBias/scale不标为完整标定
  六个正负轴静置窗口 -> 正负均值中点与幅度 -> accelBias/scale -> 质量检查

  有效样本 -> 减gyroBias、应用accelBias/scale -> 同时刻姿态去重力 -> 世界线性加速度dt一致低通
  可调向量模长死区 -> 小于门限整向量归零，已接受大运动保留幅度；不承诺滞回
  左侧诊断 -> 所选设备原始角速度/加速度、处理后角速度/世界线性加速度、数据种类/陀螺仪零偏
  按重置原点更新真值对照坐标；真值始终不参与估计纠偏
  角速度指数映射 -> 右乘姿态四元数 -> 归一
  含重力且用户启用停稳假设并满足静止门限 -> 同时刻重力方向缓慢修正倾斜；普通运动不启用
  含重力 -> 姿态旋转到世界后去重力；线性种类 -> 旋转后直接使用
  世界线性加速度 -> 时间一致速度/位置积分 -> 估计pose
  低加速度/角速度 -> 只能标记候选安静，默认不清零速度
  重置航向 -> 投影设备前向到世界XZ，绕世界Y施加当前航向的反向旋转，保留倾斜
  用户显式已停稳或启用手持假设 -> 记录零速修正及假设状态
  长断流/后台 -> 保留最后pose、清时间边界，恢复时明确新段/速度重置

  图形模拟 -> 拖拽位置/姿态目标 -> 有速度/加速度边界的连续运动
  连续运动或可重复轨迹按钮 -> p/v/a/q/角速度真值 -> 反向旋转生成机体系测量
  鼠标目标跳变 -> 仅改变运动目标，不形成无穷大速度/加速度测量
  真值测量 -> 加固定零偏/有种子白噪声/随机游走/时间抖动/丢样 -> SixAxisSample
  Simulator与手机 -> 同一ImuState处理入口；估计器只接收测量和校准配置
  真实轨迹 -> 独立显示/误差计算，不传入估计器纠偏
  左侧物体 -> 只能消费估计pose，禁止直接复制右侧真值变换

  输入端处理pose及诊断 -> 限频PublishedFrame -> WebSocket
  服务端核对type/房间/连接绑定ID/代次/顺序/有限数值/大小 -> 规范化 -> 同房间广播
  观察端加入 -> 当前设备快照 -> SceneDevice
  观察端只应用源端pose，不再次对六轴积分，不比较不同设备时钟
  多设备按每台不同色物体 -> 独立源/校准/原点/轨迹；共享虚拟世界不意味着物理空间已对齐
  断线/缓冲过大 -> 冻结/丢旧帧，不外推无限运动；空房间TTL -> 回收
  rAF -> 渲染最新pose/有界轨迹；数值面板低频批量刷新
  所有网页关闭/停止 -> 注销事件、关闭源连接、清计时器/几何/材质

  亮色主题只改变页面样式与Three场景显示颜色 -> 不进入IMU样本、估计状态、WebSocket消息或校准参数

验证
  固定种子/理想初值 -> 三轴已知旋转与加速-匀速-减速轨迹误差
  浏览器真实拖拽平移/旋转 -> 产生有限六轴测量 -> 左侧由估计数据驱动
  停止测量/估计输出并移动右侧 -> 左侧保持最后有效姿态，证明没有真值直连
  静止含重力、纯姿态旋转 -> 不二次去重力、不产生明显虚假位移
  单姿态不声称完整加速度零偏；六面校准和错误动作/噪声拒绝
  有种子多组噪声 -> 处理前后误差和残余漂移，真值不进入估计器
  匀速 -> 默认不零速修正；启用手持假设 -> 单独记录对轨迹的影响
  缺字段/null、事件回退/重复/断流、权限取消、后台恢复
  两输入/两观察端 -> 状态一致、跨设备覆盖拒绝、重连代次、房间回收
  实际手机采样/坐标/HTTPS与移动体验独立记录，模拟结果不能冒充真实位移精度
```

```text
实现常量与边界
  默认世界加速度滤波12Hz，角速度死区界面0.2度/秒，加速度死区0.08m/s²，倾斜纠偏0.25
  默认不启用手持停稳假设；大于0.15秒采样空白 -> 冻结该间隔且速度归零
  静置窗口至少2秒/20样本；角速度模长<=0.2rad/s、重力模长误差<=1.5m/s²
  窗口单轴标准差 -> 角速度<=0.03rad/s，加速度<=0.18m/s²
  六面轴分量朝上>=0.88g；比例0.8..1.2，零偏绝对值<1.5m/s²
  静置校准进行时不积分角速度偏差；校准结束保留相对航向并对齐倾斜
  右设备弹簧目标 -> 最大线速度2m/s、线加速度8m/s²、角速度3rad/s、角加速度10rad/s²
  手机时钟 -> performance.now接收时间，不冒充硬件时间戳
  缺传感器事件700ms -> 断流提示/冻结；停止或页面后台 -> 移除监听和计时器
  暂停时共享sourceTime仍取最后有效测量时间 -> 不因清空积分时间边界而倒退
  观察端按源端pose更新，无平滑外推；原始/处理后六轴和零偏在左侧诊断
  发布目标50Hz，服务端按每连接平均50消息/秒预算限流并容许三个令牌的短时突发；WebSocket最大消息256KiB以容纳轨迹快照；缓冲256KiB
  房间12源/24连接、全服务64房间；600点轨迹；无人房间120秒回收
  HTTP仅显式白名单网页/Three控件 -> 服务源码及任意路径404
  房间消息绑定ID/代次/单调sequence/time，规范化四元数/有限数据
验证状态
  npm专用测试 -> 11项：9算法、1真实WebSocket、1Chromium界面
  Android真实采集/静置校准/共享 -> 208样本、70观察帧、约60Hz
  真实位移测量、iOS权限与长时间手机性能 -> 独立现场验收，不能替代为模拟通过
```

## 原生 Android 六轴采集、固定房间转发与本机诊断（2026-10-17）

```text
新增定义
  FixedSensorRoom := "AASCIMU1"
  NativeSensorSample := { time: 单调秒, gyro: [x,y,z] rad/s, accel: [x,y,z] m/s², kind: "gravity" }
  SensorDevice := RoomDevice + { role: "sensor", lastSample, lastSequence, lastReceiveAt }
  DebugSampleRing := 最近500条规范化样本，仅内存
  AndroidSender := 独立APK，WebView连接页 + Android SensorManager六轴桥接
  DefaultEndpoint := { host: "192.168.1.39", port: 8769, room: FixedSensorRoom }

APK启动
  加载APK内本地连接页 -> 地址预填192.168.1.39、端口8769，房间显示AASCIMU1且固定
  用户可编辑主机地址 -> ws://主机:端口/room
  连接WebSocket -> 发送 {type:"room.join", room:"AASCIMU1", role:"sensor", label:"Android原生六轴"}
  服务允许桌面观察端或首个传感器创建固定房间；其他固定码仍须已有房间
  固定房间允许viewer/source/sensor；同一时刻仅允许一个在线sensor
  收到room.joined及设备id/generation -> 启用开始采集

采集生命周期
  用户点击开始 -> Android注册TYPE_GYROSCOPE及TYPE_ACCELEROMETER -> 前台采集
  不注册TYPE_LINEAR_ACCELERATION，也不采集或上传平台线性加速度
  不要求运行时传感器权限；网络使用INTERNET权限及局域网明文WebSocket
  传感器事件使用自然设备x/y/z轴；陀螺仪原生rad/s；加速度含重力、m/s²
  按单调传感器时间配对两种最新值 -> 任一值缺失/过期则丢弃该候选样本
  限频约50Hz -> NativeSensorSample -> WebView JavaScript
  原生到WebView保留有界有序队列，每次最多桥接8条样本；超过容量时丢弃旧样本并标记gap
  JavaScript保留有界有序队列；每20ms最多发送一个含至多8条样本的批次
  WebSocket积压时队列继续有界保留，溢出时丢弃旧样本并标记gap
  JavaScript发送 {type:"imu.samples", deviceId, generation, sequence, samples}；旧imu.sample仍兼容
  停止按钮/断线 -> 注销SensorManager监听、清空待派发样本并停止发送
  Activity后台或销毁 -> 注销监听并关闭WebSocket，释放固定房间传感器席位

服务端校验与转发
  验证连接绑定的sensor身份、设备id、代次、递增sequence、严格递增time
  normalizeSample -> gyro三轴有限且绝对值<=100，accel三轴有限且绝对值<=200，时间范围0..86400秒；旧APK多余字段忽略
  无效消息/时间回退/频率超限 -> 拒绝并计入调试统计，不广播
  有效数据 -> 更新时间与房间活跃状态 -> 存入最大500条内存环形缓冲
  广播 {type:"sensor.sample", room, device:summary, sequence, sample} 给房间viewer
  断线保留离线设备摘要；旧设备按各自最后活跃时间回收

桌面接收端
  选择“手机APK回传” -> 固定roomCode为AASCIMU1、以viewer角色连接、隐藏模拟器
  收到sensor.sample -> 若deviceId切换则重建本地ImuEngine/时间基线，启用仅APK观察模式的自动静稳修正
  以原始sample送入现有ImuEngine -> 更新本地估计场景、数值和校准状态
  remote模式不发布位姿、不回传估计结果；真值栏显示无外部真值
  无新样本700ms或断线 -> 冻结最后姿态、清速度并重置时间边界

本机调试HTTP接口
  GET /api/imu/status -> 仅loopback请求可读；返回房间/传感器在线状态、采样率、计数、拒绝计数及最新接收时间
  GET /api/imu/samples?limit=N -> 仅loopback可读；N规范化到1..120，返回最近原始规范化样本
  非loopback -> 403；不开放CORS、不写入磁盘、不新增写入/配置接口
  调试指标与样本全部进程内存；服务结束即清空

APK构建
  npm run build:apk:imu-sender -> 使用仓库Android Gradle Wrapper构建独立debug APK
  输出 3rd/imu-six-axis-test/android-sender/output/aasc-imu-sender.apk
  APK与Gradle中间产物忽略Git；不改变Offline发布状态
```

## 模拟器静稳归零、六轴读数与默认房间（2026-10-17）

```text
常量
  DefaultImuRoom := "AASCIMU1"
  SensorSample := { time, gyro, accel, kind }
  accel := Android原始TYPE_ACCELEROMETER读数，含重力，供既有估计器使用

网页默认房间
  显式URL参数room优先 -> 否则默认AASCIMU1
  房间输入框非空时优先使用手动输入 -> 规范化大写后连接
  成功加入房间 -> 更新输入框及URL中的room参数
  source切换不得清除已选房间；观察APK时默认AASCIMU1
  默认固定房间允许网页source/viewer及单个APK sensor共存

Android六轴加速度
  注册TYPE_GYROSCOPE和TYPE_ACCELEROMETER为必需传感器
  APK只显示和上传原始含重力加速度；电脑显示原始含重力值与估计器世界线性加速度
  旧APK仍带linearAccel -> 服务端只校验必需六轴并忽略多余字段，网页及诊断接口不返回该字段

浏览器采样
  accelerationIncludingGravity有效时作为accel/kind=gravity
  缺少含重力值但acceleration有效时，accel使用该值/kind=linear；仅作为旧浏览器兼容输入
  不额外附加或显示平台线性加速度读数

模拟器停稳自动清零
  仅source=simulator时启用simulatorAutoRest；APK观察模式采用独立remoteAutoRest，手机浏览器保持关闭
  每个有效样本计算校正角速度rate及同区间世界线性加速度acceleration
  quiet := |rate| < 0.02rad/s 且 |acceleration| < 0.12m/s²
  显著加速度与估计速度反向 -> 记录减速证据；显著正向运动或从静止重新启动 -> 撤销证据
  减速证据作为较快清零的附加条件；实际窗口评分和兜底时间见下方“模拟器六轴窗口 ZUPT”
  静稳门限超出 -> 清空静稳计时；不读取模拟器真值/目标位置/目标速度
  恢复样本首帧仅重建时间边界；清除过期的“数据中断/冻结”提示
  自动静稳只抑制停止后的速度残留，不回写或修补位置；位置精度依赖零偏校准
  默认噪声/零偏下，按静置陀螺仪校准及六面加速度校准后再评估标准轨迹
```

## 位置偏移修复草案（2026-10-03，待确认，未实现）

```text
已有声明 := ImuEngine.push/calibrate、ImuSimulator.step、滤波状态、四元数/速度/位置
复现 := 无噪测量 + 默认处理 + 10秒旋转/平移/复合 -> 与真值对照，真值仅用于评估
修复姿态时序 := 已校准角速度 -> 与当前加速度同一采样区间的姿态 -> 去重力
  不用单独低通造成滞后的姿态解释当前含重力加速度
  世界线性加速度再滤波；公开滤波作用范围
重力对齐 := 明确静置校准或用户启用停稳假设 -> 修正倾斜
  普通运动中不把真实平移加速度当倾斜；重力观测与姿态时刻一致
模拟初始状态 := 区分理想验证/带噪未校准实验；展示校准状态与残余误差
验证 := 默认处理参数 + 无噪旋转/平移/复合 + 静置/校准/噪声，不能只测全关闭处理路径
等待方案确认 -> 实现 -> 记录实测阈值与限制，不将模拟真值注入估计器
```

### 已确认修复的执行伪代码

```text
用户确认 -> 实施位置偏移修复
角速度 := 当前测量 - 已标定零偏 -> 向量死区；不单独低通造成姿态时延
区间中点姿态 := 起点姿态 * exp(角速度*dt/2)
世界加速度 := 中点姿态旋转当前机体系测量 - 重力 -> 世界系低通/死区 -> 积分
quiet候选 := 角速度/加速度门限；仅显式启用停稳假设且持续0.7秒才允许自动重力对齐/清速度
重力纠偏 := 同一中点姿态的测量方向误差 -> 小增量施加末端姿态；普通运动禁用
静置校准倾斜对齐 := 六面偏置/比例修正后的静态均值，不重复引入已标定加速度误差
新增无噪声保留处理按钮 -> 仅清噪声和旧标定并重置实验，不改变滤波/死区设置
界面标明世界加速度滤波及停稳假设下倾斜纠偏，带噪未校准状态保持可见
```

```text
修复验证结果（2026-10-03）
  无噪声+默认处理+100Hz/10秒 -> rotate误差0m、translate0.001371m、combined0.015500m
  带噪固定种子+静置校准+10秒 -> 位置残差0.015926m
  默认参数回归阈值 -> rotate<1e-6m、translate<0.01m、combined<0.03m
  13项专用自测 -> 包含无噪按钮保留12Hz滤波/0.08m/s²死区，以及标定后倾斜对齐
  未校准偏置依旧漂移，不使用真值/无依据零速掩盖误差
```

## 模拟轨迹查询与分轴位置误差（2026-10-17）

```text
已有声明
  ImuEngine.snapshot() -> {time, position, velocity, quaternion, ...}
  ImuSimulator.truth()/p -> 当前模拟真值
  RoomClient.publish(frame) -> 已校验并发布源端估计位姿
  服务端房间设备只保留最新frame；诊断HTTP接口仅接受loopback只读请求

新增定义
  PositionReference := [x,y,z] 米，模拟器原点重置后的真值位置
  PositionError := estimatedPosition - referencePosition，三个带符号世界坐标分量
  PositionErrorTotal := sqrt(x*x + y*y + z*z)，非负欧氏误差
  世界+Y朝上，因此Y误差正值表示估计位置高于真值
  TrajectoryPoint := {receivedAt, sequence, time, position, velocity, quaternion,
                      referencePosition?, positionError?, positionErrorTotal?}
  VisibleTrailSnapshot := {estimatedTrail: [[x,y,z]...], referenceTrail: [[x,y,z]...]}
  DeviceTrajectory := {points: 实时帧历史, estimatedTrail: 浏览器显示估计轨迹,
                       referenceTrail: 浏览器显示真值轨迹, current, lastFrameAt, frameAgeMs, stale}
  实时历史与浏览器显示轨迹分开保留；实时历史每帧追加，页面轨迹按距离抽稀
  实时历史最多600帧；estimatedTrail/referenceTrail分别最多600个显示点，不能混成一条
  TrajectoryQuery := {room?, deviceId?, limit?}
  DefaultTrajectoryRoom := "AASCIMU1"

页面误差显示
  仅当source=simulator且本机估计设备被选中时计算真值差
  truthPosition := simulator.p - truthOrigin
  positionError := engine.position - truthPosition
  分别显示positionError.x/y/z和sqrt(sum(component²))，单位米
  其他输入来源显示无外部真值

模拟轨迹上报
  每次目标50Hz位姿发布 -> 上传规范化frame
  若source=simulator -> 同一消息额外携带referencePosition
  服务端校验可选referencePosition为有限三轴数值且范围不超过1e5米
  服务端仅把referencePosition用于本机诊断轨迹，不放入device.frame或广播消息
  服务端逐点计算估计位置减参考位置及欧氏总误差
  ImuScene每次绘制轨迹点 -> 仅当与上一点距离大于0.01米时追加
  每次成功room.joined -> 源端发送当前estimatedTrail和referenceTrail快照
  后续imu.frame携带本帧新增的估计轨迹点/参考轨迹点 -> 服务端校验设备会话及有限三轴数值
  快照和增量分别写入estimatedTrail/referenceTrail -> 超过600点移除各自最旧点
  每个接受的imu.frame都更新current和lastFrameAt，并追加一个TrajectoryPoint到实时历史；轨迹快照不刷新位姿时间
  实时历史不按位移抽稀，超过600帧移除最旧帧；设备静止时仍保留实时采样帧
  ImuScene显示轨迹仅当位置变化超过0.01米时追加显示点 -> 超过600点移除该显示轨迹最旧点
  无referencePosition的手机/其他源帧仍保存位姿，误差字段缺省
  清除/重置网页轨迹 -> 源端重新发送空/当前轨迹快照

本机诊断HTTP接口
  GET/HEAD /api/imu/trajectory -> 仅loopback可读
  room缺省为AASCIMU1；显式room须为8位英数字并规范化大写
  deviceId可选；提供时仅返回匹配设备，省略时返回该房间所有输入设备
  limit缺省600，规范化到1..600，对实时points、estimatedTrail及referenceTrail分别返回尾部limit项
  返回{room, roomExists, limit, devices:[{id,label,role,online,current,lastFrameAt,frameAgeMs,stale,
          points,estimatedTrail,referenceTrail}]}
  points逐个对应服务端接受的实时位姿帧，包含接收时间、源序号/时间、估计位姿和可用参考位置/误差
  estimatedTrail只含网页绘制的估计位置；referenceTrail只含模拟真值位置
  current始终返回最新估计位姿和可用参考误差；lastFrameAt为服务端Unix毫秒时间；frameAgeMs按最近已接收位姿帧计算
  WebSocket在线不代表位姿帧新鲜；超过1秒无帧或尚无位姿帧时stale=true
  非loopback -> 403；非法room -> 400；不开放CORS、不写磁盘
  无房间或无设备 -> 成功返回空devices；服务进程结束后轨迹缓存清空

兼容边界
  imu.frame的referencePosition为可选字段；旧发送端和手机发送端仍可发送原消息
  轨迹快照/增量只来自已加入房间的源设备，并按deviceId和generation校验；不广播轨迹真值
  房间广播与room.joined快照只包含估计frame，不包含模拟真值
  现有status/samples接口和环形缓冲行为保持
```

## 默认死区及历史诊断字段（2026-10-17）

```text
默认输入 -> 零偏向量为零、加速度比例为一 -> 初始化重力方向
角速度 -> 现有角速度向量死区 -> 姿态积分
含重力加速度 -> 姿态转换并去重力 -> 世界系滤波 -> 加速度向量死区 -> 速度/位置积分
未执行校准 -> 提示死区处理、校准可选；不阻断采集
高级校准默认折叠 -> 用户主动选择静置/六面采集 -> 沿用标定与结果应用
状态 -> 保留运行消息 + 陀螺仪/加速度实际校准状态；未做六面不作为必做任务
规范化frame -> 复制rawGyro/rawAccel/gyro/linear/gyroBias
  + gyroCalibrated/accelCalibrated/calibrationActive/faces/zeroCorrections/status/message
  -> 同帧TrajectoryPoint -> current及最多600帧points
显示轨迹 -> 沿用各600位置点；新增诊断不进入显示轨迹
旧发送端 -> 缺省计数/标记按既有规范化规则填充；忽略额外平台线性加速度字段
```

## 静置校准死区（2026-10-17）

```text
开始死区校准 -> 取消其他校准 -> 清速度 -> 创建独立采样窗口
有效样本 -> 扣除已有偏置 -> 保存机体系加速度、角速度和采样间隔
窗口完成且含重力 -> 用平均重力方向形成候选姿态 -> 重放窗口并去重力
候选姿态的世界加速度 -> 独立按现有Hz滤波；线性输入不做重力对齐
窗口从死区前角速度/加速度采样，不使用处理后零值或模拟真值
类型变化、长间隔或输入无效 -> 清空窗口；真实移动可能被计入噪声
窗口时间>=3秒 且 样本>=60 -> 阈值=max(99分位,均值+3标准差)+裕量
角速度按0.01度/秒向上取整；加速度按0.01m/s²向上取整
阈值非负且有限 -> 同时应用候选姿态及两个阈值 -> 更新无上限数值输入和结果；零偏和比例保持原值
阈值过大 -> 提示可能忽略真实慢动作；用户可重采或手动减小
校准期间 -> 冻结位姿、速度为零；取消/暂停/重置 -> 丢弃窗口
```

```text
验收记录 -> 16项专项通过
死区前静态扰动 -> 得到非零阈值；gyroBias/accelBias不变
运动/长间隔 -> 窗口重置；取消/超限 -> 旧阈值保持
手机事件持续采满窗口 -> 校准完成 -> 两个数值输入同步；gyroCalibrated保持false
```

## 模拟器静止漂移修正（2026-10-17，已实现）

```text
房间轨迹 -> 取停稳段原始六轴、估计姿态、处理后加速度、速度与参考位置
当前姿态旋转原始加速度并去重力 -> 原始残差大于静稳门限 -> 静稳计时未完成
处理后加速度为零且旧速度不为零 -> 位置继续按旧速度积分

静置死区窗口合格且输入含重力 -> 平均已应用既有偏置和比例的机体系加速度
平均重力方向经当前姿态旋转 -> 求最小倾斜修正 -> 形成候选姿态
窗口每个样本经候选姿态转到世界系并去重力 -> 按原采样间隔独立滤波
重新统计窗口的角速度及世界线性加速度模长 -> 计算候选死区门限
候选门限/窗口质量通过 -> 原子应用倾斜修正与两个门限，清滤波历史
窗口失败/取消/超限 -> 保留旧姿态和两个旧门限
输入为已去重力线性加速度 -> 不执行重力方向对齐，沿用原阈值流程
模拟器正常采样 -> 显著线性加速度与当前估计速度反向 -> 记录最近的减速证据
后续显著加速度不再反向 -> 撤销减速证据；标定/断流/暂停也撤销
减速证据存在 且 六轴静稳窗口连续满足门限 -> 较快清零残留速度，不使用真值
无减速证据但高置信窗口持续更久 -> 兜底清零残留速度，接受长匀速误判
从静止启动或短时限速匀速时仅加速度接近零 -> 不自动清零正在运动的速度
修复后重置实验再复测 -> 比较停稳前后速度和逐轴位置误差
```

```text
固定种子三段平面目标往返 -> 运动中不误清速度 -> 停稳后零速修正一次
停止后继续静置3秒 -> 估计位置基本不动；最终模拟位置误差约0.46m
IMU专用算法、浏览器和房间测试 -> 18项通过
```

## 模拟器六轴窗口 ZUPT（2026-10-17）

```text
每个模拟器含重力样本 -> 记录时间、死区前已校正角速度、同区间去重力世界加速度、机体系力模长
只保留最近0.5秒且最多80个样本；断流、暂停、校准和用户手动清速度 -> 清空窗口
窗口不足20点或覆盖时间不足0.4秒 -> 静稳评分为0
完整窗口 -> 计算角速度均方根、世界加速度均方根/波动、力模长相对重力的平均偏差
各量按好值/坏值线性归一为0到1；世界加速度均方根和力模长偏差取较可信者
静稳置信度 := 各项评分中的最小值；这是六轴一致性评分，不当作真实静止概率
置信度>=0.8 -> 记录候选静稳起点；不满足 -> 清候选计时
有减速证据且静稳持续0.7秒 -> ZUPT清速度
没有减速证据但高置信静稳持续1.5秒 -> ZUPT兜底清速度，接受匀速误判风险
持续静稳 -> 保持零速；检测到加速度突变/角速度突变 -> 清旧窗口和静稳计时
显著正向运动或从零速度重新启动 -> 撤销最近减速证据
手机/远程输入 -> 默认不执行模拟器自动ZUPT；用户手动或显式手持假设流程保持
快照提供静稳置信度和判定原因，便于本机网页与专用测试诊断
```

```text
固定种子三段往返 -> 运动中仅保留校准产生的1次清零；停稳后总计2次
修改前停稳5秒误差[X,Y,Z]=[0.392445,0.121296,-0.196885]米
修改后停稳5秒误差[X,Y,Z]=[0.399706,0.124845,-0.200978]米，总误差约0.4647米
无减速证据且残留速度[0.15,0.31,2.09]m/s -> 约1.9秒后清零，20秒时Z仅漂移约3.95米
旧算法同一静态输入20秒时Z漂移41.8米且速度始终为2.09m/s
长时间匀速且零角速度/零线性加速度 -> 可能触发兜底ZUPT，记录为已知限制
独立浏览器真实拖动 -> 轨迹接口返回同一模拟源实时帧和分轴误差；IMU专项20项通过
```

## 模拟器纯旋转重力泄漏修正（2026-10-17）

```text
已有声明
  ImuEngine.push -> 机体系含重力加速度、角速度、姿态、世界线性加速度、位置和速度
  ImuEngine.updateSimulatorRest -> 六轴静稳窗口及零速判定
  ImuSimulator.step -> 模拟器六轴样本；真值仅供测试比较

新增定义
  CorrectedForceNorm := 扣除已有加速度零偏、比例后且旋转到世界系前的机体系加速度模长
  GravityDirectionCorrection := 当前估计姿态下，测得重力方向到世界竖直方向的最小旋转
  RotationOnlySince := 六轴连续表明正在旋转、重力模长接近标准值、世界线性残差很小时的起点

操作流程
  每个有效含重力样本 -> 在任何世界坐标旋转或去重力操作前保存CorrectedForceNorm
  模拟器启用 且 模长与标准重力相差小于0.12m/s²
    且 ((角速度大于0.03rad/s 且 初步世界线性残差小于0.25m/s²) 或 已判定静稳且角速度小于0.02rad/s)
    -> 按本帧时间间隔和10/s纠倾增益，只对姿态俯仰/横滚应用部分GravityDirectionCorrection
    -> 同步修正用于本帧去重力的中点姿态；不从加速度推断航向
  重新用修正后的中点姿态将机体系力变到世界系 -> 减标准重力 -> 滤波、死区和积分
  更新静稳窗口 -> 使用CorrectedForceNorm与标准重力比较，不使用已去重力的残差模长
  模拟器角速度大于0.08rad/s 且 修正后世界线性残差小于0.18m/s²
    且 CorrectedForceNorm与重力相差小于0.08m/s² -> 开始/延续RotationOnlySince
  已处于仅旋转零速 -> 退出门限放宽到线性残差0.25m/s²、重力模长偏差0.12m/s²，避免单帧噪声反复计数
  上述条件连续超过0.7秒 -> 视为仅旋转并清除平移速度，本帧不积分位置，计数只增加一次
  条件中断、断流、暂停、标定或手动清速度 -> 清RotationOnlySince
  仅旋转与既有静稳ZUPT共享零速生效状态；恢复明显线性运动后继续积分
  手机、APK及kind=linear -> 不执行模拟器重力反馈或仅旋转零速规则
  所有判定只读六轴样本与估计状态，不读取模拟位置、姿态真值或拖动状态
```

```text
复测 -> 固定种子默认噪声纯旋转30秒的位置误差从旧版约99.6米降至0米，零速修正仅计一次
复测 -> 默认噪声组合运动8秒不触发仅旋转零速；手机无自动归零
复测 -> 0.04弧度初始倾斜且机体系力模长为标准重力 -> 窗口评分恢复、速度归零、倾斜恢复
复测 -> 默认噪声纯旋转的浏览器实时轨迹接口误差小于0.05米；浏览器拖动、六轴算法与房间专项共23项通过
现场 -> 旧网页需刷新并重置位置；已有漂移轨迹不回溯修复
限制 -> 匀速平移同时旋转与原地旋转在六轴上无法严格区分，可能误清平移速度
```

## APK 观察模式六轴静稳与平台读数移除（2026-10-17）

修复前水平速度排查所见数据流（历史记录，后文的新批次流程已取代）：

```text
Android陀螺仪事件 -> 取最新含重力加速度；两路时间差超过100ms则丢弃
Android样本 -> WebView保留最新待发样本 -> WebSocket约25Hz发送
服务端sensor.sample -> 电脑source=remote的ImuEngine积分
电脑APK观察页以viewer身份连接且不发布imu.frame -> 服务端只有原始样本，没有处理后水平速度轨迹
```

本次竖直上举/下放样本的只读回放（记录现象，不新增处理分支）：

```text
最近120条原始样本 -> 从静置起点新建source=remote估计器并顺序推送
静置窗口 -> 水平速度归零
末段快速动作 -> 姿态变化约57度；末帧水平速度约1.44m/s
末帧仍在转动且APK随后断开 -> 没有后续静稳窗口，不能观察零速修正
关闭世界加速度滤波或加速度死区重放 -> 水平速度仍约1.44m/s
旧APK只保留最新待处理与待发送样本 -> 该段到达服务器的源时间间隔约40/80ms交替，实际约16.5Hz
此项仅记录修复前流程；新批次与轨迹上报见后文伪代码
```

```text
已有声明
  原生APK -> SensorManager陀螺仪与含重力加速度 -> 固定房间AASCIMU1
  ImuEngine.push -> 用含重力加速度和姿态求世界线性加速度并积分
  RoomClient.onSample -> 电脑source=remote的估计器；手机浏览器走独立source=phone

新增定义
  remoteAutoRest := 仅电脑APK观察模式启用的六轴静稳修正标记，其他输入默认关闭
  RemoteRestWindow := 最近0.8秒且最多80点的校正前角速度与机体系含重力加速度
  LocalGravityMagnitude := 最近可靠静稳窗口的平均含重力加速度模长，默认9.80665m/s²
  RemoteRestCandidateSince := 六轴静稳条件连续成立的起点

操作流程
  Android只注册TYPE_GYROSCOPE和TYPE_ACCELEROMETER -> 样本只含time/gyro/accel/kind
  APK本地页和电脑页移除平台线性加速度输出；浏览器不再附带单独linearAccel值
  服务端接收旧APK的多余linearAccel -> 忽略而不广播/存储；旧frame的platformLinear同样忽略
  source=remote连接或设备更换 -> 新ImuEngine启用remoteAutoRest，保留电脑网页手动清零按钮
  每个remote含重力样本 -> 将扣除已有偏置/比例的机体系力和死区前角速度加入RemoteRestWindow
  窗口达到12点和0.5秒 -> 计算角速度均方根、加速度向量波动、平均力模长
  均方根角速度<0.015rad/s 且 加速度向量波动<0.08m/s²
    且 平均力模长处于9.0..10.4m/s² -> RemoteRestCandidateSince连续计时
  静稳连续0.7秒 -> LocalGravityMagnitude更新为窗口平均力模长
    -> 用平均机体系力对齐估计姿态的俯仰/横滚 -> 清除速度、冻结当前帧位置、计数只增加一次
  持续静稳 -> 维持零速度及位置；样本明显运动或类型/时间断流 -> 清窗口和候选计时
  继续运动 -> 用LocalGravityMagnitude从世界系含重力加速度中去重力，再做既有滤波/积分
  仅手机浏览器或非APK源 -> 使用原有标准重力和默认手动清零，不做remote自动修正
  规则不使用平台线性加速度、模拟真值、外部位置或拖动状态
```

```text
保存的真实APK样本 -> 静置约3.6秒平均加速度模长约9.685m/s²，旧引擎Y位移约-0.80米
复测 -> 同批样本处理后静置段Y位移明显收敛，后续静止时速度归零
兼容 -> 老APK多余字段被服务端忽略；新APK可继续接入同一固定房间
限制 -> 六轴不能区分匀速平移和真静止，remoteAutoRest可能误清匀速；移动中的绝对位置仍会漂移
```

## APK 连续六轴批量传输与观察轨迹（2026-10-17）

```text
已有声明
  Android SensorEvent.timestamp -> 硬件测量时刻，陀螺仪/加速度计共用时间基准
  NativeImuSample -> time、gyro、accel、kind；ImuEngine.push按time积分
  固定房间AASCIMU1 -> sensor设备上传、source设备发布估计位姿
  /api/imu/samples -> 进程内500条原始样本环形缓冲

新增定义
  GyroQueue := 最多128条带硬件时间戳的陀螺仪事件
  AccelQueue := 最多16条带硬件时间戳的加速度事件
  PairedSample := 在陀螺仪时间戳上用前后加速度事件线性插值得到的同刻六轴
  NativePending := 最多128条有序PairedSample；溢出时首条存活样本标记gap
  WebPending := 最多128条有序PairedSample；溢出时首条存活样本标记gap
  ImuSamplesMessage := 每次1..8条有序样本的单个WebSocket消息

操作流程
  Android收到陀螺仪/加速度计事件 -> 分别记录原始硬件时间戳和值
  有陀螺仪时间落在相邻两条加速度事件之间 -> 插值加速度到陀螺仪时间
    -> 生成PairedSample，含time/gyro/accel/kind与两路实际测量时间
  缺少前后加速度或跨度过大 -> 暂候后续事件或丢弃并标记gap，不复用过期加速度
  原生队列正常时保留每条PairedSample -> WebView一次接收至多8条的有序小批次
  WebView发送队列正常时保留每条PairedSample -> 每约20ms发送至多8条
  队列或WebSocket拥塞且超过有界容量 -> 丢弃旧样本，把首条存活样本标记gap
  服务器对整个imu.samples消息检查会话、顺序、批大小、每条数值和递增源时间
    -> 原子接受或拒绝整个批次 -> 逐条写原始环形缓冲，向房间广播sensor.samples
  旧APK的imu.sample仍按原协议接受；浏览器同时理解sensor.sample与sensor.samples
  电脑source=remote用source身份加入房间 -> 按广播批次的源时间逐条推送ImuEngine
  sample.gap为真 -> 估计器先按断流重置速度与滤波，再从该样本时间重新开始
  电脑每约20ms发布本地估计位姿及可见估计轨迹增量 -> 现有trajectory接口可查询
  samples接口单次查询上限提高至500，与进程内环形容量一致；仅loopback可读

兼容与限制
  普通网页手机/模拟器不启用原生样本批量发送，但可继续使用旧单样本流程
  新批量消息的单帧上限有界；旧APK的单样本与无时间元数据字段继续接入
  六轴无法保证任意动作的绝对水平速度；此方案只减少中间样本丢失和时间配对误差
```

## 手持死区无上限与50Hz链路（2026-10-17，已实现）

```text
已有声明
  DeadzoneWindow -> 3秒连续六轴样本、至少60点；阈值用99分位与均值+3倍标准差取较大值
  GyroDeadZone/AccelDeadZone -> 作用于角速度与去重力世界加速度的向量模长
  NativeSensorListener -> 陀螺仪和加速度计带硬件测量时间
  imu.samples/imu.frame -> 传感器批次与电脑估计帧的房间消息

新增定义
  UnboundedDeadzoneValue := 非负且有限的数值；显示和手动输入没有固定上限
  SensorTargetPeriod := 20ms；实际硬件采样间隔单独观测
  MessageTargetPeriod := 20ms；APK批次与电脑估计帧各自独立调度
  MessageRateBudget := 每连接平均50条/秒，允许有界短时突发以吸收定时抖动

实现流程
  死区校准窗口收到有效样本 -> 只因断流、时间无效或输入类型变化重采
  满3秒且不少于60点 -> 先用平均力方向形成候选倾斜，再统计两种未截断阈值
  两个阈值均为非负有限值 -> 原子应用姿态与阈值 -> 数值输入显示实际值
  阈值偏高 -> 提示可能忽略真实慢动作；用户可手动减小或重采
  Android登记两路传感器 -> 请求20ms周期 -> 继续使用硬件时间配对，不伪造50Hz样本
  APK待发队列 -> 每20ms发送一个有界批次；拥塞时继续保持队列和gap语义
  电脑观察端 -> 每20ms发布最新估计帧，不依赖屏幕刷新回调达到50Hz
  电脑发布帧没有新增可见轨迹点 -> 仍显式发送空轨迹增量，服务端不补画浏览器未显示的点
  服务端接收每条消息 -> 按每连接令牌预算检查平均50条/秒 -> 接受正常短时抖动
  状态/轨迹诊断 -> 用实际收到的源时间与消息时间核对采样率和消息率
```
