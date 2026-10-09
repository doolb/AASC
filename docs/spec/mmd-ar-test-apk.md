# MMD AR 独立测试 APK / HTTPS 网页实现规范（伪代码）

## 2026-10-09 TAA抖动参数契约（已实现并验证）

```text
已有声明 := 渲染设置规范化/本地存储/面板、TAA绘制包装/历史签名、固定八相位序列
新增设置 := taaJitterScale=1（有限值0..2）、taaJitterSamples=8（4/8/16/32）
旧存储缺字段或非法输入 -> 强度默认1；不在周期集合中的值默认8
面板 := 抗锯齿分类增加强度滑块和周期选择；不支持WebGL2时全部TAA控件禁用
面板修改 -> 规范化值 -> 发布当前设置 -> 本地保存 -> TAA/SSGI清历史
复位 -> 恢复默认强度1/周期8以及原有默认设置
TAA开启绘制 := 按有效配置生成/选择Halton(2,3)序列
    历史签名加入强度和周期；发生变化 -> 清历史并从相位0开始
    样本索引 := 相位对周期取余
    当前偏移 := 样本乘强度；按实际绘制宽高转换为clip空间平移
    接触采样相位 := 当前样本索引；基础未抖动投影保持
    每帧只绘制一次场景；resolve成功后提交历史并推进相位
    无论成功或异常 -> 恢复原投影/逆投影/临时相位/目标
强度0 -> 偏移为零；仍按既有规则累积历史，不承诺空间抗锯齿
TAA关闭/诊断/PNG导出 -> 沿用当前旁路与资源释放
本轮范围 := 不生成速度缓存，不改变历史颜色裁剪或引入新滤波
```

## 2026-10-09 TAA与Canvas倍率契约（已实现并验证）

```text
已有声明 := renderer/camera、runtime.resize、ambientOcclusion.render、屏幕光照当前/历史目标
新增设置 := taaEnabled=false、taaHistoryWeight=.9（0..0.95）、canvasScale=1（.25..2、步长.25）
新增资源 := 最终颜色/当前深度、双缓冲历史颜色/深度、resolve/copy材料、相位/矩阵
新增接口 := 绘制包装、历史失效、关闭释放、实际分辨率及能力诊断
独立编辑器rest/seek -> invalidateTemporal；capture -> render({bypassTemporal:true})
异步动作重播 -> 开始清历史 -> await加载/提交 -> finally再次清历史（相同动作ID也生效）
capture临时resize AO为导出像素，finally恢复原绘制尺寸/相机/clear设置
独立AO composite输出 -> 直色toneMapping/colorspace -> 重新预乘alpha
    离屏颜色变换为恒等映射，仍保存线性预乘；TAA开关及capture半透明内区一致

设置加载 -> 规范化本地值；TAA关闭/倍率1保留当前行为
修改倍率 -> CSS舞台尺寸与自动DPR -> 请求绘制尺寸
设备上限 := min(MAX_TEXTURE_SIZE, MAX_RENDERBUFFER_SIZE)
实际pixelRatio := 自动DPR × 倍率 × 等比例设备限制
renderer更新缓冲 -> AO/深度/接触/SSGI/TAA跟随实际尺寸
CSS/角色根/相机位置与倍率保持；更新aspect/投影但不重新fit
实际尺寸/降档状态 -> 原分辨率显示；保存/复位倍率1及TAA关闭

普通绘制:
    TAA关闭或诊断/导出 -> 原链；关闭释放历史
    TAA开启 -> 保存未抖动投影/逆投影及原状态
    8相位小于1像素偏移叠加clip坐标，保留原AR投影裁切
    深度/场景颜色/AO/接触/SSGI -> 当前最终颜色目标
    无历史 -> 当前帧初始化；否则当前深度重建、投向前帧
    历史UV越界/深度不匹配/覆盖变化 -> 当前帧
    动态颜色变化 -> 降低历史权重；历史裁剪至当前邻域颜色范围
    RGBA预乘alpha累积，背景不引入不可见RGB，保持原色彩变换
    读写分离历史目标 -> 主画布呈现 -> 更新前帧矩阵/深度
    finally -> 恢复投影/逆投影、目标/viewport；拾取用正常相机
SSGI联动:
    切断比较未抖动投影；历史采样使用实际抖动投影
    不把抖动当相机切断，不直接累积上一帧GI
接触联动:
    TAA有效时用时间相位；关闭沿用固定相位及独立保边模糊
历史失效:
    首帧/开关/倍率/DPR/尺寸/模型/动作跳转/相机切断/后台返回/上下文恢复
    仅清时间历史，不复位角色根或相机距离
资源与兼容:
    按需分配；WebGL2不支持则TAA不可用，倍率仍可调
    浮点目标仅能力允许时启用；颜色/alpha语义显式保持
验收:
    实际GPU边缘累积、历史深度/覆盖/颜色拒绝、透明边缘和无反馈
    真实米娅动画/相机、PMX/GLB、AO/接触/SSGI组合
    DPR1/2的.25/.5/1/1.5/2倍率、设备降档、刷新/复位/后台变换
    关闭/resize/异常恢复、拾取/AR与诊断预览
```

实际接口：normalizeRenderSettings/calculateCanvasSize；createTemporalAA返回render/invalidate/dispose/active/getState，runTemporalAction处理异步重播失效；独立AO暴露invalidateTemporal/getTemporalState/setTemporalContent，render支持bypassTemporal。五个按需目标为当前颜色、两个历史颜色和两个RGBA8历史深度；支持浮点时颜色为HalfFloat，否则RGBA8。8相位不改变camera.view或世界变换，保留原AR投影并恢复逆矩阵；SSGI单独存previousStableProjection用于切断。

## 2026-10-09 抗锯齿模式TAA/FSR2契约（已实现并验证）

```text
已有声明 := renderer/camera、runtime.resize、ambientOcclusion.render、createTemporalAA历史管线
新增设置 := aaMode='taa'（旧taaEnabled映射）、fsr2Scale=.67（.50..1、步长.01）；复用既有render storageKey
设置规范 := taaEnabled=false为总开关；aaMode只取'taa'/'fsr2'；旧存储缺aaMode -> 'taa'；aaMode字段只在总开关有效时生效
canvasScale := 最终Canvas输出像素倍率（原契约不变）
输出尺寸 := renderer实际drawingBufferSize；设备限制按输出尺寸等比执行
输入尺寸 := taaEnabled && aaMode=='fsr2' && WebGL2有效 ? max(1,floor(输出尺寸*fsr2Scale)) : 输出尺寸
AO/接触/SSGI当前场景目标 := FSR2模式为输入尺寸；TAA/关闭/旁路时为输出尺寸；camera.aspect始终按舞台尺寸
TAA目标 := 普通TAA保持原有五目标/输出尺寸；FSR2当前颜色输入尺寸 + 双缓冲历史颜色/深度输出尺寸
jitter := 普通TAA保持原序列；FSR2偏移按内部输入像素计算；finally恢复基础projection/inverseProjection
普通TAA模式 := 现有1:1最终RGBA场景绘制 -> 相机/深度重投影 -> 历史混合 -> 输出（行为不变）
FSR2模式场景绘制 := renderSpatial绑定输入尺寸current target；读取同尺寸current depth；每帧一次
FSR2 resolve(输出像素uv):
    lowUv := 将输出uv映射到输入纹理
    currentDepth := 在lowUv采样输入深度；position := 使用对应输入像素中心和逆投影重建
    currentColor := 对低分辨率邻域执行深度引导空间重建并限制透明/边缘混色
    previousPosition := previousView * cameraWorld * position
    previousUv := previousProjection投影 previousPosition
    若越界/深度/覆盖不匹配 -> 当前重建颜色
    否则 historyColor := 读取输出尺寸历史并按当前邻域裁剪/颜色变化降低权重
    outputColor := 当前重建颜色与historyColor混合（预乘RGBA）
更新 := 将输入深度重采样/编码到输出尺寸历史深度，交换历史读写
present := 输出尺寸全屏pass写回原render target；恢复viewport及当前target
模式互斥 := aaMode只选择普通TAA或FSR2；不串行累计两套历史resolve
总开关关闭/设备不支持WebGL2/诊断/导出旁路 := 输入尺寸=输出尺寸；维持既有行为和尺寸
PNG捕获(宽,高):
    camera.userData.mmdArTaaBypass=true -> 临时resize输出画布/目标 -> render({bypassTemporal:true}) -> 发起blob读取
    等待blob期间其它帧同样旁路FSR2缩放；finally恢复标记/Canvas倍率/舞台尺寸/相机aspect/clear状态
无运动信息 := 不生成、不读取object/骨骼速度纹理；动态像素仅靠深度/覆盖/颜色拒绝
失效 := 开关/模式/FSR2比例、输出尺寸、模型/动作、相机切断、后台、WebGL上下文恢复
释放 := 关闭/异常/销毁 -> 释放当前/历史目标，finally恢复camera和renderer状态
验收 := 旧设置映射、模式切换、输入输出尺寸、jitter像素、历史别名/拒绝/释放、真实GLSL/alpha、PNG全尺寸、目标设备帧时
```

## FSR2轮廓边缘滤波（已实现并验证）

```text
present(tColor, mode, outputSize):
    if mode != 'fsr2': 原样执行既有present与色彩空间/预乘alpha转换
    else:
        读取center、N/S/E/W和NW/NE/SW/SE八邻颜色，边界UV夹到半texel
        luma := dot(预乘rgb, .299/.587/.114) + alpha*.05；范围覆盖九点
        若lumaRange < max(1/32, lumaMax*.125) -> 输出center
        edgeNormal := vec2(lumaE-lumaW,lumaS-lumaN)；edgeDirection := (-edgeNormal.y,edgeNormal.x)
        reduce := max(四角luma均值*.125,1/128)；方向长度限幅[-8,8]个输出像素
        sample alongA := 沿edgeDirection的1/3与2/3位置均值
        sample alongB := .5*alongA + .25*(方向两端样本和)
        luma(alongB)越过局部lumaRange -> 选alongA，否则选alongB
        输出 := 选中预乘RGBA -> 既有色域/tone mapping -> 维持预乘输出
    FSR2只在现有全分辨率present pass执行；TAA edgeAaEnabled=false
    不写回时间历史，不新增target/运动矢量/设置字段
验收 := scale .5与1.0斜边coverage增加、alpha跨jitter RMS降低；内部色/透明alpha与TAA回归正常
```

## FSR2斜边方向估算修正（已实现并验证）

```text
现状 := 初版FXAA edgeDirection仅由四角亮度差计算；对角覆盖可能抵消
方向 := gx=luma(E)-luma(W), gy=luma(S)-luma(N); edgeTangent=(-gy,gx)
验收 := angle∈{0°,45°,90°}, scale∈{.5,1.0}
    比较滤波开关后的部分覆盖和静态alpha跨jitter RMS；三方向都改善
    平坦颜色、透明alpha、普通TAA真实GPUfixture不变且无GL错误
```

实测RMS（开滤波前→后）：比例0.5下0°/45°/90°为35.1389/44.7639/35.1389→34.3737/30.8670/34.3737；比例1.0为34.7781/30.7673/33.5204→33.5596/21.2193/32.3604。


目标尺寸契约：普通TAA历史颜色/深度仍与Canvas输出同尺寸；FSR2模式仅当前场景颜色和深度按内部比例缩小，TAA当前输入颜色目标为内部尺寸，两个历史颜色与两个历史深度目标始终为输出尺寸。`canvasScale`仍仅改变最终Canvas backing buffer，`fsr2Scale`只改变FSR2内部输入比例。

## 2026-10-09 接触屏幕步进、粗细深度确认与独立保边模糊（已实现）

参考 := 用户指定知乎文章的两级深度/屏幕步进；普通Three深度与朝光源约定按项目实现

```text
规范化设置:
    接触强度0..1、距离.02..3、采样4..64步；旧质量迁移12/20/32步
    contactBlurPassCount = 整数限制0..3，默认1
    contactBlurRadii = 三个整数限制1..5，默认[3,3,3]
    GI模糊保持独立；两项效果默认关闭；本地存储和灯光复位覆盖新增参数
准备本帧接触深度:
    接触开启 -> 创建RGBA8 near/far范围目标ceil(全宽/2) × ceil(全高/2)
    每格读取精确2×2原像素；奇数末行/列夹紧；near向下、far向上16位量化
    有效near/far各额外向外扩展一码，抵消float32乘法在整数码边界的舍入；背景near保留1哨兵
    背景参与far范围，保留薄片/背景混合；关闭接触或销毁立即释放
    每帧先归约当前tDepth，再绑定tContactDepth；不使用SSGI前帧HZB
接触追踪(start,方向,距离,bias,步数):
    投影起终点，齐次裁剪w、近远面和屏幕四边；退化段返回无命中
    保存裁剪后UV/deviceDepth段及端点w比例
    固定空间噪声相位，4步无附加偏移、12步以上使用完整相位，不随帧号变化
    粗步进度经端点w比例换算为透视屏幕进度，保持物理步距
    每步仅标量更新UV/deviceDepth，不做表面位置矩阵重建
    局部偏置 = 用当前deviceDepth的逆w与投影深度分式换算物理bias
    厚度 = 正交参考射线投影差 × .04 × max(.07,屏幕进度)，下限6倍局部偏置
    当前2×2范围全在非遮挡侧且之前未遮挡 -> 略过全深度，记录非遮挡
    范围全在厚度外遮挡侧且之前已遮挡 -> 略过全深度，保留遮挡
    其他情况 -> 同一UV读取全深度，检查进入或穿出跨越
    跨越 -> 完整深度二分8次，每探针重新换算局部bias
    进入选高端，穿出选低端；仅最终重建视空间rayPoint及表面hit
    拒绝背景、厚度外、物理gap<=bias、起点自遮挡及距离外命中
    输出原强度/实际距离/边缘衰减后的接触alpha
GI追踪:
    traceCurrent与traceHistory保留旧策略；不复用新接触入口
滤波计划:
    先GI RGB、再接触alpha，各0..3轮，每轮水平/垂直两pass
    从前一pass目标读取，写不同目标，在三个效果目标间连续切换
    每轮按独立半径限制1..5效果像素；空间/深度平面gap/法线权重保边
    GI模式保持中心alpha；接触模式保持中心RGB；背景不参与
    合成使用最终目标，保留原深度/法线上采样
渲染状态:
    每target使用自身物理viewport；成功/异常都恢复原渲染目标
    尺寸/DPR变化调整范围与效果目标；GI关闭释放历史，接触关闭释放本帧范围
面板:
    正式接触分类增加轮数与按轮数显隐的逐轮半径；独立持久化与复位
验收:
    GPU执行旧GI60组、新正交54组、新透视84组（共198），包含朝相机/屏幕边缘/真正近平面
    GPU执行平面alpha、深度阶跃、法线折面、背景及另一通道不变；精确奇数2×2归约
    单位测试覆盖默认/夹取/存储/复位、串行目标、当前帧/奇数DPR/释放/异常恢复
    实际米娅检查0/1/3轮内部与无遮挡区域、静态重复、刷新/DPR/正式分类
```

## 2026-10-09 后台清理保留普通预览（已实现并验证）

```text
输入 := 浏览器visibilitychange隐藏或pagehide；当前独立测试页运行状态
已确认 := idle且tracking=false且AR相机active=false时仍调用resetArCameraPose
实际输出 := 角色根平移归零；cameraZoomFactor从1.8变为1；相机距离重新拟合
目标输出 := 空闲预览角色与相机变换保留；AR和校准资源仍释放

自动清理标记 := 生命周期事件触发；普通手动停止使用原显式复位策略
原AR相机状态 := 释放任何适配器之前读取当前active状态
保留普通预览 := 独立测试页 且 自动清理标记 且 原AR相机未激活
未知状态兼容 := 缺少AR相机诊断接口时保持原复位策略，避免遗留活动AR
取消请求 := 更新跟踪请求代次，结束待完成的视频准备及识别启动
资源释放 := 停止校准流、跟踪帧、识别会话和适配器实际持有的流
适配器取消参数 := 共享清理传入保留普通预览；适配器pagehide传入自动保留；显式取消默认复位
适配器退出AR := 仅自动保留且释放前AR相机明确未激活时跳过；其他场景保持原复位
共享显示复位 := 保留普通预览时跳过；其他场景沿用显式复位
清理结束 := 隐藏校准面板并清空校准状态；按既有规则更新定位状态

模拟恢复目标 := 隐藏前正在运行模拟定位时记录所选目标
前台恢复 := 等待清理结束，核对代次/模拟模式/摄像头开关/目标后重新定位
空闲前台恢复 := 保留当前角色根和相机；尺寸变化只更新渲染尺寸与投影
手动停止 := 清空模拟恢复目标，保留原显式退出与复位语义
重复pagehide := 独立测试页每次都清理，兼容BFCache恢复后的再次隐藏；正式页保留原监听策略
验证 := 真实模型平移与1.8倍缩放，重复隐藏/可见、pagehide/pageshow及resize
兼容验证 := 活动模拟定位轨道结束，新会话轨道不同；手动停止后不会自动恢复
验证结果 := 真实模型/模拟定位2项浏览器回归通过且无跳过；旧实现角色X从1.739变0而失败
额外验证 := 迟到校准摄像头轨道结束；重复pagehide取消请求；实际AR退出；手动停止zoom复位1
构建结果 := npm run build:web:mmd-ar-test成功，本地生成副本与脚本指纹已更新
合并后依赖变化 := 正式米娅资源清单使用/api/mmd/static/{64位版本}/mmd路径
独立网页构建 := 版本化与旧固定资源路径都转换为./mmd/；保留模型/动作版本字段
静态兼容约束 := 正式服务URL及APK分支保持原值；独立网页不依赖服务API提供模型文件
资源清单验证 := modelUrl/motionUrl都为相对mmd路径且指向已打包文件，再执行实际加载与生命周期回归
合并后最终结果 := 资源清单及两个真实浏览器用例3/3通过，无跳过；正式接口与APK路径不变
```

## 2026-10-08 接触阴影对齐主光阴影偏置与边界

```text
每帧场景深度/颜色完成后，接触阴影pass准备：
  lightDirection := normalize(keyLight.worldPosition - keyLight.target.worldPosition)
  mainShadowActive := renderer.shadowMap.enabled 且 keyLight.castShadow
  if mainShadowActive 且 keyLight阴影相机为正交相机:
    receiverNormalOffset := keyLight.shadow.normalBias
    receiverLightOffset := -keyLight.shadow.bias * (shadowCamera.far - shadowCamera.near)
  else:
    receiverNormalOffset := 0
    receiverLightOffset := 0
  接触射线的深度重建法线 n、表面位置 p 与像素保护偏置 pixelBias := 原算法
  rayStart := p + n * (receiverNormalOffset + 2 * pixelBias)
             + lightDirection * receiverLightOffset
  按原主光方向、接触距离、厚度/自遮挡保护和采样步数追踪当前帧可见深度

全分辨率几何引导上采样：
  四个低分辨率效果样本 -> 计算原双边几何权重 w（双线性 * 深度 * 法线）
  SSGI RGB := 按w加权平均（原行为）
  接触阴影alpha := w最大样本的alpha（不平均alpha，避免边界混合拖移）
  无有效样本 -> RGB/alpha为0
```

适用范围 := 独立MMD-AR接触阴影；不修改Three.js主光阴影结果、SSGI RGB、正式显示端或用户设置
TAA兼容 := 同时保留contactFramePhase时间采样、基础投影历史和生命周期清理；两项接触bias独立传入
限制 := 深度重建几何法线近似材质法线；单层屏幕深度/低分辨率仍可能造成剩余边界差异

## 2026-10-08 接触阴影补齐反向深度穿越（已实现）

```text
输入 := 强度1、距离3、30步；用户反馈内部仍漏阴影，仅边界发黑
已确认 := 真实米娅近景可复现；关闭接触阴影时新增暗带消失
已有路径 := 当前帧追踪只识别深度差从非正变正；轮廓跳变超过厚度则拒绝
缺陷 := 射线从轮廓进入遮挡背后，再连续穿出可见表面时，正到非正的跨越未参与细化
追踪新增参数 := 是否允许反向穿越
接触阴影调用 -> 允许反向穿越；SSGI当前帧回退调用 -> 不允许
跨越候选 := 原正向穿越 或 (允许反向 且 前一步深度差>偏置 且 当前深度差<=偏置)
候选 -> 标记进入/穿出方向；二分4轮始终保留深度差为正的一侧
细化命中点 := 进入取区间高端；穿出取区间低端；命中距离与所取端点一致
最终接受 := 原背景、偏置、厚度、自遮挡距离检查通过
不满足 -> 继续追踪；不把任意大深度轮廓跳变直接当作遮挡
验证 := 正向/反向连续交点、双向深度跳变拒绝、背景/自遮挡、4/12/20/30/32/64步
真实模型验证 := 原参数、固定相机/动作、接触阴影关闭与开启；读取内部像素，检查阴影内部增加而无遮挡区域保持
范围 := 接触阴影；原独立步数/质量/存储不变；SSGI算法、模糊、刷新viewport保持
验证结果 := 60组实际GLSL检查及完整Shader编译通过；定向13/13通过；Web构建成功
真实像素 := 脖子内部亮度118.43->48.60，无遮挡胸部211.30->211.30
回归有效性 := 临时仅关闭新反向策略，内部像素断言失败；恢复策略通过
```

## 2026-10-08 接触阴影独立步数与刷新显示修复（已实现）

```text
新增设置 := 接触阴影采样步数；首次默认12；整数范围4–64
旧设置缺字段 -> 按有效旧质量低/中/高初始化12/20/32
存在设置 -> 数值校验、取整、限制范围；非法值回到对应旧质量步数
面板 := 灯光面板下方正式分类；复用现有分类标题/开关/展开按钮；接触阴影滑块 + 间接光内SSGI子分类
输入变化 -> 归一化设置 -> 更新现有本地设置对象 -> 保存现有存储键
当前帧渲染 -> 更新独立接触阴影步数uniform
当前帧追踪参数 := 射线起点、方向、距离、偏置、实际步数
接触阴影调用 -> 传独立步数；SSGI回退调用 -> 传原质量步数
静态循环上限 := 64；达到实际步数停止；厚度/步长/细化区间均使用实际步数
历史HZB追踪 := 保留SSGI原质量步数与上限32
灯光恢复默认 -> 接触阴影步数12；刷新保留设置
自测 := 迁移、边界、整数、持久化、复位、GI参数独立、4/12/20/32/64步GLSL行为
离屏pass := 切换目标自动使用该目标viewport；不调用全局setViewport
完成离屏pass -> 恢复原渲染目标；主画布全局viewport保持原尺寸
刷新回归 := 保存接触阴影/SSGI设置 -> 重载 -> 等待模型 -> 实际像素及viewport检查
状态 := 独立步数、正式分类与viewport修复已实现；手机画质与帧耗时待验收
```

## 2026-10-08 接触阴影跨越后厚度校验（已实现，GPU回归通过）

```text
当前帧追踪 := 接触阴影与SSGI当前帧回退共用；保留历史帧/HZB独立追踪
跨越候选 := 当前深度差 > 偏置 且 上一步深度差 <= 偏置
候选 -> 在前一步与当前步之间二分细化4轮；粗步深度差不作为厚度拒绝条件
最终命中 := 非背景 且 细化深度差 > 偏置 且 细化深度差 <= 原厚度
    且 细化命中表面距射线起点 > 偏置 × 3
最终命中 -> 沿用置信度及距离衰减；否则沿用后续步进
固定上限 := 步数仍为12/20/32；二分仍为4轮；不增纹理、滤波或配置
验证 := 真实GLSL受控深度纹理：大步跨越可细化命中、小跨越仍命中、厚度外跳变拒绝、无遮挡拒绝、起点附近自遮挡拒绝
验证结果 := Chromium/SwiftShader三档18种输入通过；接触阴影与屏幕光照10/10通过；Web构建成功
边界 := 完整工作区历史HZB Shader另有packed保留字编译错误；用户模型与手机性能待现场验收
```

## 2026-10-08 接触阴影边缘暗带诊断（当前行为，未修复）

```text
当前厚度 := 最大值(偏置 × 3, 追踪距离 ÷ 步数 × 1.5)
当前候选命中 := 深度差 > 偏置 且 深度差 < 厚度 且 上次深度差 <= 偏置
    另需满足命中表面离起点足够远
候选满足 -> 4轮区间细化 -> 检查细化深度差及背景 -> 计算厚度置信度
候选不满足 -> 更新上次深度差 -> 继续下一步
已确认条件级缺陷 := 首次深度跳变超过厚度时不细化；后续深度差仍为正则可能持续漏判
默认低质量示例 := 距离0.3 / 12步 / 偏置0.001 -> 厚度0.0375
数值检查 := 深度差0.10至0.02的正值序列全部拒绝；直接跨越至0.02接受
画面附加约束 := 最多半分辨率且低质量长边384；GI滤波保留接触阴影中心alpha
验证状态 := 现有屏幕光照测试5/5通过；未复现用户视角GPU结果
候选修正（尚未实现） := 分离跨越识别、区间细化、最终厚度校验；保留自遮挡保护
```

## 2026-10-03 GPU 顶点布料 500ms 回退（已实现）

```text
启动读取求解器：保存值为 vertex-cloth-gpu 或 URL safePhysics=1 -> Ammo；持久化 Ammo
用户手动开启 GPU：初始化与单次顶点更新使用 500ms 墙钟预算（含等待/提交）
一次更新 -> 冻结目标 -> 生成逐 pass 任务；自碰撞按纹理行切片
调度：每批最多4个 pass；fenceSync + clientWaitSync(0) 非阻塞轮询
    上批未完成不提交下批；一份顶点更新未完成不开始另一份
    每批前后/轮询检查预算；超过500ms或GPU错误 -> 停用顶点层
回退：取消定时器/栅栏/材质绑定；恢复原网格；继续已有Ammo骨骼实例
    保存求解器 Ammo，面板显示回退原因；不执行CPU整模自碰撞
完成：仅全部计算结束后更新显示纹理；动作切换/销毁取消旧任务
限制：已提交的draw与驱动编译不能中断，500ms不是硬实时中断保证
```


## 2026-10-02 光照方向函数显式绑定（已实现）

```text
已有声明 := createPmxLighting内部lightDirectionToPosition/normalizeLightDirection
    PMX.applyKeyLightPosition调用主光及补光方向换算；KEY_LIGHT_DISTANCE属于模块上下文
新增契约 := PmxLighting返回 { setLighting, lightDirectionToPosition }
操作流程 := 创建光照模块 -> PMX主闭包接收两个函数
    模型/灯光/阴影拟合 -> applyKeyLightPosition -> 已绑定方向函数 -> 原位置换算
行为保持 := 默认31/46，经度正弦/纬度正弦/水平余弦，原距离及单位尺度
验证 := 函数可调用、默认/六个方向轴/异常数值、主补光真实定位调用
    生成网页的运行时与模块契约一致，浏览器首次模型加载无该ReferenceError
状态 := 用户确认后已补齐返回/接收
    4项真实模块/源及生成调用回归 + 1项真实浏览器米娅首启/主补光更新通过
    npm网页构建通过，59脚本/4内联/40指纹通过；产物同步本地web-dist
    用户要求提交并合并正式包，修复与共享拆分依赖同次纳入Git；旧内联实现无此作用域缺口
```

## 2026-10-02 刚体衣服相对气流（已实现）

```text
已有声明 := PMX形状/尺寸/质量、刚体位置/姿态/线角速度、风方向/强度/阵风/时间
新增定义 := RigidAerodynamics { 投影面积、受力点速度、相对气流、阻力系数、有效子步作用 }
范围 := 独立测试Ammo与刚体XPBD；顶点布料源码不修改
风等级 := 沿用0–30效果等级；有效风速sqrt(20*子步平均强度)，空气系数0.5
    面积系数采用模型单位，不声明SI单位；实际效果待模型校准
每物理子步:
    推进已有强度缓动；按模拟时间及空间连续相位采样风，阵风0均匀
    世界气流换到当前物理坐标，模型旋转不改变外部风方向
    对非type0且正质量刚体:
        读取刚体姿态、线速度和角速度；借用Ammo包装只读，不destroy
        受力点速度 := COM线速度 + 角速度 cross 真实偏移力臂
        相对气流 := 空气速度 - 受力点速度
        局部迎风方向 := 逆刚体姿态旋转相对气流单位方向
        投影面积 := 按shapeType选择球/盒/胶囊投影公式
        球 := pi * radius²
        盒 := 4*(height*depth*abs(nx)+width*depth*abs(ny)+width*height*abs(nz))
        胶囊 := pi*radius² + 2*radius*height*sqrt(max(0,1-ny²))
        退化/无效输入 := 不施力；同速相对气流0 := 不施力
        阻力系数 := 非负面积系数 * 投影面积 * 相对速度大小
        有效逆质量 := 自由体1/质量；type2采用受力点逆质量矩阵迹的上界
            局部力臂r := 逆刚体姿态 * 真实力臂
            上界 := (ry²+rz²)/Ix + (rx²+rz²)/Iy + (rx²+ry²)/Iz，零惯量项为0
            防止斜风遗漏极小惯量轴而导致该轴速度过冲
        有效阻力 := 相对气流 * 阻力系数 / (1 + h * 有效逆质量 * 阻力系数)
        注：这是沿当步相对方向冻结系数的隐式近似，不修改原求解器
        自由动态体 := 向既有力通道施加有效阻力，由原求解器积分
        positionDriven type2 := 保留位置/目标速度，只计算偏移 cross 有效阻力
            力矩转局部按实际惯量限幅12rad/s²，再转回物理坐标
    原关节/碰撞/阻尼/子步锚点流程保持
生命周期 := 关闭不施加新风力，已有速度保留；暂停不推进相位；缓存随物理释放
构建 := web-physics-wind.js在共享适配之后注入测试受风实现
    测试模块风依赖指纹沿用现有build/stageXpbdPhysics流程
验证 := 球/盒/胶囊面积、旋转/坐标、同速/逆风、小质量/强度30、不同子步
    type0不受风/type2位置约束及力矩限幅、确定性连续阵风、切换释放与无风回归
状态 := 用户确认后已实现；24项自测通过，基线快照网页构建及43脚本/4内联/34指纹通过
    共享迁移修复后直接工作区构建和59脚本/4内联/40指纹通过
    风世界采样坐标 := 更新入口保存mesh.matrixWorld * 当前物理空间mesh.matrixWorld逆矩阵 * COM
    阵风相位 := 0.19*x + 0.11*y + 0.23*z，仅随模拟时间/空间连续变化
    共享advanceWindState新增可选阵风开关，默认保留原行为；刚体取得未调制平均强度后按位置采样
```

