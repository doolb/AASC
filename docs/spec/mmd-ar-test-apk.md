# MMD AR 独立测试 APK / HTTPS 网页实现规范（伪代码）

本文描述 `3rd/mmd-ar-test/` 的本地测试 APK 实现。伪代码与独立 Android 工程、资源准备脚本和复用的显示端 MMD/AR 模块保持同步。

### HTTPS 完整 MMD 测试页的定位标记分支（伪代码）

```text
网页构建入口:
  清理 web-dist
  复制完整 MMD/PMX/灯光/AO/物理/AR 页面脚本和样式
  校验并复制默认 PMX、纹理、VMD、Ammo、Three.js、MindAR 与官方定位图资源
  使用显示端 AR 管理器的 IndexedDB 定位图选择/校准和停止流程；定位摄像头由 A-Frame 持有
  正常初始化 MMD 模型、灯光/AO、动作和物理
  仅 HTTPS 测试页设置 MmdArLocationMarkerTest = true 和 MmdArTestAframeMode = true

HTTPS 测试页切换为 MindAR Basic A-Frame 定位:
  保留现有目标图选择、拍照校准、IndexedDB 和 MMD 场景
  网页额外加载 A-Frame 1.5.0 与 MindAR 1.2.5 A-Frame 组件
  在舞台内创建 autoStart=false 的独立 AR 场景和 targetIndex=0 的目标锚点
  锚点子节点是随目标尺寸变化的半透明蓝色矩形与中心十字
  校准相机仍由原有校准逻辑管理；开始定位前释放校准相机
  将选中目标矩形图交给 MindAR Compiler，导出临时 .mind URL
  将 .mind URL 注入 A-Frame system.imageTargetSrc，再调用 system.start()
  arReady 后进入寻找；targetFound 显示锚点和定位状态；targetLost 隐藏锚点并显示寻找状态
  定位期间只由 A-Frame system 持有后置相机，不启动旧 Controller 或第二条相机流
  切换目标、停止、关闭摄像头或离开页面时停止 system，释放媒体轨道和临时 URL
  停止时移除 MindAR 注册的 resize 监听器，避免多次启动后的泄漏
  锚点仅显示定位测试图形，不向 MMD 模型写入 setArPose

处理 A-Frame 锚点事件:
  arReady: 启动状态变为寻找
  targetFound: A-Frame 自动更新锚点矩阵，显示蓝色矩形和十字，状态变为定位中
  targetLost: A-Frame 自动隐藏锚点，状态变为目标丢失
  共享 AR 管理器只消费可见/丢失状态，不再计算屏幕中心点，也不调用 MMD setArPose

停止、重置或识别异常时:
  测试标记模式隐藏定位标记
  普通模式按既有逻辑重置模型 AR 姿态

发布完整 MMD 测试页:
  上传 web-dist 中当前页面引用的静态文件，不删除远端目录中的其他文件
  对比本地构建与外网已有文件的 SHA-256，仅暂存有差异的页面、脚本和清单；模型文件无差异时不重复上传
  校验暂存文件与本地构建一致，先逐个原子替换脚本和清单，最后原子替换 index.html
  相机跟随版先切换 PMX runtime、再切换显示模块，最后切换带新面板的首页；旧首页在切换窗口仍可使用脚本默认设置
  页面资源完成切换后才切换首页，避免旧首页短暂引用不存在的模拟对象
  对 HTTPS 首页及每个页面资源请求进行状态码和 SHA-256 校验

验证:
  检查 web-dist 包含 MMD canvas、MMD runtime、Three.js/Ammo、模型 profile 和校验过的模型资源
  检查内置及用户定位图仍可选择/校准，摄像头可启动/停止
  检查找到目标时蓝色矩形和十字随锚点移动，模型不会被写入跟踪姿态
  检查目标丢失、无有效姿态、识别异常和停止后标记隐藏
  发布后逐项检查首页和资源均返回 HTTP 200，公网 SHA-256 与 web-dist 对应文件相同
```

## HTTPS 静态网页构建与发布

### 无实体摄像头的透视模拟输入（仅 HTTPS 网页，伪代码）

