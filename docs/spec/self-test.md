# 自测功能实现文档

## 六轴IMU网页定向自测（2026-10-03）

```text
npm test:imu:six-axis-test -> 三个测试文件，11项
  固定理想生成器 -> 三类运动14秒 -> 位置<1e-7m，姿态<1e-6rad，四元数归一
  匀速与线性数据 -> 不误清速度/不重复去重力；显式停稳记录
  静置与六面偏置比例 -> 恢复校准，移动窗口拒绝；固定种子噪声对照保留残余
  null/重复/回退/长gap -> 拒绝或冻结，不跨空白积分
  航向重置 -> 抵消水平角、保留倾斜；pause -> 发布最后有效测量时间
  浏览器beta/gamma/alpha -> x/y/z，横竖屏不重复变换
  跟随相机 -> 相对距离方向不变，target=设备位置
  实际WS双源与观察者 -> 所有权/代次/seq、晚加入快照、断线状态
  实际Chromium指针 -> 箭头/圆环拖拽、独立视口、移动后摄像机跟随
  关闭模拟输出后拖右侧 -> 真值变化，左位置/姿态冻结
  第二浏览器手机页面 -> 隐藏模拟器、事件输入共用引擎、同房间结果
Android另行真实采集 -> localhost可信上下文，208样本/约60Hz，静置校准成功，70观察帧
实际距离精度/iOS/手机六面及长期性能 -> 现场待测，不用事件注入冒充真机
```

## TMP14顶点布料检查范围（2026-10-02）

```pseudo
本轮 := 用户未要求测试，不新增或运行自动测试/模拟；只执行现有网页构建及静态检查
静态 := 7源/8生成/4内联语法；27本地导入、22SHA256内容指纹
    6控件唯一；Ammo/XPBD/TMP14三选项；子步3..180/default45；3模块源生成一致
人工 := 自动物理权重组及逐组开关、直接固定根部/静态接缝、自由末端
    源几何/相对morph/反向蒙皮、共享骨骼与原Ammo、代理碰撞掩码/风/AR缩放
    UV接缝/双面层/材质/表情/透明/阴影/AO、暂停/恢复/模型/VMD/失败清理
    低子步穿透、45子步手机耗时、几何morph克隆内存；首版无自碰撞
状态 := 静态通过，本地web-dist同步；实际效果与性能未验收，todo保留人工项
```
## MMD AR阴影像素对齐及跟随自测（2026-10-02）

```text
真实注入fit -> 默认倍率1、自动半幅=原0.5；四倍率往返不累乘
真实Three双光矩阵 -> 各实际尺寸512/1024/2048/4096，宽高不同也各自取步长
    世界原点投影整像素；宽高/近远裁面/光向不变；中心补偿<=半个像素
    重复10次不漂移；连续100帧每帧0.15像素位移 -> 网格最终跟随约15像素
    Three再次updateMatrices -> 对齐保持，不依赖被覆写的camera.position
真实注入跟随 -> 纯平移同步灯位/目标/承接面，静止与平移不再获取Box3
    缩放/复位比例/换根 -> 按新角色拟合；无根 -> 清缓存
真实PMX浏览器 -> 检查四档整像素、倍率宽高及覆盖变化
    translateModelByPixels -> 移动中跟随，资源数/拟合次数保持
    setArPose改变位置/比例 -> 拟合；resetArPose -> 位置/比例/范围恢复
    保存/刷新/复位 -> 默认倍率仍1、资源回收
结果 := 十项单元、真实PMX浏览器（约347秒）、两项面板静态检查通过
    构建及40脚本/4内联/28指纹通过
手机阴影观感/裁切/长时间性能 := 待现场验收
```

## MMD AR阴影相机范围倍率自测（2026-10-01）

```text
倍率规范化 -> 0.1–2、步长0.01；非法/旧偏好缺字段 -> 1
抽取实际生成fitShadowCamera -> 执行0.1/0.5/2/0.5/1/1
    两灯right/top := 初始半幅 * 倍率；left/bottom反号
    投影矩阵X := 初始值 / 倍率；往返不累乘；near/far仍来自原自动拟合
真实网页 -> 等模型实际绘制稳定后统计GPU资源
    设置倍率 -> 等待当前ShadowMap读回 -> 检查范围/贴图尺寸与资源数
    比较2与0.5覆盖估算 -> 缩小范围应增加角色覆盖
    0.1极小范围 -> 可裁切；重新1/0.5 -> 范围还原不累乘
    灯光重新拟合/刷新 -> 当前倍率保留；复位 -> 1
HTTP夹具 -> CSS响应text/css，加载真实面板布局；超时输出范围/可见性诊断
八项定向自测、真实网页回归与两项面板静态检查通过；手机观感待验收
```

## MMD AR骨骼球遮挡轴与零K（2026-10-01，静态完成）

```text
源码/Three实际渲染代码 -> opaque在transparent之前；跨队列renderOrder不足
静态修复检查 -> 关节/原选中轴transparent=true、opacity1，RGB99/关节100/实际101
构建 -> npm网页退出0，6源/5生成/4内联语法、19导入/16指纹、3源生成一致
只读PMX统计 -> 米娅261关节，平移783个K全0、旋转783个K全0；零K灰符合数据
本轮运行测试/模拟 -> 无；不以静态队列推导替代真机图像验收
人工待验收 -> 球间遮挡开关和遮挡透明度0/50/100%；轴在球后且完全不透明
    K轴球尺度、仅归属关节筛选保持，零K灰与白/红实际标记可辨认
```


## MMD AR阴影尺寸及ShadowMap预览自测（2026-10-01）

```text
共享尺寸规范化 -> 四档/非法值/设备上限 -> 合法实际尺寸
旧map与mapPass相同 -> 去重释放；重复销毁 -> 不再释放
预览GPU掩码/灰度 -> Y翻转 -> 灰度输出与占用比例独立正确
禁用/折叠/屏幕外 -> 零读回零新目标；启用 -> 单目标复用且250ms节流
诊断绘制异常 -> finally恢复原目标/视口/剪裁/自动清除/阴影启用
真实网页加载PMX -> await关闭物理的模型重载 -> 开启两灯阴影
逐档512/1024/2048/4096 -> 检查真实map宽高及贴图数量不累积
开启预览 -> 角色与空白同时存在、宽高/覆盖说明、仅增加1个目标
复用/关闭 -> 提示与旧图清除；折叠 -> 读回计数不变
关闭预览 -> 目标回收；保存2048/刷新 -> 恢复；复位 -> 1024/关闭预览
结果：尺寸6项、真实网页1项、相关面板4项通过
```

