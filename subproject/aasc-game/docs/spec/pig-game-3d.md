# 猪了个猪 3D 化伪代码

## 1. 入口、视图切换与回退（app.mjs）
```
start():
    加载关卡 JSON（默认第 1 关，可通过 `?level=` 切换 1..118）、verifyPlan(level) 校验步骤（不变）
    view3d := null
    use3D := URL 参数 view != '2d' 且 WebGL 可用
    若 use3D:
        try:
            view3d = await import('./3d/view.mjs').createView3D({
                container: #scene3d,
                level,
                levels: SUPPORTED_LEVELS,
                onPick: apply,
                onAction: handleViewAction
            })
            body.classList.add('mode-3d')
        catch(err):
            记录降级原因并保持 2D 模式
    绑定 DOM 控件事件、键盘快捷键（←/→ 步进、Z 撤回、R 重置、H 提示、M 静音、V 视角复位、C 切换简洁 2D 控件）
    render()

handleViewAction(action, payload):
    分发表路由：
        'next' -> 若可执行下一步则 apply(level.steps[cursor].id)
        'previous' / 'undo' -> undo()
        'reset' -> seek(0)
        'seek' -> seek(payload)
        'hint' -> 切换 ui.hint.checked 并 render()
        'level' -> goLevel(payload)
        'prevLevel' / 'nextLevel' -> 切换上/下一关
        'toggle2dControls' -> 切换 body.classList('show-2d-controls')
        'view2d' -> 跳转 URL ?view=2d

render():
    计算 remaining / lock / rope / cage / bomb / timer_bomb 文案与按钮禁用状态（不变）
    构造 uiSnapshot = { levelId, remaining, statusText, statusKind, ropeText, stepText, progressText,
                        ruleText, hintChecked, hintDisabled, hasSteps, cursor, totalSteps,
                        canPrev, canNext, canUndo, won, failed, freeMode }
    若 view3d:
        view3d.sync({ level, state, hintId, ui: uiSnapshot })
        同步隐藏态 DOM 文本供无障碍、简洁 2D 控件与自动化测试读取
    否则:
        执行原 DOM/SVG 棋盘渲染

计时炸弹定时器(每秒 tick):
    若游戏进行中且未暂停且有在场 timer_bomb:
        将所有在场 timer_bomb.timerSeconds 减 1
        若归零 -> state.failed = true 并调用 render() 触发爆炸特效与失败提示
    undo() 撤回时若恢复的 timer_bomb <= 5 秒，保底恢复到 >= 15 秒

animateExit(id):
    若 view3d: 异步触发 view3d.animateExit(id)（不阻塞后续点击，离场猪独立冲刺淡出，玩家可连续点击下一只猪）
    否则: 原阻塞式 WAAPI 离场动画

apply(id) 受阻 / 炸弹爆炸 / 解锁 / 剪绳 / 开笼 / 胜利:
    若 view3d:
        受阻 -> view3d.shake(id)
        事件通知 -> view3d.notifyEvent(type, payload)（触发粒子与程序音效）

cancelAnimation():
    view3d?.cancelAnimations()
    原动画取消逻辑
```

## 2. 坐标约定与环境预设（3d/presets.mjs）
```
格子 (x, y) 中心 → 世界 (x - cols/2 + 0.5, 0, y - rows/2 + 0.5)；1 格 = 1 世界单位，行号朝 +Z（朝向镜头）

SEASON_BASE / WEATHER_BASE / CAGE_DUSK:
    完全采用外网原版水粉预设（春 #74bf54→#b4e36e / 夏高饱和 #3ea824→#8ee632 / 秋 #c8a85a→#f0cf72 / 冬 #9cb5aa→#f6fafc）
buildPreset(season, weather, options): 合成基础季节与天气参数（含晴/阴/雨/雪与铁笼黄昏 dusk=1）
```