```text
网页路径:
  资源地址以页面目录为基准，JS/CSS、MindAR 官方图、MMD 清单和模型均使用相对路径
  MindAR Compiler 的动态 import 以当前脚本 URL 求同级 vendor 路径，不能把页面相对 ./js/ 再当作模块相对路径
  同一 web-dist 分别挂载到 /mnt/mmd-ar/ 和 /mnt/AASC/3rd/mmd-ar-test/web-dist/ 时解析到各自目录
  不改变 APK 的本地固定路由或正式显示端资源路径

网页构建入口:
  在定位面板加入“真实摄像头／模拟摄像头”输入选择、本地图片输入、四个视角滑条和重置按钮
  缩放滑条置于画面上方；经度滑条竖放于画面左侧；纬度滑条竖放于画面右侧；0–360° 水平旋转滑条置于画面下方；画面本身响应鼠标拖动平移
  模拟画面与已有“定位图”分离；选图只在当前浏览器内解码，不上传、不持久化
  加载网页专用模拟输入脚本；APK 与正式显示端不加载

模拟输入状态:
  mode ← camera
  sourceImage ← 空
  pose ← { zoom: 1, latitude: 0, longitude: 0, horizontalRotation: 0, panX: 0, panY: 0 }
  quad ← 根据 pose 投影原图平面四角
  activeStream ← 空

电脑模拟视角控件尺寸:
  horizontalLength ← 下方水平旋转滑条的实际可见宽度
  sourceRatio ← 已解码原图高度 / 已解码原图宽度
  取景画布宽度 ← 960；取景画布高度 ← 按 sourceRatio 换算并取整
  取景预览宽高比 ← 已解码原图宽度 / 已解码原图高度
  latitudeLength ← horizontalLength × sourceRatio
  经度和纬度滑条分别在左、右侧居中，长度不超过取景预览高度；布局或窗口变化时重新计算
  未选图时使用旧 960×540 占位比例；重选图时同步更新画布、预览、WebGL 视口和画面尺寸 uniform
  图像比例导致画布高度超过 GPU 视口上限时拒绝选图并保留旧画面，不默默改变原图比例

选图/调整:
  校验图片类型及解码结果；失败时保留旧画面并提示错误
  解码成功后先确定真实原图尺寸，再建立匹配原图比例的模拟视频帧
  按图片宽高比建立固定平面；先把归一化画面 X 换算到与 Y 相同的物理长度单位
  下方水平旋转先绕原图平面法线旋转四角 0–360°，再按左侧经度旋转竖轴、右侧纬度旋转横轴，最后以固定焦距投影四角
  经透视除法后把物理 X 换回画面 X；不能在已投影的归一化 X/Y 上直接旋转，否则非正方形画面会拉伸且深度关系不随原图转动
  以缩放和平移作用于投影结果；拖动画面只改变平移量，限制拖动范围避免整个目标移出画面
  根据投影四角求画面到图片纹理的逆单应映射；画面范围外填中性背景
  每个滑条只修改对应 pose 分量；若四角退化或面积过小，则拒绝该姿态并保留上一次有效画面
  重新选图或点击重置时恢复正面、100% 缩放、水平旋转 0° 与居中平移；不再独立拖动四个角点

启动/停止定位:
  mode 为模拟时要求已选图片且浏览器支持 WebGL 与 canvas.captureStream
  模拟画布持续重绘，以固定帧率 captureStream 交给原 MindAR A-Frame 视频入口
  mode 为真实时维持原 getUserMedia 流程；切换输入源时停止当前定位再选择新流
  结束、失败或离开页面时停止视频轨道与绘制计时器，释放图片位图/对象 URL
  模拟模式不调用 getUserMedia；不可把模拟成功宣称为真机首锁验收

模拟定位的后台切换:
  测试网页在 document 上监听 visibilitychange；不能依赖 window 接收该事件
  页面进入后台时若测试网页正在使用模拟输入定位，记住当前目标 ID，再按现有规则停止定位、释放旧视频轨道与定时器
  页面返回前台时等待后台停止完成；仅在目标仍相同、输入仍为模拟、摄像头能力启用且页面可见时重建模拟流和 A-Frame 定位
  用户手动结束定位、切换输入或离开页面时取消待恢复状态；真实摄像头定位保持原后台停止且不自动重新申请权限
  连续隐藏/显示或恢复失败不能并发启动多个定位会话；失败时保留明确的定位状态

拍照校准:
  mode 为模拟时，现有校准取流入口从模拟画布取得视频流，不调用实体摄像头
  校准预览显示当前透视画面；点击拍摄时冻结与所选原图同宽高比的模拟帧作为校准源图
  仅测试网页在拍照后显示轴对齐的蓝色矩形选区，初始四边各内缩 15%
  指针命中矩形内部时平移整个选区；命中边或角时沿对应方向缩放，始终约束在照片内并保留最小有效面积
  每次编辑将矩形换算成按左上、右上、右下、左下排列的 selectedQuad；定位图命名与 IndexedDB 保存仍走原校准流程
  正式显示端与旧测试 APK 继续使用四角独立编辑，不受测试网页矩形交互影响
  校准取消、保存、输入模式切换或转入 A-Frame 跟踪时，先停止校准轨道及模拟绘制定时器
  mode 为真实时，拍照校准继续调用现有 getUserMedia
  浏览器无实体摄像头且未选模拟图片时显示明确错误，不停留在请求权限状态

验证:
  无摄像头浏览器可从本地图选择模拟画面并找到官方目标
  同一无摄像头浏览器可从模拟预览拍照、框选并保存自定义定位图，拍摄内容与当前透视画面一致
  经纬度滑条改变透视、水平旋转滑条先改变原图平面方向并联动深度透视、缩放滑条改变整体尺寸、拖动画面只平移；四角始终对应同一平面投影
  重置恢复正面视角、0° 水平旋转、100% 缩放和中心位置；四控件与投影状态同步
  切换真实/模拟、重启/停止后无遗留 MediaStream 轨道或计时器
  深层内网路径与外网式根路径使用同一 web-dist 均加载脚本、清单、图片及样式
```