## 2026-10-02 边缘光AO遮蔽门控（候选伪代码，未实现）

```text
已有声明 := PMX rim颜色/强度/方向，AO深度/模糊/edgeResolve/最终合成
新增偏好 := rimAvoidAo，默认true，两边缘光共用，本地保存/复位
生效条件 := AO有效且已开启、边缘光至少一盏有效开启、rimAvoidAo、非正常法线预览
当前帧顺序 := 无遮蔽门控的原色彩/深度 -> 原AO采样/保边模糊
    -> 复用最终visibility求全尺寸遮蔽图（同边界修正和强度）
    -> 绑定遮蔽图，重新绘制角色色彩（复用原阴影、不重新推进物理）
    -> 原AO颜色合成，所有材质其他光照保持
遮蔽量 := clamp((1-visibility)*AO强度,0,1)
边缘光保留比例 := 1-smoothstep(0.01,0.08,遮蔽量)
rim贡献 := 原rim贡献 * 保留比例；AO关闭 -> 比例1
资源 := 单独全尺寸遮蔽目标，禁止采样当前写入目标；尺寸同步，关闭/dispose释放
失败/切换 := 复原renderer状态/材质门控，清旧遮蔽关联，原AO与边缘光仍能绘制
验证 := 仅rim差异受门控、AO0/关闭恢复、强遮蔽为0、过渡连续
    全/半分辨率和边界修正一致，模型/开关/resize/保存/资源回收及真实Shader编译
状态 := 候选方案待确认，尚未修改相关代码
```


## 2026-10-02 TMP14自动选区顶点布料（已实现，待现场验收）

```pseudo
solver选项 := ammo | xpbd | vertex-cloth；旧three-xpbd继续迁移xpbd
vertex-cloth加载Ammo作为非布料基础物理，新增四模块；正式源不改，仅测试构建副本注入
sourceGeometry := 每个mesh的原始几何（WeakMap登记，VMD临时双helper共享原始源）
拓扑(sourceGeometry, Loader最终rigidBodies, constraints, bones):
  physicalBones := 有效boneIndex且type1/2、weight>0
  boneComponents := 动态关节连接及直接动态父子；不通过静态锚点合并全部部件
  fixedBones := 原type0/无质量体；只增加直接连接原静态体且六轴lower==upper的根部
  skinPhysicalWeight(vertex) := sum(skinWeights of physicalBones)
  candidateTriangle := 至少一角权重>=0.5；低于阈值的接缝角随动画固定
  weld := 相同位置(量化1e-5)+相同归一蒙皮权重；不跨不同蒙皮焊接
  groups := candidate三角按骨骼组件、共享焊接粒子的网格连通分组；跨链共享物理顶点合组，静态接缝不合组
  fixedParticle := 非物理接缝，或直接固定骨骼权重>=0.5；不把自由网格边全部固定
  triangles := 焊接后三角去重(含反面)；退化三角丢弃
  stretch := 唯一边restLength；bend := 同边邻三角对边粒子restDistance（非二面角）
  mass := 中性三角面积×独立面密度(默认1)，均分三顶点；不是刚体weight换算
  默认启用有固定点且有自由点的组；无固定点组提示，可单独启用/停用
  稳定组ID := 模型拓扑签名+首三角/骨骼组件；同模型本地保存组开关
selectedGroups变化:
  先创建新基础Ammo实例；只有某骨骼的全部相关候选组都启用才替换其原驱动
  selectedRigidParams := 对应刚体type0/weight0/groupTarget0，移除接触该体的关节
  未完整覆盖的共享骨骼保留原基础物理，反向蒙皮确保顶点不会重复驱动
  新实例成功后切换并释放旧实例；失败保留原组/实例/显示；重置布料至当前动画姿态
每帧update:
  原Ammo更新非布料骨骼；更新mesh.matrixWorld和skeleton矩阵
  原始position+当前vertexMorphDelta -> 完整加权蒙皮 -> 模型局部目标
  自由粒子跟随当前蒙皮后的表情增量（不跟随动画整体），拉伸/弯曲restLength同步中性morph；原几何仍只读
  固定目标、身体sphere/box/capsule代理缓存前后帧；代理排除本组替换体/自身骨骼
  N := 现有基准归一(3..180，默认45)；h := 有效帧时间/N
  repeat N:
    动画固定点/代理位置及旋转插值；自由点质量积分重力/现有风场（时间缓动）
    每子步边长约束一遍，简化弯曲一遍，身体代理碰撞一遍；回算速度+时间阻尼
    代理宽阶段AABB、PMX碰撞组掩码；首版不做布料自碰撞
  cloneGeometry := 原几何克隆；绝对morph转相对delta以保留表情和直接顶点控制
  desiredLocal := 模拟粒子；inverse(weightedSkinMatrix) -> preSkin - currentMorphDelta
  回写clone.position、局部三角变形法线反向蒙皮；保留UV/材质组/materialMorph/透明度/阴影/AO
  奇异蒙皮矩阵回退动画目标；原几何从不被改写；相同模拟粒子映射接缝/反面渲染顶点
预览 := 可选青色固定点/橙色自由点，模型局部Points，不受普通骨骼开关控制
面板 := TMP14选项、分组复选框/数量/无固定提示、预览开关；状态粒子/约束/子步/总物理耗时
physicsHz := 顶点求解不用；非布料Ammo保留已有设置，UI在顶点模式禁用Hz调整
reset/切VMD := 清速度并同步动画目标；暂停不积分
大间隔/恢复 := 原Ammo只重置锚点采样并保留动态速度；顶点布料同步目标且清自身速度
physics dispose := 先释放自己的基础Ammo，再释放预览/clone；只在当前geometry属于自己时恢复存活旧helper或原几何
构建 := 依赖逐级SHA256指纹；helper/runtime/display和面板同接入；模块<=1000行
检查 := npm现有网页构建+静态语法/导入/指纹/ID；用户未要求，不新增或执行测试/模拟
```

首版固定默认：面密度1、拉伸柔度0、简化弯曲柔度0.001、速度阻尼2/秒、粒子接触厚度按模型高度比例；数值使用模型本地单位，不等价PMX六K。性能与实际穿透/表情/AR效果需人工验收。

## 2026-10-02 自动物理骨骼选区候选（历史，已由实施节取代）

```text
用户要求 -> 从PMX刚体骨骼自动筛出顶点布料区域
输入 -> 加载器最终rigidBodies/constraints/bones + skinIndex/skinWeight/index/groups
物理候选骨骼 -> type1/2、有质量、有合法boneIndex；不是原文件未转换的type
顶点动态权重 -> 各影响骨骼属于候选集合时的蒙皮权重之和
    内部候选阈值0.5；三角邻接扩充边界，不选全角色
分组 -> 关节链/骨骼层级 + 三角连通；材质映射保留正反层和渲染信息
固定点 -> type0锚点/直接全锁根部、与非物理区域连接的接缝
    只固定真实附着区域；自由边仍自由；不把type2或所有外边界全锁
    固定状态不沿动态链传播；推导不明确组提示并给预览/单组禁用
布料组 -> 自动生成候选，可独立开启；包/金属附件等不能仅凭type误判为薄布
    UV/正反重复点正确映射，分层不无条件焊接
原驱动 -> 仅选中组协调停用旧布料骨骼物理，其他基础刚体保持
求解 -> TMP14粒子拉伸/简化弯曲；固定点随骨骼、身体代理碰撞、基准N子步
    顶点布料专用柔度/质量，原刚体六K不可直接换算；自碰撞未作为首版默认
统计只读米娅 -> 164候选骨骼/34231正权重顶点/32882权重>=0.5顶点
    多区域包括裙/头发/包/饰品，统计不是实际模拟或选区通过验收
文件范围 -> 前节4新模块 + solver/panel/build；具体方案确认后再实施
```


## 2026-10-02 TMP14顶点布料候选（历史，已由实施节取代）

```text
已有 := PMX position/index/uv/skinIndex/skinWeight/morph/材质group；Ammo/刚体XPBD
用户期望 := 增加顶点布料模式，参考Ten Minute Physics14
待确认 := 初始区域、选区方式、固定点/固定骨骼、人体/自碰撞范围、专用柔度/质量约定
创建选定衣物：
    构建模拟顶点/三角边/相邻三角形对边对及渲染顶点映射
    UV重复点/正反面/多层 -> 明确缝合与分层规则，不无条件坐标焊接
    保存原顶点/材料group，协调排除选区原刚体布料驱动
    粒子质量 -> 面积/密度或选定参数；固定点inverseMass=0
每帧骨骼/基础刚体更新后：
    取得蒙皮锚点目标、身体球/胶囊/盒碰撞代理及角色模拟空间
    h=有效帧间隔/基准数值N；N沿用现有3–180子步控件
    每子步 -> 插值更新固定点 -> 重力/风/阻尼预测 -> 身体碰撞
        边长拉伸距离约束一遍（alpha=拉伸柔度/h²）
        邻三角对边顶点距离弯曲约束一遍（alpha=弯曲柔度/h²）
        必要接触纠正 -> 速度回算；不新增固定6轮
    生成选区普通Mesh顶点/法线，与未选原蒙皮网格协调绘制，不重复蒙皮
    材质/morph/UV/透明/阴影/AO同步 -> 显示粒子数/约束数/耗时
reset/物理关闭/换模型/VMD/切模式 -> 恢复原数据、清速度/实例与原衣物驱动
方案文件 := 4新独立模块 + solver/panel/build，单文件不超过1000行
当前状态 := 仅研究/候选；等待用户区域与具体修改方案确认，未写运行代码
```


## 2026-10-02 阴影像素对齐与半幅基准（已完成）

```text
已有声明 := fitShadowCamera、cameraScale、两灯shadow.camera/mapSize、Three shadow.updateMatrices
新增基准比例 := 0.5；面板cameraScale默认仍1、规范化及存储规则保持
自动基准半幅 := radius * SHADOW_FRUSTUM_MARGIN * 0.5
实际半幅 := 自动基准半幅 * cameraScale
模型/灯光/倍率变化 := 从自动基准重新拟合，不乘已有相机边界
新增跟随缓存 := 已拟合角色根节点、世界位置/比例；两灯target保存角色中心
绘制前角色跟随:
    无角色 -> 清缓存；根节点更换/世界比例改变 -> 重新拟合并刷新缓存
    世界位置变化 -> 平移差 := 当前位置 - 缓存位置
        两灯position/target及阴影承接面同步加平移差；角色中心同步移动
        更新缓存，保持范围宽高/近远裁面/光向，再执行像素对齐
    纯动作骨骼变化 -> 不因此逐帧拟合角色包围范围
绘制阴影前逐盏启用光:
    保留当前宽高，先还原正交中心偏移到0（避免微小连续移动积累抵消跟随）
    更新基础投影矩阵、light/target世界矩阵 -> shadow.updateMatrices(light)
    固定世界参考原点 -> 投影到阴影相机平面
    像素坐标 := 投影坐标按当前有效ShadowMap宽高映射
    像素误差 := 四舍五入像素坐标 - 像素坐标
    正交中心补偿 := -像素误差 * 正交覆盖宽高 / ShadowMap宽高
    left/right一起加X补偿；bottom/top一起加Y补偿
    宽高/near/far/光照方向保持 -> 更新投影与阴影矩阵
重复帧 := 从居中基准重算同一补偿，最终边界不漂移；复用向量，不每帧求角色包围范围
尺寸/倍率/方向/模型变化 := 使用当帧矩阵与新步长，原点投影仍落整像素
默认/复位 := cameraScale=1；实际自动覆盖半幅为原来的0.5
验证跟随 := 拖动中/停止、setPose定位、缩放/复位/换模型 -> 阴影跟随且对齐
    纯平移范围宽高/光向保持，静止时不重复拟合；主视角保持原操作
验证 := 默认倍率1、范围半幅减半、双光四档整像素、往返/移动/尺寸变化无漂移
    对齐前后覆盖宽高相同、近远裁面不变、贴图资源不增加、保存值兼容
实现 := 用户确认后按先行伪代码完成；基准与倍率语义保持
验证通过 := 十项单元、真实PMX网页（约347秒）、两项提交片段面板静态检查
    四档网格、移动/定位/缩放/复位、保存及GPU目标回收
构建/引用 := npm网页构建、40脚本/4内联/28指纹通过
手机闪动/裁切与性能 := 待现场验收
```

## 2026-10-01 骨骼球遮挡轴线修复（已完成）

```text
现有问题 -> 球默认transparent=true；轴线transparent=false
Three渲染队列 -> opaque先绘，transparent后绘；跨队列renderOrder不能让轴最后画
关节轴/限位/实际标记材质 -> transparent=true、opacity=1、depthTest=false、depthWrite=false
    只调整所属队列，保持轴线不透明外观、原K色和球尺寸
绘制顺序 -> 球默认0；选中RGB轴renderOrder99；关节轴100；实际标记101
骨骼选择AxesHelper -> 同样transparent=true、opacity=1、renderOrder99
    球仍独立按原遮挡/半透明规则渲染，不改变角色/物理或轴归属
只读米娅PMX -> 261关节；平移783轴全0，旋转783轴全0
    六K灰色符合K0定义；硬限位仍生效，不用轴RGB伪装K大小
文件 -> web-joint-stiffness-debug.mjs、web-skeleton-selection.mjs
构建 -> npm网页脚本退出0，6源/5生成/4内联语法，19导入/16指纹、3源生成一致
    透明队列opacity1和99/100/101顺序静态检查通过；无新增或运行测试或模拟
    真机球遮挡/透明度和各开关效果 -> 待人工验收
```

## 2026-10-01 阴影相机范围倍率（已完成）

```text
已有声明：fitShadowCamera(root)；radius；SHADOW_FRUSTUM_MARGIN；两灯shadow.camera
新增定义：ShadowMapSettings { size, previewEnabled, cameraScale }
相机倍率 := 规范化cameraScale到0.1–2，步长0.01，缺失/空/非法回1
面板新增倍率滑条与读数 -> 复用阴影偏好发布和保存 -> 即时同步
自动拟合半幅 := radius * SHADOW_FRUSTUM_MARGIN
实际半幅 := 自动拟合半幅 * 相机倍率
两灯相机left/right := -实际半幅/实际半幅
两灯相机bottom/top := -实际半幅/实际半幅
相机倍率变化 -> 对当前角色重新执行一次范围拟合 -> 更新投影矩阵/阴影
倍率未变化 -> 跳过重新获取角色包围范围；不重建阴影贴图
模型替换/旋转结束/灯光方向拟合 -> 由同一拟合声明应用当前倍率，不叠乘旧范围
读取旧存储无cameraScale -> 用1保持原自动拟合范围
灯光恢复默认 -> cameraScale回1，同时沿用贴图默认1024及预览关闭
实际预览 -> 整张图展示裁切/角色占用变化
阴影像素网格对齐 -> 现有拟合保持连续值，本次无texel snapping
验证通过 := 八项单元、真实PMX网页回归、两项面板静态检查
    0.1/0.5/1/2、原范围还原、无累乘、存储/复位/灯光拟合与贴图资源稳定
构建/静态通过 := npm网页构建，40生成脚本/4内联/28指纹导入
手机动作/换模型后覆盖与裁切观感 := 待现场验收
```

## 2026-10-08 主相机视锥切片与光源阴影相机拟合（CSM式修正）

```text
状态 := cachedCasterBounds, cachedReceiverBounds, lastCamera/light/model signature
shadowDistance := min(camera.far, targetModelHeight * 4) // 默认角色高度×4，角色高度1.75时约7单位
触发 := 主相机投影/位姿变化、模型根替换/变换、接收面变换、光线方向或cameraScale变化
更新 := signature变化后于当前渲染帧拟合；同帧内最多一次

createCameraSlice(camera, near, shadowDistance):
  对主相机NDC四角分别从near clip与far clip反投影成视空间射线
  在视空间深度-near与-min(camera.far, shadowDistance)上求交
  sliceCorners := 近/远切片共8角变换至世界空间
  sliceCenter := 8角平均；sliceRadius := max(各角到sliceCenter距离)
  无效/退化 -> CSM拟合失败

fitShadow(light):
  更新主相机、模型根、接收面与光源矩阵
  slice := createCameraSlice(camera, camera.near, shadowDistance)
  if slice无效:
    回退旧角色包围盒半幅(radius*1.18*0.5*cameraScale)，标记fallback
  else:
    不以角色/接收面/影子足迹重设XY中心或宽高；模型仅参与光空间near/far深度范围
    centerLight := sliceCenter变换到当前shadowCamera空间；direction不变，不移动light/target
    mapAspect := 实际ShadowMap.width/height
    viewHeight := max(2*sliceRadius, 2*sliceRadius/mapAspect) / 0.78 * cameraScale
    viewWidth := viewHeight * mapAspect
     stability := 按切片球半径而非旋转后的OBB定XY范围；主相机仅旋转时viewWidth/viewHeight不变
     texelSnap := alignTestShadowCamera将固定世界参考点吸附到实际ShadowMap整像素，且每次从拟合边界恢复上帧偏移，避免累计抵消跟随
     cascadeCount := 当前每盏灯仍为单切片/单ShadowMap，不实现多级级联与级间混合
    以centerLight.xy为中心设置正交边界；联动模式不再额外乘0.5
    near/far := 角色与接收面光空间深度范围 + max(0.1, radius*0.25)余量
    updateProjectionMatrix；标记shadow.needsUpdate

resizeViewport(width,height):
  renderer.setSize(width,height)
  camera.aspect := width/height
  if not arCameraState.active: camera.updateProjectionMatrix()
  else: 保留定位跟踪器提供的projectionMatrix
  不调用fitCameraToModel；保持cameraTarget/cameraDistance/cameraZoomFactor与camera.position/quaternion
  不写currentRotationPivot.position/quaternion/scale
  首次加载/替换模型 -> 既有模型提交路径显式fitCameraToModel
  浏览器恢复可见触发resize -> 仍按上述规则，仅更新投影，不自动居中

renderFrame:
  跟随角色移动 -> jointFitter.update()检查签名并按需更新
  联动区域随主相机视锥切片移动；相机旋转/投影不变时sliceRadius与阴影区域大小稳定
  角色偏移/姿势变化不重新居中XY范围，只更新签名及必要的光空间深度
  依次执行现有light-space texel对齐与ShadowMap渲染，保持切片投影中心

规则 := near到shadowDistance构成CSM式相机前方固定距离视锥切片；目标占比0.78控制余量
规则 := cameraScale为唯一联动范围倍率，默认1；不额外乘旧角色中心拟合的0.5系数
规则 := 联动关闭时旧角色包围盒拟合及其0.5基准保持不变；贴图尺寸独立管理
性能 := 角色AABB仅用于深度范围且只在根替换时读取；静止签名不变则不重算
范围 := PMX/静态GLB；正式display VRM/PMX源码不改
验证 := tests/mmd-ar-shadow-map-size.test.js 15/15通过；与公网模型回退组合22/22通过；角色平移/随行灯光、完全离开切片、相机移动、固定投影尺寸及0.5/1/2倍率均覆盖
构建 := npm run build:web:mmd-ar-test成功，生成模块含CSM切片；当前缺少配置Chromium，实际GPU阴影画面待设备/浏览器验收
```

## 2026-10-08 可选主相机联动阴影拟合开关

```text
ShadowMapSettings := { size, previewEnabled, cameraScale, jointFit }
jointFit默认 := false；旧存储缺少jointFit时按false；灯光复位也回false

面板 := 增加“联动主相机计算”复选框
apply(settings, persist):
  jointFit := settings.jointFit === true
  window.MmdArTestShadowMapSettings := { size, previewEnabled, cameraScale, jointFit }
  if persist: 将四字段写入既有aasc.mmdArTest.shadowMap.v1

syncJointShadowFitMode():
  enabled := window.MmdArTestShadowMapSettings?.jointFit === true
  if enabled:
    if 上次状态为关闭: jointFitter.forceUpdate()
    else: jointFitter.update() // 内部签名缓存；相机与切片静止时不重算
  else:
    if 上次状态为开启: fitShadowCamera(currentRotationPivot || currentMesh) // 立即切回旧角色包围盒拟合
    不调用jointFitter.update() // 不跟随主相机重新拟合
  保存本次enabled状态

renderFrame := followTestShadowRoot() 后调用syncJointShadowFitMode()
联动开启 := CSM式主相机near→targetModelHeight*4视锥切片拟合，不以角色为XY中心且不额外乘0.5；cameraScale控制尺寸
联动关闭 := 旧角色包围盒拟合与0.5基准不变；两态的角色跟随、模型替换/缩放及手动cameraScale继续生效
兼容 := 默认关闭；缺失字段的旧本地偏好安全归一为关闭；size/预览/倍率字段保持不变
范围 := 仅独立MMD-AR测试网页；不修改正式display运行时或APK行为
测试 := UI默认/持久化/复位、CSM切片中心追随主相机、角色移动不重置XY中心/尺寸、主相机转向与cameraScale更新、联动关闭旧fit不变
验证 := 更新联合拟合测试并运行Web构建；GPU视觉验收待可用浏览器/设备
```

## 2026-10-08 web-dist西施GLB公网回退

```text
stageRuntime(root, { webMode }):
  local := 尝试读取 output/xishi/xishi.glb
  if local可读 且GLB magic/version/声明长度有效:
    modelBytes := local
    modelHash := SHA256(local)
  else if webMode:
    manifest := HTTPS GET https://c.aasc.us/mnt/mmd-ar/mmd-resources.json
        设置请求超时；manifest响应大小 <= 1MiB；HTTP成功且JSON有效
    profile := manifest.resources中resourceId == xishi-default
    require profile.modelType == glb 且 profile.staticModel == true
    require profile.version为64位小写SHA-256
    modelUrl := resolve(profile.modelUrl, manifest URL目录)
    require modelUrl.protocol == https
    require modelUrl.origin == https://c.aasc.us
    require pathname匹配 /mnt/mmd-ar/mmd/xishi/xishi-<version前12位>.glb
    bytes := HTTPS GET modelUrl，设置请求超时/大小上限64MiB
    require HTTP成功、GLB magic/version/声明长度有效
    require SHA256(bytes) == profile.version
    modelBytes := bytes；modelHash := profile.version
  else:
    报错本地GLB缺失或无效；不得在APK构建中访问公网

  relative := mmd/xishi/xishi-<modelHash前12位>.glb
  将modelBytes仅写入GENERATED_ASSETS/relative
  返回xishi-default静态角色profile，version=modelHash

规则 := 本地有效模型优先；远端回退仅WEB_MODE启用，不覆盖output/xishi或Blend源文件
规则 := 非HTTPS/非指定来源/非角色静态模型/路径不符/超时/过大/哈希错误 -> 构建失败，不弱化校验
测试 := 本地优先且零网络、Web缺失时有效回退、APK缺失时不联网、非法清单/域名/哈希/GLB/超时/超大响应拒绝；tests/mmd-ar-web-characters-build.test.js 7/7通过
验证 := npm run build:web:mmd-ar-test在本地GLB缺失时成功生成web-dist及西施资源清单；合并阴影回归19/19通过
浏览器 := 阴影浏览器验证2项因Windows环境缺少测试配置的/usr/bin/chromium跳过
```


```text
用户要求 -> 轴图形与骨骼球一样大；选中只显示本骨骼，不显示下一节
图形轴长 := 骨骼基础半径 * 0.8 * 球大小倍率
    箭头尖最大1.25倍轴长 -> 正好等于球半径；圆弧/限位位于球尺度内
    角色世界缩放沿用原映射；原选中骨骼RGB轴也改为worldRadius长度；不新增尺寸控件
关节归属ownerBoneIndex：
    两端同骨骼 -> 该骨骼
    一端无骨骼 -> 有骨骼端
    A骨骼为B祖先 -> 归B；B为A祖先 -> 归A，兼容反向关节
    无祖先关系 -> 沿PMX第二端B作为默认所属骨骼
过滤 -> 未选仍全部；选中仅ownerBoneIndex == selectedBoneIndex
    不画从选择骨骼通往下一骨骼的关节；不任意只保留第一个关节
位置/六K/限位/实际标记/面板数值 -> 保持，只改变尺寸及所属筛选
构建/检查 -> 现有npm网页脚本、静态语法/引用/指纹；不运行或新增测试
```

## 2026-10-01 轴图形替代文字卡片（已完成）

```text
用户确认 -> 模型旁去掉文字卡片；面板保留图例与数值
接入 -> 传入独立骨骼scene；关节模块只创建LineSegments，不创建文本Canvas
几何 -> 局部XYZ各一根正向平移箭头 + 绕该轴正向旋转圆弧
    旋转圆弧用三档半径分辨，法向对应XYZ；颜色分别编码六K，K0灰
    正K色阶保持两组全模型log范围，不随选择改变
平移限位 -> 坐标按每轴固定span映射到轴长，span=max(轴长,abs上下限)
    上下限区间+两端刻度；相等画锁定菱形；自由画虚线
旋转限位 -> 对应轴圆周上的范围弧+端点；相等画锁定菱形；自由画虚线整圈
    旋转限位超过一整圈时按全圈显示；数值面板保留原范围
选择过滤 -> 未选全部；选中仅ownerBoneIndex所属关节，不扩展到下一节
真实姿态 -> 每帧只借读需要的A端；选中再读B端和实际局部XYZ坐标
    A侧实际frame -> 图形matrix = 模拟空间至角色世界映射 * frameA
    无物理 -> 当前骨骼/刚体offset预览matrix * 原关节局部frame
选中标记 -> 平移各轴白色十字；旋转各圆周白色径向指针/十字
    超显示范围或违反硬限位 -> 红标记；平移超显示span截在边界，面板给真实数值
    无physics -> 不画实际标记，面板未模拟；不能以预览冒充实际变化
几何缓存 -> 模型/尺寸/选择变化时重建局部线段和颜色，单批次变换写世界位置
    静态轴限位与实时标记两个LineSegments；关闭不遍历姿态、不绘制
    模型更换/dispose释放旧几何与材质；不进入角色场景或改变求解
面板读数 -> 每帧图形计算的选中实际状态缓存，约10Hz显示，不额外借读物理
    面板隐藏/分类折叠停止数值DOM刷新；图形仍按开关及模型可见性更新
文件 -> web-joint-stiffness-debug.mjs、web-skeleton-debug.mjs、web-panel-groups.js
构建 -> npm网页构建退出0；源码/生成模块/内联语法与导入指纹/唯一控件检查
    轴模块无文字Canvas；3源生成一致；无新增/运行测试或模拟；真机待验收
```

## 2026-10-01 阴影尺寸与ShadowMap预览（已完成）

```text
已有声明：keyLight.shadow.map；fillLight.shadow.map；renderer；当前主/补光阴影模式
新增定义：ShadowMapDiagnostic { size, previewEnabled, maxSize, effectiveSize, previewRows }
面板新增四档尺寸选择512/1024/2048/4096及显示ShadowMap开关；默认1024/关闭
读取本地保存 -> 规范化 -> 发布冻结设置 -> 改变时保存；灯光复位同时重设
渲染前按设备纹理上限计算有效尺寸 -> 回显/禁用不支持档位
实际尺寸改变 -> 释放并置空两灯旧map/mapPass -> 写入尺寸 -> 标记更新
渲染主场景后：
    开关关闭/面板折叠或屏幕外 -> 不分配预览GPU资源、不读回
    可见且距上次至少250ms -> 逐灯查看实际阴影状态
    未投影 -> 清空预览并显示关闭/复用主光原因，不能展示旧帧
    已投影 -> 用现有阴影贴图渲染到固定256方形预览目标
    GPU解包RGBA深度 -> 灰度颜色/占用掩码 -> 读回固定小缓冲
    Y翻转写到面板canvas，保留整张图；覆盖比例 := 掩码像素数/65536
    回显实际map宽高及像素覆盖估算；不自动裁切/放大角色
    finally恢复原renderTarget/viewport/scissor/autoClear/阴影更新状态
首次分配后复用预览场景/材质/目标/缓冲；复位、关闭释放预览自有资源
runtime结束 -> 释放预览与两灯阴影目标
```

## 2026-10-01 六K颜色、限位与实际变化（旧文字版，已由轴图形替换）