## 3. 程序纹理（3d/textures.mjs）
```
createNoise2D(seed) / fbm(noise, x, y, octaves)
createTextureLibrary(tier):
    按 tier='low' 缩放贴图尺寸为 0.5x，其余 1.0x
    noiseMap(): 128² RGBA 可平铺四频段 DataTexture（风场、云影、色斑）
    ground(): 灰度草地底色 + fbm 色斑 + 数千条短画笔刷痕 + 泥土斑
    lawn(): 修剪草坪明暗条纹 + 细碎刷痕
    stone(): fbm + 裂纹 + 苔藓斑
    wood(): 年轮拉伸噪声 + 木板拼缝
    mountain(layer 0..2): 圆柱首尾无缝连接的三层山脊线 + 笔触明暗 + 顶部雪线
    particleAtlas(): 2×2 图集（柔圆点、花瓣、带叶脉叶片、六角雪花）
    gradient3(): 4×1 NearestFilter 高对比暖可可明暗阶梯图（[46,34,38] → [104,82,82] → [222,208,192] → [255,253,240]）
    label(text, style): 圆角牌 + 描边粗体字，按 text+style 缓存（LRU 64）
    flowerSprite(): 128×128 手绘 5 瓣星形白花贴图（黑色细描边轮廓 + #ffd046 金黄花蕊中心，配合 instanceColor 染色）
    hintDecal(): 地面及猪背表面贴花提示环纹理（高饱和鲜艳红色 #ff2432 / #ff5454 环形光晕与虚线描边角标）
    handPointer(): 128×128 手绘卡通白手套点击手势贴图（#4d2b18 描边与手指纹路，配合点按动画提示目标小猪）
```

## 4. 通用几何与角色模型（3d/geometry.mjs + 3d/models.mjs）
```
mergeParts(parts): 转非索引 → 应用矩阵 → 保留部件已有顶点色或写入线性顶点色、aPart 部件标记与 aPivot 枢轴 → 合并为单一 BufferGeometry
shadeGradient(geo, lowColor, highColor, axis): 按局部坐标轴对几何体写入线性顶点色渐变
outlineOf(geometry, thickness): 反面 BackSide 法线外扩描边网格

createModelFactory(textures):
    共用外网顶点色水粉双阶着色器 toonMat（侧前主受光亮面 + 高光阶梯 + 暖玫瑰可可暗面）
    接触阴影: 底部半透明软阴影椭圆（shadowMesh）+ 实时太阳阴影贴图
    按 (kind, length, width) 缓存几何体与描边几何体：
        - pig / elephant / duck 与六种机制配件（lock / scissors / rope / spring / bomb / timer_bomb）
    铁笼(cage): 外网原始笼框与 'steel' 金属计数牌
    提示与受阻: 脚下旋转鲜艳红贴花环 + 猪背表面贴花（片元尾部补全 #include <tonemapping_fragment> 与 #include <colorspace_fragment> 保真鲜红显色） + 头顶浮动全息箭头 + 卡通点按手势精灵 `handSprite`（`showGuideHand` 开启时在目标猪上方做轻点动画）；受阻弹出红色全息叉号
```

## 5. 手绘场景（3d/scenery.mjs）
```
createScenery(scene, textures, level, tier):
    外网完整手绘地貌与景物:
        - 修剪草坪平面(y=0.008) + 卵石镶边 + 外部起伏大草地(82×82)，双方通过 onBeforeCompile 注入 uHorizonColor 做远景柔和空气透视雾化（20.0~36.0 低饱和与地平线混合）
        - 西北石板路、右上高脚木屋（含冬季屋顶积雪）、外围细木栅栏、左后方旋转风车、季节限定树（阔叶/松树）、蘑菇与季节道具（夏向日葵/秋稻草南瓜/冬雪人）
        - 实例化小花: 保留外网 tier='high' 1800 / 'medium' 900 / 'low' 420 与山丘正弦聚簇分布；high/medium 升级为交叉双面 5 瓣星形花面片（textures.flowerSprite(), alphaTest 0.42, DoubleSide，high 附加轻微风摆），low 保持六边圆片
    applyPreset(preset, blend, horizonColor): 同步 ground/lawn/crown 颜色、uHorizonColor、雪景 props 与花色
```