### 测试网页定位图底面/立面驱动 MMD 相机（伪代码）

```text
测试网页相机跟随设置:
  定位图与校准分类提供“底面 / 立面”切换，默认底面；从同源 localStorage 恢复合法模式
  切换模式时立即复用最后一次有效锚点姿态计算相机，更新选中样式并保存；不得重置 PMX 根节点或物理
  定位面板单列“相机跟随”分类，包含平移死区、旋转死区、缓动时间、相机到定位图距离四个滑条
  默认值 ← { 平移死区: 目标图宽度的 0.5%, 旋转死区: 0.5°, 缓动时间: 120ms, 距离: 100% }
  距离滑条仅允许 50%–100%：100% 为原始跟踪距离，减小数值沿原始相机与定位图中心的连线等比拉近
  从测试页同源 localStorage 恢复合法设置；非法或缺失值回退默认；滑动时显示当前值、保存并立即传给 PMX runtime
  PMX runtime 尚未加载时，显示层暂存设置，在创建 runtime 后补发；正式显示端与旧测试 APK 不显示也不应用这些设置

定位开始:
  保持 MindAR A-Frame 独占摄像头和目标识别，MMD PMX 保持原 Three.js 渲染场景
  底面：目标平面 XY 绕 X 轴旋转为世界 XZ 地面；以当前 PMX 模型脚底中心为目标中心
  立面：目标平面保持世界 XY 方向；目标图下边缘中点对齐当前 PMX 模型脚底中心
  首次定位时只缓存 PMX 模型可见状态和由原有模型高度算出的目标世界宽度；模型根节点位置、缩放、旋转及物理状态均不改写
  目标世界宽度 ← 当前模型高度 / 1.5；角色与目标的视觉比例保持约 1.5:1

目标姿态更新:
  MindAR 的 targetUpdate/targetFound 在锚点矩阵写入前触发；事件结束后读取新矩阵，且锚点可见期间逐帧核对 PMX 是否采纳当前矩阵，避免漏帧后相机停在旧视角
  仅锚点可见、矩阵有效且 PMX 已就绪时提交位姿；逐帧仅读取 PMX 相机的轻量 active/trackingLost 状态，不重新计算模型包围盒
  提交失败时不得把 PMX 误报为已经跟随，保留可观测的同步状态
  A-Frame 锚点更新后读取其完整矩阵；该矩阵是目标相对于摄像头的姿态
  从原始锚点矩阵提取定位图相对于摄像头的平移和旋转；首次定位直接采纳原始定位图姿态
  后续把本帧定位图平移与上次采纳的定位图平移比较，按定位图自身宽度的百分比判断平移死区
  把本帧定位图旋转与上次采纳的定位图旋转比较，按角度判断旋转死区；两个分量分别只采纳超出死区的部分
  用已采纳的定位图平移、旋转和本帧原始缩放重建目标相对摄像头矩阵；不再用相机位移判断定位图抖动
  从已编译定位图读取高宽比；缺失或非法时使用 1
  底面目标中心 ← 模型脚底中心；目标旋转 ← 绕 X 轴 -90°
  立面目标中心 ← 模型脚底中心向上移动“目标世界宽度 × 目标图高宽比 / 2”；目标旋转 ← 单位旋转
  世界摄像头矩阵 ← 所选模式的目标中心平移 × 目标旋转 × 目标世界宽度缩放 × 已采纳目标相对摄像头矩阵的逆
  从矩阵提取原始相机位置与旋转，舍弃目标宽度带入的缩放，保持相机自身缩放为 1
  相机相对定位图中心的向量 ← 原始相机位置减去定位图中心世界位置
  目标相机位置 ← 定位图中心世界位置 + 相机相对向量 × 距离设置；相机方向和投影矩阵不受距离设置影响
  首次首锁立即采用目标姿态；调整相机距离或切换底面/立面时复用最后采纳的定位图姿态重新计算相机，不重置死区参考；切换模式立即对齐而不经过旧模式缓动
  每帧按实际帧间隔缓动当前位置与四元数朝向已接受目标；缓动时间为 0 时立即跟随
  同步 A-Frame 摄像头投影矩阵与世界摄像头矩阵到 PMX 渲染相机
  AR 相机模式暂停 PMX 原有环绕相机的逐帧覆盖；画布、视频与投影使用同一可视矩形
  蓝色矩形可保留作调试标记，PMX 根节点不动，不再使用屏幕脚底映射

定位丢失或停止:
  丢失时冻结当前已显示的相机视角并清除尚未完成的缓动目标，PMX 模型继续显示在原位置并维持原动画/物理；重新找到目标后从冻结视角平滑跟随
  重新找到目标后，首个有效锚点矩阵必须解除 PMX 的失锁冻结；即使事件回调漏掉一次，下一显示帧也要重新尝试；停止定位时清理重试循环
  回归验证蓝框可见且更新时 PMX 相机的采纳位姿持续更新，丢失再找到后 trackingLost 恢复为假，角色投影重新贴近定位图中心
  停止或切换输入时恢复 PMX 原相机、模型可见性与环绕控制；模型位置/缩放从始至终不变
  正式显示端和旧测试 APK 不启用上述相机模式
```