## MMD AR关节六K轴图形（2026-10-01，仅静态完成）

```text
构建 := npm run build:web:mmd-ar-test -> 本地web-dist生成成功
静态 := 诊断/骨骼/面板/注入/构建源码及生成脚本、内联脚本语法通过
    新3控件唯一且位于骨骼分组；本地导入和内容指纹正确；3源生成一致
    新模块无Canvas/fillText，独立scene两个LineSegments，runtime/Display两API保持
本轮运行测试/物理模拟 := 未请求，未新增/执行
人工待验收 := XYZ箭头/旋转弧及原RGB选中轴同球尺度、六K色阶、图形限位/锁定/自由
    单开关/归属过滤不显示下一节、反向A/B、无亲缘第二端归属
    Ammo/XPBD位移/角度白标，越界/超范围红标，无物理未模拟，面板缓存值
    非零/反向/全圈限位、模型缩放旋转、刷新/模型/VMD重建、关闭清理与手机性能
结论 := 构建/静态通过，真实画面/姿态精度待现场
```


## MMD AR风力上限30（2026-10-01）

```text
已有声明 -> 14项真实Ammo风场夹具、共享规范化、经典Display/面板、真实米娅
明确边界 -> 3保持3；30保持30；31/999截断30；缺失/空白/非法回退0.3
自由体 -> 强度0.3与30分别跨Hz/FPS连续模拟1秒 -> 速度符合缓动后的施力积分
受控type2 -> 强度30、阵风100 -> 位置约束保留，极小惯量风矩有限；零偏移不制造风矩
本地存储 -> 风启用且强度30 -> 执行面板初始化 -> 值30/读数/Display一致
真实米娅 -> 90/180Hz × 风开关 × 强度30模拟2秒 -> 姿态有限、风响应可观察、native全部释放
构建 -> npm run build:web:mmd-ar-test -> 滑条max30与共享模块/经典副本指纹一致
LAN检查 -> 默认0.3 -> 手动30 -> 实际物理30 -> API31截断30 -> 刷新恢复30
结果 -> 14项自测及35脚本/4内联/21指纹通过；LAN控件/物理值30、API31截断和刷新30恢复通过
```


## MMD AR物理风场（2026-10-01）

```text
已有声明 -> 真实THREE/Ammo/MMDLoader/MMDParser，稳定性/子步/生命周期/动作/面板夹具
风夹具 -> 同构造补丁注入MMDPhysics；经典Display及面板执行真实归一化声明
参数 -> 缺失/空白/非法/边界/步长；来向经纬度6基轴、极点、±180一致
时间 -> 0.3秒指数缓动步内均值；30/90/180Hz同秒积分；阵风按模拟秒，暂停不进相位
真实自由体 -> 30/90/180Hz × 30/60/144画面FPS一秒风速度近似一致；关闭保留速度
坐标 -> 非单位缩放与0/±90°旋转枢轴，物理速度转回场景后保持外部来向
受控type2 -> 骨骼局部位置/线性因子保留；风矩旋转，极小惯量受限，零力臂无转矩
回收 -> 施力抛错后继续模拟池稳定；64次开风创建/销毁native对象归零
runtime -> 新实例首次帧前补发；同实例无变更跳过；纯JS弱引用缓存
真实米娅 -> 90/180Hz各模拟2秒，风关/开姿态有限并有差异，全部销毁
稳定性回归 -> 风补丁类运行16项原旋转/type2/纠错测试；蝴蝶结固定刚体不自旋
LAN -> 默认风关 -> 0.5/45/30/50 -> VMD切换新物理继承 -> 刷新保留 -> 关闭 -> 损坏偏好默认
结果 -> 58项通过，35脚本/4内联/21指纹与网页构建通过，手机风效果/CPU待验收
```


## MMD AR默认纠错45Hz与物理90Hz（2026-10-01）

```text
已有声明 -> 物理频率/稳定性/子步/生命周期/动作/面板测试及真实THREE/Ammo
输入 -> 缺失、null、空白、NaN、Infinity、保存65/180、纠错130
共享参数 -> 缺省90Hz/10步/参考45，合法保存值规范化后保持
生成Display接口 -> 无runtime时也按共享规则归一纠错，空白回退45
真实构造 -> 不传步长默认1/90；六轴ERP=1-0.525^(45/90)
回归 -> 骨骼父逆乘刚体世界旋转；type2位置；子步锚点；清速度切换与资源回收
LAN浏览器 -> 新上下文90/45 -> 手动180/130 -> 刷新保持 -> 非法90/45 -> 物理复位90
每次状态 -> 捕获真实物理实例unitStep/referenceHz与6轴ERP，核对控件；页面异常为空
构建 -> npm run build:web:mmd-ar-test -> 34脚本/4内联/19相对指纹通过
结果 -> 51项唯一测试通过（面板夹具同步后复验）；手机实际观感待验收
```


## MMD AR原生预览竖屏方向（2026-10-01，几何自测已通过）

```text
已有声明 -> CameraPreviewGeometry生产实现、JUnit4、现有Android Gradle工程
新增自测 -> app/src/test/java/com/aasc/mmdartest/CameraPreviewGeometryTest.kt
操作流程
  竖屏sensor90/display0 -> 默认TextureView已旋转的横向边仍向下 -> 只做比例补偿，无额外90度
  sensor四方向 × display四方向 × 窗口四比例 -> 64组合
    原始中心映射窗口中心 -> X/Y像素长度一致且正交 -> 四角覆盖窗口并居中
  非中心主点及不等fx/fy -> 四个像素 × 三个深度 × 64组合 = 768条射线
    反推GL相机点 -> 生产投影 -> 还原窗口像素 -> 与相机预览像素一致
  三对应角独立求显示仿射 -> 验证第四角与内部点 -> TextureView补偿与原始帧显示一致
  180度同尺寸变化 -> 几何不同，像素绕窗口中心反转，投影X/Y行反转
  深度近远端 -> NDC -1/+1；非法尺寸/方向/内参/裁剪范围 -> 拒绝
验证 -> Gradle testDebugUnitTest 6项通过，0失败/跳过；两端控件/原生模拟分流2项Node回归通过
真机 -> 修正版APK构建及覆盖安装SM-N9500完成
  真实采集640×480；同进程窗口720×1480/display0 -> 1480×720/display90 -> 720×1480/display0
  预览持续显示，布局及显示旋转更新几何，未因尺寸变化停止定位
  APK方向unspecified；测试后恢复系统自动旋转1/user_rotation0；180度仅数值验证
```