## 6. 可交互草地（3d/grass.mjs）
```
grassCountForTier(tier, isMobile, isSoftware):
    软光栅返回 1500
    桌面端: high 140000 / medium 36000 / low 22000
    手机端(isMobile): 每档降一档 -> high 36000 / medium 22000 / low 12000
createGrass(scene, textures, level, tier):
    实例数: 由 grassCountForTier(tier, isMobile, isSoftware) 决定（棋盘内占 28%，其余集中分布于外围可见草坪）；动态降档 setTierCount 共用同一映射，getCount 返回当前可见数量
    草叶几何: 5 段渐细弯折三角带（uv.y 0→1，基底宽 0.072）
    实例属性: aOffset(x,z), aBaseY(groundHeight 贴合丘陵), aHeight, aAngle, aTint
    交互贴图 DataTexture 256×256 RGBA: R 踩踏衰减 + G 在场动物占格压扁
    片元着色器: 外网明快水粉渐层（0.28+0.72*smoothstep(0,0.80)）、13% 金色麦草秆（vTint>0.87）、大尺度晴天冷暖斑块、移动云影（0.72~1.12）、5 点 PCF 太阳阴影、踩踏微暗与远景空气透视雾化（smoothstep(20.0,36.0,length(vWorldXZ))*0.36 向 uHorizonColor 柔和过渡）
    update(dt, time, state, actorPositions, preset, shadowData, horizonColor)
```

## 7. 粒子系统（3d/particles.mjs）
```
createParticles(scene, textures, tier):
    上限: high 8000 / medium 4000 / low 1500
    Points + 自定义着色器（支持 2×2 图集索引、大小随寿命缩放、旋转、透明度、雨丝拉伸）
    发射接口:
        - burstGrass(x, z, season): 草屑 + 季节花瓣/落叶/雪团
        - burstDust(x, z): 离场或滑停扬尘
        - burstSpark(x, y, z, color, count): 解锁金光 / 剪绳 / 开笼火花
        - burstFireworks(): 胜利彩色星光烟花
        - burstExplosion(x, z): 炸弹火光、黑烟与碎片冲击波
    持续天气粒子 update(dt, preset, boardRect):
        - rain: 雨丝高速斜落 + 落地生成地面涟漪圆环
        - snow: 大小不一雪花随风螺旋飘落
        - 季节飘浮: 春花瓣/蝴蝶、夏萤火虫/花粉、秋落叶、冬冰晶微光
```

## 8. 动态环境与季节天气（3d/environment.mjs）
```
createEnvironment(scene, textures, tier):
    天空穹顶: 自定义球面着色器（天顶到地平线渐变、太阳光晕、横向水粉刷痕噪声、黄昏星点）
    一局内时间推进（默认开启，可开关）: 约 600 秒一个昼夜/日照弧线循环，轻微偏移太阳高度与天空暖度
    积云: 14~20 朵噪声球簇，顶白底蓝灰，按风速缓慢漂移并环绕回折；阴雨天加厚下压并调暗
    远山: 3 层圆柱剪影带（textures.mountain(0..2)），随季节与雾色过渡
    灯光与雾: 主平行光（high 2048 / medium 1024 软阴影，low 关闭阴影）+ 外网半球光（#fff7e8 天光 / #5a7d3e 地色，随黄昏渐变）+ 月光方向光 + 指数雾
    setPreset(season, weather, isCageLevel, immediate=false): 非 immediate 时在 2 秒内平滑插值参数
    getHorizonColor(): 返回当前 scene.fog.color（供草叶与远景地面空气透视雾化同步）
    getShadowData / getCurrent / update(dt): 更新云漂移、时间推进、天气过渡插值、雨天随机闪电闪白（触发回调播放雷声）
```