### 手机校准、定位切换与双光阴影（伪代码）

```text
测试网页校准弹窗:
  可用高度 ← visualViewport 高度减去安全区和弹窗外边距
  弹窗最大高度 ← 可用高度；内容超出时仅在弹窗内部纵向滚动
  预览高度 ← 可用高度减去标题、提示、操作按钮和内边距
  视频与画布保持原始纵横比，不允许预览把关闭/拍摄/保存按钮挤出可达范围
  角点拖动继续用画布显示矩形映射到原始像素坐标

测试网页定位按钮:
  保留原开始/结束按钮及既有业务事件，隐藏两个旧按钮的视觉呈现
  在第一分类加入唯一可见切换按钮
  跟踪中或相机仍占用时显示“结束定位”，否则显示“开始定位”
  点击切换按钮转发到对应的原业务按钮；启动失败后恢复为开始状态
  摄像头禁用或未选定位图时禁用开始；后台停止与面板重开后同步状态

测试网页双光阴影:
  主光阴影开关默认开启，只作用于主光投影
  补光关闭时强度为零，且不投射阴影
  补光开启后，补光阴影模式分为 none / key / fill
  none: 补光正常照亮，不检查遮挡；主光是否投影由自己的开关决定
  key: 主光投影开启时补光使用主光阴影遮挡系数，关闭时补光不受阴影
  fill: 补光生成自己的阴影贴图，按补光方向遮挡；主光开关不影响补光投影
  两盏灯均不投影时关闭阴影贴图计算；任一灯投影时模型仍投射和接受阴影
  网页主光开关存入现有灯光本地配置；旧记录缺少字段时默认开启
  旧版 shadowSource 配置映射到网页新语义；非测试网页仍按旧行为运行
  模式切换、补光开关、模型更换后重新同步阴影状态

MindAR 视频输入:
  HTTPS 测试页 A-Frame system 在真实模式自行申请后置摄像头并使用原始视频帧
  模拟模式改用本地图片经透视画布生成的视频流，不请求实体摄像头
  校准照片仍由原有拍照相机取得；进入定位前释放校准相机
  网页不再展示旧 Controller 的 25% / 35% / 50% / 75% / 100% 识别尺寸选项
  官方示例直接使用 MindAR Basic 相同的官方 .mind；自定义选区由编译器导出临时 .mind URL
  A-Frame system 负责读取视频、编译目标索引及更新锚点矩阵
  完整页面回放需连续更新模拟相机画布，验证 targetFound、targetLost 和停止释放

验证:
  窄屏竖屏、横屏和安全区下弹窗按钮可到达，角点仍可拖动
  定位按钮首次、成功、失败、停止、后台释放的文字与禁用状态正确
  主光开关关闭时 none/key 不生成主光阴影，fill 可独立投影；开启时两盏灯在 fill 模式同时投影
```

### 网页改为仅 MindAR 与窄屏面板（伪代码）

```text
网页构建模式:
  不复制、不加载自写图片跟踪器脚本；APK 模式保留旧 A/B 构建
  测试适配层在网页模式固定使用 A-Frame MindAR，不显示算法下拉和 A/B 对比结果
  保留自定义图编译进度与当前识别状态；页面刷新后脚本 URL 带内容版本
  正式显示端脚本和运行中的跟踪器不随测试网页切换

网页手机面板:
  页面允许默认触摸滚动动作；MMD Canvas 继续单独禁止浏览器手势
  定位和灯光面板允许纵向手势滚动，最大高度跟随 visualViewport 与安全边
  展开分组后底部操作按钮可滚动到可见区域，不被摄像头画面或浏览器底栏挡住
  以窄屏触摸拖动和按钮点击回归验证
```

### 官方示例定位图（仅 HTTPS 网页，伪代码）

```text
构建网页:
  校验并复制 MindAR 官方文档的原始示例 PNG 到 web-dist/assets
  在定位图选择器后加入“查看官方测试图”链接，供另一屏幕显示或打印
  在共享 AR 脚本之前设置网页专用内置定位图提供者；APK 不设置

加载定位图:
  从 IndexedDB 读取用户定位图并按更新时间排序
  若存在网页专用提供者，则从同源资源读取示例 PNG 为 Blob
  生成固定 ID、全图四角、默认相对尺度的只读内置定位图
  将用户定位图与内置定位图合并，但不写入 IndexedDB
  若上次选中的 ID 仍存在，则保留选择；否则先选用户定位图，再选官方示例
  示例资源读取失败时记录警告，用户定位图仍可使用
  选中只读内置定位图时禁用删除；用户定位图仍可删除、切换、拍照校准

验收:
  首次访问直接可选官方示例；已有用户选择不被覆盖
  HTTPS 网页的 MindAR 复用同一图像和全图四角；开始定位时才请求摄像头
  查看链接读取本地同源图片，不请求第三方域名
  正式显示端与独立测试 APK 不出现官方示例
```