## MMD AR后蝴蝶结末端旋转回写（2026-10-01，已实现并验证）

```text
稳定性tests/mmd-ar-physics-stability.test.js -> 新增5项，与原9项合计14项通过
  合成type1/type2 -> 不同轴父子大角度、刚体偏移、256次回写 -> 世界旋转等于明确目标
    旧回写平均角误差2.053154rad/角增量2.030531rad；修复角增量0
  每帧恢复动作局部姿态/改变模型和父级旋转 -> 当帧物理世界目标一致
  非单位模型缩放/旋转及外层Group -> 真实物理帧世界旋转正确、type2局部位置保持
  父级读取异常 -> 全部池对象归还；连续1300次 -> native稳定且角速度保持
  真实米娅刚体120/127 -> 1200次固定回写，末300次骨骼角增量0
    原回写两目标平均角增量右122.522767度/左118.519752度
    从绑定姿态reset -> 180Hz、60FPS、20秒 -> 两目标回写误差不大于0.000003度
    骨骼转角等于物理目标转角，分别记录角速度RMS，不以平滑掩盖残余物理扰动
  唯一/缺失/互换边界 -> 构建适配失败；固定vendor未改
原回归 -> 频率4/子步6/生命周期6/动作切换8/骨骼8/点选10/碰撞体9，共51项通过
总计 -> 65项；边界互换夹具修正后针对入口用例复测通过
构建 -> npm run build:web:mmd-ar-test；33脚本（含物理vendor2）/4内联/19相对导入指纹通过
LAN网页 -> 180Hz播放12/暂停12/恢复13帧，共37帧，两目标最大世界误差4.214685e-8rad
  骨骼4实例组、无页面错误；实际物理URL内容指纹f3d9add20d67
```

## MMD AR网页全功能同步APK与灯光修复（2026-10-01，已验证）

```text
已有声明 -> 网页/APK生成目录、真实米娅PMX/VMD、Chromium、已连接SM-N9500
新增自测 -> tests/mmd-ar-apk-parity.test.js
  两端ID集合 -> APK剔除5个原生控件 -> 与网页一致；所有ID唯一；共用模块摘要相同
  系统目录回调 -> 相对路径File内容正确；重复/旧消息忽略；取消保留；异常/退出释放令牌
  可用原生能力 + 模拟输入 -> MindAR；真实输入 -> 释放预览 -> SLAM -> 幂等停止并恢复预览
  实际APK页面 -> 加载内置模型 -> 展开灯光并切主光阴影 -> 动作骨骼 -> 目录选择真实PMX
    等待resourceId为local且加载完成 -> 选择本地VMD -> motionResourceId为local -> 定位展开
    官方定位图HTTP200 -> 页面错误为空；允许无关favicon404
  超时诊断 -> 输出profile、文件选择状态、页面错误与缺失资源，不吞掉加载失败
本地文件单测 -> 注册表只接受确切File/扩展名；拒绝未选及已释放路径
验证 -> APK4 + 本地文件2 + 相机动作2 + 进度/分类/频率/动作切换24 = 32项通过
构建 -> npm两端脚本通过；各31脚本/4内联/18导入指纹；APK76网页文件/14模型文件/原生资源校验
真机 -> 覆盖安装成功；三面板展开/收起日志；回环官方图200且大小/摘要一致
现场待验收 -> 系统目录/标定、原生地图精度/回环及长时间帧率/内存
```

## MMD AR骨骼大小、名称、点选与碰撞累计（2026-10-01，已实现并验证）

```text
selection模块10项 -> 真Three、可观察Canvas与真Ammo
  倍率默认/端点/无效值/真实实例半径，骨骼与物理参数不变
  中文固定字号、唯一Canvas、DPR/尺寸变化、空名及相机/屏幕裁剪
  关闭/隐藏即清屏，关闭无额外名称绘制；换模型/幂等销毁释放轴与Canvas
  点选/空白/等距前方优先，多绑定/无绑定骨骼与局部轴父级变换
  刚体过滤压缩有效count，空集合隐藏，不重建资源，取消恢复全量
  真Ammo每子步累计直接对手，不递归链；1000+次读取不改速度/native对象数，4MiB探针复用
  跨子步短暂接触保留；读取异常不打断物理；重建/取消清除回调与累计
  偏好损坏/受限、范围钳制、面板状态与清空按钮
原有骨骼8/刚体9/子步6/切换8/生命周期6/稳定性9 -> 与selection10合计56项通过
面板回归 -> 控件ID和分组、大小范围、开关默认关闭、原交互/滚动保留
真实网页 -> 大小端点/名称/高亮/三轴/实际轻点/拖动/CDP真实双指/取消恢复全量
  刷新恢复设置；PMX切换清选择，VMD保留选择且物理替换清累计；Canvas数量稳定
构建 -> npm run build:web:mmd-ar-test；31生成脚本/4内联语法/16导入指纹/LAN HTTP200通过
当前状态 -> 面板8项与最终真实网页1项通过，总计65项；手机密集名称可读性/触摸命中/帧耗时待现场验收
```

## MMD AR PMX碰撞体显示（2026-10-01，已实现并验证）