```text
确认范围 := 单开关、六K色标、轴上下限、选中过滤与真实变化；默认关闭
模型提交 -> 读取MMD.constraints/rigidBodies/bones；缓存静态文字/两组log色阶/关联索引
参考框架 -> 从加载器中立骨骼pos累加得到刚体初始位置；PMX刚体rotation和joint.rotation
    局部锚点 := inverse(initialBodyQ)*(jointP-initialBodyP)
    局部框架Q := inverse(initialBodyQ)*jointQ
    XPBD运行时优先直接读constraints对应localA/localB/rotationA/rotationB
选择变更 -> 任一端刚体boneIndex等于选择骨骼即纳入；未选全部；无关联为空
叠加每帧 -> 两排XYZ色标+数字K，平移/旋转限位各一行，名称和两端关系
    真实A侧关节锚点 -> 复用刚体诊断空间映射 -> 投影Canvas绘制
    无物理 -> 从当前A骨骼及刚体偏移得到配置预览锚点；不冒充真实变化
色阶 -> 平移/旋转分别取模型正K min/max；对数蓝→青→黄→红，零灰
    同值取中点，无正K标全0；选择不改变色阶
可见骨骼面板约100ms -> 查询专用关节状态；只对选中关节读取实际两端姿态
    位移 := inverse(frameA.Q)*(anchorB-anchorA)，模型单位
    角度 := EulerXYZ(inverse(frameA.Q)*frameB.Q)，转度，参考关节绑定姿态
    无physics -> 未模拟；读取失败 -> 姿态暂不可用
Ammo只借用变换/origin/basis；临时nativeQuaternion从manager池借还，finally释放
开关关闭/骨骼总开关关闭/模型隐藏 -> 不绘制、不读取姿态；隐藏Canvas
模型切换 -> 清静态数据/关联过滤；VMD/后端切换 -> observePhysics绑定当前实例
Display/runtime重建 -> 恢复jointParametersVisible；panel复用skeletonDisplay.v1
build -> 新模块先生成指纹，注入skeleton相对import，新增控件唯一性检查
检查 := npm网页构建退出0；6源码/5生成模块/4内联脚本语法通过
    3新控件唯一；19本地导入/16指纹正确；3源码生成一致；2组runtime/Display API齐全
    未新增/运行测试或物理模拟；现场人工验收待进行
```


## 2026-10-01 K值颜色编码（更新方案，待确认）

```text
沿用单开关/选中对应、未选全部/轴限位/选中实际变化方案
每模型构建两组色阶 -> 平移springPosition、旋转springRotation各取全部正K
正K范围min/max -> log归一t=(log(K)-log(min))/(log(max)-log(min))
若min==max -> t=0.5；不随选择过滤重新归一
颜色 := t从蓝经过青/黄到红；K0灰并标弹簧关闭；无正K图例标全0
每关节 := 平移XYZ与旋转XYZ两排六色标 + 数字K；XYZ用字母区分
图例 := 平移/旋转分别显示色带与min/max；换模型刷新
限位 := 每轴原上下限、锁定/自由标记；颜色不代表限位或实际受力
选择/实际变化 := 沿用前节；关闭不更新/绘制，静态标签和颜色缓存
实现文件 := 前节新诊断模块与selection/debug/Display/panel/build，不新增开关或模式
当前状态 := 仅方案更新，未写运行代码，待具体方案确认
```

## 2026-10-01 单开关六K/限位与选中实际变化（待确认，未实施）

```text
用户确认具体文件/显示与数值方案 -> 再实施
开关 := 动作/骨骼/显示关节K值与限位，默认false，复用skeletonDisplay偏好
诊断总门控 := 骨骼可视化开启 && 关节参数开关开启 && 模型可见
加载后数据 := MMD.rigidBodies + MMD.constraints；缓存每关节名称/六K/十二上下限
选择过滤：
    selectedBoneIndex < 0 -> 全部有效关节
    有选中 -> 收集该骨骼自身关联刚体索引
    显示任一端属于自身刚体集合的关节；每关节一次，不扩展到碰撞对象
    空集合 -> 显示无关联关节
每关节标签 := 名称/两端对应关系；平移X/Y/Z K及上下限；旋转X/Y/Z K及上下限
语义 := K0弹簧关闭；上下限相等锁定；下限大于上限自由
单位 := 平移模型单位；旋转角度；XYZ是关节局部坐标，红/绿/蓝
选中实际变化：
    当前physics有效 -> 只读两端真实刚体姿态；Ammo借用变换，不destroy
    初始关节框架转为刚体局部锚点/局部旋转，按真实姿态得到frameA/frameB
    位移XYZ := inverse(rotationFrameA) * (anchorB - anchorA)
    旋转XYZ := EulerXYZ(inverse(rotationFrameA) * rotationFrameB)，弧度转度
    参考 := 关节绑定姿态；非相邻帧差/累计旋转
    无运行physics -> 未模拟；实际值不可用，不拿配置预览代替
    数值在可见面板约10Hz刷新；静态文本缓存；位置跟随关节，处理缩放/旋转
生命周期 := 关闭不遍历/绘制；隐藏/切换模型清标签；后端/VMD重建重新读取当前实例
文件 := 新web-joint-stiffness-debug.mjs；修改selection/debug.mjs/debug.js/panel/build
构建检查 := 现有npm网页脚本，语法/本地导入/指纹/唯一控件，不运行或新增测试
```

## 2026-10-01 第三后端移除与锁定传递修复归档

```text
用户提交指令 -> 精确暂存本轮源码/删除的vendor/相关文档与任务记录
排除 -> 模型/日志/运行结果/网页与APK构建产物/无关Android缓存
当前Offline待出包状态 -> 保持minApk=true、servicePackage=true、dependenciesPackage=false
检查 -> 差异空白/暂存路径清单；沿用此前构建与静态结果，不运行测试
提交 -> master；推送 -> origion/master；核对远端提交一致
现场验收/未确认K可视化 -> 继续保留todo，不标记实现
```

## 2026-10-01 全锁绑定不向末端传播（已完成）

```text
用户目标 -> 修复全锁固定状态沿动态链传递；末端保留动态求解
用户确认方案，createAnchoredBindings(bodies, joints)：
    staticAnchors = 初始化时所有!dynamic刚体；之后不扩展此集合
    fixed = copy(staticAnchors)，bindings = []
    遍历六轴上下限相等的关节：
        仅一侧属于staticAnchors -> 此侧anchor，另一侧body
        两侧都静态或都动态 -> 不建立随动绑定
        body已直接绑定 -> 跳过重复绑定
        计算原局部锚点/锁定旋转构成的相对位姿
        若静态体在B侧 -> 反转相对位姿
        fixed.add(body)，bindings追加；不把body加入staticAnchors，不遍历其子链
    返回fixed/bindings
普通动态末端 -> 原质量/惯量、动态积分、风/碰撞、自身PMX关节求解保持
直接全锁锚点 -> 原位姿/速度随动、有效质量0、reset/dispose保持
部分锁轴投影/现有子步与参数 -> 保持
只读米娅拓扑 -> 绑定30变21，呆毛2～4/包1～6不再继承fixed
本地web-dist构建与静态检查完成；实际摆动/限位残差待现场验收
```

本地web-dist已重建，npm run build:web:mmd-ar-test退出0；10源/10生成模块、5段内联脚本/importmap语法、25本地导入、20内容指纹及4控件唯一性检查通过。rigid源与生成内容除依赖指纹外一致，静态锚点集合没有扩展/BFS；Ammo/XPBD两个选项与基准3–180/step1/default45保持。未运行或新增测试、物理模拟或设备验证，实际摆动/限位残差与手机耗时待现场验收；未APK、提交或发布。 以下BFS相关伪代码仅为修复前历史记录，当前以本节为准。

## 2026-10-01 Ammo与整链绑定差异（只读分析，未改实现）

```text
用户观察 -> Ammo可动；当前XPBD呆毛下半段也不动
用户精确指定 -> 呆毛4 = 刚体173/type1；251->172，250->171，249->170，248->头部4
Ammo路径：
    保留动态刚体质量/惯量 -> 创建原PMX六轴约束 -> 顺序冲量求解
    STOP_ERP = 1 - 0.525^(参考Hz * unitStep)
    默认参考45、物理90 -> ERP约0.275431；本地封装支持setParam
    上游限位误差 -> 目标纠错速度 = 符号 * ERP/h * 误差
    动态求解可有瞬时误差/滞后；真实摆动幅度、WASM版本与迭代参数未实测
当前XPBD路径：
    头部静态锚点 -> 全锁BFS -> 呆毛1、2、3、4全加入fixed
    固定体求解有效逆质量/惯量=0；跳过动态积分
    每子步直接同步锚点相对位姿 -> 整条链无相对物理摆动
后续候选方向：
    若目标保留Ammo效果 -> 保留全锁动态体的动态求解与原模型限位
    有限纠错策略及发根/部分锁轴行为 -> 另行确定具体方案并确认
    当前只分析；不改PMX、代码、参数，不执行测试或模拟
```

## 2026-10-01 呆毛与包摆动范围排查（只读，未实施）

```text
读取内置米娅PMX -> 仅检查元数据，不创建物理实例或推进模拟
呆毛170–173 -> 关节248–251 -> 根连接type0头部4
包174–181 -> 关节252–260 -> 首段174和末段181分别连接type0下半身2
上述全部关节 -> 平移/旋转下限==上限==0，六K==0
现有全锁图 -> 两条链绑定到各自静态锚点，无相对物理摆动
候选讨论 -> 保留发根/包带两端连接位置，后续/中间段开放有限旋转
角度/局部轴/参数保存方式 -> 尚未确定；不修改代码、PMX或全锁规则
Ammo实际效果/此前摆动来源 -> 尚未测量，不归因于某个已复现求解误差
```

## 2026-10-01 移除THREE-XPBD与呆毛静止排查（已完成）

```text
只读检查米娅PMX：
    呆毛刚体170–173；关节248–251；根连接type0头部4
    每个关节六轴下限==上限==0；六个弹簧K==0
    现有静态锚点全锁图 -> 四刚体随头部运动，无相对物理摆动
    保留通用硬锁规则；不按名称改类型/开放旋转，不修改模型
用户确认移除，呆毛旋转范围另行讨论；执行：
    布料选项 -> Ammo、XPBD
    共享normalizePhysicsSolver注入runtime、Display与面板
    保存/接口值three-xpbd -> 规范化xpbd；其他非法值 -> ammo
    首次读取旧偏好 -> 先使用xpbd，再尝试写回xpbd；存储失败仍使用xpbd
    MMDAnimationHelper -> 仅导入自写XpbdPmxPhysics
    物理资源构建 -> collision -> rigid -> physics，逐层内容指纹
    删除第三后端适配器/构建器/已跟踪vendor文件
    骨骼/碰撞体/动作复位/子步单位判断 -> engine==xpbd
    更新当前使用说明、待验收项与历史移除注记
    构建本地web-dist；静态检查资源引用和选项
    不运行或新增测试；不构建APK、提交或发布
```

实施结果：只保留Ammo/XPBD，共享规范化函数注入三层，Display读取旧偏好后尝试写回；已删除43个vendor跟踪文件及3个旧适配/构建文件，新增web-xpbd-build.js。构建成功，10源/10生成模块及5段内联/importmap语法、25本地导入、20内容指纹、4唯一控件检查通过；生成目录无第三后端资源，滑条3–180/step1/default45保持。未运行/新增测试或真机验证，呆毛范围另行讨论。以下第三后端章节是历史实现记录，以本节为当前状态。

## 非日志/非模型归档检查（2026-10-01）

```text
归档当前工作区：
    收集现有代码、配置、文档、测试与参考截图
    排除日志、模型、运行结果、APK/ZIP与构建缓存
    检查源文件语法与差异空白
    执行六组定向测试：38项 = 31通过 + 7失败
    待同步：骨骼夹具的renderer.capabilities；本地资源用例的物理默认90Hz
    将失败记录到todo；提交允许的74个文件并推送origion/master
```

### 风力强度上限30（2026-10-01，已实现）

```text
已有声明 -> normalizeWindSettings、共享归一化经典副本、风滑条、风控件本地键、固定子步施力
变更定义 -> strength范围0–30，步长0.05，缺省0.3；enabled缺省false
操作 -> 共享strength规范化max3改30；滑条max3改30
已有合法保存值 -> 保持；超过30 -> 截断30；非法/缺失 -> 0.3
Display/面板 -> 构建时复用同一规范化声明 -> runtime -> 物理实例
自由体施力 -> 原质量×10×强度×阵风倍率 -> 连续子步积分
受控type2 -> 原位置约束与局部角加速度12限幅保持
验证 -> 3/30/31/999及非法、经典副本一致、强度30真实Ammo积分与极小惯量限幅、保存/恢复
构建 -> npm run build:web:mmd-ar-test；控件max30及共享模块指纹验证
结果 -> 用户确认后实施，14项风场自测、网页构建与35脚本/4内联/21指纹通过；LAN控件/物理值30、API31截断和刷新30恢复通过
```


### Ammo物理风场（2026-10-01，已实现）

```text
已有声明
  固定子步时钟、anchorSamples、positionDriven、bodies及params质量/type/骨骼偏移
  Ammo刚体施力/力矩、manager资源池、模型动作切换门控和Display/runtime补发
新增定义
  WindSettings { enabled=false，strength=0.3（0–30），longitude=0°，latitude=0°，gust=0% }
  WindState { 有界平滑强度、已模拟秒数、场景来向/气流向量、等效风力臂 }
  本地偏好键 -> aasc.mmdArTest.wind.v1；共享归一化声明同时嵌入经典Display与面板
  风力幅度 -> 强度步内均值×(1+阵风百分比×连续双频正弦)；角加速度限12，力臂限1
操作流程
  经度 -> -180至180；纬度 -> -90至90；均步长1，缺失/非法回退0
  来源单位向量 -> (sin经度×cos纬度, sin纬度, cos经度×cos纬度)
  气流向量 -> 来源单位向量取负；0/0由+Z吹向-Z，90/0由+X吹向-X
  纬度+90 -> 自上向下；纬度-90 -> 自下向上；极点与经度无关
  动作→物理控件 -> 规范化风参数 -> 本地保存 -> Display -> runtime -> 当前物理
  初始化/换模型/换动作 -> 原T Pose及清速度流程 -> 补发风设置
  每物理帧归一缩放前 -> 记录角色场景世界旋转
  临时脱离父级后 -> 当前物理网格旋转×场景网格旋转逆 -> 将场景气流换入物理坐标
  固定子步 -> 应用插值锚点 -> 强度0.3秒指数缓动（取子步平均值） -> 按模拟秒数算连续阵风
  自由体风力 -> 质量×强度×10×阵风倍率×气流向量；风强度为效果等级
  新helper首次更新前 -> 补发缓存设置；同实例版本一致时跳过
  原始runtime创建物理 -> 立即补发；手动VMD替换的新物理 -> 首帧更新前补发
  type0/零质量 -> 跳过
  type1/自由type2 -> 质量及有界强度换算外力 -> Ammo.applyCentralForce
  刚体创建 -> 保存实际shape.calculateLocalInertia结果（Three数值，无新增native对象）
  positionDriven type2 -> 偏移换算等效力臂（限长） -> 局部力矩各轴按惯量限角加速度 -> 转回世界 -> Ammo.applyTorque
  保留type2线性因子及位置目标 -> Ammo单步积分 -> 原骨骼回写
  关闭 -> 停止风力；不清已有速度/不清其他物理力
  无子步/暂停 -> 不推进风相位；后台恢复沿用子步历史同步
  池向量 -> 借用 -> finally归还；不销毁借用getOrigin/getRotation返回值
验证
  默认关闭等价旧行为；经纬度基轴/极点/正负180一致、风力反向、零强度、阵风与保存/非法值
  同模拟时长在30/90/180Hz自由刚体风积分接近；不同画面帧率不额外加冲量
  type0不受力；type2位置不漂且有力臂时旋转响应；非法/极小惯量限幅
  连续模型动作切换native资源稳定；原旋转修复/子步/生命周期/面板回归
结果 -> 58项回归/网页构建/35脚本/4内联/21引用通过；LAN默认/设置/动作切换/刷新/关闭/损坏偏好通过，真机风效果待验收
```


### 默认纠错45Hz与物理90Hz（2026-10-01，已实现）

```text
已有声明
  getWebPhysicsStepOptions、normalizeWebStabilityReference、稳定性生成补丁
  DisplayMmd/PMX runtime/helper生成副本、物理控件、纠错偏好恢复
新增定义
  DefaultTestPhysics { 纠错参考Hz=45、物理步进Hz=90 }
操作流程
  参考初值/缺失/非法 -> 45；合法保存值 -> 30–180范围、5Hz规范化后恢复
  物理初值/缺失/非法 -> 90；合法保存值 -> 原范围及步长规范化后恢复
  生成DisplayMmd/runtime/helper/vendor物理 -> 默认90；物理控件初值/读数 -> 90Hz
  生成display-mmd-lighting -> 恢复默认90Hz；空白字符串按缺失处理
  生成稳定性实例/runtime/display -> 参考默认45；纠错控件初值/读数 -> 45Hz
  共享步进 -> unitStep=1/物理Hz，maxStepNum=ceil(物理Hz×0.1)+1，携带参考Hz
  六轴关节纠错 -> ERP=1-0.525^(参考Hz/物理Hz)，默认45/90 -> 约0.275431
  保存值继续优先，不以新默认覆盖手动配置
  真实骨骼旋转回写、type2位置、切换清速度/分帧和循环 -> 原流程保持
验证 -> 默认/回退/偏好、默认真实ERP、生成脚本/控件/指纹与网页加载
状态 -> 先更新本伪代码，用户确认后完成代码；51项定向回归和真实LAN网页默认/偏好/回退/复位通过
```

### SLAM失锁/地图切换行为核对（2026-10-01，仅分析当前实现）

```text
IMU启用条件补充核对
  calibration.imu不存在 -> imuEnabled=false -> monocular -> 不注册SLAM惯性传感器
  calibration.imu存在 -> 校验外参/噪声/频率/时间偏移、相机REALTIME时间戳
  启动采集 -> 加速度计和陀螺仪均可用且注册成功 -> 传感器样本随帧传入JNI
  网页pose.mode -> monocular-inertial显示“视觉＋IMU”，其他显示“单目视觉”
  角色重力旋转 -> 独立显示功能，不能作为SLAM惯性模式已启用的证据
  当前手机日志无可用模式记录，界面读取失败 -> 不确认现场会话模式
单目加IMU可行性核对
  已标定且条件通过 -> JNI创建System.IMU_MONOCULAR
  原始加速度/角速度和校正时间戳 -> 有界imuSamples队列 -> 按相机帧时间取样
  TrackMonocular(图像、相机时间、惯性测量) -> 跟踪/惯性初始化状态
  惯性初始化完成且图片多帧对齐成功 -> 角色世界锚定
  联合标定/初始化/恢复精度需本机实测，接入代码存在不等于已验证可用
```

```text
已有声明
  Session.anchored、observedMap、referenceKeyFrame、clearAnchor、findTarget、align
  ORB-SLAM3.TrackMonocular/GetTrackingState、原生pose事件、网页状态提示
当前操作
  跟踪帧 -> 读取状态与有效匹配地图点所属地图
  地图非空且不同于observedMap -> clearAnchor -> 保存新地图
  OK且姿态有效且地图非空 -> 检查参考关键帧
  参考关键帧失效或属于别图 -> clearAnchor
  未锚定 -> 图片识别/PnP；图片姿态可有效，但多帧align完成前anchored仍为false
  已锚定 -> 使用参考关键帧相对变换/尺度修正 -> 不调用图片识别
  暂时失锁且没有地图切换 -> 保留锚点及最后渲染姿态
  同图恢复 -> 使用原锚点；切回旧图 -> 当前单锚点实现仍会清空
  状态0/1 -> 初始化提示；状态3/4 -> 同一暂时失锁提示
  停止/后台 -> 销毁会话，当前没有地图和锚点跨会话持久化
上游核对
  单目视觉成熟地图RECENTLY_LOST -> 环境重定位
  超过3秒且仍失败 -> LOST；地图较小也可能直接LOST
  LOST后 -> 重置较小活动地图或在Atlas创建新地图
限制及候选（尚未实施）
  当前只保存单份地图对齐；需要独立设计有效地图锚点缓存及合并/替换迁移
  新地图未恢复与旧图坐标关系 -> 不可直接复用旧姿态
  区分首定位/同图恢复/重建/待对齐，并记录地图ID、状态转换、清空原因
验证
  本轮仅核对本地源码和官方Tracking.cc/论文；未复现具体失锁原因，未运行新增测试
```

### 后蝴蝶结末端旋转回写修正（2026-10-01，已实现并验证）

```text
已有声明
  MMDPhysics._updateBones -> RigidBody.updateBone -> _updateBoneRotation
  _getWorldTransformForBone、骨骼parent、ResourceManager池、共享测试构建稳定性补丁
新增定义
  RotationWriteback { 物理骨骼世界目标、父世界旋转逆、归一后的局部旋转 }
操作流程
  唯一旋转/位置方法边界及先后顺序 -> 校验 -> 替换生成副本旋转回写入口
  读取物理质心乘刚体偏移逆 -> 物理骨骼世界目标
  从池获取两个Three四元数 -> 世界目标、父逆
  更新/读取父级及祖先世界旋转 -> 取逆；无父级 -> 单位旋转
  父世界旋转逆 × 物理骨骼世界目标 -> 归一 -> 写骨骼局部旋转
  不再使用旧局部姿态与可能滞后的自身世界矩阵形成迭代增量
  type1 -> 沿用物理位置回写；type2 -> 保留受控位置，只回写正确旋转
  finally -> 归还临时变换、Ammo四元数、两个Three四元数
验证
  真实Three/Ammo固定不同轴大角度 -> type1/type2新回写不自旋，旧逻辑必然失败
  父级/模型组合旋转及动作局部姿态恢复 -> 读取当帧父级世界旋转
  非单位模型缩放 -> 物理更新临时去缩放/脱离父级 -> 正确恢复显示世界旋转
  异常父级读取及1300次回写 -> 池归还、native不增长、速度保持、销毁归零
  真实米娅骨骼247/255 -> 1200次固定回写、180Hz/60FPS模拟20秒
结果
  两目标固定回写角增量0；20秒模拟最大旋转回写误差约0.000003度
  骨骼帧间角增量等于物理世界目标角增量，实际刚体残余角速度仍保留
  稳定性14 + 频率4/子步6/生命周期6/切换8/骨骼8/点选10/碰撞体9 -> 65项通过
  npm网页构建、33脚本/4内联语法/19相对导入指纹通过；LAN180Hz播放12/暂停12/恢复13帧通过，两目标最大误差4.214685e-8rad，骨骼4组、无页面错误
  固定vendor和生产Offline未变；当前测试网页/APK共用补丁，APK本轮未打包
```

### 摄像头跟随手机旋转与竖屏方向修正（2026-10-01，已实现并验证）

```text
已有声明
  NativeSlamController.initialize/updatePreviewGeometry、CameraPreviewGeometry.projection
  TextureView系统传感器方向变换、原始YUV灰度帧、当前显示方向及窗口尺寸
新增定义
  PreviewGeometry { sensorOrientation、displayRotation、rawSize、viewSize、cropScale、offset }
  DisplaySnapshot { 当前会话、显示旋转、已布局窗口宽高 }
操作流程
  已确认故障入口 -> 测试APK开始定位后的原生预览
  手机旋转 -> APK沿用unspecified及系统自动旋转 -> 按当前窗口方向显示；不锁竖屏
  已布局窗口 -> 记录DisplaySnapshot -> 同一几何计算产生两条变换
    原始四角 -> 传感器方向旋转并按视图尺寸拉伸 -> TextureView已有显示位置
    原始四角 -> 传感器方向减显示旋转 -> 等比例cover缩放并居中 -> 期望显示位置
    TextureView已有位置到期望位置 -> 设置补偿矩阵；竖屏不再次施加传感器90度旋转
    原始SLAM投影 -> 由相同原始像素到视图仿射变换生成NDC投影 -> 保持深度行
  布局或当前显示器旋转变化 -> 当前会话更新不可变几何；监听包含180度同尺寸旋转
  worker -> 按几何变化缓存投影；UI发送姿态前验证几何未过期；不重建相机和SLAM地图
  退出/新会话 -> 注销显示/布局监听；旧会话更新不得覆盖新会话
  保留原始采集尺寸/标定/灰度帧，不以旋转显示画面改变SLAM输入坐标
  自测 -> 四个显示方向、两种传感器方向、竖横窗口比例及投影/画面对应
  构建 -> npm run build:apk:mmd-ar-test -> 资源校验 -> SM-N9500覆盖安装及实际预览检查
当前状态 -> 6项JUnit/64几何组合/768射线及2项Node回归通过；修正版APK构建及覆盖安装完成
  SM-N9500同进程竖屏 -> 横屏 -> 竖屏持续预览，几何按display0/90/0更新
  临时方向测试结束恢复accelerometer_rotation=1、user_rotation=0；180度由数值测试覆盖
  本次验证预览方向与几何，不宣称原生地图尺度/标定/精度已验收
```

### 网页全功能同步测试 APK（2026-10-01，已实现并验证）

```text
已有声明
  stageTextAssets、网页功能注入模块、APK回环资源服务、原生ORB-SLAM3适配
新增定义
  SharedTestFeatures { 三面板、灯光/AO/高光、本地PMX/贴图/两类VMD、重力/模拟视频、物理/诊断、加载进度 }
  NativeDirectorySelection { operation、用户授权目录、相对路径、会话资源令牌 }
操作流程
  两种构建 -> 同一控件/脚本/样式/物理注入链 -> 校验必需控件与唯一ID
  网页输出 -> 相对静态路径；APK输出 -> 原回环API路径；两端导入使用相同内容指纹
  主光阴影控件 -> 两端均保留 -> 灯光初始化完成 -> 点击展开/关闭
  APK目录入口 -> 系统目录选择 -> 只枚举用户授权树中的文件 -> 令牌化回环读取
    返回相对路径清单 -> 获取文件Blob -> 构建带相对路径的File -> 共用模型加载流程
    取消/异常 -> 返回明确结果；旧操作消息忽略；退出清理令牌与授权引用
  APK多文件/VMD -> 系统文档选择；取消保持已加载内容
  本地模型/动作解析 -> 先识别同一ESM注册表中的确切已选资源URL
    注册存在且对应目标File/扩展名 -> 使用本地profile；已释放/伪造路径 -> 拒绝
    不使用服务默认profile覆盖本地模型，不将虚拟路径直接交给HTTP服务
  回环资源 -> 提供内置assets；路径先规范化并限制白名单
  模拟视频 -> MindAR；真实视频且原生能力可用 -> ORB-SLAM3；无原生能力 -> MindAR
  切换后端/输入 -> 先释放旧相机；重力背景与图片定位不得同时独占相机
  构建APK -> 检查网页共用资源完整、SLAM库/词袋存在、内置模型摘要正确
  自测 -> 两端功能清单一致、APK灯光/动作/定位点击、文件入口和资源加载、原生能力保留
当前状态 -> npm网页/APK构建成功；76网页文件/14模型文件/原生SLAM库与词袋摘要校验通过
  两端各31脚本/4内联语法与18导入指纹通过；32项定向测试通过
  APK页面真实PMX/VMD加载、三面板/主光阴影/骨骼、目录取消/旧回调与模拟后端通过
  SM-N9500覆盖安装；三面板真机日志及官方定位图HTTP200已确认
  现场原生SLAM地图/标定/性能和手机本地目录贴图验收仍保留，不将构建等同精度验收
```

本文描述 `3rd/mmd-ar-test/` 的本地测试 APK 实现。伪代码与独立 Android 工程、资源准备脚本和复用的显示端 MMD/AR 模块保持同步。

### 骨骼大小、名称、点选与碰撞累计（2026-10-01，已实现并验证）

```text
已有声明
  WEB_MODE、骨骼/刚体独立overlay、DisplayMmd轻点/拖动/双指处理、当前helper.physics、固定子步
新增定义
  SkeletonDisplayPreference { sizeMultiplier默认1、范围0.2至3、步长0.1，namesVisible默认关闭 }
  NameLayer { 唯一透明Canvas，固定12px字号，DPR不超过2，复用投影向量和屏幕点 }
  Selection { boneIndex默认-1，ownBodyIndices，contactBodyIndices集合，当前physics与指针映射 }
  LocalAxes { 骨骼原点及世界旋转，红X/绿Y/蓝Z，轴长为基准世界半径×16 }
操作流程
  build -> 拷贝selection并计算指纹 -> 替换骨骼import并计算指纹 -> 传递刚体/runtime指纹
  面板初始化 -> 安全恢复skeletonDisplay.v1偏好；损坏/非有限值回退，有限值钳制并按0.1规范化
  倍率/名称变化 -> DisplayMmd保存并转发 -> 保存本地偏好；runtime重建后补发
  球半径 -> 本地高度×0.0035×最大绝对世界缩放×倍率，仅用于显示
  原pointerUp -> 双指抑制/已完成拖动先返回 -> 骨骼pick -> 消费轻点，避免触发角色动作
    关闭骨骼/模型隐藏 -> 不消费；屏幕中心距离命中，最小8px半径，等距优先较近深度
    命中 -> 选择骨骼；空白 -> 取消；所有原拖动/多指行为继续使用既有流程
  选择变更 -> 清空累计 -> 映射全部直接绑定刚体 -> 重建当前physics的指针到索引映射
  renderFrame推进前 -> observePhysics当前对象；实例变化先断开旧观察回调并清空累计
    已选且有绑定且物理存在 -> 安装当前physics.onDiagnosticSubstep
    否则 -> 观察回调为null；未选中不扫描
  每固定子步stepSimulation完成 -> 可选观察回调
    借用dispatcher/manifold/contactPoint -> 仅接触距离非正且至少一侧为自身刚体
    将直接对手PMX索引加入集合 -> 去重/有界；不递归，不保存native接触引用，不destroy借用值
    读取异常 -> 记录状态说明，物理子步继续，不修改速度/力/约束参数
  每可见渲染帧 -> 动作/物理后更新小球矩阵与骨骼局部轴
    碰撞体开关开启 -> 按自身与累计集合压缩每组有效实例count；取消选择恢复全量
    names关闭且无选择 -> 不投影名称，不创建画布
    names关闭且有选择 -> 仅绘制选中白环/名称和XYZ字母
    names开启 -> 批量投影非空骨骼名称；相机后方/近远裁剪面/屏幕外跳过，中文描边
    名称Canvas与renderer的CSS区域同步 -> 复用唯一画布，不新增逐骨骼DOM/纹理
  总开关关闭/首帧隐藏/runtime不可见 -> 隐藏轴和名称；画布首次隐藏清屏，后续不重复清
  无绑定骨骼 -> 提示无关联刚体，不借父级接触；无物理 -> 自身配置预览，停止新增接触
  换选/取消/关闭骨骼/换PMX/physics替换 -> 清除累计；清空按钮 -> 只清累计，后续接触仍可记录
  VMD切换 -> 复用显示资源和选择，physics替换时清累计；PMX切换 -> 清选择并释放旧轴/实例资源
  dispose -> 断开观察回调，释放轴/小球，移除Canvas，清空引用；重复释放幂等
当前状态 -> 用户确认后实施；模块及物理56项、面板8项、真实网页1项共65项通过
  npm网页构建/31生成脚本/4内联语法/16导入指纹/LAN HTTP200通过
  真实321骨骼/4实例组，16旧组释放，Canvas保持1；PMX取消、VMD保留选择，无页面错误
```