### 仅网页的设置分组（伪代码）

```text
网页构建模式读取共用显示端页面:
  注入测试页的 MindAR 对比控件
  从灯光面板收集现有控件节点，按 基础光照 / AO / 主光 / 补光 / 边缘光 1 / 边缘光 2 / 物理 归类
  从定位面板收集现有控件节点，按 定位图与校准 / 跟踪操作 / 体感环绕 归类
  每组使用独立标题行、展开按钮和隐藏内容容器；首组默认展开，其余默认收起，组之间可独立开合
  AO、补光、边缘光 1、边缘光 2、体感环绕的原有开关移到对应标题行，放在展开按钮之前
  边缘光按两个独立开关拆成两个组；基础光照内的阴影/Toon 开关保持在组内容中
  开关原标签只保留复选框，把原描述文字移动到占据标题剩余宽度的展开按钮中
  点击复选框只触发原设置变更；点击标题文字、空白或箭头只切换内容可见性与 aria-expanded
  将开合监听直接绑定到每个分类展开按钮；不能依赖 document 冒泡，因为原灯光/定位面板会 stopPropagation
  标题行使用比内容区浅的背景，窄屏仍可阅读原开关说明
  保留所有控件 id、值、隐藏状态与原事件监听；面板标题和恢复默认按钮始终可见
  若任一原有控件未进入分组，构建直接失败，避免悄悄遗漏新设置
  只向 web-dist 的页面加入分组样式；APK 模式与正式显示端页面不执行分组

验证:
  加载完整测试网页脚本，点击灯光和定位分类后均可展开/收起；不可只在剥离原脚本的测试页中验证
  网页分组开合不会改动灯光与定位设置值，也不会自动启动相机
  旧 APK 生成页不含网页专用分组；正式 display.html 保持原结构
```

```text
buildMmdArTestWeb
  通过 npm run build:web:mmd-ar-test 调用现有资源准备脚本的 --web 模式
  目标目录 ← 3rd/mmd-ar-test/web-dist
  复用 APK 测试页的 DOM、JS/CSS、Three.js、MindAR 和固定 SHA-256 模型清单
  将生成副本中的 /js、/css 与 MMD profile/API 路径改成 /mnt/mmd-ar 下同源静态路径
  将 /api/mmd/resources 的响应预生成到 mmd-resources.json
  按固定模型清单原样复制 PMX 与 PNG 纹理，当前不生成网页专用压缩贴图变体
  不调用 Gradle；共用显示端源码的网页专用分支不改变正式显示端默认行为，也不启动 AASC 服务
  校验首页、清单、模型、MindAR、Ammo 与模块路径都只依赖此目录

publishMmdArTestWeb
  上传 web-dist 内容到远端 /home/as/a/mmd-ar
  HTTPS 入口 ← https://c.aasc.us/mnt/mmd-ar/
  校验入口、模型清单和代表性模型/运行时资源可通过 HTTPS 读取
  浏览器申请相机权限；定位图及灯光状态按 HTTPS origin 保存在本机浏览器
  真机现场验证摄像头授权、目标首锁、灯光、布料和拖动旋转

官方示例定位图发布:
  仅更新 web-dist/index.html、web-dist/js/display-mmd-ar.js 和 web-dist/assets/mindar-official-card.png
  按 图片 → AR 脚本 → 首页 的顺序原子替换
  校验三个公网文件的 SHA-256 与本地构建产物一致
```

网页模式与 APK 模式复用测试代码，但本地存储 origin 不同，旧 APK 的定位图不会自动迁移到 HTTPS 网页。

## HTTPS 网页模型加载进度

```text
HTTPS 测试页初始化 DisplayMmd:
  传入 onLoadProgress 回调；APK 与正式显示端不传入，沿用旧状态文字

PMX runtime.load:
  每次加载创建独立的进度代次，旧代次回调不得覆盖当前进度
  PMX 主文件收到有 total 的下载事件时，将字节比例映射到 1–70%
  total 不可用时保持阶段提示，不假造字节进度
  LoadingManager 报告纹理完成项时，将资源项比例映射到 70–84%
  PMX 与纹理都准备好后进入 VMD 阶段，从 VMD 下载事件映射到 85–94%
  VMD 没有长度时维持阶段起始百分比；下载结束后进入初始化阶段 95%
  骨骼/物理准备好但模型尚未提交时最多显示 99%
  DisplayMmd 确认模型真正 ready 后报告 100%，短暂展示后隐藏进度层
  任一阶段失败时隐藏进度层，并保留原错误状态提示
  百分比只允许单调前进，不以某个单独文件下载结束表示整个模型完成

网页展示:
  用独立进度层显示阶段文字、百分比及进度条，aria-valuenow 同步百分比
  不覆盖灯光/定位按钮、MMD 画布和原状态/错误文案
```