```text
模块自测 -> 真Three几何和世界变换
  球半径/盒半边长到完整尺寸/胶囊Y轴与端帽比例，红0/黄2/绿1
  读取Ammo实际COM位置/旋转，故意与骨骼分离 -> 线框跟随物理结果
  无物理 -> 骨骼偏移配置预览；无骨骼仍显示；非法数据安全跳过
  模型/父级平移旋转及非单位缩放 -> 物理到显示坐标无重复变换
  开关独立/默认关闭/偏好异常；首帧隐藏与关闭时无逐体更新
  动作/物理重载 -> 新physics对象生效；不访问已销毁的旧Ammo引用
  native姿态读取 -> 池对象归还，无持续增长；不写入速度/约束
  几何复用/实例化/重复模型替换/幂等释放/绘制异常恢复
真实网页 -> 同时开启骨骼与碰撞体、动作暂停/播放、物理关/开、换PMX/VMD、刷新
  分类/姿态/状态说明正确，无页面异常，资源数量不持续增长
  记录实际刚体数量、实例组数量和开启的帧耗时，手机观感另验收
npm网页构建 -> 生成语法/模块指纹/LAN页面资源核对
当前状态 -> 碰撞体9项/骨骼8项/面板8项/动作切换与生命周期14项/浏览器1项，共40项通过
  真实Ammo -> 1000帧读取，无native数量增长，4MiB探针复用，堆64MiB
  默认PMX形状 -> 134盒/49胶囊，无球体；球体由模块Three/真实Ammo用例覆盖
  网页构建成功，30脚本/4内联语法/16导入指纹/LAN HTTP200通过
  浏览器225秒 -> 183体、33实例组/31几何，累计释放132旧组，无页面异常
  AO/骨骼独立开关/物理实际及预览/两次PMX/VMD/刷新恢复通过
  SwiftShader连续8帧 -> 骨骼开启基线877.89ms/帧，碰撞体开启923.57ms/帧
    软件渲染短窗口不代表手机性能；密集部位观感另验收
```

## MMD AR 骨骼物理状态球（2026-09-30，已实现并验证）

```text
真实Three模块自测 -> 输入已加载刚体元数据与骨骼
  断言红type0、黄type2、绿type1，无关联灰，非法索引忽略
  断言同骨骼type1优先type2优先type0，采用加载后type转换结果
  更新骨骼/父级变换 -> 小球位置等于骨骼世界位置，球大小跟随模型缩放
  关闭/角色首帧隐藏 -> 无实例更新与overlay绘制
  overlay绘制失败 -> renderer状态恢复；骨骼/物理状态不被写入
  换模型/重复销毁 -> 旧实例/几何/材质释放且无残留骨骼引用
面板自测 -> 开关在动作面板、默认关闭、图例映射正确、偏好恢复与转发
真实网页自测 -> 默认PMX开关/动作/物理暂停/恢复、刷新、再次选择PMX
  检查分类与位置、T Pose首帧门控、无页面异常、资源数量不持续增长
现有npm网页构建 -> 生成模块语法及内容指纹校验
当前状态 -> 模块8项/面板8项/切换和生命周期14项/真实网页1项，共31项通过
  软件WebGL真实网页 -> 321骨骼/4实例组；5代模型/旧16组释放；VMD复用球资源
  开关/刷新/AO/两次PMX切换通过，截图确认；构建/语法/指纹/LAN HTTP200通过
  首帧尚隐藏 -> 测试等待真实显示帧再比较资源，避免把未分配状态当泄漏
  性能采样 -> SwiftShader连续8帧，关闭732.16ms/帧，开启778.13ms/帧
    属于软件渲染环境及短窗口，不代表手机性能；真机密集位置观感待验收
```

## MMD AR ORB-SLAM3迁移评估（2026-09-30，尚未实现）

```text
本轮: 只核对源链路与官方资料，未新增/运行测试、构建或实际SLAM
后续实现需验收:
  纯网页无接口/MindAR保持；桥存在但available=false或版本错误仍回退
  APK原生可用才启动，失锁不误切MindAR；启动失败先释放输入再回退
  会话代次拦截迟到回包；两后端不争用相机；原生预览与WebView投影一致
  相机/IMU采集时间基准、校准/尺度初始化、真机三维平移与旋转
  世界相机转换/投影/背景裁切，保留动作/Ammo/手动变换/第二层缓动
  不重复旧IMU积分；失锁/重定位/回环/新地图时锚点处理
  停止/后台恢复/线程释放、手机CPU/帧率/发热/内存
  单图透视模拟仅验证桥接，不能证明空间SLAM稳定性
```

## TTS 内存音频下发与 Node 标准输入播放（2026-09-30）

```text
本轮仅静态检查，不新增或运行测试:
  tts-service/cache/cache-config/http、config-app-service、server-app、Node audio-player
  控制端tts.js/websocket.js -> node --check通过
  定向差异空白检查通过；两处服务端生成与Node URL/Buffer路径无写文件入口
待现场验收:
  默认128MiB、16..1024边界/非法值规范化、容量热应用与持久化失败保留旧值
  Android禁用外部TTS时也恢复显示端回传音频缓存容量
  多控制端广播/断线重连/服务器重启恢复，10秒无回包解除等待
  降额不驱逐有效音频，超额拒绝新增，过期后恢复；升额立即放行
  外部/显示端生成成功及fallback，API/普通/Agent/文本媒体/语音/提醒/报时
  完整GET/HEAD、首尾/后缀/无效Range、重复/多端读取、过期/重启404
  单段/总量/条数超限、异常base64、上游错误/超时/中断不发布半成品
  Windows/Linux：没有新增临时WAV，有正常声音、队列/停止/新句不被旧结束覆盖
  录音暂停后停止恢复，16位PCM额外RIFF块/立体声的AEC回调只执行一次
  旧WAV汇总清理且清理完成后不再磁盘扫描，其他文件/符号链接保留
```

## MMD AR Ammo固定子步锚点与180Hz（2026-09-30，已验证）