### PMX碰撞体显示（2026-10-01，已实现并验证）

```text
已有声明
  WEB_MODE资源注入、骨骼诊断叠加、动作面板、DisplayMmd转发
  currentMesh几何MMD刚体参数、骨骼worldMatrix、helper当前physics.bodies
新增定义
  RigidBodyPreference { enabled，默认关闭，本地记忆 }
  RigidBodyMarker { bodyIndex，boneIndex，type，shapeType，dimensions，offset }
  RigidBodyOverlay { auxiliaryScene，instanceGroups，geometryCache，materials，model }
  ShapeRules { 球半径width，盒边长2×各半边长，胶囊半径width/圆柱长height/Y轴 }
  PoseMode { 实际物理姿态，骨骼绑定配置预览未模拟 }
操作流程
  WEB_MODE -> 拷贝独立模块 -> 导入骨骼颜色表及指纹 -> 接入runtime/DisplayMmd
  动作面板骨骼分类 -> 添加独立碰撞体开关与状态说明 -> 安全恢复偏好
  用户切换 -> 保存偏好 -> 当前runtime应用；后续runtime继承
  提交模型 -> 清理旧overlay -> 提取加载后刚体参数；每个刚体保留独立标记
    非法形状/尺寸/类型 -> 安全跳过；boneIndex=-1 -> 仍可显示配置或实际姿态
  首次开启 -> 共享球/盒单位几何；胶囊按height/width比例缓存 -> 按颜色/形状分组实例化
    胶囊统一半径缩放 -> 保留球形端帽，不用Y轴拉伸单位胶囊
  每帧动作/物理完成 -> 判断角色可见性及首帧门控
    关闭/不可见 -> 不读取逐刚体姿态、不更新/绘制
    开启 -> 从当前helper读取physics，不保存已销毁的native刚体引用
      physics有对应刚体 -> 借用COM变换与origin -> 池中旋转对象读取并归还
        当前物理坐标系 -> 当前模型显示坐标系 -> 实际线框位置/朝向
      没有物理 -> bone世界变换×PMX骨骼偏移；无bone则model世界变换×配置偏移
        状态说明 -> 未模拟，显示配置位置
    共享临时Three矩阵/向量 -> 批量更新实例矩阵
  角色/AO之后、骨骼球之前 -> 线框独立场景叠加，忽略模型深度、不写深度
    finally -> 恢复renderer清屏状态
  换模型/销毁 -> 清空模型引用 -> 释放实例/材质/缓存几何；重复释放幂等
  换VMD/物理重载 -> 读取本帧新physics；不修改速度/约束，不新增Ammo求解
当前状态 -> 用户确认后完成；碰撞体9/骨骼8/面板8/切换及生命周期14/浏览器1，共40项通过
  实际183体 -> 红19/黄16/绿148，134盒/49胶囊，33实例组/31几何
  重载/两次PMX -> 释放132旧组；VMD复用；刷新恢复；无页面异常
  真实Ammo1000帧 -> native数量稳定、4MiB探针复用、堆64MiB、速度不变
  构建/30脚本/4内联/16导入指纹/LAN HTTP200通过；外网未发布
```

### 碰撞体按质量着色（2026-10-01，已实现）

```text
已有声明
  RigidBodyOverlay、entries、共享几何与实例组、getRigidBodyState、骨骼选择过滤bodyFilter
  MMD刚体参数type/weight、动作面板碰撞体开关与状态说明
新增定义
  EffectiveMass -> type0或weight非法/不大于0时为0，否则weight
  MassScale { min，max } -> 模型全部刚体有效质量大于0部分；加载时固定，不随过滤重算
  MassRamp -> 对数插值连续色带（蓝/青/绿/黄/红）；有效质量0 -> 浅灰
  RigidBodyLegend { 渐变条，范围文字，灰说明 }
操作流程
  提交模型 -> 计算每个刚体有效质量 -> 汇总massScale -> 按形状建实例组（分组键去掉type）
  首次开启 -> 白色基色材质；逐实例颜色与矩阵同帧写入（过滤压缩序号时颜色跟随所属刚体）
  每帧 -> 更新实例矩阵与颜色；物理开关/VMD切换不改变颜色，颜色只取决于刚体质量
  选择过滤 -> 只压缩显示实例count；同一刚体颜色不漂移
  min等于max或只有一个正质量 -> 色带中点单色；无非零质量 -> 全部浅灰
  换模型 -> massScale与实例色重建；销毁释放实例/几何/材质
  getRigidBodyState -> 增加massScale/massRamp/massBodies；samples颜色改为实例色
  动作面板骨骼分类 -> 碰撞体状态行下方图例；面板打开时500ms随状态刷新范围文字
  骨骼小球 -> 保留红type0/黄type2/绿type1，不随本功能改变
  验证 -> 0质量浅灰、色带端点、退化单色、非法weight按0、过滤颜色稳定、实例组数量不增加
```

实现：修改 `3rd/mmd-ar-test/web-rigid-body-debug.mjs`（有效质量/色阶/逐实例颜色/分组键）、`web-panel-groups.js`（图例元素、分组登记、轮询刷新、CSS）；扩展 `tests/mmd-ar-rigid-body-debug.test.js` 与 `tests/mmd-ar-rigid-body-debug-browser.test.js`。

### 碰撞体实体模式与真实遮挡（2026-10-01，已实现）

```text
已有声明
  RigidBodyOverlay实例组/材质/getState/setBodyFilter、质量色带与逐实例颜色
  renderFrame的AO离屏合成→刚体叠加→骨骼叠加顺序、pmxAoEnabled、ambientOcclusion.supported
  currentRotationPivot.visible（AR/首帧门控）、currentMesh、renderer/scene/camera
新增定义
  RigidBodyStyle { wireframe，solid（默认，本地记忆） }
  SolidAppearance { 填充不透明质量色；描边BackSide深色，实例统一放大1.04 }
  DiagnosticShading { 两叠加场景各自环境光0.55＋顶光平行光0.9（0.35,1,0.5）；不联动真实灯光 }
  OcclusionRule { solid+全量+角色可见→深度遮挡；选中过滤→穿透；角色隐藏→无遮挡 }
  CharacterHidden { 关闭mesh.visible；物理/动画/叠加继续；换模型后重应用 }
  SceneDepthPrepass { clearDepth + colorWrite:false覆盖材质深度直写；仅AO离屏生效时 }
操作流程
  面板 -> 碰撞体样式分段按钮（线框/实体）+隐藏角色开关 -> 本地记忆与DisplayMmd转发
  solid -> 重建资源：按形状分组各建填充与描边两组实例，共用几何缓存
    填充受光材质（Lambert）不透明、depthTest/depthWrite开、逐实例质量色
    描边BackSide深色、实例矩阵统一放大1.04；诊断顶光只作用于本叠加层
    骨骼小球同用该诊断光：受光材质并保留type三色与透过显示
    wireframe -> 保持原透过线框（depthTest关，无描边、无遮挡）
  每帧 -> 未过滤且角色可见且solid -> 需要场景深度；过滤激活 -> 过滤刚体关闭深度测试穿透
  深度遍（仅需要时）-> autoClear关 -> clearDepth -> scene.overrideMaterial=colorWrite:false
    -> 渲染角色深度 -> finally恢复overrideMaterial/autoClear
  隐藏角色 -> 仅mesh不绘制；碰撞体叠加守卫不再要求mesh.visible；骨骼小球保持随网格隐藏
    -> AO场景无角色；跳过深度遍
  换模型 -> 重建资源并重新应用隐藏状态；物理开关/VMD切换保持模式与隐藏
  销毁 -> 释放填充/描边实例、材质、几何；重复释放幂等
  getRigidBodyState -> 增加displayMode/characterHidden/needsSceneDepth
  验证 -> 模式切换资源重建、描边材质与放大比、过滤穿透、深度遍条件、隐藏后仍绘制、释放幂等
```

实现：修改 `3rd/mmd-ar-test/web-rigid-body-debug.mjs`（样式/描边/穿透/守卫/needsSceneDepth/诊断顶光）、`web-skeleton-debug.mjs`（小球受光材质＋诊断顶光，保留透过）、`web-rigid-body-debug.js`（深度遍、隐藏角色与显示层透传）、`web-panel-groups.js`（样式按钮、隐藏开关、提示文案）、`build.js`（必需控件）；扩展刚体/骨骼单测与真实网页自测。视觉调整：描边外壳 1.08→1.04，两叠加层加固定顶光着色（不联动真实灯光）。

### 骨骼物理状态小球（2026-09-30，已实现并验证）

```text
已有声明
  WEB_MODE构建适配、动作面板、DisplayMmd接口
  currentMesh.skeleton.bones、geometry.userData.MMD.rigidBodies
  动作/物理帧更新、模型提交/释放、角色首帧可见性、renderer与camera
新增定义
  SkeletonPreference { enabled，默认关闭，本地保存 }
  BoneMarker { boneIndex，physicalType，instanceIndex }
  SkeletonOverlay { auxiliaryScene，markerGroups，geometry，materials，model }
  类型颜色表 { type0红，type2黄，type1绿，无关联灰 }
  多类型优先表 { type1优先，type2次之，type0最后 }
操作流程
  WEB_MODE构建 -> 拷贝独立模块并生成内容指纹 -> 注入runtime与DisplayMmd适配
  动作面板 -> 添加显示骨骼复选框和颜色图例 -> 安全恢复本地偏好
  用户切换 -> 更新偏好 -> DisplayMmd转发当前runtime；后续runtime继承
  模型提交 -> 释放旧overlay资源 -> 保存新mesh -> 按实际刚体元数据分类骨骼
    非法type/越界boneIndex/无骨骼刚体 -> 跳过
    同一骨骼多个类型 -> 按优先表选唯一颜色；无关联 -> 灰
  首次开启且有模型 -> 共享低面数球几何 -> 各颜色建立实例组
  每画面帧 -> 完成原动作/物理更新 -> 判断开关、角色可见性、首帧门控
    不满足 -> 不更新/不绘制小球
    满足 -> 刷新模型世界矩阵 -> 骨骼世界位置与模型缩放 -> 批量更新实例矩阵
  原角色/AO绘制后 -> 暂存renderer.autoClear -> 禁用清屏 -> 绘制独立overlay场景
    材质不测试/不写入深度，不参与阴影；finally恢复renderer状态
  关闭 -> 隐藏overlay并停止逐骨骼更新
  换模型/销毁 -> 清空骨骼引用 -> 释放实例、材质、几何；重复释放幂等
  小球逻辑 -> 只读骨骼结果；不修改Ammo速度、约束、子步或动作切换流程
验证状态 -> 用户确认后实现；模块8/面板8/切换及生命周期14/真实网页1，共31项通过
  实际321骨骼 -> 红18/黄16/绿148/灰139；4实例组；重载与两次PMX切换释放旧16组
  VMD切换 -> 不重建骨骼球；AO开启仍叠加；刷新恢复开关
  构建/28脚本/4内联/13导入指纹/LAN HTTP200通过；外网未发布，手机观感待验收
```

### Blender物理修正路径（2026-09-30，只读技术核对）

```text
已有声明: 当前PMX刚体/6DoF弹簧/骨骼回写，固定Ammo原生world
Blender刚体 -> Bullet顺序冲量、子步与约束迭代
  Split Impulse -> 碰撞穿透单独push/turn速度 -> 姿态纠错与真实动能分离
  范围 -> 接触穿透，不代表PMX弹簧关节已经位置投影求解
Blender传统Cloth -> 顶点质量/弹簧/阻尼 -> 隐式线性系统求速度增量 -> 更新位置
Blender 5.2实验几何节点 -> XPBD Solver -> 预测位置/旋转、约束迭代、速度更新
  实验状态 -> 不代表传统Cloth修改器或刚体后端整体替换为XPBD
本地读取 -> 固定Ammo新建world默认splitImpulse为true，穿透阈值0、迭代10
  当前MMD创建/补丁未覆盖 -> 沿用开启；仅参数读取，不作为模型对照测试
候选借鉴 -> PMX刚体语义适配后再评估，避免重复求解与盲目更改默认参数
本轮 -> 只读资料/参数和文档更新，无生产或自测代码、构建或发布
```

### 位置预测与XPBD式约束（2026-09-30，只读核对）

```text
已有声明: 当前WEB_MODE -> 每固定子步调用一次Ammo world.stepSimulation
核对上游原生流程:
  predictUnconstraintMotion -> 候选姿态缓存 -> 碰撞检测 -> 速度/冲量约束求解
  约束后的速度 -> integrateTransforms -> 最终刚体姿态
  候选姿态 -> 不等同XPBD约束修正后位置，也不是最终受约束结果
候选XPBD式流程（未实施）:
  当前位置/速度/外力 -> 预测位置与旋转
  预测状态/关节/接触/柔度/累计乘子 -> 位置与旋转迭代修正
  修正姿态与上一步姿态差 -> 更新线/角速度 -> 骨骼回写
  独立求解职责 -> 避免与Ammo重复推进同一动态刚体，定义接触反馈
边界:
  JS预移刚体后再Ammo步进 -> 可能重复积分，不采用该快捷拼接
  只读预测缓存 -> 诊断用途；骨骼目标外推 -> 处理延迟；均不能等同XPBD
本轮: 仅核对/文档更新，未新增生产代码/自测代码、未构建或发布
```

### 跨Hz布料与小物件抖动（2026-09-30，已实现并验证）

```text
已有声明:
  WEB_MODE副本、Ammo固定子步、MotionState锚点、type2位置随骨骼/旋转随物理、资源池
新增定义（已确认）:
  PhysicsStability { referenceHz:65, referenceStopErp:0.475, maximumFrameSeconds:0.1 }
  PositionDrivenSamples { previousPosition, currentPosition, bodyReference }
  StabilityCases { frequencies, inertia, spring, limits, renderFps, residualAngularSpeed }
实现流程:
  WEB_MODE -> web-physics-stability.js补丁 -> 仅网页vendor接入稳定性
  resetAnchorInterpolation -> 刷新本实例关节；缓存unitStep相同时跳过ERP写入
  创建或unitStep改变 -> STOP_ERP为1减去(1减0.475)的(65除Hz)次方
  每关节每轴 -> 应用时间归一后的STOP_ERP，65Hz保持0.475
  所有30至180Hz -> ceil(Hz乘0.1)加1预算 -> 覆盖掉帧，不再低频仅3步
  采集type2骨骼世界位置目标 -> 复用前后位置样本，初始化/复位同步历史
  仅type2且boneIndex不为负 -> 标记positionDriven；无骨骼type2保留自由动态语义
  有骨骼type2线性因子为0 -> 自由线性力不推动其位置，质量/惯量/角速度保留
  每子步 -> 位置目标插值 -> 以目标终点减当前COM再除h得到受控线速度
  受控位置子步期间 -> 暂时线性阻尼为0、旋转阻尼原值；finally恢复PMX线性阻尼
  Ammo单步积分 -> type2平移到目标终点，旋转继续动态模拟；不重复VMD/IK
  帧末type2 -> 回写物理旋转，不再第二次强制位置回位；其骨骼局部位置保留
  type1 -> 原有自由动态运动；type0 -> 现有子步MotionState插值
  正常运行 -> 不通用清零速度；换模型/动作 -> 保留已有清零与两帧门控
  暂停/循环/复位/变频 -> 历史与时钟同步，native临时值复用并finally归还
  默认10迭代与PMX质量/弹簧/阻尼 -> 保持，避免无验证的整体改参
实际诊断:
  原预算65Hz/10FPS一秒 -> 位移0.461538，低频丢模拟时间
  本地HTTP200 -> 用户页面180Hz且有子步锚点，180Hz预算已足够
  用户静止并关闭动作 -> 仍抖，优先物理修复，显示插值不能代替
  真实米娅65Hz静止5秒尾段角速度RMS -> 10/40迭代为1.539483/0.887426
  同一场景180Hz -> 0.555438/0.786762，不能盲目提高迭代
  米娅180Hz/60FPS静止8秒末1秒 -> 基线0.315354、type2线性因子0为0.259848
  同一场景STOP_ERP时间归一 -> 0.126469；仅为该模型/窗口物理指标，不宣称手机已修复
新增验证结果:
  30/65/90/120/180Hz的真实米娅60FPS静止8秒末1秒角速度RMS:
    30:1.958293至0.165598；65:1.514808至0.063439；90:0.653841至0.025390
    120:0.558105至0.084257；180:0.315354至0.094321（约减小70%）
  真实锁定关节模拟0.1秒 -> 多Hz残余0.001517；65Hz不足整步为0.002094
  父骨骼动态平移 -> type2跟随帧前目标，保留局部位置，最多一画面帧目标延迟
  type2阻尼1与异常求解 -> 端点正确、旋转保留、阻尼及池恢复
验证范围:
  30/65/90/120/180Hz与多种渲染帧率 -> 全时间推进、65基准不变
  type2受控平移 -> 末步位置/速度正确、角速度保留、无帧末二次回位
  实际PMX静止与动作 -> 角速度残余、限位/接触和父骨骼跟随对照
  暂停/循环/切换/首两帧门控/native回收 -> 原语义保持
  手机具体PMX/部位/CPU -> 待补充与现场验收
后续可选:
  动态绘制插值与finally恢复 -> 可辅助视觉连续性，暂不作为本次主要修复
状态:
  用户已确认方案，已先更新伪代码再实现；定向82加补充1、真实浏览器3，共86项覆盖通过
  网页约576秒24次VMD/4次PMX切换 -> 创建32/销毁31/存活1，64MiB堆，探针跨度3227080字节
  语法15脚本与4内联、11导入指纹、用户局域网HTTP200提供新实现 -> 通过，未发布外网
```

### 关节纠错基准Hz可调（2026-10-01，已实现）

```text
已有声明
  web-physics-rate.mjs的getWebPhysicsStepOptions、runtime两处Object.assign步进参数
  web-physics-stability.js的_refreshConstraintStability（65写死）与resetAnchorInterpolation刷新入口
  lightingState.physicsFps、动作面板物理分类、DisplayMmd转发
新增定义
  normalizeWebStabilityReference(value) { 非有限值/缺失回退45；其余30-180截断并按5Hz取整 }
  PhysicsStepOptions { unitStep，maxStepNum，stabilityReferenceHz（默认45） }
  MMDPhysics.setStabilityReferenceHz(value) { 有限正数写入（非法回退45）并立即重算六轴，返回生效值 }
  面板：mmdArPhysicsStabilityReference + 数值输出 + 说明；本地键aasc.mmdArTest.physicsStabilityReference.v1
操作流程
  面板滑条(30-180步长5默认45) -> 本地记忆 -> DisplayMmd.setPhysicsStabilityReference
  显示层 -> 同一归一规则本地保存待补发值，runtime存在时转发；runtime重建后补发
  runtime -> physicsStabilityReferenceHz；对当前物理Object.assign步进参数并调用setStabilityReferenceHz立即重算
  创建/变频路径 -> 步进参数携带参考值写入实例；补丁记忆核对unitStep与参考值任一变化重算
  补丁换算 -> ERP = 1-(1-0.475)^(参考Hz×unitStep)；65Hz基准恢复原库0.475
  非法值 -> 滑条/显示层/runtime/补丁四层一致回退45；不修改弹簧/质量/阻尼/预算/渲染
  验证 -> 同Hz不同基准ERP数值、实时改基准立即生效、回退与非法值、45默认/90物理真实ERP与公式一致，显式65仍保持旧行为
```

实现：修改 `3rd/mmd-ar-test/web-physics-rate.mjs`、`web-physics-rate.js`、`web-physics-stability.js`、`web-panel-groups.js`、`build.js`；扩展 `tests/mmd-ar-physics-rate.test.js`、`tests/mmd-ar-physics-stability.test.js`、`tests/mmd-ar-web-panel-groups.test.js`。

### Ammo方法与XPBD候选后端（2026-09-30，评估，未实现XPBD）

```text
当前实现:
  PMX刚体/关节输入 -> Bullet顺序冲量PGS求解器与离散动力学世界
  6自由度弹簧约束/碰撞 -> 刚体速度与姿态 -> 骨骼变换回写 -> 蒙皮显示
候选已有声明:
  PMX刚体/关节参数、骨骼偏移、VMD与IK、锚点姿态、固定步时钟
候选定义:
  XPBDState { position, orientation, velocity, angularVelocity, inverseMass, inverseInertia }
  CompliantConstraint { localFrames, limits, compliance, damping, multiplier }
候选操作流程（未实施）:
  PMX数据 -> XPBD刚体/关节适配 -> 明确材料参数映射与标定
  每固定子步 -> 运动学锚点位置/四元数插值 -> 预测动态姿态
  约束/接触/摩擦迭代 -> 柔度按步长平方缩放，更新累计乘子及位置/旋转
  姿态变化 -> 更新线/角速度 -> 全帧结束回写骨骼
  后端独立拥有状态 -> 不与Ammo重复求解同一动态刚体
  初始化/暂停/循环/速度归零/销毁 -> 与当前运行时约定适配
边界:
  XPBD与现有Ammo为不同实现路径，不能通过修改physicsFps获得XPBD
  XPBD不自动处理外部锚点不连续，仍需子步采样/插值
  XPBD仅评估；用户已确认180Hz与Ammo插值实施，未替换物理
```

### 布料物理频率上限180Hz（2026-09-30，已实现）

```text
已有声明:
  网页滑条、DisplayMmd/runtime/helper副本、共享StepOptions、浏览器设置和导入指纹
新增定义:
  WebPhysicsRate { minimum:30, maximum:180, default:65, increment:5, maxFrameSeconds:0.1 }
操作流程（已确认，仅独立网页）:
  WEB_MODE -> 滑条max改180，保留下限30、默认65与步长5
  DisplayMmd / runtime / helper / 共享参数 -> 输入统一限制30至180，5Hz规范化
  保存的480或其他超过180的值 -> 恢复时实际应用180
  目标频率 -> unitStep为频率倒数；全30至180Hz预算为频率乘0.1向上取整加1
  65Hz预算8、180Hz预算19 -> 覆盖0.1秒（跨Hz稳定性修复取代原低频3步规则）
  实时修改 / 模型初始化 / 动作切换 -> 同一共享StepOptions
  频率调整 -> 保持当前物理实例与速度；模型/动作初始化 -> 绑定姿态、速度清零、两帧播放
  构建 -> 频率模块与helper的导入内容指纹自动更新
验证结果:
  默认/边界/非法值、177到175及178到180、480到180
  180Hz真实Ammo在60/30/10FPS下推进一秒 -> 模拟位移正常
  页面范围180、旧480设置恢复180、实时65不重建、模型/动作切换预算19及资源回收
  正式显示端/APK仍30至90；仅origion同步代码，不发布外网
高频抖动原流程核对（历史问题分析）:
  每个渲染帧 -> 动作/锚点更新一次 -> Bullet内部多个子步 -> 物理骨骼回写
  原子步期间 -> 无动作/锚点重新采样；本次改为子步MotionState插值
  弹簧目标速度 -> 与物理步频、弹簧参数及求解迭代数有关
  原因判断 -> 离散驱动/约束响应/CPU帧间隔波动为候选，需受控复现
  上限180 -> 限制最高目标步频，不保证解决视觉抖动
```

### 运动学锚点子步插值（2026-09-30，已实现）

```text
已有声明:
  MMDPhysics.update、RigidBody运动学目标变换、world.stepSimulation、资源池、帧末VMD/IK、初始化复位
新增定义:
  AnchorSamples { entry, previousPosition, position, previousQuaternion, quaternion, stepPosition, stepQuaternion }
  FixedClock { physicsRemainder, physicsSampleTime, physicsStepTime, interpolationUnitStep, unitStep, maxStepNum }
  KinematicTarget { position, quaternion, bodyReference }
操作流程（已确认，仅网页副本）:
  每渲染帧 -> VMD/IK与角色锚点就绪 -> 采集type0且有骨骼的目标世界姿态
  将本帧有效时间加入累计 -> 足够一固定步且预算未耗尽时执行子步
  子步对应时间 -> 前后采样时间范围内的插值比例
  位置线性插值 / 四元数球面插值 -> 本步运动学目标MotionState
  world以固定h、关闭内部拆步单次求解 -> 每步由Bullet更新运动学速度
  减少累计时间，保留未满一步余量 -> 不强制每渲染帧推进至少一步
  预算超限 -> 丢弃超额整步并同步时钟基线，保留不足一步余量，避免后台积压补算
  全部子步后 -> 动态刚体骨骼回写 -> 正常绘制；不重复推进VMD时钟
  动态type1/type2 -> 保留Bullet运动，不用锚点插值覆盖速度或位置
  首载 / 换模型动作 / 物理复位 / 后台恢复 -> 重建姿态历史与物理时钟基线
  实时频率切换 -> 同步步长/预算及时间基线，保留动态速度
  native临时值 -> 资源池复用，异常finally回收；dispose清除历史引用
  web-physics-substeps.js -> 构建时在生命周期补丁之后注入MMDPhysics固定子步方法
  resetAnchorInterpolation -> 以当前刚体世界姿态同步前后样本并将时间余量归零，不清速度
  unitStep改变 -> 捕获本帧目标前同步历史；实际帧间隔超过0.1秒或显示恢复 -> 同步历史
  renderFrame/setVisible -> WEB_MODE构建适配调用history reset，正式源/APK保持
  零/负/非法delta -> 不采样、不求解，不强制推进
  update异常 -> 恢复临时网格变换并归还资源池
接口依据:
  固定Ammo有tickCallback方法，但未导出addFunction/removeFunction/saveKinematicState
  选择JS外层固定步循环；每次stepSimulation单步，避免重复累计/内部拆步
  Bullet每次world调用在求解前更新运动学变换与速度
已验证:
  子步锚点轨迹、角速度方向、单位时间推进、60/90/120FPS与180Hz时钟一致
  无子步帧、暂停/循环、初始化首帧、复位历史、预算超限/后台帧间隔、异常资源回收
  64轮真实弹簧锚点及128轮生命周期 -> native分配归零、大块堆空间复用
  实际浏览器24次VMD/4次PMX -> 创建32/释放31/存活1，64MiB堆，探针跨度391064字节
  定向74项加本地资源3项 -> 77项通过；构建/语法/导入指纹通过
  手机CPU/布料观感与外网发布 -> 仍待现场验收与单独发布
```

### 布料物理频率30–480Hz（2026-09-30，历史实现，现由180Hz取代）

```text
已有声明:
  displayMmdPhysicsFps滑条、DisplayMmd与runtime频率规范化、createPmxMotionHelper
  当前物理unitStep/maxStepNum、prepareMotionSwitch、WEB_MODE副本、浏览器保存设置
新增定义:
  WebPhysicsRate { minimum:30, maximum:480, default:65, increment:5, maxFrameSeconds:0.1 }
  StepOptions { unitStep, maxStepNum }
操作流程（仅独立网页）:
  WEB_MODE -> 滑条max设480，min30/step5/value65保持
  DisplayMmd / PMX runtime / helper生成副本 -> 频率上限480，保留非法值回退与5Hz规范化
  规范化频率 -> unitStep = 1除以目标频率
  频率不超过90 -> maxStepNum=3，保持原低频预算
  频率超过90 -> maxStepNum=目标频率乘0.1向上取整再加1，480Hz预算49
  实时调节 -> 同时更新当前物理unitStep与maxStepNum，不重载模型或清零速度
  创建模型helper / 手动动作物理 -> 使用同一StepOptions
  首帧 -> 物理从绑定姿态推进；下一帧 -> 依播放开关播放，初始化速度归零和循环逻辑保持
  实际帧更新 -> vendor按实际delta计算子步数量，且不超过上述预算；不强制执行最大预算
  当前浏览器保存/恢复 -> 480Hz不再被任一层回落到90Hz
  网页频率/物理helper模块 -> 带内容指纹导入，确保新校验和预算同时生效
  非WEB_MODE -> 控件/显示模块/runtime/helper仍为原30–90Hz与子步预算
验证（70项覆盖通过）:
  默认65、30/90/95/480边界、超过480和非法值、5Hz步长
  UI实时调节与存储恢复 -> display/runtime/helper物理参数一致
  480Hz真实Ammo在60/30/10FPS模拟输入下 -> 无3子步截断导致的物理时间损失
  模型/动作切换、暂停、物理关闭、速度清零、循环及资源释放继续通过
  480Hz网页24次VMD与4次PMX -> 创建32、销毁31、当前1；WASM堆64MiB、探针跨度3516552字节
  实时降至65 -> 原实例仍存活、预算3；再设480并刷新 -> 控件/API恢复480
  源/生成脚本9个、内联脚本4个 -> 语法通过；导入指纹6个 -> 与文件内容匹配
```

### 换模型沿用 VMD 与 T Pose 分帧初始化（2026-09-30，已实现）