## HTTPS 网页 Canvas 分辨率适配与诊断

```text
网页构建时:
  从正式 display.html 复用灯光面板标题后的只读渲染分辨率文字
  从共用灯光脚本复用 Canvas 绘制缓冲尺寸显示
  仅在 HTTPS 网页生成的初始化脚本中加入尺寸监听；正式显示端沿用 DisplayStage.resize

网页初始化与每次窗口/visualViewport/舞台尺寸变化:
  下一动画帧读取舞台实际 CSS 宽高与当前设备像素比
  若宽高或设备像素比改变，则调用已有 DisplayMmd.resize(width, height)
  DisplayMmd/PMX runtime 按既有最多 2 倍像素比设置 WebGL 绘制缓冲、AO 与相机 aspect
  共用灯光脚本读取 canvas.width 和 canvas.height 作为当前 MMD 实际渲染像素尺寸
  Canvas 绘制缓冲属性变化时，将“宽×高 px”更新到灯光面板标题后的只读文字
  相同尺寸的重复 resize 事件不重复触发 WebGL 缓冲重建

模型加载完成:
  再读取一次 canvas 绘制缓冲尺寸，确保初始 fallback 到 WebGL 的切换后显示真实数值

验证:
  正式显示端与独立 HTTPS 网页在桌面/手机视口尺寸变化后，canvas 绘制缓冲与面板文字一致
  设备像素比受既有 2 倍上限约束；显示的是实际渲染尺寸，不是 CSS 或屏幕物理分辨率
  灯光和定位面板仍可点击；独立测试 APK 不再构建或维护
```

## 1. 构建配置

```text
buildMmdArTestApk
  仅在明确要求测试 APK 时执行；从当前显示端源码重新提取允许列表内的网页资源，不复用旧 APK 内的脚本
  profile ← 独立包名、应用名、版本和 Android SDK 配置
  modelManifest ← 固定 miya-default 文件列表、URL、长度和 SHA-256
  modelCache ← 3rd/mmd-ar-test/model-cache
  webAssets ← 3rd/mmd-ar-test/app/build/generated/assets/www
  generatedAssets ← Gradle build/generated/assets

  对 manifest.files 中的每个资源:
    若 cache 中普通文件的长度和 SHA-256 都匹配:
      复用 cache 文件
    否则:
      通过固定 IPv4 资源源下载到同目录临时文件
      校验长度和 SHA-256
      校验成功后原子替换 cache 文件
      校验失败则删除本次临时文件并终止构建

  将允许列表内的显示端 JS/CSS/Three.js/Ammo 复制到 generatedAssets/www
  将已校验 PMX、纹理、VMD 复制到 generatedAssets/www/mmd
  执行 :app:assembleDebug
  检查 APK ZIP 完整性、包名、模型文件和模型 SHA-256
  输出 3rd/mmd-ar-test/output/aasc-mmd-ar-test.apk
  按需通过 ADB 覆盖安装到指定设备，在 display 0 启动 MainActivity，并检查进程和前台 Activity
```

## 2. Android 启动保护与诊断

```text
Activity onCreate:
  startupStage ← 初始化窗口
  在 try 范围内依次记录并执行:
    初始化窗口 → 启动本地资源服务 → 创建 WebView → 加载本地测试页面
  若某阶段抛出 Exception:
    记录阶段名和完整异常堆栈到 MmdArTest 日志
    关闭已启动的本地资源服务
    显示包含阶段、异常类型和简要详情的可截图/可选中文字错误页

Activity window focus:
  页面已挂载且窗口获得焦点后才请求沉浸式显示
  Android R 及以上:
    获取 window.insetsController
    若 controller 为空:
      记录警告并恢复默认内容布局，保留可见系统栏
    否则:
      设置 decor fits system windows = false
      先设置 systemBarsBehavior，再隐藏状态栏和导航栏
  旧版本 Android:
    使用既有 systemUiVisibility 标志隐藏系统栏
  任一窗口操作失败:
    记录警告，尝试恢复可见系统栏与默认内容布局，继续测试页

Activity onResume:
  尝试恢复 WebView
  若恢复 WebView 抛出 Exception:
    记录完整异常并显示诊断页
    停止本轮恢复流程
  若窗口已有焦点:
    再次请求沉浸式显示

WebView renderer 退出:
  记录 renderer 崩溃或系统回收信息
  显示 WebView 渲染进程错误页
  返回已处理，避免 Activity 跟随 renderer 异常退出
```

诊断只包围 Activity/WebView 的启动及窗口操作，不修改相机权限声明、系统授权时机或网页能力。虚拟机致命错误不作为可恢复启动错误吞掉。

## 3. Android 本地页面与权限