```text
已有声明: 真实Three/固定Ammo WASM、WEB_MODE构建补丁、native生命周期与本地资源浏览器压力
新增定义: AnchorTrace { substepTime, position, quaternion, linearVelocity, angularVelocity }
操作流程:
  60FPS/180Hz -> 单帧位置和旋转目标 -> 实际三个单步及其MotionState目标等比例推进
  60/90/120/144FPS -> 固定步余量跨帧 -> 单位时间模拟步数与速度一致
  120FPS/65Hz -> 无子步帧不强制推进；动态速度不清零
  复位/步频改变/后台恢复 -> 同步姿态历史与时钟，无跨旧状态插值
  预算超限 -> 余量不足一步，无无限补算；异常 -> 临时资源归还
  真实关节 -> 锚点带动动态刚体；native循环释放 -> 计数归零
  180Hz网页 -> 模型/动作切换首帧物理、下一帧动作与内存有界
  旧480保存值 -> 页面与实际物理参数限制180，实时调65不重建
验证结果:
  tests/mmd-ar-physics-substeps.test.js -> 6项真实子步/关节/历史/边界测试通过
  同步rate/lifecycle/motion-switch夹具 -> 与构建一致的完整物理补丁链
  定向74项 + 本地资源浏览器3项 -> 77项通过
  64轮锚点关节 / 128轮生命周期 -> native分配清空、4MiB探针地址复用
  浏览器约563秒、24次VMD/4次PMX -> 创建32/释放31/存活1、64MiB、391064字节跨度
  旧480设置恢复180、实时65不重建、首两帧动作门控 -> 通过
  npm网页构建 / 10脚本与4内联语法 / 11导入指纹关系 -> 通过
待现场:
  手机实际CPU、帧率和布料抖动改善程度，不以自动化关节测试代替视觉验收
```

## MMD AR 布料480Hz（2026-09-30，历史验证记录）

```text
已有声明: 网页专用频率适配、固定Three/Ammo、Node测试及本地资源Chromium压力用例
新增定义: RateCases、真实动态刚体位移、BrowserRate { input, persisted, unitStep, maxStepNum }
操作流程:
  规范化边界/默认/非法值 -> 30到480，5Hz步长，65默认；低频3子步、高频0.1秒预算
  固定源码经网页补丁 -> 实际helper创建480Hz物理 -> 与正式90Hz限幅对照
  480Hz刚体恒速运动一秒，输入帧率60/30/10 -> 位移接近一米，无时间截断
  同步修改现有实例预算回65 -> 仍为原实例，不归零速度
  网页滑条默认65、范围30到480 -> 设置480 -> 控件/API/存储/物理参数一致
  真实24次VMD与4次PMX切换 -> 参数保持480，首帧门控与native回收继续验证
  实时调65 -> 当前物理使用3子步，实例未重建；再设480并刷新 -> 恢复480
  既有灯光AO夹具 -> 补齐正式页面已有主光阴影控件，避免全控件初始化提前返回
  既有面板夹具 -> 同步现有过滤/IMU/重力控件与分类名称，默认不透明度50%
结果:
  定向回归57/57；面板/资源10项最终覆盖通过（旧夹具修正后定向复测3/3）
  本地资源浏览器3/3，480Hz压力阶段24次动作与4次模型切换，耗时约589秒
  物理创建32、销毁31、存活1；堆67108864字节、探针跨度3516552字节，无页面异常/OOM
  构建通过；9个源/生成脚本、4个内联脚本语法及6个导入指纹通过
待验收:
  发布后手机480Hz帧率、CPU负荷、布料观感与不同模型兼容性
```

## MMD AR 重力缓动默认20ms（2026-09-30）

```text
本轮构建和静态检查，未执行测试:
  默认过滤/模型/控件状态 -> smoothingMs=20，生成滑条/读数=20ms
  npm run build:web:mmd-ar-test -> 成功，源/生成脚本语法通过
待现场验收:
  无已保存用户设置 -> 默认20ms；已有参数 -> 恢复原值
  0关闭缓动、手动旋转叠加/居中、手机跟随观感
```

## MMD AR 重力摄像头背景与默认外观（2026-09-30）

```text
本轮仅构建和静态检查，不新增或执行自动测试:
  npm run build:web:mmd-ar-test -> 成功生成web-dist
  构建/分组/重力注入/背景模块/跟踪源及生成AR脚本 -> node --check通过
  生成页面复查 -> 三个面板默认50%，开关默认关闭，顶部固定提示DOM已移除
待真机验收（未执行）:
  重力开启 -> 勾选背景 -> 授权成功显示，手动/重力叠加继续
  背景关闭/重力关闭/后台/离开 -> 独立轨道停止，迟到授权轨道停止
  图片定位 + 背景关闭 -> 只隐藏视频，目标识别/蓝框继续
  校准 -> 独立流释放，校准预览显示，关闭后按选择恢复
  快速开关/授权拒绝/前后台/横竖屏/真实及模拟输入切换 -> 无重复占用
  无已保存不透明度 -> 三个面板50%，调节并刷新 -> 恢复手动值
```

## MMD AR Ammo 生命周期压力验证（2026-09-30）

```text
已有声明:
  网页vendor生命周期补丁、固定Three.js/Ammo、Node test runner、Chromium本地资源用例
新增定义:
  NativeFixture { livingPointers, createEvents, destroyEvents, memoryProbes, ownedWorld, borrowedWorld }
  BrowserPhysicsLifetime { activeInstances, createdCount, disposedCount, errors }
操作流程:
  固定物理/动画源码 -> 与构建相同补丁 -> 实际Ammo，观测new与destroy对应native指针
  128轮创建三种形状刚体/约束 -> 物理步进 -> helper.remove -> 存活指针回到0
  每轮4MiB申请/释放 -> 预热后地址稳定复用 -> 64MiB堆不增长
  约束先移除 -> 刚体移除 -> 逆创建销毁，重复dispose不再destroy
  借用world -> 只销毁借用实例的自建对象 -> 所有者world仍可步进
  第二刚体/约束/构造失败、helper物理创建后IK失败 -> 暂存分配为0，网格父级/变换恢复
  新动作已初始化后回滚/失败 -> 旧物理仍存活，新分配消失
  成功移除旧helper -> 绑定姿态骨骼不被旧mixer复位 -> 新物理可步进，最终释放为0
  真实网页 -> importmap同一指纹helper -> 只观测存活物理，不保留历史模型引用
  24次原生VMD文件选择 + 每6次一次PMX/贴图选择共4次模型切换
  每轮 -> 当前仅1实例且创建数减销毁数等于1 -> 被销毁manager拥有对象为0
  每轮4MiB探针 -> 预热后的地址跨度小于8MiB，不要求地址逐次相同
  每轮当前仅1实例、已销毁native为0 -> 64MiB堆保持，无页面异常/OOM
  原PMX/贴图/进度/暂停/恢复默认/物理重载/重力/循环用例继续通过
```