## 9. 3D 全息浮动 UI（3d/holo-ui.mjs）
```
createHoloUI({ renderer, levels, levelId, onAction }):
    独立正交/低透视 UI 场景（或 HUD 叠加渲染层），保持清晰中文文本与独立拾取
    卡通着色器(uSelfRect + uClipRect): 支持 UI 像素坐标区域裁剪遮罩与上下边缘柔滑渐隐（默认全屏不裁切）
    浮动与呼吸: 面板保持正交屏幕平行（取消 `root.rotation.y` 倾斜，避免移动端旋转视角或 `mediump` GPU 裁剪/精度问题导致 UI 消失；关闭视口裁剪 `frustumCulled = false`、`uiCam` 纵深 `[-1000, 1000]`、安全默认 `uClipRect` `[-32000, 32000]`），保留柔和上下呼吸漂浮（reduced-motion 时关闭）
    竖屏 / 横屏自适应布局（根据 viewport aspect 动态重排面板锚点，绝不遮挡中心棋盘安全区）:
        - 顶部全息条: 标题、第 N 关、上/下一关、展开式关卡网格/滑动选择、自由试玩徽章（矮按钮自适应双行字距，防止压字）、剩余与机制计数胶囊
        - 底部全息条: 步骤标题、提示开关、状态提示、上一步/下一步、可拖动全息进度条、撤回、重开
        - 侧边可折叠全息面板: 四季 4 键、天气 4 键、画质(自动/高/中/低)、时间流动开关、音乐/音效开关、视角复位(V)、简洁 2D 控件开关(C)、切回 2D 版
        - 关卡滑动选择面板: 内置圆角列表凹槽底板 + `PICK_ROWS_VISIBLE + 1` 行缓冲平滑滑动，配合 `uClipRect` 与 6px 渐隐遮罩严格裁剪上下出界格子，命中拾取同步限制在列表可视遮罩内
        - 结算全息浮窗: 自适应宽度与 188px 高度居中弹窗，主副标题排布于上半区（0.25/0.46），两个按钮排布于下半区（y=h/2-48）留出 > 28px 安全间距绝不与文字重叠
        - 新手引导标语条 `guide-banner`: 无点击拦截（不加入 hitTargets）的金黄描边悬浮提示条，在第 1 关初始前两步或遇到阻挡时显示（如“👆 点击高亮小猪向前移动”），带柔和呼吸缩放并在完成引导/打开弹窗时自动隐藏
    输入: pointerdown/move/up 射线拾取全息按钮、进度条滑块与居中平滑关卡列表（强惯性平滑拖动 `pow(0.24, dt)`，禁用 `pickerBg`/`card` 底板 hover 变色与缩放）；暴露 getButtonScreen(name) 供自动化测试点击
```

## 10. 程序音乐与音效（3d/audio.mjs）
```
createAudio():
    WebAudio AudioContext（首次用户交互时解锁 resume）；三条子总线(music / ambient / sfx) -> DynamicsCompressor -> masterGain
    持久化配置(localStorage): musicEnabled(默认 true), sfxEnabled(默认 true), masterVolume
    季节音乐前瞻调度器(25ms tick, 100ms lookahead):
        - 春: C 大调五声 112BPM（轻快钢片琴 FM + 拨弦）
        - 夏: D 大调五声 120BPM（明亮跃动）
        - 秋: A 小调五声 90BPM（温润柔和）
        - 冬: E 小调五声 76BPM（空灵稀疏 + 长混响 pad）
        - 雨天自动降低音符密度并加大滤波暖度
    环境声场: 粉噪声风声(随 wind 增益)、高通雨声 + 随机雨滴、春夏晴天 FM 鸟鸣、夏日蟋蟀、闪电后延迟低频雷鸣
    完整程序音效 playSfx(name):
        'oink'（点击哼哼）、'slide'（滑行扫频）、'exit'（欢快跑动）、'blocked'（木咚）、'spring'（弹簧嘣）、
        'unlock'（清脆金锁）、'scissors'（咔嚓剪绳）、'cage'（铁笼开启）、'tick'（炸弹跳数）、
        'boom'（爆炸冲击波）、'win'（五声部胜利琶音）、'holo'（全息短促滴声）、'rustle'（草地拨动沙沙声）
```

## 11. 后期与性能分档（3d/post.mjs）
```
detectInitialTier(renderer): 软光栅 / mem<=2 / (移动端且 cores<=2) 返回 low；其余移动端与 4 核设备返回 medium；非移动端且 cores>4 且 navigator.deviceMemory 缺省（如局域网 HTTP 非安全上下文）按 8GB 回退避免误降 medium，高配返回 high（保留 HiDPI 清晰度，high/medium/low 分辨率上限分别达 2.5x / 2.0x / 1.75x，避免手机端退回 1x 变糊）
createPost(renderer, initialTier):
    外网简洁全屏后期平面（无需 EffectComposer）:
        - high 档启用柔光(0.16) + 轻微暗角(vignette * 0.45) + 温和对比度微调 + #include <tonemapping_fragment> + #include <colorspace_fragment>
    FPS 监视器: 每 2.5 秒统计平均帧率；自动模式下需连续 2 个统计周期（5 秒）低于 38fps 且非刚切回前台（Visibility/Focus 切回调用 resetFpsMonitor 重置采样并跳过瞬时抖动）才降档，防止切窗口或初始编译误把 high 降为 medium
    页面可见性监听(visibilitychange): 隐藏时暂停渲染循环与调度音频，切回或获焦时重置帧率采样窗口
```