```text
testActivity
  创建启用 JavaScript、DOM Storage、WebGL 的 WebView
  读取 WebView/窗口的系统 Insets，并将右侧安全距离转换为 CSS px
  页面加载完成或 Insets 变化时，将安全距离写入 documentElement 的 CSS 自定义属性
  测试页的灯光/定位控件按安全距离偏移，始终留在可触摸应用区域内
  localServer ← 仅绑定 127.0.0.1 的 APK 静态 HTTP 服务
  localOrigin ← http://127.0.0.1:17836
  webViewClient:
    / → APK 的 www/index.html
    /js/*、/css/* → APK 的 www 静态资源
    /api/mmd/static/* → APK 内置 miya-default 模型、纹理和动作
    /api/mmd/resources → 返回 APK 内固定的 miya-default profile JSON
    其他主机/路径 → 拦截，不允许外部导航或资源回退
  webChromeClient:
    确认请求 origin 等于 localOrigin，且只请求 CAMERA 视频捕获
    检查 Android CAMERA 权限
    权限已授予 → 只授予 VIDEO_CAPTURE
    权限未授予 → 保存当前 WebView 请求并请求 Android 系统授权
    用户拒绝或撤销 → 拒绝请求并显示相机不可用状态
  加载 http://127.0.0.1:17836/
  Android 系统相机权限弹窗期间不把 Activity onPause 当作用户离开
  普通切后台、页面隐藏或页面退出时停止跟踪并释放摄像头
```

## 4. 测试页面启动

```text
加载 MMD 测试 HTML 与显示端原有脚本/CSS
  WebView 请求 /api/mmd/resources
  本地 profile 响应返回 resourceId=miya-default、modelType=pmx
  profile 指向 /api/mmd/static/mmd/miya/miya.pmx 与 /api/mmd/static/mmd/motions/miya-default.vmd
  DisplayMmd 初始化 PMX runtime、灯光状态与模型拖动事件
  DisplayMmdLighting 绑定现有灯光控件并保存到本地存储
  DisplayMmdAr 读取 IndexedDB 定位图并绑定校准/跟踪控件
  测试 harness 将灯光/定位控件放入 display-interaction-layer 层叠上下文（z-index=50）
  确保 MMD canvas 层（z-index=10）不覆盖控件的 DOM 命中目标
  DisplayMmdImageTracker 对摄像头帧在本机提取特征并估计姿态
  AR pose 更新只作用到 PMX 外层定位；VMD、布料物理、灯光和旋转控制继续运行
  Android WebView 记录右上区域的原生 ACTION_DOWN/UP 坐标、view 尺寸和 raw 坐标
  测试页记录右上区域的 DOM pointerdown/click 目标及灯光/定位面板状态
  WebView console 经 Android 日志输出，对照原生与 DOM 坐标确认触摸命中链路
```

## 5. 生命周期

```text
应用启动 → 127.0.0.1:17836 本地 HTTP 页面 → PMX/VMD 加载 → 等待用户校准
用户拍照 → 四角选区 → IndexedDB 保存目标 → 用户开始定位
Android camera grant → getUserMedia → 本地跟踪 → 更新 PMX AR pose
停止/页面隐藏/应用退出 → 停止跟踪帧循环 → 关闭 MediaStream → 释放 WebView
```

## 6. 验证伪代码

```text
profile test 确认独立 applicationId 且 embeddedNode=false
server test 确认监听地址为 127.0.0.1，非本地 origin 和未知资源路径被拒绝
asset test 确认只包含白名单 Web 文件和 miya-default 模型文件
hash test 对每个 APK 模型 asset 与固定 manifest 比较长度和 SHA-256
manifest test 确认仅含本地 socket 所需 INTERNET、按需 CAMERA 权限，且没有 AASC Service/Receiver
startup test 确认启动阶段异常写入 MmdArTest 日志并显示可读错误页，onResume 沉浸式操作失败不退出 Activity
renderer test 确认 WebView renderer 退出时显示诊断页并由 Activity 接管
gradle test 与 assembleDebug
Insets test 确认不同方向与系统栏模式下按钮布局避开系统不可用区域
touch test 确认灯光/定位按钮 pointerdown、click 与面板开合状态一致
真机验收摄像头授权、拍照选区、定位、灯光、布料、VMD 和拖动旋转
```

## 7. 测试 APK 内的跟踪器 A/B 对比