## MMD AR 加载进度与初始化速度清理（2026-09-30）

```text
已有声明:
  ProgressView、模型/VMD专用进度回调、clearPmxPhysicsMotion、固定vendor与Ammo
新增定义:
  ProgressFixture { token, timers, aria, phase, state }
  PhysicsFixture { bodies, velocities, forces, transforms, allocationCount }
操作流程:
  开始 -> 不定进度可见 -> 实际读取比例单调 -> 未提交不能到100% -> 成功收起
  新操作 -> 旧消息/旧定时器忽略；失败 -> 停止且不100%；多PMX -> 等待选择
  非零线/角速度与残留力 -> 清理 -> 全部为零，刚体位姿保持
  临时向量 -> 成功和异常均释放；无物理 -> 旁路
  注入模型helper初始化 -> 清理 -> 返回提交；动作绑定姿态初始化 -> 清理 -> 启用
  真实Ammo不同刚体类型/无骨骼索引 -> 设速度/施力 -> 线/角速度读回零
  下一步进 -> 无残留X速度证明清力 -> 仍受重力，位姿和动作时间保持
  真实VMD自动循环 -> 新增清理调用次数不变
  Chromium原生文件选择 -> 提交前可见进度 -> 模型/动作阶段 -> 成功100%
  缺贴图/损坏VMD -> 错误提示无100% -> 原模型/动作可用
  恢复默认与物理重载 -> 同一进度和清理；无过期进度或页面异常
```

## MMD AR 手动 VMD 切换与继承动作（2026-09-30）

```text
已有声明:
  prepareMotionSwitch、注入runtime实际renderFrame、真实Three.js/Ammo、Chromium文件选择
新增定义:
  MotionTrace { bindingPose, physicsSetup, zeroVelocity, firstFrame, nextFrame }
操作流程:
  解析成功 -> 暂停旧物理 -> 等待Ammo -> 绑定姿态 -> 注册无物理helper -> 世界矩阵 -> 新物理
  初始化helper不得执行update(0)，刚体初始位置等于绑定姿态
  全刚体类型非零线/角速度和残留力 -> 清零且位姿不变，重力随后仍产生运动
  原物理关闭/无刚体 -> 不请求Ammo；播放暂停 -> 保留绑定姿态、动画时间为0
  失败/过期 -> 清理新helper/物理，恢复旧网格/骨骼/表情/IK和原开关
  等待期间帧门控 -> 旧helper不步进、锚点仍更新、重复切换拒绝
  实际renderFrame首帧 -> 动作强制关闭、物理仍步进、角色隐藏
  第二帧 -> 按最新播放开关应用新动作、正常显示；暂停不推进
  自动循环 -> 不新增速度清理或物理实例
  Chromium -> 目录/多选/下拉PMX继承内置VMD；另一个PMX继承本地VMD及名称
  换模型/物理重载 -> 仍可读取继承的动作上下文；关闭动作选PMX -> 无动作
  Chromium前两次真实update -> 物理创建时间0、首帧animation=false、次帧按开关推进
  24次动作+4次模型压力切换 -> 开启/暂停均覆盖，仅当前物理存活，堆与探针有界
  重力缓动数学测试显式使用120ms；浏览器存储显式测试值，不依赖默认参数
```

## MMD AR 完整重力方向与锚点过滤（2026-09-30）

```text
已有声明:
  THREE 四元数、真实 IMU 屏幕转换、网页控制器注入、Chromium 本地资源用例
新增定义:
  GravityFixture { referenceBeta, inputBeta, deadZoneDegrees, smoothingMs, rotations }
操作流程:
  小角度连续输入 -> 不越死区则保持 -> 慢转越界后接受完整目标
  60Hz 与 120Hz 按时间更新 -> 相同收敛 -> 最终精确等于接受目标
  居中/关闭强制单位旋转 -> 绕过死区 -> 手动目标保持
  两参数为0 -> 即时完整角度；降低死区 -> 重新接受最新原始输入
  加载实际 IMU 与注入控制器 -> 首次归零 -> 忽略旧灵敏度存储与 alpha
  无效倾斜忽略 -> 坐标变化重建参考 -> 迟到权限无法重新开启
  Chromium 加载生成页 -> 新控件默认值 -> 修改参数 -> 保存 -> 合成倾斜事件
  小抖动保持目标 -> 30度输入得到30度目标 -> 居中清零
  本地模型/物理重载 -> 独立重力参数仍保留 -> 无页面异常
```

## MMD AR 网页本地资源选择（2026-09-30）

```text
已有声明:
  Node test runner、Chromium、生成 web-dist、构建校验过的 PMX/贴图/VMD
新增定义:
  LocalAssetFixture { pmxFile, textureFiles, vmdFile, invalidVmd }
  LocalAssetResult { ready, modelUrl, motionUrl, motionProgress, error, requests }
操作流程:
  目录索引及平铺索引 -> 检查相对路径、大小写、唯一名称回退、重复/歧义/越界
  注册文件 -> 创建对象 URL -> 读取文件 -> 释放 -> 原 URL 和旧映射均不可复用
  生成网页 -> 本地 HTTP 按正确 CSS/ESM MIME 服务深层目录 -> Chromium 打开
  原生 file input 选择真实 PMX 与贴图 -> 就绪且地址属于当前会话
  选择真实 VMD -> 进度可读 -> 暂停后进度冻结
  选择损坏 VMD 或缺贴图 PMX -> 错误提示 -> 原模型/动作仍就绪
  物理重载 -> 本地模型/动作仍可读取
  恢复默认动作 -> 当前本地模型保持；恢复默认模型 -> 内置 profile 生效
  页面异常与本地虚拟路径的 HTTP 请求均为空
  收集结果 -> 关闭浏览器和 HTTP 服务 -> 删除本用例创建的临时损坏 VMD
```


## 概述

自测功能用于验证系统各模块是否正常工作，包括基础功能测试、播放控制测试、画面控制测试等。

## 数据结构

### 测试结果