```text
已有声明:
  当前 profile、动作播放开关、物理开关、本地模型/动作上下文
  prepareMotionSwitch、pendingInitialMotionHelper、renderFrame、clearPmxPhysicsMotion
新增定义:
  InheritedMotion { motionUrl, motionResourceId, playMode, retainedSelection, displayName }
操作流程（仅独立网页，替代历史先第0帧后物理规则）:
  选择 PMX -> 读取当前播放状态与成功加载的 profile
  播放开启且当前 VMD 有效 -> 新 profile 携带当前 VMD 地址、标识、播放模式
  播放关闭或无 VMD -> 新 PMX 无自动动作
  新 PMX 按自身骨骼重新解析 VMD，不复用旧模型 clip
  暂存模型/贴图/VMD加载成功 -> 提交；仍使用的动作上下文保持引用
  失败 -> 释放新模型上下文，保留旧模型、动作引用、标签和开关状态
  手动切换 VMD -> 先解析成功 -> 保存旧网格/骨骼/表情/IK并冻结旧 helper
  恢复模型绑定姿态与表情 -> 创建尚未应用动作的新 helper -> 刷新世界矩阵
  物理开启且有刚体 -> 绑定姿态创建物理，禁止预热与自动动作第0帧
  清零所有刚体线速度/角速度/残留力 -> 提交新 helper 并设置首帧延迟标记
  成功替换 -> 释放旧 helper 原生物理；失败/过期 -> 释放暂存物理并按原契约回退
  首个实际渲染帧 -> 暂停新动画，只运行物理，按刷新流程隐藏初始化角色
  下一实际渲染帧 -> 根据当前动作开关开始从头播放并正常显示
  播放关闭 -> 保持暂停与绑定姿态；物理关闭 -> 不创建或强制启动物理
  动作开关在等待期间变化 -> 首帧门控仍生效，下一帧使用最新开关值
  后台/页面不可见 -> 等实际渲染恢复后执行两帧流程，不用定时器模拟下一帧
  自动循环重播 -> 原 helper 持续运行，不新增物理初始化或速度清零
验证（67项通过）:
  物理初始化读取绑定姿态，首帧动画时间为0，第二帧才应用VMD并推进时间
  本地/默认VMD继承、播放关闭、无动作、物理关闭、文件引用与物理重载
  失败/过期恢复、进度不提前完成、连续切换原生资源释放与内存有界
```

### 重力缓动默认20ms（2026-09-30）

```text
仅独立网页重力旋转:
  默认 GravitySettings.smoothingMs = 20
  过滤模块、模型状态、控件初始化、滑条及读数使用相同默认值
  未保存用户设置 -> 使用20ms；已保存用户设置 -> 保持原值
  0关闭缓动、最大500ms、步长10ms、独立存储键沿用
```

### 重力摄像头背景与面板默认外观（2026-09-30）

```text
仅 WEB_MODE:
  重力分类新增“显示摄像头画面”，默认关闭，仅启用重力旋转时可用
  重力开启且画面开关开启、页面可见且无图片定位/校准占用:
    请求视频流并作为全屏背景，不启动图片识别、不写相机定位/角色角度
  图片定位运行时复用其视频展示；开关仅控制可见性，不停止定位输入
  图片定位/校准开始前释放独立预览；结束后按重力/画面开关状态恢复
  关闭画面/重力、后台或离开取消等待并释放独立流；迟到的授权流立即停止
  错误显示在重力分类，重力传感器与手动旋转继续工作
  灯光/定位/动作面板共用默认不透明度=50%，CSS/滑条/初始化一致
  已保存的显式不透明度仍恢复；调整任一面板同步其余面板并保存
  网页移除顶部测试提示文字，保留面板状态/必要加载进度
  生成 web-dist，旧 APK/正式显示端保持原行为
```

### Ammo 物理生命周期与频繁切换 OOM（2026-09-30，已实现）

```text
已有声明:
  MMDPhysics、ResourceManager、MMDAnimationHelper.remove、网页构建副本
  stopMotion、disposeStagedResources、prepareMotionSwitch.rollback
  Ammo.destroy、world.removeConstraint / removeRigidBody、模型/动作提交序号
新增定义:
  NativeOwnership { ownedObjects, attachedBodies, attachedConstraints, disposed }
  自建对象按创建顺序登记，临时向量通过同一资源池复用，构造信息在创建刚体后立即销毁
操作流程（仅独立网页）:
  构建 -> 为MMDPhysics/MMDAnimationHelper副本接入所有权与释放；正式vendor/APK保持
  物理副本内容指纹 -> helper物理import带指纹 -> importmap精确helper地址带指纹，避免旧缓存
  物理创建 -> 记录自建世界依赖、形状/状态/刚体、约束及资源池对象
  临时重力/盒体尺寸向量 -> 最后使用后归还所有权资源池，dispose时销毁
  刚体构造信息 -> 刚体创建结束后立即销毁，异常时同样释放
  getter借用对象及外部传入世界 -> 不当作自建对象销毁
  helper移除 -> 物理幂等释放 -> 原helper移除；不停止旧mixer以避免复原骨骼覆盖新动作
  helper物理创建后的预热/IK异常 -> 同样释放已创建物理，再上抛原异常
  释放 -> 从世界移除约束 -> 移除刚体 -> 按依赖顺序销毁自建native对象
        -> 清空资源池/对象引用 -> 仅销毁自建世界与其依赖
  初始化异常 -> 释放已分配和已挂接部分 -> 恢复网格姿态/父级 -> 原异常上抛
  成功切换 -> 新资源准备成功 -> 提交边界释放旧helper/物理 -> 新资源接管
  失败或过期 -> 只释放暂存helper/物理，旧内容及开关保持
  动作切换 -> 绑定姿态/矩阵 -> 新物理/速度归零 -> 提交并设置首帧延迟；原进度流程保持
  自动循环 -> 原姿态复位，不新建/释放物理，不新增速度清理
  真实Ammo压力验证 -> 重复创建/步进/销毁 -> 存活native分配回到基线
  真实PMX/VMD重复切换 -> 内存稳定，无OOM，旧内容/进度/开关/循环仍正常
```

### 模型/动作物理初始化速度归零（2026-09-30，已实现）

```text
已有声明:
  网页 createMotionHelper、prepareMotionSwitch、新物理的 bodies 与 manager
  刚体 setLinearVelocity / setAngularVelocity / clearForces、物理开关、模型/动作提交保护
新增定义:
  PhysicsMotionReset { newPhysics, zeroVector }
操作流程（仅独立网页）:
  模型切换 -> 新模型骨骼/物理初始化 -> 新刚体速度归零 -> 提交模型 -> 下一渲染回调物理步进
  动作切换 -> 恢复绑定姿态 -> 更新骨骼矩阵 -> 新物理初始化
            -> 新刚体速度归零 -> 启用物理并提交动作 -> 下一渲染回调物理步进
  无物理或原物理关闭 -> 不创建物理、不执行归零
  归零入口位于web-motion-switch.mjs，由网页模型helper与动作新物理复用
  归零入口 -> 从新物理 manager 分配零向量
            -> 遍历新物理全部刚体，线速度与角速度置零、清除残留力、激活
            -> 无论成功/异常都释放临时向量
  归零不改刚体位置/朝向、PMX参数、骨骼、锚点或动作时间
  恢复默认模型/动作、物理重载 -> 复用相同初始化归零入口
  清理只在初始化边界执行；正常渲染帧不调用归零，保留后续物理运动
  VMD自动循环重播 -> 沿用现有helper循环处理 -> 不调用新增初始化速度清理
  现有resetPhysicsOnLoop为true -> physics.reset只按骨骼复位刚体变换，不清速度
  初始化或清理失败 -> 清理暂存资源 -> 恢复或保留原可用模型/动作/物理
  过期结果 -> 不提交、不归零旧物理；进度只在当前资源成功提交后达到100%
```

### 本地 PMX / VMD 加载进度（2026-09-30，已实现）

```text
已有声明:
  本地文件选择与串行 run、模型 runtime.onProgress、显示 onLoadProgress、网页底部进度条
  loadSelectedMotion、prepareMotionSwitch、PMX校验、模型/动作序号、旧模型/动作保留
新增定义:
  LocalLoadProgress { phase, percent, indeterminate, error }
  ProgressView { operationToken, latestPercent, hideTimer, settled, state }
  loadModel / loadSelectedMotion 的网页可选进度回调、默认模型进度事件
  APK构建不加载本地选择模块 -> 保留原模型进度渲染器；共享构建只在WEB_MODE替换渲染
操作流程（仅独立网页）:
  原生文件选择器返回文件 -> 取消旧收起定时器 -> 显示检查/准备阶段 -> 让浏览器绘制
  每次操作建立新token -> 该操作专用回调传至DisplayMmd及runtime
  UI接收回调 -> 检查token -> 更新底部条及本地消息；开始后的两个绘制回调再进行耗时读取
  默认模型/物理重载进度 -> 页面事件 -> UI同一进度视图，本地操作忙时不覆盖
  目录/多选 -> 枚举PMX -> 只有一个则加载；多个则提示数量和等待明确选择
  等待选PMX -> 结束文件检查提示，不宣称模型就绪；选中目标 -> 开始新的模型加载进度
  模型 -> PMX读取/校验 -> 纹理读取 -> 模型/物理初始化 -> 成功提交
  VMD -> 读取/解析 -> 序号有效 -> 暂停旧物理/恢复绑定姿态 -> 更新矩阵/初始化物理 -> 成功提交
  文件读取有字节数、纹理有资源数 -> 实际读取进度映射到对应阶段
  解析和物理初始化没有可测比例 -> 阶段提示或不定进度，不使用虚假定时器递增
  模型与VMD进度通知统一更新底部条及当前本地资源提示，忽略过期操作的消息
  成功提交 -> 显示100%和完成阶段 -> 保留1500ms -> 自动收起
  加载失败 -> 停止进度、不显示100% -> 保留错误原因 -> 继续旧模型/动作
  文件选择取消 -> 保留原状态，不显示虚假加载或完成
  恢复默认入口 -> 同一进度生命周期；新操作开始 -> 取消旧完成收起定时器
  保留串行与原物理/播放开关；进度更新不推进VMD时间或重新开启物理
```

### 重力方向 1:1 与锚点死区/缓动（2026-09-30，已实现）

```text
已有声明:
  gravityDirection、setModelGravityRotation、手动旋转层、重力开关、屏幕坐标转换
新增定义:
  GravityFilter { referenceSample, lastSample, rawQuaternion, acceptedTarget, currentQuaternion }
  GravitySettings { deadZoneDegrees: 0.5, smoothingMs: 20 }
操作流程（仅 WEB_MODE）:
  移除灵敏度控件和对应 DOM/事件/存储；保留重力开关、重力居中及首次姿态归零
  重力分类增加独立死区与缓动控件 -> 规范化参数 -> 当前浏览器保存 -> runtime 重力层
  启用 -> 首个有效 beta/gamma 记录参考 -> 下一样本使用完整方向求相对参考的旋转
  beta/gamma -> 屏幕坐标重力上方向 -> 参考到当前方向的最短弧四元数 rawQuaternion
  对跖方向使用固定旋转轴；忽略 alpha；不乘角度系数
  angleBetween(rawQuaternion, acceptedTarget) 小于死区 -> 保持 acceptedTarget
  达到或超过死区 -> acceptedTarget 使用完整 rawQuaternion，不扣除死区角度
  原始样本始终更新；相对接受目标比较，缓慢移动可累积越过阈值
  渲染帧 -> 按 delta 与 smoothingMs 计算球面缓动 -> currentQuaternion 收敛至 acceptedTarget
  smoothingMs 为 0 -> 立即采用目标；死区为 0 -> 每个有效样本均接受
  实际相机先更新 -> 重力层转换到世界坐标 -> 叠加独立手动层 -> 物理角速度保护
  横竖屏/后台 -> 重建中性参考；权限迟到不得重新开启；模型重载保留设置和最新目标
  居中 -> 参考采用最新样本 -> 强制重力目标归零，绕过死区，手动状态保持
  关闭 -> 强制重力目标归零，绕过死区，移除监听；手动状态保持
  测试 -> 首样本归零、居中、1:1角度、死区抑噪/累计、缓动收敛与帧率一致、参数为0
```

### 手动 VMD 切换绑定姿态物理与分帧播放（2026-09-30）

```text
已有声明:
  loadSelectedMotion、createMotionHelper、physicsEnabled、helper.current、PMX 骨骼和物理
新增定义:
  MotionSwitch { oldHelper, newClip, modelSequence, motionSequence, playbackEnabled, physicsEnabled }
操作流程（仅独立网页）:
  选择 VMD -> 解析 clip 成功 -> 核对当前模型/动作序号
  切换中的当前网格不推进 helper 帧，角色锚点仍更新；旧 helper 物理暂停
  保存骨骼/网格变换、表情与 IK 开关 -> 等待 Ammo 可用并检查序号
  恢复绑定姿态/表情 -> 注册新动画但不执行 update(0) -> 刷新世界矩阵
  根据原 physicsEnabled 与 PMX 刚体声明，在同一新 helper 上初始化新物理
  使用固定 vendor 的 _setupMeshPhysics；warmup 为0，animationWarmup 为false
  全部刚体线/角速度与残留力清零 -> 提交 helper/profile -> pendingInitialMotionHelper 指向新helper
  首个实际渲染帧 -> 强制关闭动画，仅推进物理，并隐藏角色初始化画面
  下一实际渲染帧 -> 使用最新动作开关，开启则从头推进，关闭则保持暂停
  原来关闭物理 -> 新 helper 继续无物理；原来暂停播放 -> 不应用动作第0帧
  失败或过期 -> 清理暂存物理；仍有效时恢复网格/骨骼/表情/IK及旧 helper -> 不改变旧profile
  实现模块 -> web-motion-switch.mjs；runtime 注入 -> web-local-assets-inject.js
  自动循环 -> 保持原helper与物理，不重复初始化或新增速度清零
```


### 本地 PMX / 贴图 / VMD 选择（2026-09-30，独立网页已实现）

```text
已有声明:
  DisplayMmd.loadModel、PMX runtime.load、loadMotion、LoadingManager
  动作面板、播放开关、进度、物理重载、重力旋转与 AR 相机
新增定义:
  LocalModelSelection { pmxFile, relativeFiles, textureMatches, retainedUrls }
  LocalMotionSelection { vmdFile, resourceId }
  LocalLoadContext { selection, sequence, stagedResources, missingPaths }
操作流程（仅 WEB_MODE）:
  用户选目录或多选文件 -> 保留相对路径 -> 枚举 PMX -> 确定当前 PMX
  PMX 引用贴图 -> 规范化分隔符和相对路径 -> 查找完整路径
  文件多选缺少目录信息 -> 仅唯一文件名允许回退 -> 缺失/歧义显示路径
  受控虚拟 PMX/贴图路径 -> 当前加载器独立资源映射 -> 已选文件对象 URL
  通用 toon 纹理继续使用运行时内置资源，不放宽任意网络资源地址校验
  暂存模型与物理 -> 全部就绪且序号仍有效 -> 提交 -> 释放旧资源
  新选 PMX 时播放开启且当前 VMD 有效 -> 继承动作地址/标识/模式，按新骨骼重新解析
  继承的本地动作上下文与名称保留，不随旧模型释放；关闭播放或无VMD -> 新模型静态及物理
  用户选 VMD -> 准备新动作 -> 成功后替换；全部切换走绑定姿态物理及分帧播放
  加载错误或旧序号 -> 清理暂存资源 -> 保留原模型/动作 -> 显示错误
  切换物理重载 -> 复用当前本地选择 -> 不提前释放文件 URL
  恢复默认 -> 成功加载内置 profile -> 释放本地选择；刷新需重新选择
  web-local-assets.mjs 用模块内注册表保存已选文件；注册的虚拟路径仍带 PMX/VMD 扩展名
  每个 LoadingManager 仅映射该次注册上下文，不修改 Three.js 全局管理器
  预读 PMX 实际引用的纹理声明，缺失/歧义在创建网格前报错；内置 data URI toon 保留
  独立 VMD 先解析 clip，序号和当前网格仍一致才替换 helper 与当前 profile
  DisplayMmd 网页副本暴露当前 profile、独立动作加载和恢复默认模型入口
  操作期间禁用本地资源与物理开关，错误不抹去前一次成功选择
  物理重载正在进行时提示等待；多 PMX 时先展示空选项，不擅自加载第一个
  释放上下文后旧映射拒绝生成新 URL；BFCache pagehide 保留会话引用
  模块和注入副本使用同一内容指纹 URL，保证会话注册表唯一
  验证相对路径、歧义、缺失、VMD、取消、失败、并发切换及物理重载
```

实现：`web-local-assets.mjs`（路径索引/会话 URL）、`web-local-assets-ui.mjs`（选择/串行操作）、`web-local-assets-inject.js`（网页副本运行时和显示 API）；`build.js` 和 `web-panel-groups.js` 负责构建与入口。新增定向测试 3/3、既有 PMX/helper/物理测试 40/40 通过，网页构建与语法检查通过。


### 测试网页相机动作 VMD（2026-10-01，已实现）

```text
已有声明:
  PMX runtime camera（预览虚拟相机）、updateCameraView、fitCameraToModel、renderFrame、arCameraState
  MMDLoader.loadVMD、animationBuilder.buildCameraAnimation、MMDAnimationHelper
  动作面板、本地资源面板、loadSelectedMotion、getMotionProgress、恢复默认模型与动作
新增定义:
  CameraMotionSelection { motionUrl, motionResourceId }
  CameraMotionState { hasClip, helper, enabled, farLimit }
  UI: mmdArCameraMotionPlayback、mmdArCameraMotionProgress、mmdArCameraMotionTime、
      mmdArLocalCameraVmdButton、mmdArLocalCameraVmd、mmdArLocalCameraMotionName
操作流程（仅 WEB_MODE，构建期注入 web-dist 副本）:
  用户选择相机 VMD -> 独立文件上下文与对象 URL -> 加载器经本地映射读取
  loadVMD 解析 -> cameras 为空报错（内置角色动作 VMD 无相机帧）
  buildCameraAnimation 生成循环 clip；按机位最远距离(|position|+distance)+模型半径计算 far 上限
  复用固定 MMDAnimationHelper：先移除旧相机绑定，再绑定新 clip
  每帧仅在未定位且开关开启时 -> helper.update(delta) 覆盖相机位置/朝向/FOV，near 固定 1
  定位激活（含失锁冻结）-> 不推进混音器，相机保持 MindAR 姿态；退出定位 -> 从暂停处继续
  关闭开关或清除 -> 停止推进并恢复预览视角（up、fov 28、near/far 与 fitCameraToModel）
  进度只读：动作面板打开时每 250ms 读取当前/总时长；无相机 VMD 显示 --:-- / --:--
  动作面板开关默认勾选并持久化于当前浏览器；本地资源分组显示当前相机动作名
  恢复默认模型与动作 -> 清除相机动作并复位预览；释放本地文件上下文；pagehide 释放
  播放期间拖动仍旋转模型；缩放/体感观察不改变相机；不改正式显示端源码
  验证注入锚点唯一、合成相机 VMD 播放、进度推进、开关恢复、AR 暂停与无相机帧报错
```

实现：新增 `web-camera-motion-inject.js`（runtime/display 副本注入）；`build.js` 创建动作分类控件并接入注入链，`web-panel-groups.js` 负责分组与轮询/开关事件，`web-local-assets-ui.mjs` 负责选择与恢复默认清理。新增定向测试通过后构建 `web-dist`。


### 独立重力体感与手动旋转叠加（2026-09-30）

```text
仅 WEB_MODE:
  将独立体感环绕改为独立重力旋转，保留启用/重力死区/重力缓动/重新居中控件
  DeviceOrientation 只读取有限 beta/gamma，忽略 alpha/absolute/磁航向
  upDevice = [-sin(gamma)*cos(beta), sin(beta), cos(gamma)*cos(beta)]
  首个样本记录为中性重力；居中更新参考，不改手动角度
  按当前屏幕角度将参考/当前向量转到屏幕坐标，取两向量的最短弧旋转
  完整倾斜角不缩放；固定对跖方向轴避免反转抖动；接受目标按独立死区过滤
  新增网页专用 PMX 旋转入口，保存相机坐标的目标重力四元数
  每帧在实际相机更新后:
    manualYaw/manualPitch 仍使用原拖动目标角和缓动；不从最终组合 Euler 读回手动状态
    gravityQuaternion 按独立 smoothingMs 球面缓动；世界重力层 = cameraQ * gravityQuaternion * inverse(cameraQ)
    finalAnchorQ = worldGravityQ * manualQuaternion
    先更新锚点/骨骼世界矩阵，再推进物理/动作；合成角速度仍进入原旋转物理保护
  关闭体感/重新居中将重力目标归单位四元数，手动目标保持
  屏幕方向/后台切换重新建立重力参考，取消权限等待；退出清理监听
  模型尚未加载时保存重力目标，重载后恢复；无传感器时手动旋转仍可用
  相机独立 IMU 定位、MindAR/PMX 第二层相机缓动、角色拖动/缩放继续保留
  通过构建期注入网页副本，不改正式显示端或旧 APK
```

### 合并 MindAR Basic 相机融合（2026-09-30）

```text
仅 WEB_MODE 构建:
  复制 mind-basic-imu.js、mind-basic-quality.js 原模块，使用内容指纹加载
  从 mind-basic/index.html 复用 IMU/质量面板，改为 mmdAr ID；分类独立展开
  默认关闭 IMU；用户启用后请求权限并连续静置至少 1.2 秒校准双零偏/噪声
  两个开关分别控制图片可见/不可见时的旋转和平移预测
  共用核心的死区×2、静止归零、低通、时间/速度/位移保护和三帧重获
  每个新 targetUpdate 在微任务分解本帧矩阵，原始跟踪失败立即接管且不接纳旧矩阵
  每个 RAF 根据有效视觉<=500ms、校准/传感器新鲜度选择视觉/融合/冻结
  相机预测由固定世界图面位姿与融合目标相对相机位姿取逆得到
  A-Frame 参考框移到固定世界锚点，相机 rig 更新位置/方向；PMX 根节点不写入定位变换
  PMX 用已有底面/立面及尺度映射，只更新相机；融合输出继续经过原相机死区和第二层缓动
  保留相机 near=1、底面/立面、距离/缩放、角色拖动、模型物理和动作
  arReady 挂接只读质量观测；面板每100ms刷新，失锁/过期/停止不显示旧评分
  停止/换目标/离开取消权限等待、传感器监听、质量包装、RAF并重置相机/世界尺度
  横竖屏/后台切换清除预测时间基准，等待新视觉；重校准不移动固定锚点
  保留 PMX runtime 现有相机跟随实现，不增加跳过缓动的分支
  npm run build:web:mmd-ar-test 同步 web-dist；本次不发布外网
```

### MindAR One Euro Filter 调节（伪代码）

```text
网页构建:
  WEB_MODE 在定位面板新增 MindAR 抖动过滤分类
  提供 filterMinCF 与 filterBeta 两个滑条，默认分别为 0.001 与 1000
  APK 构建不添加这两项控件

页面初始化:
  从 aasc.mmdArTest.mindArFilter.v1 读取合法有限数值
  filterMinCF 限制到 0.0001..0.02；filterBeta 限制到 0..2000
  缺失、损坏或不可读时使用 MindAR 默认值
  更新滑条、数值显示和操作提示

用户调节:
  更新当前页设置与数值读数，并尽力保存到 localStorage
  不在运行中的会话修改 Controller，不中断相机
  提示停止并重新启动定位以应用

每次开始定位:
  等待定位页 A-Frame scene 完成初始化
  将当前 filterMinCF/filterBeta 写入 MindAR image system
  再启动 system，使新 Controller 使用本次滤波参数

既有 PMX 相机跟随死区和 smoothingMs 保持独立，不合并到 MindAR 参数
```

### HTTPS 测试网页面板横竖屏布局与共用透明度（伪代码）

```text
网页构建阶段:
  WEB_MODE 从正式 display.html 复制灯光、动作/物理和定位面板
  分类生成完成后，在每个面板顶部插入同一语义的面板不透明度滑条
  面板根容器写入统一的 opacity range 值
  构建 APK 模式不插入该网页专用控件

网页运行阶段:
  opacity = 从 localStorage 读取 aasc.display.mmdPanelOpacity.v1
  读取失败、值非法或超界时 opacity = 96
  将值限制到 0..100，并写入舞台 CSS 自定义属性
  改变任一滑条时同步所有面板的滑条、百分比文字和背景透明度
  尝试保存；存储失败不阻断当前页面操作
  背景透明度只作用于面板、分类卡片和分类标题背景，不作用于文字和输入控件

网页舞台尺寸变化:
  direction = visualViewport.width > visualViewport.height ? landscape : portrait
  portrait 和 landscape 时都把三个面板定位在竖向按钮列左边，顶部对齐第一颗按钮
  常规视口下三个面板都固定为 320px，不因横竖屏方向缩窄
  只有可用宽度不足 320px 时，才按按钮列、间距和左右安全区收缩到可用宽度
  面板最大高度 = 可视高度 - 上下安全区 - 24px，上限 620px
  内容超出时只滚动面板内部
  方向或可视区变化时重新计算位置、宽度和最大高度

网页动作面板事件:
  测试页动作按钮与动作面板使用独立 ID 时，显式绑定测试页自己的 click 事件
  动作面板把播放开关与进度读数组成“动作”分类，把物理开关与参数组成“物理”分类
  点击动作按钮时切换 hidden 和 aria-expanded
  打开动作面板时关闭灯光和定位面板；打开其他面板时关闭动作面板
  面板内部点击停止向外传播；点击外部或 Escape 收起并同步 aria-expanded
  动作面板打开时立即读取 getMotionProgress，并每 250ms 更新进度和当前/总时长
  面板关闭或页面离开时清理定时器；暂停和循环播放按实际 action.time 显示
```

正式显示端与 HTTPS 测试网页使用相同的存储键和范围；只有同一浏览器 origin 下的页面共享 localStorage 值。测试网页仍由 `npm run build:web:mmd-ar-test` 生成，不因本次修改上传发布。

### 测试网页动作面板与播放进度（伪代码）

```text
已有声明：灯光/定位面板、播放动作开关、物理开关与参数、PMX helper 的 VMD action
新增定义：动作面板 { 动作分类, 物理分类, 只读进度条, 当前时间/总时长 }
仅测试网页生成“动作”按钮与独立面板，复用现有控件节点和原设置键
动作/物理控件从灯光面板移入独立动作面板；灯光分类列表不得再引用已迁移的动作或物理控件 ID
动作面板保留播放开关并加入进度条；物理分类保留启用开关、物理频率和旋转暂停阈值
打开动作面板时关闭灯光与定位；打开后两者时关闭动作；点击外部或 Escape 关闭动作面板
WEB_MODE 副本从当前 PMX helper 的 action.time 和 clip.duration 读取播放状态
无模型、无 VMD 或无有效时长时显示未知并保持进度 0；暂停时进度停留，循环时跟随 action.time 回到起点
动作面板可见时定时读取实际播放状态并更新只读进度条；隐藏时停止定时器
保持已有动作、物理与灯光控制逻辑，不提供进度拖动或物理跳帧
```

### 测试网页 Blinn-Phong 高光（伪代码）

```text
已有声明：MMDToonMaterial 的直射高光、测试页基础光照分类、WEB_MODE 构建副本
新增定义：TestSpecular { enabled=false, color=#ffffff, intensity=0.3, shininess=30 }
读取独立本地存储，失败或字段非法回退默认；强度限制 0..2，锐度限制 1..256
基础光照之后插入独立高光分类；默认折叠，标题前开关与折叠按钮互不触发
分类 section 保留 mmd-ar-specular，容纳标题开关与正文颜色、强度、锐度
输入更新内存权威值并尝试持久化；原存储键与 shader 不变，折叠不改变启用状态
仅 WEB_MODE 复制模块并给 lighting import 添加内容指纹，正式源码和 APK 不变
为模型材质增加独立 uniform；关闭时完整保留原 PMX 高光
开启时用颜色、强度、锐度替代原高光，按 max(N·L,0) 和原 Blinn-Phong BRDF 计算
沿用进入直射光函数之前的主光和补光阴影，不改变漫反射、Toon、AO、轮廓光和透明度
每次绘制仅在设置版本变化时刷新 uniform；不改 PMX 原参数，避免材质 morph 覆盖
```

### 独立 WebGL2 深度读数页（伪代码）

```text
测试网页 AO 高精度采样构建:
  背景白色无效法线保护仅在法线预览启用；正常 AO 背景值 1 仍表示无遮蔽
  半分辨率边界修正开关默认开启，本地保存；全尺寸时禁用界面并跳过修正，保留用户选择
  AO 像素到源深度像素统一用整数映射 ((2 * AO像素 + 1) * 深度尺寸) / (2 * AO尺寸)
  用当前全分辨率像素及四邻点较连续的一侧估计视距斜率
  容差 = max(四分之一视空间像素尺寸, 八倍深度量化估计, 视距相关数值下限)
  四个低分辨率候选按真实源深度与斜率预测深度比较，拒绝背景及跨表面样本并按双线性权重合成
  无有效候选时只在该像素复用原公式补算法线或 AO；补算后不再模糊
  开启时保边模糊也使用相同源坐标和表面匹配，避免合成前跨表面混色
  关闭时保留 highp、整数像素横条修复及背景白边保护，沿用原有合成与模糊
  法线预览将低分辨率背景写为 alpha=0 的无效法线；正常 AO 背景仍为全可见
  合成先用全分辨率深度识别背景并保留原颜色/透明度
  前景像素对应低分辨率无效法线时，用同一整数深度差分公式在该像素重建法线
  内部有效低分辨率法线原样显示，不通过裁掉轮廓或全屏全分辨率预览掩盖问题
  将 AO 中心 UV 映射为深度纹理整数像素，中心和上下左右统一用 texelFetch 读取
  视空间位置使用该深度像素中心 UV 重建，禁止以未对齐 UV 搭配已离散化深度
  邻点坐标限制在纹理内；边缘优先使用实际存在的另一侧，退化切线使用朝前法线
  AO 遮蔽邻域样本同样对齐深度像素中心；全/半及尺寸预算缩放共用此规则
  AO 分类新增本次页面有效的法线预览开关，默认关闭
  预览复用 AO 原来的深度差分及法线方向修正，将 normal * 0.5 + 0.5 输出为颜色
  保持当前 AO 分辨率，跳过采样遮蔽及保边模糊；合成直接输出法线颜色并保留原画面 alpha
  预览允许在 AO 关闭时工作，退出后恢复原有 AO 开关、模糊和灯光参数
  复制正式源码到 web-dist 后，校验 AO 模块包含三处默认深度采样器
  将 AO、保边模糊、合成中的 tDepth 声明统一替换为 highp sampler2D
  计算 AO 副本内容指纹，写入 runtime 的 AO 导入 URL，再刷新 runtime 与页面脚本指纹
  构建失败时停止发布；校验后上传变化的脚本，最后切换首页
```