```text
构建测试 APK:
  固定 MindAR 版本 = 1.2.5
  下载 MindAR 入口脚本、Controller chunk、UI chunk 和 LICENSE
  逐个校验文件大小与 SHA-256；缺失或不匹配则停止构建
  将资源放入测试 APK 的本地 www/js/vendor/mind-ar-1.2.5 和 licenses/
  不增加项目运行依赖，不复制进正式显示端或 Offline APK

页面初始化:
  保留原 DisplayMmdImageTargetTracker 引用
  仅测试页面用适配器覆盖同名 tracker 接口
  默认选择 current；用户选择 MindAR 前不动态导入 MindAR 代码

用户开始对比:
  检查只存在一个 AR 跟踪会话和一个已授权摄像头流
  从同一 IndexedDB 目标读取参考照片与 selectedQuad
  从 tracker.start 进入算法初始化时开始计时，不计相机权限等待
  current:
    调用原 tracker.start(video)，记录参考图载入与特征提取准备耗时
  MindAR:
    首次选择时从 APK 本地 URL 动态导入 MindAR 模块；该时间计入首锁时间，不发生公网请求
    共享摄像头已授权且 video 已就绪后，将定位状态从“请求摄像头权限”更新为“正在编译定位图”
    将当前阶段同步到 A/B 状态提示，避免相机预览已显示但界面仍提示等待权限
    将 selectedQuad 透视校正为目标画布并编译 MindAR target
    调用 compileImageTargets 时必须提供 progressCallback；回调将编译百分比同步到定位状态和 A/B 提示
    编译失败时显示具体异常并终止本轮；不得创建 Controller 或显示“正在寻找定位图”
    每轮 tracker.start 重新执行目标编译，单独记录目标预处理耗时
    使用已有 video 的 videoWidth/videoHeight 创建 Controller
    addImageTargetsFromBuffer → dummyRun(video) → processVideo(video)
    用 Controller worldMatrix 与投影矩阵映射目标四角到归一化视频姿态
    从 Controller processDone 回调生成一次新 tracker sample
    引擎启动成功后由 DisplayMmdAr 更新为“正在寻找定位图”；编译或启动失败时由共享流程显示错误
  两种算法都返回 DisplayMmdAr 所需的 processFrame、hasLocated 与 stop 接口
  两种算法继续复用 mapPoseToCover 和 DisplayMmd.setArPose

测试页竖屏布局:
  测量灯光按钮的右上定位区域（右侧安全 Insets + 14px 边距 + 按钮宽度 + 14px 间隔）
  竖屏时为左上测试提示设置右边界，限制提示最大宽度并允许文本换行
  横屏布局保持现有位置；提示始终不覆盖灯光按钮

每轮采样:
  current 每次处理实时视频帧时采样一次
  MindAR 只有观察到新的 processDone 时间戳时才采样，重复读取旧姿态不重复计数
  记录 tracker 初始化后的首锁延迟、样本帧率、按时间加权可见率、可见转丢失次数
  将姿态映射至 displayStageLayers 坐标，计算目标静止时屏幕锚点的 RMS 偏差
  MindAR 未暴露置信度时不伪造置信度；状态文案明确说明不提供该指标

用户停止或页面退出:
  停止帧调度并 dispose MindAR Controller / 停止原 tracker session
  只结束当前算法会话，不并行启动另一 tracker
  保存本轮报告到页面内存，允许开始另一算法继续复用同一定位图
```

识别帧率是 tracker 实际产生新样本的速率，不是 WebView 刷新率。可见率按状态持续时间加权，避免当前 JS 与 MindAR 输出频率不同时用简单样本比例比较。锚点 RMS 同时包含测试中的真实移动；只有目标/设备保持静止时才可近似解读为识别抖动。

## 8. 当前设备验证记录

```text
ADB 安装 SM-N9500 / Android 9 / API 28 → 成功
停止旧实例后将 APK 启动到内屏 display 0 → 成功
内屏原状态 OFF；发送 KEYCODE_WAKEUP 后 display 0 状态 ON
ADB 截图 → 测试页面控件与米娅 PMX 可见，WebView/WebGL 基本渲染通过
Insets 回调 → top=24/right=48 CSS px；灯光/定位入口避开 42/84 物理 px 的系统安全区域
灯光和定位按钮 → native touch 坐标、DOM target 与 click 状态日志一致；面板均可打开/关闭
模型区域 ADB swipe → 角色继续响应拖动旋转，VMD 动作继续播放
经临时 adb forward 请求 localhost:17836 → 首页、profile、PMX、VMD 均 HTTP 200；转发随后移除
摄像头授权、AR 图片校准/跟踪与布料物理 → 待真机验证
```

触摸根因是独立测试 harness 漏掉 `display-interaction-layer`（z-index 50）父层，MMD canvas（z-index 10）因此成为按钮位置的 DOM target。补回包装层后两个按钮均正常响应。多 display 测试中，旧 Activity 尚存活时再次创建 Activity 会因固定 loopback 端口已占用而进入启动错误页；当前仍需先停止旧实例再启动单实例，多实例生命周期和端口共享尚未实现。

## 9. 外网分发与校验

```text
publishMmdArTestApk
  artifact ← 3rd/mmd-ar-test/output/aasc-mmd-ar-test.apk
  expected ← artifact 的文件大小和 SHA-256
  上传 artifact 到 as@120.79.245.103:~/a/aasc-offline/apk/aasc-mmd-ar-test.apk
  通过 SSH 校验远端文件大小和 SHA-256 等于 expected
  通过公网 URL 下载响应并校验 HTTP 成功、文件大小和 SHA-256
  不修改 Offline 服务 manifest.json
```