```javascript
{
    testResults: {
        passed: number,     // 通过数量
        failed: number,     // 失败数量
        skipped: number,    // 跳过数量
        total: number       // 总数量
    },
    results: [{
        id: string,         // 测试ID
        name: string,       // 测试名称
        category: string,   // 测试分类
        description: string,// 测试描述
        success: boolean,   // 是否成功
        message: string,    // 结果消息
        details: string,    // 详细信息
        timestamp: string   // 时间戳
    }],
    lastRun: string         // 最后运行时间 (ISO格式)
}
```

### 待确认消息

```javascript
{
    pendingAcks: Map<string, {
        resolve: Function,      // Promise resolve 函数
        timer: number,          // 超时定时器ID
        commandType: string,    // 命令类型
        displayId: string       // 显示端ID
    }>,
    ackTimeout: 5000            // 超时时间 (毫秒)
}
```

## 核心函数

### waitForAck(commandType, displayId, timeout)

等待显示端确认命令：

```
waitForAck(commandType, displayId, timeout):
    返回 Promise:
        生成 key = displayId_commandType
        设置超时定时器:
            超时后:
                从 pendingAcks 删除 key
                resolve({ success: false, message: '等待确认超时', details: ... })
        
        将 { resolve, timer, commandType, displayId } 存入 pendingAcks
```

### handleAck(data)

处理显示端确认消息：

```
handleAck(data):
    生成 key = data.displayId_data.commandType
    从 pendingAcks 获取 pending
    
    如果 pending 存在:
        清除超时定时器
        从 pendingAcks 删除 key
        resolve({
            success: data.success,
            message: data.success ? '显示端已确认' : '显示端处理失败',
            details: ...
        })
```

## 测试用例

### 基础功能测试

| ID | 名称 | 描述 | 验证内容 |
|----|------|------|----------|
| display_connection | 显示端连接测试 | 检查是否有显示端连接 | DisplayList.getDisplays().length > 0 |
| websocket_connection | WebSocket连接测试 | 检查WebSocket连接状态 | ws.readyState === WebSocket.OPEN |

### 播放控制测试

| ID | 名称 | 描述 | 验证内容 |
|----|------|------|----------|
| play_command | 播放命令测试 | 测试播放命令发送并等待显示端确认 | 发送 play 命令，等待 commandAck |
| pause_command | 暂停命令测试 | 测试暂停命令发送并等待显示端确认 | 发送 pause 命令，等待 commandAck |
| volume_control | 音量控制测试 | 测试音量调节 | 发送 volume 命令 |

### 画面控制测试

| ID | 名称 | 描述 | 验证内容 |
|----|------|------|----------|
| fit_mode_contain | 画面填充-适应测试 | 测试适应模式 | 发送 fit: contain |
| fit_mode_height | 画面填充-高度铺满测试 | 测试高度铺满模式 | 发送 fit: height |
| fit_mode_width | 画面填充-宽度铺满测试 | 测试宽度铺满模式 | 发送 fit: width |
| fit_mode_crop | 画面填充-裁剪测试 | 测试裁剪模式 | 发送 fit: crop |
| rotation_0 | 旋转-0度测试 | 测试0度旋转 | 发送 rotation: 0 |
| rotation_90 | 旋转-90度测试 | 测试90度旋转 | 发送 rotation: 90 |

## 命令确认流程

### 显示端发送确认

**public/display.html**:

```
function sendCommandAck(commandType, success, details):
    如果 WebSocket 已连接:
        发送 {
            type: 'commandAck',
            commandType: commandType,
            success: success,
            details: details || '',
            timestamp: Date.now()
        }

消息处理:
    如果 type === 'control':
        handleControl(data)
        sendCommandAck('control', true, data.action)
    
    如果 type === 'tts':
        handleTTS(data)
        sendCommandAck('tts', true, data.action)
    
    如果 type === 'media':
        showMedia(data)
        sendCommandAck('media', true, data.type)
    
    如果 type === 'voiceCommand':
        handleVoiceCommand(data)
        sendCommandAck('voiceCommand', true, data.action)
    
    如果 type === 'reminder':
        handleReminder(data)
        sendCommandAck('reminder', true, data.action)
    
    如果 type === 'restoreState':
        handleRestoreState(data.state)
        sendCommandAck('restoreState', true, 'state restored')
```

### 服务端转发确认

**server.js**:

```
显示端消息处理:
    如果 type === 'commandAck':
        广播到控制端 {
            type: 'commandAck',
            displayId: displayId,
            commandType: data.commandType,
            success: data.success,
            details: data.details,
            timestamp: data.timestamp
        }
```

### 控制端接收确认

**public/js/websocket.js**:

```
handleMessage(data):
    ...
    如果 type === 'commandAck':
        如果 window.SelfTest 存在:
            调用 SelfTest.handleAck(data)
```

## 测试运行流程

```
runAllTests():
    设置 isRunning = true
    重置结果
    
    显示进度界面
    
    遍历所有测试:
        更新进度显示
        执行测试 run()
        记录结果
        更新统计
        
    保存结果到 localStorage
    显示结果界面
    导出 JSON 文件
    
    设置 isRunning = false
```

### 源码契约回归测试同步（2026-09-03）

```
runSourceContractRegressionTests():
    检查 Android ASR 测试 APK 的路由变量按查询字符串拆分
    检查 ASR 网页通过带查询参数的 /api/asr 路由提交音频

    检查正式显示 APK 不复制 GTCRN 资源
    检查 DenoiseModelManager 使用 speech-enhancement 清单和模型下载路由
    检查服务器提供 GTCRN 清单与文件白名单路由

    检查网页 TTS 使用 recoverTtsPlayback 恢复自身 audio 元素
    检查聊天删除单轮按后端选择对应的 runtimeManager 重置会话
    检查 repairMode.password 为字符串且 repairMode.role 为 mainfront
    检查搜索频道按 pi 或 codex Agent 会话设置 ephemeral
    检查语音指令帮助文本传入当前命令集和 topic

    保留 display-native-bridge.test.js 的 DeX 原生触摸/滚轮旧契约失败
    直到明确 DeX 多屏输入桥接的后续处理方案
```

上述契约测试只验证源码中对外可观察的稳定行为和路由，不绑定已经重命名或抽取的内部局部变量。