```text
打开 depth-probe.html:
  对同一深度纹理分别运行默认 sampler2D 与显式 highp sampler2D 程序，仅改变 sampler 精度
  每个程序分别读取已知值、片元深度、纹理值及背景，并显示误差与还原视距
  默认采样失败而 highp 恢复时提示采样器精度嫌疑得到支持；两者仍异常时继续排查，不宣称 AO 已修复
  不加载模型、相机、外部脚本或构建产物
  创建 WebGL2 上下文与 DEPTH_COMPONENT24 / UNSIGNED_INT 深度纹理
  依次用 AO 相机近远裁面和紧凑近远裁面绘制三个已知距离的平面
  在第二绘制通道读取深度纹理，将浮点深度编码进 RGBA8 再读回页面
  将浮点位模式直接拆为四个 RGBA8 字节，避免乘法编码自身压缩精度
  分别读取已知浮点 uniform、平面片元 gl_FragCoord.z、深度纹理采样三条路径
  记录三个平面中心及背景位置的原始深度，并逐路径比较误差
  根据近远裁面分别计算标准透视深度 A + B / 距离、反向深度 1 - 标准值
  已知值异常时先判编码/读回异常；已知值正常但片元异常时判投影/光栅化异常；仅纹理异常时判深度纹理采样异常
  将读数与两种预期值逐项比较，并还原实际视距、报告误差
  显示深度灰度预览、WebGL 参数、失败原因和可复制的诊断文字
  WebGL2、深度附件或读取失败时明确报错，不将失败读数误判为反向 Z

隔离约束:
  该 HTML 只供本地或任意静态服务器单独打开，不进入 web-dist/APK/正式显示端
  不改 AO 算法、构建入口、发布清单与远端资源
```

### 测试网页基础光照实际相机裁剪范围（伪代码）

```text
测试网页基础光照显示实际相机裁剪范围:
  仅在 --web 构建复制后的 PMX runtime 中注册测试专用只读投影矩阵读取器
  正式显示端原始源码及测试 APK 拷贝保持不变
  测试页基础光照分类插入无 ID 的 near/far 只读标签，不参加灯光配置和持久化
  面板可见时读取 DisplayMmd 模型就绪状态和运行时当前投影矩阵
  对标准透视矩阵按 m[10]、m[14] 反解 near/far，先校验有限值和正数顺序
  MindAR 活跃时标记来源为 AR 投影；否则标记普通 PMX 相机
  投影缺失或非标准透视时显示不可读取，不误报初始化的 0.01/100
  面板隐藏时停止定时刷新；重新打开、模型加载、AR 切换时刷新
  测试网页构建对诊断注入锚点做唯一性校验，并更新 PMX runtime URL 指纹
```

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
  不复制、不加载自写图片跟踪器脚本
  网页与 APK 构建均固定 MindAR，不显示 current/MindAR 算法下拉或 A/B 结果
  APK 由测试适配层调用单一 MindAR tracker，网页继续使用 A-Frame MindAR
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
  注入测试页 MindAR 单算法所需的识别参数和运行指标
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

### 测试网页 VMD 动作播放开关（伪代码）

```text
网页构建模式:
  在灯光面板首个分类插入“播放动作”复选框，默认 checked
  把复选框登记为网页专用“动作”分类控件
  APK 构建模式不插入该控件

网页专用初始化脚本，在 DisplayMmd 模型初始化前执行:
  从 aasc.mmdArTest.motionPlayback.v1 读取字符串
  enabled ← (保存值 == "false") ? false : true
  设置复选框 checked = enabled
  调用 DisplayMmd.setMotionPlaybackEnabled(enabled)
  监听复选框 change
    enabled ← 复选框 checked
    调用 DisplayMmd.setMotionPlaybackEnabled(enabled)
    尝试将 String(enabled) 写回专用 localStorage 键
    存储不可用时仅本次页面生效

DisplayMmd.setMotionPlaybackEnabled(enabled):
  将 enabled 规范化为严格布尔值
  保存显示模块状态
  若 PMX runtime 已创建则立即转发；否则由后续 runtime 创建时应用

PMX runtime 应用开关:
  仅更新 MMDAnimationHelper.enabled.animation
  保持 enabled.physics 原值，布料继续模拟
  helper.update(delta) 继续执行并渲染
  关闭时 mixer 不推进，当前动作帧保留；开启后从该帧继续
  每个新 helper 继承当前开关状态
  刷新重新加载动作时不在初始化阶段应用 VMD 第 0 帧；新模型首个实际渲染帧只更新物理且不绘制角色，第二帧起推进 VMD 并显示

验证:
  默认开启；切换关闭后帧停止、物理状态仍推进；重新开启接续帧
  关闭后刷新仍关闭且保留 PMX 绑定姿态；清除/无效存储值默认为开启
  APK 页面及正式显示端界面不新增该复选框
```

### 测试网页 PMX 物理对照开关（伪代码）

```text
网页构建模式：在“物理”分类加入默认开启的复选框；APK 和正式显示端不加入
初始化时读取 aasc.mmdArTest.physicsEnabled.v1；仅明确保存 false 时关闭
在 DisplayMmd.init 之前设置物理状态，避免初次加载后立即重复加载
用户切换时禁用复选框，调用 DisplayMmd.setPhysicsEnabled(checked)
  如果成功，保存专用 localStorage 键并恢复复选框可操作
  如果失败，恢复原复选框值及运行状态，不保存失败值
DisplayMmd.setPhysicsEnabled:
  将开关状态传给 PMX runtime，并用当前 profile 重新加载模型
  关闭时新 helper 以 physics=false 创建，不请求 Ammo，不执行物理预热
  开启时初始化 Ammo，但不在不可见阶段预热或套用 VMD 首帧；后续正常物理步进
  动作从 VMD 第 0 帧重新开始；原模型在新模型准备阶段继续显示
  不使用 helper.enabled.physics=false 模拟“无物理”
验证：带刚体 PMX 关闭物理时 helper 不初始化 Ammo，开关重载不会影响正式显示端
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

## 7. 历史：测试 APK 内的跟踪器 A/B 对比

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

### mmd-ar HTTPS 测试网页角色拖动与缩放（伪代码）

```text
构建 WEB_MODE 页面
  继续从正式显示端复制 display-mmd.js、display-pmx-runtime.js、display-mmd-ar-pose.js 与 display-mmd.css
  不注入额外手势脚本，保持测试网页和正式端使用同一 pointer 处理逻辑

运行测试网页
  左键/单指拖动沿用角色旋转；轻点角色沿用互动
  鼠标滚轮与双指捏合连续缩放相机距离，保持 PMX 根缩放不变
  鼠标右键拖动与双指中点移动角色相对定位锚点的位置
  相机缩放作用在 A-Frame 跟随相机位置上，不改写 MindAR 锚点矩阵
  通过既有 PMX 手势、AR pose 与测试网页构建回归确认行为
```


## ORB-SLAM3 定位迁移评估（2026-09-30，尚未实现）

```text
已有声明: MindAR锚点 -> MindBasicImu预测 -> setArCameraPose(图面/尺度换算) -> 第二层相机缓动
拟新增定义: SlamPose {timestamp, cameraToWorld, trackingState, mapId, generation}
拟新增定义: WorldAnchor {mapId, worldTransform, metricScale, placement}
已确定: APK提供原生ORB-SLAM3桥；纯网页无原生接口时使用MindAR；不移植WASM
待确定: 原生单目或单目IMU的设备标定；手动放置还是图片首定位
拟原生接口: MmdArNativeSlam.getCapabilities/start/stop/reset
拟能力: {protocolVersion:1, engine:orb-slam3, available, reason}
拟回包: {sessionId, generation, timestamp, mapId, trackingState, cameraToWorld, projectionMatrix}
后端选择:
  无接口 -> 原MindAR
  能力查询失败/版本不支持/available=false -> 原MindAR
  能力可用 -> 原生ORB-SLAM3适配；不同时启动MindAR
  原生跟踪失锁 -> 原生重定位流程，不触发自动后端切换
  原生启动失败 -> 完整释放输入/线程/迟到回调后提示或回退MindAR
拟迁移流程（本轮未改实现）:
  相机标定 -> 内参/畸变；惯性模式另标定外参/噪声/时间偏移
  输入 -> 相机帧及采集时间戳；原始加速度/角速度按相机帧区间对齐
  Android -> 检查Camera2时间戳来源；不能直接拿UNKNOWN与SensorEvent比较
  APK原生适配 -> 有界最新帧队列 -> TrackMonocular(frame, time, imuBatch)
  有效跟踪 -> 转换SLAM位姿方向、坐标轴、矩阵存储顺序、世界锚点与模型单位
  通用相机接口 -> 当前投影/背景裁切 -> 原第二层死区和缓动 -> 渲染相机
  SLAM模式 -> 不再走旧MindBasicImu预测；渲染缓动不反馈SLAM测量
  模型根节点 -> 保留手动偏移/旋转/缩放、动作和Ammo物理
  初始世界锚点 -> 手动放置或已知图初始对齐；单目必须定义尺度
  失锁 -> 保留角色且明确位姿无效；重定位/回环检查锚点变换
  新地图/重置 -> 旧锚点不能直接复用；要求重定位旧图或重新放置
  状态面板 -> 初始化/跟踪/失锁/重定位、匹配点数量；不伪造概率可信度
  后台/停止 -> 释放采集/SLAM线程；代次阻止迟到位姿污染新会话
  共用网页 -> 后端分发器/原生桥适配/MindAR资源，重新构建web-dist；无WASM依赖
  MindAR模式 -> 保留原图像定位/IMU预测；原生模式只保留渲染缓动
  能力检测不启动相机/申请权限；原生接口只向本地白名单页面注入
  原生预览与位姿对应同一相机配置，禁止原生和网页争用相机
  独立APK -> Camera2/SensorManager/NDK/JNI与预览桥接，重新编译APK
  尚未实施 -> 不更改当前运行后端、不标记新增发布产物、不执行测试
```

## 原生ORB-SLAM3双后端实现计划（2026-09-30，用户已确认）

```text
已确定: APK NDK原生定位；网页无接口走MindAR；使用原图片首定位对齐SLAM
构建:
  固定ORB-SLAM3源码提交、OpenCV Android SDK和依赖 -> 本地构建缓存
  自有CMake构建headless core/DBoW2/g2o/Boost序列化；不构建桌面Viewer/ROS/示例
  APK资产加入词袋及许可证，原生lib经Gradle打包；网页不带原生资源
  APK与网页都加载MindAR/A-Frame和原生分发器
原生桥:
  getCapabilities -> 检查实际lib/词袋存在，返回协议1/engine/available
  start(targetImage, selectedQuad, viewport, calibration?) -> 会话ID；后台初始化
  Camera2单一采集同时输出TextureView预览与ImageReader灰度帧
  permission -> 允许后启动；退出/暂停/错误 -> 释放camera/sensors/native threads
  原生frameQueue最多一个等待帧，丢旧帧不积压；时间戳使用采集时间
  合法标定具备IMU外参/噪声/时间同步 -> IMU_MONOCULAR
  未提供惯性标定 -> MONOCULAR；内参优先标定，其次Camera2数据估算并明确状态
  原始IMU缓存按帧区间传入，禁止旧网页预测参与原生融合
图片锚定:
  参考图按已保存quad裁切 -> ORB参考描述子
  每帧ORB匹配/RANSAC/PnP -> 目标到相机矩阵（图宽单位）
  SLAM初始化期间保留图片测量；相机有足够平移且多个共同观测后拟合尺度/旋转/平移
  对齐通过 -> 保存锚点相对地图关键帧的变换；后续只依赖SLAM
  新地图/锚点关键帧失效 -> 重新寻找原图；失锁保留显示并暂停相机目标更新
位姿/显示:
  OpenCV坐标转Three坐标 -> anchorMatrix（目标到相机）
  原生投影与TextureView使用相同屏幕旋转/cover裁切
  网页收到sessionId/generation一致的位姿 -> 既有setArCameraPose -> 第二层缓动
  原生异常/后台 -> 作废代次；不自动并发启用MindAR
  纯网页/能力不可用 -> 原MindAR start/processFrame/stop及原IMU流程
  相机设置、模型动作/物理/手动拖动和旋转保持
本轮: 不新增/运行测试；允许构建和静态检查，未授权安装到设备或发布/提交
```

原生生命周期补充伪代码:
```text
Android单实例会话互斥 -> 初始化与停止不得交叉释放其他会话
编译时镜像上游头文件并加入对象登记基类 -> KeyFrame/MapPoint/Map/Preintegrated/相机对象登记
上游正常delete -> 注销；停止后的残余对象 -> 分类统一回收
GBA线程取消时解锁GBA互斥量再join；完成旧任务后才启动新任务；停止时join当前GBA
Shutdown -> join局部建图/回环 -> join GBA -> 删除跟踪组件 -> 回收残余地图与预积分
```

## 原生双后端已实现契约（2026-10-01）

```text
固定源码commit=4452a3c4ab75b1cde34e5505a36ec3f9edcdc4c4
固定下载=OpenCV4.11.0/Boost1.85.0/Eigen3.4.0；解压前校验SHA-256
capabilities: protocolVersion=1, engine=orb-slam3, available=真实lib和词袋可用
start: referenceImageBase64/selectedQuad/calibration? -> sessionId,generation
事件: status/ready/error/pose -> sessionId,generation及message/测量
pose: timestamp,trackingState,mapId,anchored,trackedPoints,imageMatches,imuInitialized,poseValid
      mode,calibrationQuality,anchorMatrix(列优先16),projectionMatrix(列优先16)
首次: 图片ORB/RANSAC/PnP + SLAM共同观测 >=5、足够平移 -> 旋转SVD/正尺度/残差门控
锚定: 使用不被常规剔除的地图首关键帧；保存目标->关键帧变换及地图点初始深度
后续: 当前相机->首关键帧；地图点深度比中位数修正尺度 -> 目标->当前相机
惯性: 提供Tbc/噪声/频率/timeOffsetSeconds并校验REALTIME -> IMU_MONOCULAR
      传感器时间+标定偏移 -> 帧区间批次；惯性初始化前不固定锚点
默认: MONOCULAR + 焦距/物理传感器尺寸估算K；明确estimated/calibrated
渲染: OpenCV转Three -> 既有anchorMatrix图面/模型高度换算 -> 原相机缓动
无接口: 同一APK/网页A-Frame MindAR资源与旧IMU控件；网页无原生依赖
停止: 页面取消即作废代次/回调 -> Camera2/Sensor清理 -> worker串行销毁引擎
本轮检查: 构建/静态语法/资产检查；不新增或执行测试/手机安装/发布/提交
```

```text
构建资产检查: APK要求arm64 SLAM/C++库、词袋、版本/许可证、原生适配及MindAR回退脚本
            词袋按打包源SHA-256/大小核对，默认模型和MindAR沿用固定清单检查
相机控件: camera-settings-template.js共享模板 -> APK和网页相同默认/存储/事件逻辑
```

```text
Android上游补丁: Tracking析构释放特征提取器/标定；不创建原本未保存的IMU重定位临时Frame
              重定位MLPnP候选改unique_ptr自动回收；纯单目不读未初始化的IMU配置
采集参数: ready报告后置cameraId和实际width/height；标定尺寸错误明确显示期望尺寸
```

```text
APK标定导入: WebChromeClient文件输入 -> 系统文档选择器 -> 用户选中content Uri -> File读取JSON
             保持本地origin白名单/禁止file导航；content读取允许，结果仅接content scheme
             取消/新选择/Activity销毁 -> 旧ValueCallback收到null，防止悬挂
```

## 低模面间 AO 浅凹抑制（2026-10-01，已实现）

```text
用户问题 := 拉近相机后相邻低模面的 AO 暗带（非外轮廓）
法线 := 沿用深度差分几何法线；不改模型法线或几何
用户已确认 := 内凹交界处出现 AO
控件 := 灯光 → AO → 浅凹抑制；0..45度 / 步长0.5度 / 默认10度
存储 := aasc.mmdArTest.aoConcavityAngle.v1；受限时保持本次调整有效
初始化:
    缺失、空字符串、非法存储值 -> 默认10；合法数值 -> clamp(0,45)
    输出数值与 window.MmdArTestAoConcavityAngle 同步
input/change -> 校验范围 -> 即时设置 + 保存
灯光恢复默认 -> 滑块及存储恢复10度
每帧AO渲染:
    角度 := window.MmdArTestAoConcavityAngle
    lower := finite数值 ? sin(clamp(角度,0,45) * PI/180) : 0.08
    upper := lower + 0.22（保持原有平滑过渡宽度；未指定时等价旧0.08..0.3）
    原AO与合成补算 uniform aoFacingThreshold := (lower, upper)
共同shader函数:
    facing := dot(重建法线, 采样点-中心点) / 距离
    遮蔽权重 := smoothstep(lower,upper,facing) * 原距离权重
阈值含义 := 采样方向高出当前切平面的角度；不是两面的法线夹角
兼容 := 半/全分辨率和补算一致；法线预览不受门限影响
限制 := 较高门限同时减弱真实浅凹槽遮蔽，10度为起始值非已实测最优值
构建 := 既有 build.js 复制共享shader/面板并生成指纹；同步web-dist
状态 := 共享源码使servicePackage保持true；不改minApk/dependenciesPackage
检查 := 静态语法/构建/差异；不新增或执行测试，不构建APK/提交/发布
结果 := 网页构建成功；源/生成AO一致；4内联脚本/importmap语法通过
生成AO指纹 := 8eae1293cfd9；真实近距离视觉与手机交互待验收
```

## 主光阴影偏移控件（2026-10-01，已实现）

```text
用户范围 := 暂不处理AO，先处理阴影；已确认主光bias/normalBias控件方案
文件 := 新web-shadow-bias.js + web-panel-groups.js + build.js测试副本注入
主光深度偏移bias := [-0.005,0.005] / step0.0001 / 默认-0.0005
主光法线偏移normalBias := [0,0.1] / step0.001 / 默认0.02（场景单位）
唯一字段定义 := 控件/默认值/校验/运行时由同一描述生成
normalize(value, field):
    缺失/空串/非数值类型/非finite -> field默认
    clamp范围 -> 对齐step -> 按field小数位规范化
控件初始化:
    localStorage key aasc.mmdArTest.keyShadowBias.v1 -> JSON对象
    非对象/解析错误/存储受限 -> 默认
    规范化两值 -> 滑块/输出 -> 发布冻结的测试页设置对象
input/change -> 读取两滑块 -> 即时发布 + 本地保存
灯光恢复默认 -> 默认两值 -> 发布 + 保存
独立测试runtime:
    主/补光旧初始化后建立局部syncTestKeyShadowBias闭包
    帧渲染在visible/disposed判断后、实际渲染前调用同步
    设置对象未变化 -> 常数时间返回
    新设置 -> 同一字段校验 -> 仅改keyLight.shadow.bias/normalBias
    数值实际变化 -> keyLight.shadow.needsUpdate=true
    不操作fillLight独立阴影参数；补光沿用主光的既有shader关系继续保留
生命周期 := 无新增全局回调/定时器；不可见期间保存，下次渲染应用
构建 := 本次提交为独立测试网页生成runtime注入，既有runtime指纹更新
提交范围 := 阴影相关片段及文档；APK共享构建等其他未提交工作不带入
本轮输出 := 本地web-dist；不重新打包APK或发布外网
范围限制 := 不改AO、模型、正式runtime源码/灯光配置、贴图尺寸和阴影相机
Offline状态 := 独立测试变更不改变现有发布状态
检查 := 静态语法、生成资源与构建；不新增或执行测试
风险 := 过大偏移可能使接触阴影脱离；保留旧默认，近距离条纹改善需现场调参
结果 := 静态语法及网页构建通过；主光两控件唯一/参数匹配
runtime指纹 := bb62ffb19c38；display-mmd动态导入携带同一指纹
AO指纹 := 8eae1293cfd9；与已有源码一致，本轮不再修改
待验收 := 实际条纹观感/偏移调节、保存/复位/主光及补光模式
```

## 补光继承主光背光区域（2026-10-01，已实现）

```text
已确认原因 := 继承系数仅含主光shadow map可见度，不包含主光背光区域
拟修改文件 := display-pmx-lighting-mode.mjs / createWebFillShadowChunk
方向光循环（既有主光索引0、补光索引1）:
    每盏光采样前将当前遮挡系数重置为1
    有阴影贴图且片元接收阴影 -> 当前遮挡系数 := 原getShadow结果
    光颜色 *= 当前遮挡系数（保持既有本光阴影）
    主光索引0、执行RE_Direct前:
        朝向 := dot(geometryNormal, directLight.direction)
        朝向门控 := smoothstep(-0.3, 0.3, 朝向)
        缓存主光继承系数 := 当前遮挡系数 * 朝向门控
    补光索引1、执行RE_Direct前:
        光颜色 *= mix(1, 缓存主光继承系数, pmxFillUsesKeyShadow)
    执行原RE_Direct
边界 := 朝向<=-0.3补光为0；朝向>=0.3只继承遮挡，不乘完整余弦强度
用户后续反馈 := 强补光时0至0.05过渡过窄出现硬折线，允许过渡延伸至负点积
新增修正 := -0.3至0.3平滑；点积0门控0.5，深背光仍抑制；无新增控件
最新构建 := 范围修正源/生成模块4个、内联脚本/importmap5段静态语法通过
最新指纹 := lighting 8dc6c931342c / runtime 76b6dccea2dd / skeleton 617ffe2b4cb7
缓存位置 := 位于阴影贴图条件之外；无阴影采样时默认可见度1
兼容 := 主光自身计算、补光无/独立阴影、主光关闭回退均保持既有逻辑
成本 := 无新增贴图/采样/pass；少量点积与平滑门控运算
同步 := npm run build:web:mmd-ar-test复用既有复制及资源指纹流程
Offline := 若共享源码实施变更，servicePackage保持true；其他项沿用
检查 := 静态语法与构建；不新增或执行测试、不打包APK或发布
状态 := 用户已确认并实现；源语法及网页构建通过，实际背光面效果需现场验收
```

## 骨骼小球遮挡开关（2026-10-01，已实现）

```text
用户纠正 := 前方骨骼小球遮挡后方小球；不受角色遮挡
控件 := 动作/骨骼/小球相互遮挡 checkbox，默认false
存储 := 既有skeletonDisplay.v1对象增加occlusionEnabled严格boolean
面板apply -> DisplayMmd.setSkeletonOcclusion -> runtime.setSkeletonOcclusion
DisplayMmd记忆设置 -> runtime初始化/重建时补发
骨骼overlay:
    occlusionEnabled := 设置===true
    现有/新建球材质.depthTest、depthWrite := occlusionEnabled
    换模型保持设置
    实际叠加绘制前:
        renderer.autoClear := false
        遮挡开启 -> renderer.clearDepth（保留角色/碰撞体颜色）
        绘制球 -> 只比较小球表面深度，前球挡后球，与类型分组/实例顺序无关
    骨骼不再请求角色深度；既有补绘仅服务实体碰撞体
作用域 := 小球像素；名称/选中轴/轻点拾取沿用现有诊断行为
检查 := 静态语法与网页构建，不新增或执行测试
现场 := AO开关/碰撞体样式/骨骼开关/遮挡切换/刷新/换模型/隐藏角色
资源释放 := runtime销毁时释放共用角色深度材质
状态 := 已按用户纠正实施；仅球之间的深度遮挡
检查 := 6个源/生成模块、5段内联脚本/importmap静态语法及网页构建通过
指纹 := skeleton 617ffe2b4cb7 / runtime 0cda1aa3f234 / lighting e0e0c27ff41c
现场 := 同/跨类型球重叠、视角旋转、AO开关、保存/重建；不新增绘制pass
```

## 补光范围与骨骼遮挡处透明度（2026-10-01，已实现）

本次提交仅包含对应功能片段，球alpha输出兼容既有Basic材质及工作区Lambert材质；原生共用构建、固定顶光、碰撞体实体与AO改动不纳入。以下指纹为完整工作区首次构建记录，生成产物不提交。

```text
补光参数:
    控件 := 灯光/补光/过渡起点和终点，范围[-1,1]，默认[-0.3,0.3]
    校验 := 缺失/非finite -> 默认；clamp；步长0.01，保证终点大于起点至少0.01
    交叉输入 := 改起点时把终点推高，改终点时把起点推低；边界限制[-1,1]
    独立参数辅助模块 -> 保存/恢复默认 -> 测试runtime设置材质vec2 uniform
    存储键 := aasc.mmdArTest.fillFacingRange.v1；冻结设置对象按身份同步
    背光门控 := smoothstep(起点,终点,主光法线点积)
    状态变化或模型重建 -> 更新；每帧设置身份未变化且模型未变化 -> 快速返回
骨骼角色遮挡:
    控件 := 动作/骨骼/遮挡处不透明度，0..100%，默认50%
    步长 := 1%；runtime使用0..1，非法值回退0.5
    存储 := 沿用既有骨骼显示偏好并在runtime重建补发
    小球显示 && 模型可见 && 不透明度<100%:
        独立辅助模块用角色浅克隆捕获深度纹理，不包含球/碰撞体
        共享几何/骨骼/形变数据，仅独立深度材质；保留源材质可见性/side/alphaTest
        图像尺寸匹配画布；使用本帧相机/蒙皮/形变后的角色
        捕获前保存target/autoClear/阴影更新状态，finally恢复；不重复绘主光阴影
    球shader在opaque_fragment前按像素比较角色深度（默认24bit深度，差值容限0.000001）:
        角色后面的球面 -> alpha := 遮挡处不透明度
        角色前/外部球面 -> alpha := 1
    相互遮挡开启:
        清球层深度 -> 球深度预绘 -> 半透明球颜色绘制只保留最近球面
        球深度实例共享颜色实例矩阵；深度遍只有球，颜色遍depthWrite=false
        避免先绘的后球颜色残留导致穿透前球
    相互遮挡关闭 -> 按既有叠加逻辑，仍可按角色深度改变球面alpha
    名称/轴/拾取沿用既有诊断行为
    全不透明或诊断关闭 -> 不捕获角色深度；销毁/换模型/resize正确管理资源
    缺少WebGL2/WEBGL_depth_texture -> 球正常显示，不执行角色深度捕获
影响 := lighting-mode、独立参数辅助/build/面板、骨骼模块/注入及深度辅助模块
范围 := 不改暂停的AO算法，不给正式显示端新增控制端配置
检查计划 := 静态语法与网页构建；不新增或执行测试
风险 := 角色深度与必要球预绘增加诊断开销，手机性能及透明交界需验收
生命周期 := 只释放辅助拥有的材质/目标/实例资源，不释放共享模型骨骼或几何
状态 := 用户已确认两项并已实现；网页构建及12模块/5内联与importmap静态语法通过
生成控件 := 起点、终点、不透明度各1个，位于各自分类
生成指纹 := lighting64a2b657cf9f / character-depthddc72846653a / skeleton7adb2a6a6cfb / runtime0e8e21cc4809
现场 := 实际画面/交互与性能未验收；未新增或执行测试、未打包APK/提交/发布
```

## 眉心凸面 AO 排查（2026-10-01，未改代码，用户要求暂缓）

```text
新线索 := 用户发现额头半透明覆盖面
已核对默认 := Three.Material depthWrite=true / alphaTest=0
加载路径 := MMDLoader按diffuse alpha设置transparent，不自动关闭depthWrite
AO输入 := 彩色通道DepthTexture，混合透明度不等于忽略深度
排查优先级 := 找到实际覆盖面材质/透明度/深度写入 -> 隐藏该面做同视角对比
若确认来自覆盖面:
    先确认具体材质及范围，再选择装饰层不写深度或独立AO深度排除策略
    保留可见叠加；不能统一排除所有带alpha纹理的材质
原法线/合成修改候选 := 未获确认，保留候选，优先检查覆盖面
主光shadow bias候选 := 独立问题，仍待确认
本轮 := 只读核对与文档，无运行代码变更或测试
```

```text
反馈 := 抑制45度 + 拉近相机 -> 两眉中心凸面皮肤仍变暗
角度门限局限 := 无法区分邻近眉毛几何 / 自表面 / 错误法线 / 滤波污染
已核对:
    法线 := 一像素深度差较小的一侧；跨面连续性尚无二像素判断
    全分辨率合成 := 中心+四邻点深度加权平均；模糊0轮仍执行
    半分辨率修正 := 表面归属匹配 + 原公式补算
截图 := 用户runimg/ao1.jpg，眉心内部细红线；用户确认AO颜色红/红线来源AO
模型资料 := 脸前有阴影材质层，眉心抽查alpha=255；不认定透明片根因
AO候选（待确认）:
    原AO及补算/预览共用两像素深度连续性选边法线
    比较同侧深度线性外推至中心的误差；背景/边界邻点不作为共面证据
    全分辨率AO直接同像素合成，半分辨率保留现有归属匹配/补算
    保留浅凹抑制门限、模型法线与几何；实际红线改善待复现验收
阴影现状 := PCFSoft / 1024平方 / 全角色范围 / bias=-0.0005 / normalBias=0.02
阴影候选（待确认）:
    web-panel-groups新增主光深度/法线偏移 -> 本地保存/灯光恢复默认
    build.js仅测试生成runtime接入 -> 主光shadow参数即时生效
    初始值保留现状；过大偏移可能让接触阴影脱离，需用户画面对比