## 12. 主控 3D 视图（3d/view.mjs）
```
createView3D({ container, level, levels, onPick, onAction }):
    初始化 renderer(WebGLRenderer, antialias, sRGB, ACESFilmicToneMapping)、scene、camera(PerspectiveCamera fov=40)
    创建 textures -> post -> environment -> scenery -> grass -> models -> particles -> holoUI -> audio
    默认俯角 0.91（约 52°）；自动镜头适配 fitCamera():
        - 按内圈棋盘实际区域（hw = cols/2 + 0.15, hh = rows/2 + 0.15, 高度 0..0.92）投影计算安全区居中 lookTarget
        - 横屏（viewW >= viewH）以安全区高度 96% 为主填满高度（兼顾宽度不溢出右侧 HUD）；竖屏（viewH > viewW）以安全区宽度 96% 为主贴紧透视前边最长边填满宽度（兼顾高度不溢出上下 HUD）
        - 二分搜索最优距离 [6..64] 并反推精确居中偏移
    轨道阻尼控制: 左键/单指拖拽平移、PC 右键拖拽 360° 无极旋转与俯仰（全局捕获拦截 contextmenu 弹窗，围绕按下时鼠标地面射线交点旋转与轻量惯性自转，最大角速度 2.6 rad/s + 8.5/s 指数阻尼）、PC 滚轮缩放以鼠标下地面交点为焦心锁点、移动端双指只控制垂直轴（`yaw`/转盘 Z 轴）360° 无极旋转（融合双指拧转角变化与纯平行横向滑动，带轻量甩手惯性）+ 双指捏合缩放且实时以两指比例中心对应地面点为锚点，缩放/滚轮高度通过 autoPitchForZoom(zoom) 自动计算俯仰角（0.58~1.24 rad）；每帧按当前渲染姿态实时反解 `panOffset`（范围 `[-28, 28]`）消除旋转/缩放插值中途的弦线漂移；双指先后抬指同步剩余坐标防止视角跳变且保留甩手惯性；取消双击地面复位，仅保留 V 键与全息复位按钮按最短角差平滑回正
    输入分发:
        - pointerdown/move/up: 优先交由 holoUI 精确包围盒拾取、居中平滑关卡列表拖动与进度条拖动；未命中 UI 时若移动距离 <= 8px 且非右键旋转视为点击：
          优先对在场非离场动物真实 3D 躯体网格做射线检测（失败再查包围盒）-> onPick(id) + 哼哼音效
          否则命中地面 -> grass.stamp + particles.burstGrass + 草地沙沙声
        - pointermove 悬停地面 -> grass.stamp 拨开草叶
    sync({ level, state, hintId, ui }): 同步全部猪/象/鸭/笼、启动位置滑行撞障补间、检测逃出棋盘的小鸭并通过空格 BFS 搜索通路启动蹦跳逃出动画、炸弹归零定位爆炸点、更新地面+猪背表面贴花提示、更新卡通浮动 UI
    animateExit(id): 蓄力下蹲后沿朝向冲刺跑出棋盘并淡出，沿途写入 grass 踩踏与白金冲刺尾迹，累计帧间隔确保完整播放
    shake(id, message): 前方受阻时前冲撞击喷火花+挤压回弹再左右摇摆；锁定态原地扭动身体；弹出红色叉号 + blocked/spring 音效
    cancelAnimations(): 立即完成或停止进行中补间，确保状态瞬间落位
    测试钩子 window.__pig3d = { ready, tier, preset, fps, getGrassCount, getBoardScreenBounds, getCameraState, screenOf(id), holoButton(name), setSeasonWeather(s, w), resetCamera }
```