## 结果存储

测试结果保存在两个地方：

1. **localStorage**: `selfTestResults` 键
2. **JSON 文件**: 自动下载 `self-test-results-{timestamp}.json`

## 消息类型

### commandAck 消息

| 字段 | 类型 | 说明 |
|------|------|------|
| type | string | 'commandAck' |
| displayId | string | 显示端ID |
| commandType | string | 命令类型 (control/tts/media/voiceCommand/reminder/restoreState) |
| success | boolean | 是否成功 |
| details | string | 详细信息 |
| timestamp | number | 时间戳 |

## MMD AR 物理稳定性（2026-09-30，已验证）

```text
已有声明: 固定vendor、真实Ammo WASM、子步插值、资源池、模型/动作切换
新增定义: StabilityFixture { baselinePhysics, stabilizedPhysics, actualPmx, renderFps, tailRms }
流程:
  同一真实vendor -> 生命周期与子步补丁 -> 基线；再加稳定性补丁 -> 新实现
  有骨骼type2 -> 重力/平移目标/旋转速度 -> 每步端点正确且角度保留，无帧末COM重置
  真实锁定角度关节与旋转扰动 -> type2仍受到角冲量纠错，线性因子0不冻结旋转
  无骨骼type2与type1 -> 仍自由平移，速度不被通用清零
  父骨骼/世界偏移/动作目标 -> 多帧跟随；不足一步 -> 不移动刚体
  真实关节 -> 65Hz保持原ERP；变频刷新六轴一次，静止模拟比较残余
  全频率与多画面帧率 -> 一秒位移接近实际固定步时钟，不丢低频时间
  真实米娅30/65/90/120/180Hz、60FPS静止八秒 -> 比较末一秒低质量角速度RMS
  各Hz修复/基线均降低；180Hz为0.315354至0.094321，限制结论仅该模型/窗口
  异常/循环/复位/切换 -> 保持两帧门控及速度清零边界；池归还与native销毁归零
  本地网页 -> 模型/动作连续切换、实时变频、导入指纹和页面异常回归
结果: 首批82加补充角冲量1、本地资源3，共86项覆盖通过
  实际24次VMD/4次PMX切换 -> native创建32/销毁31/存活1；堆64MiB，无OOM
边界: 不宣称所有PMX或手机观感已验收；不替换求解器或发布外网
```

## 原生 ORB-SLAM3 接入检查记录（2026-10-01）

```text
本轮按会话约束不新增/运行测试，不安装设备
允许: npm APK/网页构建、源及生成脚本语法检查、构建资产校验
待现场: 摄像头权限/后台/重启时无残留；代次拒绝旧位姿
待现场: 原定位图首定位+平移初始化尺度；移开图片仍SLAM跟踪
待现场: 失锁角色保留，重定位恢复，新地图重新看图
待现场: 横竖屏/cover裁切/矩阵方向/near=1与原缓动一致
待现场: 导入真实标定启用IMU，UNKNOWN时间戳拒绝，偏移符号正确
待现场: 回环后首关键帧锚点/尺度连续性、手机帧率/发热/内存及多次停止回收
纯网页兼容: 无桥继续MindAR；不含原生库/词袋/WASM，不做模拟接口验收
```

构建/静态检查结果（不属于功能测试）：两种npm构建成功；最终APK资产含SLAM/C++库、词袋、版本/许可及MindAR回退资源，模型/定位资源摘要通过；5个源脚本与4个生成脚本、APK3/网页4个内联脚本语法通过，定向差异检查通过。APK大小95,015,322 bytes，SHA-256 `29cbf0fc2242ebe2f03a3ca3c18a351daf79f5629da05760a3aad1b9abfba991`。上述待手机项目未执行；没有测试代码变更、自动测试或设备安装。

## 六轴IMU默认参数位置偏移回归（2026-10-03）

```text
专用测试 -> 13项通过
默认处理 + 无噪三类轨迹10秒 -> 旋转<1e-6m、平移<1cm、复合<3cm
带噪静置校准10秒 -> 残差<5cm；已有加速度标定 -> 静置对齐不再次引入倾斜
真实浏览器 -> 无噪按钮保留滤波12Hz/加速度死区0.08，噪声归零；原拖动/房间回归
模拟精度与手机实际精度分开，未校准误差不隐藏
```

## 刚体XPBD WebGL2自测伪代码

```text
启动静态服务与Chromium真实WebGL2 -> 导入CPU/GPU后端
相同重力/风积分 -> 比较位置误差小于1e-4 -> 断言实际后端为GPU
六种形状组合 -> 接触标记非空且穿透向外修正
锚点移动/六轴关节/type2/非零全锁 -> 验证随动与锁角
reset -> 无风无重力下一帧不因旧速度移动；保存的renderer状态恢复
重复创建/步进/销毁50次 -> geometry/texture/program回到基线
无renderer -> CPU回退及原因；丢失上下文 -> 暂停释放 -> 恢复重建无GL错误
生成网页加载默认PMX -> 选择GPU -> 实际GPU读回/接触/关节 -> 切回CPU
手机复杂碰撞、动作/模型长期切换、小物件观感和P95 -> 独立现场验收
```

## Offline MMD 首次下载后本地持久缓存（2026-10-08）

```text
固定版本/14项白名单 -> 新 profile 带版本URL；本地manifest优先规则不变
空缓存 -> 固定上游顺序下载 -> 校验HTTP/长度/SHA -> 唯一临时文件原子改名
同版本同资源并发 -> 上游仅一次；下次请求 -> 磁盘命中且上游/DNS调用为0
损坏缓存 -> 丢弃并重取；缓存写入失败 -> 返回已校验内容、不保留半成品
缓存根/版本/父目录或目标为符号链接 -> 不跟随；清理只删除专用根的旧SHA普通目录
版本路由 -> ETag、private一年immutable、If-None-Match命中304
旧静态路由 -> 保持同源兼容和no-store；显示端只接受固定版本白名单路径
自测 -> 服务17项、显示端版本路径定向1项通过；脚本语法/diff-check通过
Android Offline实际冷启动、Runtime更新/进程重启后的缓存命中和加载耗时 -> 现场验收
```