下一步 := 用户确认具体方案后更新实际伪代码再实施；不能以颜色区分替代验证
状态 := 原因未定、问题未修复；本轮仅源码排查与文档
```

## 2026-10-01 PMX 刚体 Ammo / XPBD 可选求解

用户确认：新增布料计算选项；XPBD驱动已有PMX刚体和骨骼，不建立布料顶点网格。参考Ten Minute Physics刚体/关节示例与XPBD论文，独立JS实现；正式显示端暂不接入。

```text
测试构建复制 XPBD 刚体/碰撞/PMX适配模块，并逐级写入内容指纹
动作→物理：布料计算 = Ammo(default) | XPBD
恢复本地physicsSolver；未知值归一Ammo
首次偏好在Display首次加载前同步读取，面板恢复不触发重复重载
切换：物理配置互斥→锁住控件→保存旧选择→请求Display重载当前模型
  新helper创建physicsSolver指定的物理；失败恢复旧选择和模型
  成功保存偏好；刷新、换模型、换VMD都补发同一求解器
Ammo：沿用当前MMDPhysics/固定步进/STOP_ERP/风
XPBD：不加载Ammo，建立现有PMX球/盒/胶囊刚体
  绑定姿态下计算刚体到骨骼偏移、关节局部锚点与局部旋转框架
  每画面帧采样type0姿态/type2位置
  复用基准Hz数值作为每帧子步数N（10–180，步长5，默认/非法回退45）
  N不取物理Hz/基准Hz比值；XPBD忽略物理Hz，Ammo继续使用原物理Hz/ERP
  h := 当前有效帧间隔 / N
  循环N个子步：保存上一步姿态→按(i+1)/N插值驱动锚点→重力/风/阻尼积分→清零各约束lambda
    SAP+AABB筛选一次；尊重PMX分组/掩码/关节相连禁碰
    球/胶囊解析、胶囊盒最近距离、盒盒SAT/面裁剪生成接触；采集入射速度
    1轮：非零弹簧用compliance=1/k，随后求逐轴平移/旋转硬范围约束
      deltaLambda=(-C-alpha/h²*lambda)/(sum(invMass*gradient²)+alpha/h²)
      更新刚体位置/旋转并累积lambda
      关节后解一次非穿透并保持子步局部接触
    回算线/角速度→单轮关节硬限位速度投影→接触摩擦/反弹（含尺寸容差和低速抑制）
    子步末只读接触索引供骨骼诊断；画面帧末回写骨骼一次
  type0跟随，type1完整物理，type2位置随骨骼/旋转随物理；零质量不可移动
  骨骼世界姿态通过父世界姿态逆转换，保留现有非单位缩放坐标规则
  复位/换VMD清空速度、lambda与帧子步统计；释放仅自身JS对象
基准控件下限10，共享规范化/Display/存储/HTML一致；保留现有默认45与合法偏好
Ammo显示纠错基准Hz并换算ERP；XPBD显示每帧子步数，值10即每帧10子步
XPBD禁用物理Hz滑条并保留原值；切回Ammo恢复可用
状态行显示当前子步数、每子步1轮与帧物理耗时，不增加独立子步设置
```

限制：骨骼蒙皮密度不变，不能生成额外布料褶皱；XPBD刚度转换不是MMD手感保证；离散碰撞无CCD，极快运动可能穿透。只做构建和静态检查，不运行或新增自动测试；真机性能和效果待用户验收。

实现状态：已完成共同测试构建接入；初版9源文件/11生成模块/5内联或importmap静态语法、控件唯一性和21指纹检查通过，最新子步检查见下文。XPBD每子步1轮，Euler角梯度用瞬时轴对偶基，临近奇异处限制梯度及单次旋转修正；盒盒面接触用裁剪多点，边接触用最近线段，胶囊中轴入盒采用最短盒面推出。仍属离散近似，不保证高速/深度交叠接触或PMX复杂角度限制与Bullet一致。实际物理与性能未验证，未执行/新增测试、打包或发布。

### 2026-10-01 XPBD复用基准数值为每帧子步数（已实现）

用户最终明确：基准数值10就是每帧10个子步，XPBD暂不使用物理Hz；取代此前基准/物理频率比值方案。帧间隔沿用runtime有效delta，每个子步重新积分/插值/碰撞/回算速度，每帧最后一次骨骼回写。降低基准下限至10，保持上限180、步长5、默认45与共享存储。初始化options及运行时setter均规范化；现有unitStep/maxStepNum可以由共享runtime赋值但不参与XPBD步进。复位/暂停恢复/VMD切换重置插值与帧子步统计。只构建与静态检查，真实运动/耗时待现场验收。

静态完成记录：7源文件/12生成模块/5段内联脚本或importmap语法通过；4个相关控件唯一，基准min10/max180/step5/default45；21处相对导入指纹一致。核心指纹b421bb90c31a、PMX适配848eb1725b17、共享基准8b802f71a249。只构建与静态检查，未执行/新增测试或设备验证。

### XPBD硬限位速度与静止接触修正（2026-10-01，已实现）

用户已确认优先修正关节硬限位速度约束、静止接触容差与低速反弹抑制；没有调整每帧N子步、每子步1轮、物理Hz禁用或PMX弹簧/阻尼语义。抖动主因尚无设备复现证据，不把修正接入等同实际抖动验收通过。

```text
bodyTolerance := clamp(最小形状半尺寸 * 0.001, 0.000001, 0.001)
pairTolerance := min(bodyA.tolerance, bodyB.tolerance)
每子步:
  积分 -> SAP扩展各刚体AABB到本体容差
  窄阶段接触允许pairTolerance内的轻微正间距；接触记录真实表面点与容差
  采集入射速度 -> 一轮PMX弹簧/硬限位位置求解
  一轮接触位置求解: C := surfaceSeparation + pairTolerance
    C<0才修正穿透，容差内不反复推出
  回算线/角速度
  一轮硬限位速度求解（使用与位置约束相同的关节坐标梯度/惯量）:
    相对轴速度 := n·(vB-vA) + gradA·omegaA + gradB·omegaB
    lower>upper := 自由轴，不作速度约束
    lower=upper := 锁定轴，将相对轴速度投影为0
    其他轴 := 仅在界限邻域限制下一子步继续越界的速度，保留返回区间的速度
    deltaImpulse := requiredSpeedChange / generalizedInverseMass
    只更新可动物体的线/角速度，运动学/type2驱动位置速度不被改写
  一轮接触速度求解:
    非穿透接触允许以 separation/h 的速度闭合；未碰到表面不提前完全冻结
    反弹阈值 := max(0.5模型单位/s, 2*|gravity|*h, pairTolerance/h)
    仅真实碰到表面、入射速度超过阈值才使用原PMX恢复系数
    继续沿用法向位置修正预算和库仑摩擦
  接触诊断 -> 下一子步；帧末骨骼回写
```

锁定轴使用精确位置目标；平移界限邻域采用pairTolerance，旋转采用0.0001弧度，均为内部数值容差，不新增用户参数或模拟休眠。候选初期没有关节速度投影；本轮已获用户确认并实施。只运行构建和静态语法/指纹核对，不执行或新增测试；真机运动、静止、强风及10/45/180子步仍需验收。

完成记录：已接入以上硬限位广义速度投影和接触带，位置/速度复用关节坐标梯度；保留单轮求解和原PMX阻尼，不新增整体速度阻尼或休眠。网页构建、4个源文件/12个生成模块/5段内联或importmap语法通过，4控件唯一、21处导入指纹一致；碰撞/核心/PMX适配指纹bb7766640f74 / b8ceec30f33c / a46ffd9df1a8。未运行/新增测试或实际物理验证，静止及动作抖动改善待用户验收。

## THREE-XPBD第三求解器接入（2026-10-01，已实现）

```text
physicsSolver := ammo | xpbd | three-xpbd
未知/未保存值 := ammo
构建固定上游提交和MIT许可证、实际核心及适配说明
  去掉Game.gui/World演示调试的依赖闭包，保留真实上游刚体/接触求解
THREE-XPBD适配:
  PMX球/胶囊 -> 凸体近似；盒 -> 凸盒
  PMX质量/惯量/阻尼/type0/1/2 -> 上游刚体，驱动骨骼位置/姿态
  Spring6DOF每轴限制和非零刚度 -> PMX专用约束适配
  碰撞分组/掩码、相连关节禁碰 -> 筛选候选对
  每有效画面帧: N := 原基准数值；h := delta/N
    N子步: 目标骨骼插值 -> 风/重力积分 -> 一轮关节/接触位置
      -> 速度回算 -> 一轮关节/接触速度；更新诊断
    帧末骨骼回写，记录帧物理耗时
  三种后端共用选择保存、模型重载与失败回滚、换VMD、复位/释放
面板: 三种求解器；两种XPBD都显示每帧子步数并禁用物理Hz
实际代码接入 := 用户已确认；新增真实上游后端
检查范围 := 仅构建/静态语法/指纹；效果/精度/性能待设备验收
```

实施结构与伪代码（先于代码更新）：

```text
vendor/upstream := 固定提交的原始TypeScript核心 + MIT + 来源/哈希
vendor/build-headless.js:
  精确移除Game/World GUI及演示调试；BaseSolver只留无操作debugContact
  修正刚体速度回算对prevPose.q的原地conjugate、世界原点质量判断
  移除凸体调试网格/未释放的中间几何，保留ConvexGeometry数值数据
  esbuild逐模块转换为本地ESM，扩展名补mjs；不下载依赖
共同XpbdPmxPhysics := PMX空间/骨骼/风/子步/生命周期适配
  默认工厂 := 现有独立XPBD
  three-xpbd工厂 := 上游RigidBody包装 + PMX6DOF适配 + 上游XPBDSolver
THREE-XPBD一步:
  保存前姿态 -> 上游积分（附PMX阻尼/世界惯量/type2驱动处理）
  骨骼目标插值 -> 更新凸体 -> SAP + PMX分组/关节筛选
  上游GJK/EPA生成实际ContactSet；保存入射速度
  六轴弹簧/限位通过上游applyBodyPairCorrection求位置；接触上游位置摩擦
  上游速度回算 -> 六轴硬限位速度投影 -> 上游接触速度/摩擦
  清力矩，更新凸体；诊断接触a/b对应实际A/B
PMX约束:
  局部锚点和Euler XYZ角轴对偶梯度；柔度=1/k（k>0），k=0关闭
  平移纠正A/B使用B锚点作为作用点以计入参考轴运动
  角约束按对偶轴长度缩放误差与柔度，保持广义惯量
释放/初始化失败 := 清理已建刚体几何与求解器，不丢失原模型变换
构建 := vendor ESM整体内容指纹目录，PMX后端/共同适配逐层URL指纹
```

实施完成补充伪代码：

```text
core补丁 := prevPose.q.clone().conjugate + 原点线性质量 + 纠正前力臂
EPA := 最小面witness同步；非有限距离/退化重心拒绝；上限仍16
球凸体 := 8×6分段；胶囊 := 3层球帽×8周向；盒 := 2*PMX半尺寸
上游接触 := min(A容差,B容差)，入射低速门限max(0.5,2|g|h,容差/h)
头部/刚体诊断 := three-xpbd与xpbd共用getBodyPose及contacts.a/b索引
构建:
  验证RUNTIME每文件哈希/源码commit一致
  整体hash := 排序的ESM/凸体辅助/许可证/来源/适配说明文件哈希
  复制至vendor/three-xpbd-整体hash
  PMX关节 -> 第三后端 -> MMDAnimationHelper -> runtime/display逐层指纹
  importmap继续只使用本地three，没有额外远程资源
初始化或reset失败 := dispose已建物理，finally恢复模型父级/PQS
```

本地网页构建完成；29个源/核心模块、28个生成模块、5段内联/importmap语法检查通过，4控件唯一、3求解器选项、62处本地导入解析及24处内容指纹通过；两个源物理类离线导入通过。未执行或新增测试，实际模型与设备运动/性能待验收，未打包/发布/提交。

## 基准下限开放到1（2026-10-01，用户指定）

```text
共用控件范围 := 1..180；步长 := 1；默认/非法值 := 45
normalizeReference(value):
  null/undefined/空白/非有限 := 45
  其他 := round(clamp(Number(value), 1, 180))
ESM运行时/经典Display/面板存储恢复 := 相同归一化规则
HTML基准滑条 := min=1、max=180、step=1、value=45
Ammo := 基准值继续作为ERP参考Hz；物理Hz规范化保持原样
XPBD/THREE-XPBD := 基准值直接作为每帧N子步，N=1时仅1步
  h := 有效帧间隔/N；每子步位置/速度各一轮，不新增求解参数
已有存储整数 := 保留原值；新的1..4不可按旧步长5变为0或5
构建本地web-dist := 共享模块/后端/Helper/runtime/display逐层更新指纹
检查 := 仅构建、语法与控件/指纹静态核对；不新增/运行测试
```

实现完成：共享ESM、经典Display与面板三处均采用round(clamp(value,1,180))，缺失/空白/非法回退45；滑条min1/max180/step1/value45。两种XPBD复用共享归一化，1实际作为一个子步，不改变物理Hz、每子步轮数或默认值。npm网页构建完成；6源/10生成模块/5内联或importmap语法、4控件唯一性、24导入指纹及归一化/滑条静态一致性检查通过。未执行/新增测试，未物理真机验收、APK/提交/发布。

## 基准下限改为3（2026-10-01，用户最新指定）

```text
共用基准范围 := 3..180；步长 := 1；默认/缺失/非法 := 45
normalizeReference(value) := 缺失/空白/非有限 ? 45 : round(clamp(Number(value),3,180))
ESM/经典Display/面板恢复 := 同一公式
HTML := min3/max180/step1/value45
已有1或2存储 := 恢复为3；其余合法整数保持
XPBD/THREE-XPBD := 每帧N子步，N最小3，每子步1轮；Ammo仍为ERP参考Hz
提示 := 3表示3子步；物理Hz参数保持
本地web-dist重建；仅构建/静态语法/指纹核对，不执行或新增测试
```

下限3实现完成：ESM、经典Display、存储/滑条均为round(clamp(value,3,180))，min3/max180/step1/value45及提示已同步；现有1/2值会在恢复时归一为3。网页构建通过，6源/10生成/5内联或importmap语法、4控件唯一、24导入指纹及公式静态一致；未新增或运行测试、未真机/APK/提交/发布。

## 自写XPBD效果对齐（2026-10-01，用户已确认完整方案并实现）

```text
前置 := 用户已确认完整算法方案；保留原自写后端身份
刚体积分/纠正:
  对齐当前THREE-XPBD包装的PMX阻尼/驱动目标顺序
  quaternion := normalize(q + 0.5 * [deltaTheta,0] * q)
  各刚体旋转deltaTheta独立限制为0.5rad，位置纠正完整施加
  angularVelocity := shortestSign(2 * (q * inverse(prevQ)).xyz / h)
接触:
  解析碰撞/SAP/接触池保持；盒面裁剪多点保持
  胶囊侧面近似平行支撑 := 最多两个解析接触，去重/容差筛选
  pairFriction/restitution := 两侧各自规范化后取平均
  法向位置纠正 -> 保存lambdaN -> 基于两侧前姿态表面位移求静摩擦
  若切向位置lambda在muStatic*lambdaN预算内，则施加上游风格静摩擦
  回算速度/硬限位投影 -> 以当前法向lambda预算求动摩擦/恢复系数
  按上游法向/切向合成速度纠正响应，采用池化临时量实现
保持 := 3..180整数子步/默认45/每步一轮/物理Hz不用于XPBD
风险 := 解析圆面与凸体面不同，不能保证完全一致或未经测量的速度
验证 := 构建本地web-dist、静态检查；不运行/新增测试
  真实模型精度与性能需同模型/动作/子步/风/诊断条件现场对照
```

实施细化伪代码（先于算法修改）：

```text
子步 := 保存前姿态 -> 动态刚体阻尼 -> 重力/外力/力矩 -> 积分 -> 骨骼目标 -> 接触
位置静摩擦:
  法向lambdaN := 推开穿透的正值；更新纠正后的世界接触点
  delta := (当前B点-前姿态B点) - (当前A点-前姿态A点)
  tangent := delta - n*dot(delta,n)；方向 := tangent/长度
  w := 两侧线性质量与接触力臂角质量之和
  lambdaT := 长度/w
  仅长度>=1e-6且lambdaT < 平均摩擦*lambdaN时，纠正完整切向位移
速度:
  vt := 当前相对速度去法向；切向dv := -unit(vt)*min(mu*lambdaN/h,长度vt)
  e := |incoming|>max(0.5,2|g|h,tol/h) ? 平均恢复系数 : 0
  normalTarget := separation<=0 ? max(-e*incoming,0) : separation/h
  注 := 自写法线A到B，上游法线B到A；上游d=-separation，其分离支路为-d/h
  dv := 切向dv + n*(normalTarget-vn)；按合成方向/有效质量纠正一次
胶囊/胶囊侧面:
  两侧中轴非退化且近似平行；沿A轴投影B并取重叠区间
  区间两端在各中轴上取对应点，圆面半径偏移；容差筛选/去重，最多两点
  无有效侧面点时回退原最近点；球/退化胶囊/不平行保持最近点
胶囊/盒侧面:
  最近法线接近盒面法线，胶囊轴近似与该面平行
  将中轴裁剪至盒面两条侧轴的矩形范围，区间两端投影到面
  仅法向间距在半径+容差内生成圆面接触，去重，最多两点
  无有效面支撑时使用原解析最近点/穿透推出点
近似平行 := 轴夹角正弦<=0.01；重复点 := 间距<=max(EPS,两侧最小容差)
保持 := 已有盒/盒裁剪、碰撞过滤、对象池、每子步一轮，不新增UI参数
```

实现完成：web-xpbd-rigid.mjs按上述伪代码对齐静/动摩擦、合成速度响应、独立角限幅、一阶姿态及阻尼/驱动顺序；web-xpbd-collision.mjs新增平均材质缓存和有界胶囊侧面双点，真实距离筛选、退化回退与双表面去重均保留。静摩擦复用预计算逆惯量；接触纠正长度门限1e-6，原关节广义梯度/限位速度投影保持。npm网页构建完成；9个源模块、29个生成模块语法、5段内联脚本/importmap、62处本地导入、24处内容指纹及4个控件唯一性检查通过；基准滑条3–180/step1/default45、两个自写模块与生成内容一致。上游核心目录three-xpbd-c7bec6aaaf1e保持原内容；未新增/运行测试，未设备/APK/提交/发布。

提交归档（2026-10-01）：用户要求提交本轮完整XPBD优化和基准下限3，源码/文档一起归档到master，目标远端origion；沿用已完成的网页构建/静态检查，真实模型效果与性能继续待现场验收，生成资源和无关运行数据保留在工作区。

## PMX XYZ刚度可视化候选（2026-10-01，待确认）

```text
前置 := 用户确认具体方案；当前仅规划，不修改运行代码
数据 := mesh.geometry.userData.MMD.constraints
每个关节 := 刚体A/B索引、配置position/rotation、平移K[3]、旋转K[3]
选择范围 := 默认选中骨骼关联刚体的直接关节；可选择全模型
模式 := 平移K / 旋转K；每模式正K全模型对数范围固定
显示:
  关节参考框架局部X红/Y绿/Z蓝；箭头越长对应K越大
  K=0 := 灰色虚线、表格显示弹簧关闭；不把硬限位解释为关闭
  原值表格 := 关节名/两端刚体名/平移XYZ/旋转XYZ，共6个K
  物理启用 := 从当前后端真实刚体姿态变换关节框架
  无物理 := 骨骼驱动的配置预览，明确标注；不虚称真实关节姿态
  帧范围 := 复用当前骨骼选择，过滤不改变全模型色阶/长度范围
生命周期 := 默认关、本地记忆；关闭不更新绘制；换模型释放几何/材料
构建 := 新关节诊断ESM与注入模块 -> build/panel接入 -> 逐层URL指纹
验证 := 获确认后构建/语法/导入指纹静态检查，不新增或运行测试
待人工 := 三后端、轴随运动/模型变换、K=0、过滤/模式、刷新与手机耗时
```

诊断目的补充伪代码（方案待确认）：

```text
已确认质量实现:
  mass := type0 ? 0 : max(0,PMX.weight)
  invMass := mass>0且非带骨骼type2 ? 1/mass : 0
  inertia := 按球/盒/胶囊形状和mass计算；invInertia := 各非零分量的倒数
  w := |平移梯度|²*(invMassA+invMassB) + gradAngleA·I_A^-1·gradAngleA + gradAngleB·I_B^-1·gradAngleB
  alphaTilde := (1/K)/h²；deltaLambda := (-C-alphaTilde*lambda)/(w+alphaTilde)
诊断候选 := 6K + 刚体质量/惯量 + 每轴限位/锁定状态 + 位移/角度时间变化
理论弹簧力 := -K*C；仅标为理论量，不冒充含接触/限位的求解器实际力
理想参考 := 隔离单轴弹簧、恒外力下C=F/K；无阻尼小振动T=2*pi*sqrt(mEffective/K)
  角弹簧改用有效角惯量；模型完整布料受耦合/碰撞影响，不能直接套单轴公式
判断 := 同载荷/质量/限位/阻尼/物理时长与足够小步长比较参考误差及步长收敛
状态 := 未运行测试/模拟，也未确认或实现新增诊断内容
```

## 米娅XPBD风响应/type2核对（2026-10-01，未改算法）

```text
已实现type2（带骨骼）:
  positionDriven=true；invMass=0；动态角惯量保持
  保存前姿态 -> 角积分 -> 骨骼位置目标 -> 关节/碰撞纠正 -> 回算速度
  骨骼回写 := 仅旋转；type1另回写位置
  风 := type1外力m*10*strength；type2仅风力矩，局部角加速度限幅12
只读PMX核对 := 现有Parser.parsePmx(...,true)，不创建物理对象/不推进模拟
加载器类型规则 := 若A非type0、B为type2且B骨骼父级为A骨骼，则B改type1
内置米娅头发 := 后发20个type1；侧发原8个type2 -> 2个type2+6个type1
头发相关44关节 := 全部K=0；七根部关节全部六轴锁0
现象分类（待用户提供）:
  发根离开/跟随错误 := 优先查根部锁定误差与坐标/骨骼回写
  发根固定、发束翻起 := 查角限位/多节累计、方向/强度与硬约束误差
外力参考 := aWind=10*strength；默认|g|=98
  世界向上分量需结合方向、阵风与模型物理空间，不能以强度单值定结论
下一步 := 用户后端/风参数/子步/根部状态 -> 定位具体路径 -> 提出修复方案确认
本轮 := 只读源码与模型元数据、更新文档；未测试/模拟/修改运行代码/构建
```

## 自写XPBD全锁定发根候选修复（2026-10-01，待确认）

```text
用户确认现象 := 自写XPBD，右側髪_0_1旋转，Ammo不旋转
已知模型 := 134号type2通过六轴全锁0关节连接4号type0头部
构建随动绑定:
  仅六轴lower=upper=0的关节视为全锁边，不以K=0作固定判据
  从运动学/静态刚体遍历全锁边；首次到达的动态刚体绑定已固定的父锚点
  顺序 := 锚点先于后继；重复路径不绑定两次，防止闭环依赖
  记录两侧localAnchor/rotationOffset，支持A/B方向反转
有效质量:
  anchoredLockedBody := 求解invMass=0、求解invInertia=0
  PMX类型/质量/形状惯量元数据保持；非固定动态体使用原逆质量/惯量
每子步:
  保存前姿态；普通动态体阻尼/外力/积分；跳过随动体的自由积分
  原type0/type2目标更新后，按绑定顺序更新全锁定体
  followerQ := anchorQ * anchorJointRotation * inverse(followerJointRotation)
  anchorPoint := anchorPosition + rotate(anchorLocalAnchor,anchorQ)
  followerPosition := anchorPoint - rotate(followerLocalAnchor,followerQ)
  followerVelocity/omega := 由前姿态与新姿态/h计算（实际随动速度进入碰撞）
  一轮关节/碰撞求解 := 固定体不接受纠正，纠正只施于仍有自由度的体
  不用普通动态速度回算覆盖已建立的随动速度；清力矩
reset := 重算全锁姿态，同步前姿态，清速度；dispose := 清绑定/集合
保持 := 原N子步/每步一轮、3–180、部分锁轴/自由角type2动态、PMX/风接口
构建/验证 := 获确认后本地web-dist/静态语法/依赖指纹；不新增或运行测试
人工验收 := 发根随头部但无相对旋转、后续发链正常风响应、三后端/刷新/模型切换
```

## 自写XPBD六轴全锁定统一处理（2026-10-01，用户已确认并实现）

用户要求“应该统一处理这种”，确认通用关节规则，不按模型名、刚体索引或type2特判。

```text
识别 := 六个轴各自lower=upper；允许非零锁定值，不以弹簧K判定
全锁图 := 每个全锁关节为无向边
锚点 := 所有!body.dynamic刚体（静态/运动学）
广度遍历 := 锚点先入队；动态后继首次到达即建立绑定；已访问不重复绑定
  没有静态锚点的动态全锁链继续参与原动态求解
  部分锁轴、有限范围、自由轴继续参与原动态求解
全锁边相对变换A->B:
  relativeQ := joint.rotationA * EulerXYZ(rotationLocked) * inverse(joint.rotationB)
  relativeP := joint.localA + rotate(translationLocked,joint.rotationA) - rotate(joint.localB,relativeQ)
  反向B->A := inverse(relativeQ)，rotate(-relativeP,inverse(relativeQ))
绑定 := { anchor, body, relativeP, relativeQ }，父绑定始终先于子绑定
有效质量 := fixedSet有body ? invMass=0/世界invInertia=0 : 原值
  元数据params.type/weight/inertia/inverseMass/inverseInertia不改
activeJoints := 排除两端均已固定的冗余纠正，仍保留全部碰撞禁碰边
每子步:
  保存前姿态；普通动态体积分，全锁随动体跳过自由积分
  原骨骼目标更新 -> 按绑定更新随动位姿
  bodyQ := anchorQ * relativeQ；bodyP := anchorP + rotate(relativeP,anchorQ)
  随动速度 := (新位置-前位置)/h，一阶四元数差回算角速度
  一轮activeJoints/接触纠正，使用有效质量；随动体不接受位置/速度纠正
  普通动态体速度回算跳过随动体；清力矩
reset := 重算随动位姿、同步前姿态、速度归零；dispose清绑定与集合
诊断 := getState.anchoredBodyCount，显示实际随动刚体数量，无新面板参数
保持 := N子步/每步一轮、3–180/默认45、解析碰撞/SAP/池、PMX/风/骨骼接口
构建 := 源rigid内容指纹自动传播到共同PMX/后端/Helper/runtime/display
检查 := 构建、静态语法/本地导入/指纹核对，不新增或运行测试
范围 := 当前自写XPBD数值求解器；Ammo与真实THREE-XPBD数值实现保持
```

用户追加部分锁轴约束，实施前补充伪代码：

```text
部分旋转锁轴 := rotationLower[axis]=rotationUpper[axis]（可为非零）
每子步位置阶段 := 一轮常规关节/接触 -> 一次旋转锁轴终态投影
  逐关节/轴使用现有Euler XYZ广义梯度/惯量，硬柔度0投影到锁定值
  自由轴和有范围的轴不在这次投影中追加纠正；普通限位仍走原求解
  全锁随动体有效惯量0，后续纠正不能改变它
速度阶段 := 姿态回算 -> 一轮接触速度/摩擦 -> 一轮关节硬限位速度
  锁轴消除对应广义相对角速度，自由轴保留；碰撞之后不再反向改动锁轴速度
计数 := 常规位置/速度仍各一轮，另有一次只处理旋转锁轴的终态投影
  不重复弹簧/接触迭代，不新增可调迭代参数，不将此额外投影隐瞒为完全原次数
限制 := 多个动态关节耦合的一次局部投影仍可能有残差，需真机验收
```

界面同步伪代码：web-physics-solver.js提示区分自写XPBD的“每子步一轮+旋转锁轴纠正”与THREE-XPBD的一轮；状态行依据rotationLockProjections追加锁轴纠正说明，不新增控件。

实现完成：createAnchoredBindings构建通用全锁边/BFS绑定；effective逆质量/惯量仅求解器内部置0、元数据不改，绑定先于碰撞同步位姿及速度，冗余两固定端关节退出纠正。projectRotationLocks对子步末已锁旋转轴补硬投影，速度按接触后关节顺序；自由/有范围轴保持原常规求解。reset/dispose资源与前姿态同步；getState增加固定体数量和锁轴投影信息，面板说明与实际次数一致。npm网页构建及9个源模块、29个生成模块、5段内联脚本/importmap语法、62处本地导入、24处内容指纹和4个控件唯一性通过；基准3–180/step1/default45、rigid源与生成内容一致、锁轴提示进入HTML。本轮未运行/新增测试或物理模拟，非线性多关节部分锁轴仍可能有残差，现场效果/性能待验收。
# 顶点布料 WebGL2 伪代码（2026-10-03，源码已实现，待运行验收）

```text
选项：保留 vertex-cloth（CPU），新增 vertex-cloth-gpu（WebGL2）
  两种后端共用分组偏好与修复后的接缝拓扑；GPU回退展示原因，不改用户保存选择
初始化：原始网格 -> 候选布料 -> 边界配对/兼容接缝 -> 物理粒子与渲染映射
  -> 拉伸/弯曲约束图着色、风/法线邻接 -> WebGL2能力与容量检查
  成功：创建GPU纹理、求解通道、材质/阴影/AO采样适配
  失败：释放部分GPU资源 -> 现有CPU后端，展示实际后端
每帧：基础Ammo -> 骨骼固定点/碰撞代理/表情增量上传
  对现有每帧子步数：预测 -> 分色约束 -> 碰撞 -> 速度
  -> 按渲染顶点重建法线并保留硬边 -> 各绘制通道直接采样
切模型/VMD/重置/上下文恢复：同步重建或清零状态，资源按所有权释放
接缝：只合并或缝合兼容的成对边界；重叠独立层不因坐标相同自动连接
GPU组织：每组粒子独立浮点MRT，保存位置/逆质量、速度、子步初始位置
  每种颜色：每个自由粒子至多一条约束，按粒子收集两端纠正，无浮点原子写
  帧末按渲染顶点散点写入共用位置/法线图；UV/硬边保留原渲染顶点
  材质蒙皮后覆盖布料位置/法线，深度阴影同源，AO复用场景深度
  上传仅骨骼目标/表情增量/碰撞代理，正常帧不读回模拟粒子
```

实现文件：`web-vertex-cloth-webgl.mjs`负责GPU资源/各组步进和散点输出；`web-vertex-cloth-gpu-shaders.mjs`负责预测/分色约束/代理碰撞/速度与法线；`web-vertex-cloth-gpu-data.mjs`打包纹理/邻接/着色；`web-vertex-cloth-gpu-render.mjs`按几何所有权接入主材质、专属深度/距离材质和预览。接缝使用`web-vertex-cloth-seams.mjs`，成对边界端点反向对应、第三点不同、两面法线点积非负、对应端点骨骼区域相同且表情增量一致时才合并，固定点优先作为代表。分组模型签名反映焊接结果，拓扑变化模型会重新自动分组。原始渲染顶点/UV/法线拆点保留。

限制：不新增自碰撞；位置法线留在GPU，不更新CPU射线拾取的变形顶点。面板GPU耗时仅CPU提交时间，非GPU完成时间；每组和每种约束颜色需要绘制通道，高子步/小网格不保证加速。本轮仅构建/语法及GLSL编译检查，未运行模拟测试或真机。

## 2026-10-03 包网格分离候选修正（未实施）

```text
只读证据 := 内置米娅包16组，默认启用3组、其余13组禁用；共享动态骨骼保留Ammo
问题路径 := 布料改写部分网格 + 其余表面仍蒙皮 -> 同一附件两套运动
拟审计 := 动态骨骼 -> 涉及的自由网格组/未覆盖自由顶点 -> 关联驱动区域
  关联区域包含未接入的自由表面/附件：该区域保留原骨骼/Ammo，面板解释
  原本固定/全运动学区域：不因固定装饰阻塞邻接布料
  UI启用状态与实际顶点模拟/刚体替换一致，切换、保存偏好、CPU/GPU共用
禁止 := 按包名称排除、扩大距离误焊、只合并开关却让无约束附件自由落下
状态 := 用户模型/后端未确认；只读拓扑分析，无模拟复现，待方案确认
```

用户补充：CPU与GPU均发生包分离，优先排查共用拓扑/驱动分配；已询问选择保守统一原物理，或完整顶点附件绑定。尚未确认具体模型及实施方案。

## 包分离统一驱动修正（2026-10-03，已确认，实施中）

```text
拓扑构建：统计每组自由粒子涉及的非固定动态骨骼及物理链组件
关联分组：自由组通过共同物理链归并；全固定组不参与阻塞
  某关联组无固定点（未建立附件连接）或链含未覆盖自由顶点：整套关联组保留Ammo
  其余关联组：作为整体开关；旧偏好有部分关闭时整个关联组关闭
实际enabled := 安全且关联组所有成员均请求启用的组
替换刚体 := 非固定动态骨骼，仅当涉及的自由组全部实际enabled且无未覆盖自由顶点
面板 := 显示实际enabled；不安全组禁用并显示保留原物理原因；安全关联组同步开关
CPU/GPU、复位、换动作、刚体替换、碰撞排除 := 共用实际enabled
保存 := 保留旧偏好但不能绕过安全判定；用户切换安全关联组时一起保存成员偏好
```

## 骨骼驱动加顶点自碰撞（2026-10-03，待确认、未实现）

```text
原PMX物理 -> 骨骼姿态 -> 蒙皮目标及表面运动
共享物理网格 := 兼容接缝归并 + 不相连附件附着映射 + 渲染顶点映射
顶点状态 := 上帧碰撞偏移/速度随参考形状搬运，保留局部相对运动
每子步 := 插值骨骼目标 -> 柔性跟随/拉伸/弯曲
  -> 空间索引候选 -> 排除邻接/同缝粒子 -> 自碰撞/身体接触 -> 更新相对速度
  不重复施加骨骼层的风/重力；不把碰撞位移每帧清零
输出 := 骨骼目标 + 顶点修正 -> 材质/阴影/AO/附件附着
后端 := CPU和WebGL2统一接缝/排除规则/约束含义；GPU空间索引与收集单独实现
阶段 := 原骨骼基础/连续连接 -> CPU自碰撞 -> GPU等价路径
状态 := 只记录新方案，旧的统一Ammo保护源码尚未构建发布
```

## 骨骼跟随与自碰撞实施细化（2026-10-03，完整方案已确认）

```text
骨骼层 := 完整保留原Ammo刚体/关节/风，不再替换任何布料刚体
模拟层 := 各自动组聚合成同一粒子空间，跨组接触也参与；关闭组作为随骨骼运动的接触表面
基准运动 := 每子步跟随蒙皮目标增量，速度只存相对运动；形状/边长目标取当前骨骼形状
力 := 顶点层不再另施重力/风；柔性回归与相对速度阻尼保留接触偏移
附件 := 识别同物理链、不同网格组的近距离表面附着，保存参考偏移并约束相对修正一致
碰撞 := 顶点-三角形及边-边；BVH按子步当前位置/前位置重拟合
  排除同粒子、拓扑近邻、接缝和附着邻域；厚度不超过中性形状的初始间隙
  对所有接触端按逆质量分配位移，Jacobi聚合后回算相对速度
GPU := 合并粒子纹理，BVH层级重拟合，逐粒子收集接触各端贡献，无完整粒子读回
限制 := 离散边接触加点面跨面保护，非完整连续碰撞；不反向推动骨骼
```

## 骨骼跟随与自碰撞当前实现（2026-10-03）

```text
createClothSurface := 拼接各组粒子/三角/边 -> 原渲染顶点映射 -> 固定BVH三个根（点、面、边）
  同链无固定网格附近0.025模型高度内寻找带固定点表面；有固定点边界半径0.002高度且只向较小组索引附着
  attachment := 四端粒子 + [1,-barycentric]，保存相对蒙皮目标的偏移约束
sampleTargets := Ammo更新后的完整骨骼矩阵 -> 当前表情蒙皮位置、每粒子帧间旋转差
beginFrame := 搬运相对偏移/速度 -> 更新前/后目标
每子步：
  p += (当前目标-前帧目标)/子步数 + 相对速度*h
  p += (插值目标-p)*(1-exp(-20*h))；固定/关闭粒子直接插值目标
  拉伸/弯曲 := 长度目标为本子步蒙皮目标距离；原柔度0/0.001
  附着 := 约束各端相对于骨骼目标的修正差，Jacobi收集
  身体代理 := 原球/盒/胶囊，按所属组保留原PMX碰撞掩码与自身排除
  BVH重拟合当前位置和子步前位置包围盒
  点面接触 + 边边接触 := 排除邻接/附着及原本重叠表面 -> 初始间隙限制厚度 -> 逆质量纠正
  每粒子取0.8*平均纠正，并限制长度<=2*接触厚度
  vRelative := (p-pBefore-目标子步增量)/h*exp(-30*h)
GPU := MRT位置/速度/前位置 -> 分色距离约束 -> 附着shader -> 身体shader
  -> BVH层级refit -> 每粒子遍历自己的点、邻面、邻边收集接触 -> 相对速度shader
  -> 共享位置/法线图 -> 主材质/阴影/AO/预览
组开关 := 不重建Ammo或清掉骨骼速度；重建粒子mask/附着与GPU资源，失败恢复旧选择
```

新增`web-vertex-cloth-contact.mjs`、`web-vertex-cloth-bvh.mjs`、`web-vertex-cloth-surface.mjs`、`web-vertex-cloth-self.mjs`、`web-vertex-cloth-self-shaders.mjs`、`web-vertex-cloth-gpu-self.mjs`；同步桥接、拓扑、CPU/GPU求解、构建指纹与面板。无固定额外6轮：仍每帧现有子步数，每子步执行各类约束一次；GPU分色/BVH各层是绘制通道，不是增加物理子步。CPU顺序距离求解与GPU着色顺序可能有数值差异。无GPU粒子读回；CPU拾取网格仍未跟随GPU局部修正。

检查：独立网页构建、15个顶点布料源模块语法、7段GLSL编译、74个生成JS及5段内联脚本/importmap解析通过。未新增/运行测试或物理模拟，未做浏览器/手机效果及性能验收。

## 2026-10-03 服务器角色面板与西施 GLB（已实现）

```text
Blender源 -> 仅选头发/角/脸/裙子/身体/龙/龙须七个网格 -> 导出内嵌贴图GLB
构建 -> 按内容hash命名GLB -> 资源清单含米娅PMX及西施GLB -> 同源按需读取
角色按钮 -> 50%透明面板 -> 点击角色 -> 锁定切换控件 -> 加载进度
    复用现有PMX场景/相机/AR/灯光，GLB跳过MMD动作和物理初始化
    新模型准备成功后释放旧模型并提交；失败保留旧模型和已保存选择
    GLB静态角色禁用角色动作/骨骼物理入口；相机定位与灯光可用
首次启动 -> 根据已保存resourceId选择资源，未知值回到米娅；失败显示重试/可切换
本地模型入口保留；选择服务器角色后同步UI并释放旧本地资源
限制：Blender自定义节点并非全部可表达为glTF，需要检查导出材质与贴图
```

角色接入实现补充：独立构建在mmd-model-runtime生成副本注入GLB分支，沿用PMX渲染实例而不创建MMD helper；资源modelType仍为glb。GLB统一到20单位高度以适配near=1，相机据包围盒取景；材质颜色/粗糙度/金属度/发光按原输入图烘焙，法线沿用，头发自定义着色近似PBR。所有模型入口共用加载锁；服务器角色完成切换后释放本地资源上下文，本地资源入口移入角色面板。

## 2026-10-03 西施GLB实际加载入口修复

```text
独立构建可能展开mmd-model-runtime到display-pmx-runtime
角色适配同时覆盖：模块context入口 + 展开后主闭包入口
    展开入口传入原实例状态访问器，不复制状态；GLB分流必须早于PMX校验
    静态动作拦截分别使用context.currentProfile/主闭包currentProfile
    构建缺少预期入口时明确报错，运行时及依赖重新计算内容指纹
```

## 2026-10-03 西施材质转换修复

```text
复制Principled材质输入：未连线的同名标量/颜色输入保留原值（尤其Emission Color）
    连线标量通过Float输入转换后烘焙灰度，连线颜色按颜色空间烘焙
    保留Specular Tint等可映射PBR输入；Normal保持原法线图连接
Alpha连线 -> 烘焙灰度 -> 合入基础色贴图Alpha -> 连接新材质Alpha
    不再把黑色自发光替换为白色，也不丢弃裙子/角的透明度
重新导出GLB -> 查看实际材质/透明度字段及贴图通道 -> 构建新的内容hash资源
```

## 2026-10-04 西施人物拆分与角色URL

```text
西施导出白名单 := 头发/角/脸/裙子/身体；不导出龙/龙须，不修改源blend
启动角色 := 有效URL character(xishi/miya) > 有效保存resourceId > miya-default
    URL角色名只映射清单ID，不作为模型地址；未知/空参数按保存值或默认回退
服务器角色切换成功 -> 写入角色记忆 -> URLSearchParams.set(character, 短名)
    history.replaceState保留原history.state、其他查询参数和hash；失败不改变地址
    已有character参数时，恢复默认等成功加载入口同步实际角色
重新导出GLB并构建web-dist；按内容hash换资源地址，既有旧模型不删除
```

## 2026-10-04 西施2绑定与布料实验 / AO默认45°

```text
输入现有无龙西施 -> 独立西施2副本，不覆盖静态西施
人体骨骼采用MMD命名；按模型尺寸建立躯干/头/四肢/手指与蒙皮权重
头发/裙摆/宽袖 -> 固定根部 + 分段辅助骨骼/渐变权重 + PMX刚体与限位弹簧关节
身体跟随碰撞体 -> 与布料碰撞，布料组屏蔽相邻/同组碰撞避免初始爆炸
导出可编辑blend、PMX及贴图/绑定报告；复用原动作和Ammo/XPBD入口
构建独立版本目录，新增西施2清单/面板/character=xishi2
AO浅凹抑制默认与重置值45°；已有用户保存值仍优先
实验限制：程序生成权重和关节需要实机/人工调整；PMX材质不是完整glTF PBR
```

```text
骨架 := 58个人体/控制骨 + 27条(固定根 + 3段)辅助骨链 = 166骨
权重 := 分区候选人体骨距离 / 同类相邻两条布料骨链距离 -> 保留前4并归一化
    世界位置round(6位)作为接缝共用权重键；脸和角先绑定头骨
PMX坐标 := Blender(x,z,y)*10；法线同样交换轴；三角面反序；UV.y := 1-v
    刚体旋转先在浏览器右手系求胶囊Y轴对齐，反变换PMX Euler(-x,-y,z)
人体13个固定胶囊：group0/mask2；27个固定根：group15/mask0
81个动态布料胶囊：group1/mask1；质量头发.025/衣物.06；位置阻尼.6、旋转阻尼.7
81个弹簧关节：平移锁定，旋转XZ头发±40°/衣物±50°、Y±.35rad
    平移K=(80,80,80)，旋转K头发(3,3,3)/衣物(6,6,6)
版本 := SHA256(排序后的PMX及贴图相对路径 + NUL + 文件内容)
清单xishi2-default -> mmd/xishi2/版本前12位/xishi2.pmx + 复用miya-default-motion
导出Blend/统计报告到output/xishi2；构建只拷贝runtime模型与贴图
```

## 2026-10-04 可选接触阴影与屏幕空间间接光

```text
灯光面板 := 接触阴影开关(false)/强度/距离 + 间接光开关(false)/强度/半径 + 质量
本地保存独立实验设置；灯光重置恢复两项关闭；无WebGL2时显示不支持
构建生成AO副本注入独立模块，不改正式渲染器；将实际主光对象传入
只要AO或实验效果开启 -> 复用场景颜色/深度捕获；全关闭直绘
    深度重建视图位置与法线，主光方向从世界转换到视图
    接触阴影：沿主光短距离射线步进深度，偏置/厚度/边界淡出抑制自遮挡
    间接光：半球射线有限步进，命中可见表面后采样颜色，距离/双侧法线衰减
    低分辨率目标有分辨率上限；合成按深度边界加权，保留原alpha
    合成后统一色调映射；不反馈上一帧颜色；不读取GPU粒子/像素到CPU
    关闭两项释放额外资源，跳过新增pass；AO可独立关闭
限制 := 屏幕空间单次漫反射近似，非完整GI/镜面反射；屏外/背面/透明层受限
```

### 西施2衣物权重交界修复

```text
静态PMX检查：52条长度<0.08模型单位的衣物边，两端骨权重L1差>1.6
导出前按重合位置焊接逻辑权重节点，三角边建立拓扑（不改实际几何/UV/法线）
找含布料骨的权重突变边 -> 拓扑距离0.1米内平滑 -> 保留远处人体/布料原权重
    距离加权邻接迭代，边界保留原权重，最多4骨并归一化，共点同步
袖根选择最近手臂/前臂/手腕骨；身体过渡使用实际人体权重混合
重新导出西施2，生成新资源版本；不更改全局Ammo/XPBD参数
```

```text
默认 := contactEnabled=false, giEnabled=false, contactStrength=.5, contactDistance=.3,
        giStrength=1, giRadius=2, quality=low
设置范围 := 阴影强度0..1，距离.02..3；GI强度0..4，半径.1..10（模型单位）
质量low/medium/high := GI射线4/6/8，步数12/20/32，最长边384/512/640
新增目标尺寸 := 原画布*.5 与最长边上限中的较小值
接触阴影合成 := 原色 * (1 - 阴影强度*主光强度权重*朝向权重*命中衰减)
GI合成 := 命中颜色 * 命中法线朝向 * 距离衰减 * 接收表面近似色调 * GI强度 / 射线数
    仅一次反弹，RGB限幅0..1；保留alpha，最后复用原AO/色调映射/输出颜色空间
关闭效果 -> 释放额外资源；无WebGL2 -> 原绘制路径、面板显示不可用
布料权重静态结果 := 严重短边突变52 -> 0；资源版本46265901296f
```

## 2026-10-04 西施2刚体旋转导出修正

```text
静态检查：浏览器按Three Euler XYZ重建胶囊Y轴，与对应骨段方向比较（轴正负等价）
现有错误：Blender quaternion.to_euler('XYZ')数值直接给Three，旋转复合约定不同
修正：Blender四元数 -> 旋转矩阵 -> 按Three XYZ矩阵分解求角度 -> PMX(-x,-y,z)
    y=asin(clamp(m13)); 非奇异 x=atan2(-m23,m33),z=atan2(-m12,m11)
    奇异 x=atan2(m32,m22),z=0
刚体与关节共用修正后的旋转导出；重新导出资源，保持现有权重及材质
权重归属：等待用户错误部位截图/后端，不能以平滑指标代替正确绑定
```

```text
导出结果 := 121胶囊与骨段轴偏差最大0.000091°，>1°数量0
对比上次发布 := 88刚体/81关节旋转变更，顶点权重变更0
新资源 := mmd/xishi2/06106e4b975a/xishi2.pmx
尚未处理 := 具体顶点错绑、碰撞体尺寸/位置逐部位拟合（需要错误部位资料）
```

## 2026-10-04 浏览器复现后的部件绑定修正

```text
Chromium对照物理关闭+动作、Ammo、XPBD -> 复现袖片尖条与局部附件异常
焊接同坐标后连通分量识别真实部件，源模型固定指纹与部件顶点数保护
身体的皮肤/靴子/颈部 -> 仅人体权重，拓扑平滑排除这些固定归属节点
裙子中的左右袖片 -> 整片按手臂方向分带，不再被高度阈值切入裙摆
裙摆/披帛 -> 各自归属；小附件沿最近已绑定表面转移权重
碰撞体尺寸 := 已确认人体皮肤/靴子部件，按各骨段轴向范围的截面分位数估计
    保持关节朝向修正；人体躯干用贴合包围盒、四肢用胶囊
导出 -> 浏览器三种状态截图对照 + JS错误/有限数值检查
```

```text
部件绑定最终规则：
    身体连通部件0/1/2/3/4/5/6/7/9/11 -> 人体权重，禁止平滑引入布料骨
    身体12/13/18/19、裙子2/3 -> 同侧袖片，各分带根均连接对应上臂
    裙子4/5/10 -> 披帛，其余 -> 裙片；低端高于固定腰线的空动态链跳过
    剩余身体附件 -> 最近已绑定表面权重（包括脸，排除头发/角）
        半径<.07m的小挂件共用中心处权重，保留刚性形状
人体手臂候选边界随高度倾斜，避免躯干侧边仅因x>.17m而分到手臂
平滑保护节点：设置原始人体权重后不参加迭代；共点节点共享保护结果
胸腹髋碰撞：轴向截面3%..97%分位包围盒，半尺寸*.9
四肢胶囊：骨段15%..85%区间、侧别及距离过滤 -> 半径80%分位*.85
最终资源935cb111b2ba，162骨/117刚体/78关节，皮肤和靴子布料误权重0
```

## 西施2材质及人体胶囊修正（2026-10-04）

```text
胸腰：已保护人体顶点 -> 分位包围范围 -> 横向胶囊，圆截面按深度/高度约束
双手：手首胶囊 + 各指节小胶囊，mode=0跟随骨骼，与动态衣物碰撞
GLB原始材质按名称匹配PMX材质槽，保留颜色/法线/金属粗糙度/透明/发光
    加载完整GLB材质 -> 检查所有槽匹配 -> 替换材质 -> 释放旧材质与多余GLB几何
    保留PMX顶点/UV/骨骼/物理；使用GLB的flipY=false纹理约定
    原GLB材质版本写入资源profile，导出PMX移除人为固定白色环境色
浏览器：同灯光同相机静态对照；动作+碰撞体可视化；检查JS错误和有限顶点
```
关节处暂按碰撞连续性处理：肩/肘/腕/膝/踝各增加骨骼跟随球体，半径取相邻段较小值；不改变原有弹簧约束。

```text
面绕序：MMD Tools保存时已反转面索引，Three MMDParser读入时也反转
    导出器传原始Blender三角形顺序，禁止再额外reverse，避免几何朝向与顶点法线相反
    校验浏览器面几何法线与顶点法线的点积，恢复双面材质正确受光
```

## 接触阴影与 UE 风格 SSGI 历史输入/降噪（2026-10-08，已实现）

```text
ScreenLightingSettings := { contactEnabled, contactStepCount, giEnabled, giStrength, giRadius, quality,
                            giBlurPassCount, giBlurRadii[3] }
UI := 接触阴影独立分类；间接光分类 -> SSGI子类；默认关闭；旧设置键不变

每帧场景颜色/深度渲染完成，AO/SSGI合成前：
  key := (全分辨率尺寸, 效果尺寸, quality)
  if SSGI关闭:
    历史有效标记 := false；释放SSGI历史/层级目标；不构建Reduction/HZB
  else if key改变或历史不存在:
    按当前尺寸创建双缓冲历史SceneColor与深度层级；历史有效标记 := false
  if 首帧/相机大幅切断/投影变化/上下文丢失或恢复:
    本帧GI回退到currentSceneColor/currentDepth；不得采样无效历史
  else if 历史有效:
    当前帧射线起点和方向 -> 当前相机World -> previousView
    每步投影到previousUV；按屏幕步长选择HZB mip粗筛
    使用上帧HZB的近/远深度范围检测候选，可能命中则回到mip0做4轮区间细化
    将候选命中反投影到当前深度验证；越界、遮挡不匹配或动态物体深度冲突 -> 拒绝历史
    验证通过 -> 在previousUV采样前帧Reduction SceneColor作为入射颜色
    拒绝或未命中 -> 当前帧深度/颜色射线回退
  短射线 -> 每帧新算漫反射辐照度与接触阴影；不累积上一帧SSGI输出
  命中颜色软限幅 -> SS Denoiser执行深度/法线引导双边降噪
  只滤波SSGI RGB；接触阴影alpha始终保留原中心样本；最终引导上采样合成

帧末从尚未合成SSGI的原始深度采集待写历史槽：
  depthInput := currentDepth
  while depthInput宽或高大于效果尺寸:
    nextSize := 每维最多缩小1/2，最终落在效果尺寸
    depthInput -> near/far 16-bit范围归约（空层哨兵near=1/far=0）；最终写入HZB mip[0]
  for mip := 1 to 1x1:
    HZB[mip] := 对前一级2x2归约；普通Z下near=min、far=max，背景哨兵不参与
  colorInput := 未合成SSGI的currentSceneColor
  for 与depth相同的逐级尺寸:
    colorInput -> 四点深度引导颜色归约，使用对应的currentDepth归约级
  深度范围RGBA用两个16-bit归一化分量编码，兼容UnsignedByte附件；near=min对应UE reversed-Z的max-near语义
  写入颜色/深度双缓冲待写槽和当前相机矩阵、尺寸/质量key；完成后交换读写槽，任何pass输入/输出纹理不得相同

尺寸/质量改变重建历史；相机切断或WebGL上下文丢失/恢复只清除有效标记
动态形变无运动矢量时，前后深度/当前可见性不匹配 -> 拒绝历史并回退当前SceneColor
GI关闭、runtime销毁 -> 释放历史颜色、HZB、Reduction、滤波目标与材质；模型切换由runtime销毁并重建

验证 := 首帧回退/后续帧重投影、质量/尺寸/投影/相机切断失效、历史命中当前深度拒绝、
        SceneColor历史不含GI反馈、Reduction/HZB奇数尺寸及层级、读写不别名、双边降噪/alpha不变、释放、WebGL Shader编译、Web构建
```

实现边界：历史输入为前帧原始SceneColor Reduction，不是前帧SSGI结果或TAA累积；Three/WebGL2使用普通Z，HZB同时保存近/远范围以适配其深度约定。当前没有通用运动矢量，动态模型历史可能被保守拒绝。`node --test tests/mmd-ar-screen-lighting.test.js tests/mmd-ar-contact-shadow-browser.test.js` 12/12通过（包含SwiftShader/WebGL2真实Shader编译/链接）；`npm run build:web:mmd-ar-test`成功。移动设备画质和GPU帧时仍需实机验收。

## 编辑／预览／渲染首版（2026-10-04，已实现）

```text
工程文档 := 原始PMX及贴图 + 刚体/关节覆盖值 + 灯光/物理/相机/动作引用
保留原始文件字节，不从渲染几何逆向生成PMX；首版保存自包含ZIP工程
刚体位置沿用加载器的骨骼相对坐标；关节使用模型坐标；界面角度使用度
进入编辑 -> 暂停动作/物理 -> 绑定姿态 -> 编辑代理几何与三轴手柄
属性或拖动结束 -> 参数校验 -> 一条命令记录前后文档 -> 撤销/重做
预览 -> 将文档覆盖到新加载网格的MMD物理数据 -> 重建helper -> 播放
工程保存 -> 原始资源/动作/PBR源GLB写入ZIP + manifest.json描述字段与映射
工程打开 -> 校验版本/路径/文件大小/物理引用 -> 注册本地资源 -> 加载 -> 应用文档
渲染 -> 暂停/固定当前姿态 -> 指定尺寸/透明背景 -> 绘制并toBlob -> 恢复画布和相机
刚体：形状、尺寸、骨骼、类型、质量、阻尼、摩擦、恢复系数、碰撞组/掩码
关节：连接刚体、位置/方向、平移/旋转上下限、六轴弹簧
列表多选批量改、复制、左右镜像、删除；删除刚体同步修正关节索引；所有操作可撤销
不在本轮实现权重刷、顶点/UV/Morph编辑、PMX重写导出及视频编码
```

```text
工程解压前：核对ZIP中央目录、重复/异常路径、文件区间、展开总量256MB/4096条；拒绝ZIP64/分卷/加密
压缩库复用声明依赖Three.js内置fflate，保留MIT许可；不增加npm依赖
编辑代理单独恢复canvas指针接收，原模型拖动仍关闭；隐藏代理不参与拾取
工程保存物理参考Hz和观察相机；修改形状尺寸时按拖动轴分别调整盒尺寸/胶囊长度或半径
PNG导出后恢复像素比/画布/相机；编辑轴、操作面板不写进图片
```

## 2026-10-06 移除西施2内置角色

```text
构建角色清单 = 米娅 + 静态西施
移除西施2专用导出脚本和构建接入
旧URL character=xishi2 或旧记忆 xishi2-default → 静态西施
通用PMX工程材质加载器保留，改为中性命名
重新生成web-dist，不携带西施2模型；原始output文件保留
```


## 2026-10-09 PMX文件导出

```text
编辑器加载物理数据 -> 保存源索引与加载器参数基线
新增/复制 -> 无源身份，撤销/重建/ZIP继续保留来源
导出PMX -> 原字节扫描 -> 刚体/关节改动反向坐标变换 -> 物理段重写
刚体重排 -> 冲量表情/软体锚点引用同步，已删除源对象引用移除
索引宽度不足 -> 同步扩展头部及所有相关字段
输出结构校验 -> 下载新PMX，灯光/动作等另存工程ZIP
详细伪代码 -> docs/spec/mmd-ar-pmx-export.md
```

## 2026-10-09 FSR2覆盖率与斜边空间误差修正（已实现）

合并正式渲染共享适配后的构建兼容伪代码：共享标记存在 → 转换独立命名与指纹 → 仅给构建副本注入FSR2内部尺寸与PNG旁路；未共享源码 → 沿用原完整TAA构建注入。两种路径调用同一内部尺寸生成规则，不向正式显示端新增FSR2设置。

```text
已有声明 := reconstructCurrent、presentShader、FSR2浏览器夹具
参考输入 := 同场景高分辨率覆盖率；多角度/正负斜率/亚像素相位
四点双线性空间权重 → 保留前景总覆盖权重与背景颜色贡献
空间权重大于最小有效值的四点深度 → 独立选择重投影参考深度
前景深度相似度 → 只规范化前景内部颜色，不重新规范化前景/背景覆盖比例
规范化前景颜色 × 原始前景覆盖权重 + 原始背景颜色贡献 → 当前线性预乘RGBA
零空间权重的前景 → 不得替代背景中心覆盖率
比例1且位于输入像素中心 → 空间重建保持中心颜色/alpha
滤波关闭/开启、重建输出/最终输出 → 分别比较参考覆盖、轮廓位移与空间误差
帧间alpha变化下降 → 仅代表时间指标改善，不作为空间质量充分条件
失败断言定位到重建或最终滤波 → 单独修正该分支 → 普通TAA/透明/PNG/深度历史回归
```

用户确认后已完成真实GPU先失败再通过与Shader修正；合并共享构建适配后九文件38/38通过、无跳过，网页构建成功。手机实际观感仍待设备验证。详见`docs/task/20261009_MMDAR_FSR2轮廓覆盖率排查.md`。

## 渲染共享构建（2026-10-09）
```text
正式渲染共享标记 -> 复制测试参数/Shader模块 -> AO/runtime映射为web模块与MmdAr入口
模块内容指纹 -> runtime/合成/页面使用同一设置模块实例 -> 不重复插入TAA或屏幕光照
正式预建渲染控件 -> 分类前移除 -> 按同一参数清单重建独立分类
已共享相机resize标记 -> 跳过再次替换；保留预览姿态，仅更新投影
输出 -> web-dist构建成功；正式code48发布不部署独立站点/编辑器/原生APK
```
