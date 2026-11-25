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

apply(id) 引导锁定与动作校验:
    第 1 关新手引导期（`level.id === 1 && !state.failed && hasSteps && (cursor === 0 || cursor === 1)`）:
        若 `id !== expected.id` -> 拦截不提交，保留原步骤并提示“请先点击手势指引的高亮小猪”，触发 view3d.shake(id, notice) 或 2D 晃动反馈
    受阻 / 炸弹爆炸 / 解锁 / 剪绳 / 开笼 / 胜利:
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
    WEATHERS = ['sunny', 'cloudy', 'rain']（晴 / 阴 / 雨，4 季节 × 3 天气 = 12 组基础预设，搭配 4 时段共 48 种环境状态）
    春 #74bf54→#b4e36e / 夏高饱和 #3ea824→#8ee632 / 秋 #c8a85a→#f0cf72 / 冬外雪地 #dce7f5→内棋盘覆霜青绿 #5e9690（草叶 #9cb5aa→#f6fafc）
buildPreset(season, weather, options):
    合成基础季节与天气参数（含铁笼黄昏 dusk=1）；冬季保持内棋盘青绿覆霜条纹草坪（lawn 仅混入 snowCover*0.18）、外围大面积雪白粉雪地（ground 混入 snowCover*0.92）；当 season === 'winter' 且 weather === 'rain' 时，降水自动转为冬雪飘落（precip='snow', precipCount=3000, snowCover>=0.85, lightning=false）
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
    导出 PBR_ACCESSORY_PRESETS = { steel: { metalness: 0.82, roughness: 0.26 }, gold: { metalness: 0.86, roughness: 0.22 }, spring: { metalness: 0.72, roughness: 0.28 }, ironBomb: { metalness: 0.68, roughness: 0.42 }, paintedRed: { metalness: 0.16, roughness: 0.46 }, rope: { metalness: 0.04, roughness: 0.82 } }
    共用外网顶点色水粉双阶着色器 toonMat：保留经典 Painted Valley 侧前主受光亮面 + 高光阶梯 + 顶面柔和微辉 `topRim` + 暖玫瑰可可暗面，接入 `setLightState(lightState)` 每帧同步当前太阳/月亮主光方向 `uLightDir`、24h 光色 `uLightColor`、环境色温 `uTimeTint`、夜晚融合度 `uNightMix` 与冬季积雪反光 `uSnow`（夜晚区分亮面 `litBase` 与暗面 `shadeBase`，以银白月光 `mix(uLightColor, mix(vec3(1.0, 0.98, 0.96), uLightColor, 0.42), uNightMix)` 与 `mix(1.0, 1.18, uNightMix)` 柔和照亮受光面同时压低 `topRim` 85% 与 `hiStep` 88% 保持哑光无塑料反光；冬季适度抬升暗面与下肚皮亮度；明暗交界线附近叠加暖桃粉次表面散射 SSS 透光带）
    接触阴影: 底部半透明软阴影椭圆（shadowMesh）+ 实时太阳阴影贴图
    按 (kind, length, width) 缓存几何体与描边几何体：
        - pig / elephant / duck 与六种机制配件（lock / scissors / rope / spring / bomb / timer_bomb；配件与铁笼全部使用无贴图参数化 THREE.MeshStandardMaterial，按材质种类预设金属度/粗糙度）
    铁笼(cage): 外网原始笼框与 'steel' 金属计数牌
    getLightState(): 返回 { lightDir, lightColor, timeTint, nightMix, accessoryPbr }
    提示与受阻: 脚下旋转鲜艳红贴花环 + 猪背表面贴花（片元尾部补全 #include <tonemapping_fragment> 与 #include <colorspace_fragment> 保真鲜红显色） + 头顶浮动全息箭头 + 卡通点按手势精灵 `handSprite`（`center=(0.35, 0.84)` 对齐食指尖端并直接锚定在目标猪背部中心上方沿视图微抬轻点，360° 任意旋转视角不偏移）；受阻弹出红色全息叉号
```

## 5. 手绘场景（3d/scenery.mjs）
```
createScenery(scene, textures, level, tier):
    导出 PBR_SURFACE_PRESETS（含 ground、lawn、wood、stone、foliage、water、snowProp、windmill、cabinWindow、seasonProp 金属度/粗糙度及湿润/积雪动态参数）
    全部地貌与静态场景物件统一升级为无额外 PBR 贴图的参数化 THREE.MeshStandardMaterial（Cook-Torrance GGX 微表面 PBR）：
        - 修剪草坪平面(y=0.008，细分 48×48 网格)与外部起伏大草地(82×82)通过 setInteractTexture(tex) 绑定共享交互贴图 uInteractMap；在 enhanceGroundAerial(material, sharedGround, isInnerLawn) 中：
            * 冬季(uSnow>0.15)顶点着色器采样 uInteractMap 抬升积雪层（内棋盘 +0.044m / 外雪地 +0.052m），在踩踏/滑行轨迹 R 与占位 G 处下陷为 3D 雪槽并挤起四周雪垄 scRim
            * 片元着色器于 `#include <normal_fragment_maps>` 按双倍差分跨度(2/256)提取真实下凹斜率 `vec2(pR - pL, pU - pD)` 强力扰动 PBR 法线(`1.45`)；并接入主光水平方向 `uSunDir.xz` 与光色 `uDirectTint`，在被拨开/踩踏雪槽的**背光坡面与迎光雪坎背阴槽底**计算 `backShadow`（叠加深冷冰蓝阴影与槽底遮蔽），在**迎光坡面与推起雪脊**计算 `frontLit`（叠加太阳/月亮调制的亮白微高光），形成“一侧背光冷蓝暗影、对侧迎光亮白高光”的立体雪槽体积感
            * 棋盘内覆雪在拨开露底(scPress)处显现覆霜青绿草坪，外围雪地沿栅栏灯串与木屋前投出暖金地面光晕并点缀雪地微闪星点；夜晚由左后明月投出银青漫射光池并在右后木屋前形成暖黄窗光晕；远景(20.0~36.0)低饱和柔和融入 uHorizonColor
        - 卵石镶边、粗段原木围框、石板路、高脚木屋与双暖窗、木栅栏、池塘水面与砌石、三簇灌木、远景风车塔/盖/扇叶、四季树干与树冠、冬季各处积雪帽及季节道具全部升级为 MeshStandardMaterial 并通过 `enhancePropPbr` 保持 Painted Valley 明快发色，同时接入 `uSnow` 叠加冬季雪地环境漫反射提亮
        - 实例化小花: 按棋盘左/右两侧通道草带及前后栅栏内缘形成聚簇花丛（high 1800 / medium 900 / low 420），high/medium 采用交叉双面 5 瓣星形花（夜晚随环境压暗调色）
    applyPreset(preset, blend, horizonColor, lightState): 同步地面与全部场景物件 PBR roughness（随 wetness / snowCover 插值）与底色（冬季夜晚减轻外景物件压暗并将雪帽提亮至 `#8ba4cf`）、sharedGround uniforms（含 uSunDir / uDirectTint）、雪景 props、仅冬季灯串与木屋暖窗显隐
    setInteractTexture(tex): 绑定实时踩踏/占位交互贴图 uInteractMap
    pickTree(raycaster) / shakeTree(index) / getTreeState(index): 为 10 棵季节树树干与四季树冠/雪松网格标记 `userData.treeIndex`，支持点击射线拾取并触发 0.72s 阻尼弹性摇晃与 Q 弹缩放动画，返回树冠中心坐标与尺寸
    getGroundPbrState(): 返回 ground、lawn、wood、stone、foliage、water、snowProp、windmill、cabinWindow、seasonProp 各材质的 { metalness, roughness }
```

## 6. 可交互草地（3d/grass.mjs）
```
grassCountForTier(tier, isMobile, isSoftware):
    软光栅返回 1500
    桌面端: high 140000 / medium 36000 / low 22000
    手机端(isMobile): high 8000 / medium 4000 / low 2000
createGrass(scene, textures, level, tier):
    导出 PBR_GRASS_PRESET = { metalness: 0.0, roughness: 0.56, wetRoughness: 0.28, snowRoughness: 0.76 }
    实例数: 由 grassCountForTier(tier, isMobile, isSoftware) 决定；棋盘内缩减至 8% 并偏向棋盘边缘且保持 0.06~0.12 低矮高度以露出整洁草坪条纹与清晰小猪投影；外围跳过池塘范围并按自然草丛聚簇分布；冬季通过顶点着色器按 `uSnow` 与 `aTint` 剔除约 90% 外围草叶与 97% 棋盘内草叶，露出干净平滑雪地与零星覆霜草簇
    草叶几何: 5 段渐细弯折三角带（uv.y 0→1，基底宽 0.072）
    实例属性: aOffset(x,z), aBaseY(groundHeight 贴合丘陵), aHeight, aAngle, aTint
    顶点着色器额外输出: 随 aAngle 与倒伏姿态旋转的世界法线 vWorldNormal、世界坐标 vWorldPos 及脚下踩踏/占位压平度 vPress = clamp(trample * 0.88 + occupy * 0.95, 0.0, 1.0)
    交互贴图 DataTexture 256×256 RGBA: R 踩踏衰减 + G 在场动物占格压扁
    片元着色器(无贴图 Cook-Torrance GGX PBR + 草根跟随当前地面渐变 + 冬季 24h 雪地反光):
        - 同步传入 `uGroundColor` (`preset.ground`) 与 `uLawnColor` (`preset.lawn`)，按 `vWorldXZ` 区分棋盘内草坪与外围地面并复用同一套地面明暗（色斑、移动云影、太阳/月亮实时阴影 `shadowMask`、白天/月夜底色混入、冬季外围 `powderSnow` / 棋盘内按 `vPress` 拨雪露底的 `boardSnow`、夜间左上月光池 `moonPool`、木屋前暖窗光池 `cabinPool` 与冬季栅栏灯串光晕 `fenceGlow`）实时算出脚下地面颜色 `groundSurfaceCol`
        - 基于 `uMetalness` 与随湿润/积雪变化的 `uRoughness` 计算 Trowbridge-Reitz GGX 法线分布 $D$、Schlick-GGX 几何遮蔽 $G$、Schlick 菲涅尔 $F$、能量守恒漫反射 $k_D$、逆光叶片次表面透射与半球环境光；冬季 `snowBounce = smoothstep(0.10, 0.75, uSnow)` 抬升色斑/云影/`shadowMask` 暗部下限（投影内草叶呈清透冰蓝雪影 `vec3(0.68, 0.76, 0.90)`）、将草身覆霜白雪下延至 `smoothstep(0.12, 0.88, vY)`、抬升草根 AO（`0.48 -> 0.94`）并融合脚下雪面亮度 `gLit` 与背光全向补光 `(1.0 - NoL * 0.45)` 注入 24 小时全天候雪地向上漫反射反光 `snowBounceLight`
        - 非冬季夜晚收敛夜斑与夜色压暗（`nightRoot` / `nightBlade` 与贴合地面的叶尖微辉）；冬季夜晚结合 `snowBounce` 大幅减轻 `uTimeTint` 压暗并用脚下雪面反光兜底暗部（`litBlade = max(litBlade, gLit * mix(0.84, 0.96, vY) * snowBounce)`），消除背光面/阴影区发黑
        - 最终将草叶从 `vY = 0`（100% 承接当前脚下地面颜色 `groundSurfaceCol`）沿 `smoothstep(0.0, 0.58, vY)` 平滑渐变至受光草身与叶尖，远景平滑融入 `uHorizonColor`
    getLightState(): 返回 { nightMix, snowCover, metalness, roughness, timeTint, directTint, sunColor, hemiGroundColor, groundColor, lawnColor }
    getInteractTexture(): 返回 256×256 共享实时交互贴图供棋盘与地面雪坑交互共用
    getInteractSample(wx, wz): 查询指定世界坐标当前 trample / occupy 归一化采样值
    update(dt, time, state, actorPositions, preset, shadowData, horizonColor, lightState): 冬季 uSnow > 0.35 时放缓踩踏回弹系数为 pow(0.68, dt) 以拉长雪槽保留时间，并同步 uGroundColor / uLawnColor
```

## 7. 粒子系统（3d/particles.mjs）
```
createParticles(scene, textures, tier):
    上限: high 8000 / medium 4000 / low 1500
    Points + 自定义着色器（支持 2×2 图集索引、大小随寿命缩放、旋转、透明度、雨丝拉伸）
    发射接口:
        - burstGrass(x, z, season): 草屑 + 季节花瓣/落叶/雪团
        - burstTree(x, y, z, season): 树冠抖落四季粒子（春粉白樱花瓣、夏翠绿树叶与金粉、秋金红枫叶、冬松枝雪团与冰晶）
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
    天空穹顶: 自定义球面着色器（天顶到地平线渐变、太阳光晕仅白天可见 sunVis = 1 - smoothstep(0.35, 0.85, uDusk)、横向水粉刷痕噪声、黄昏星点与夜晚银蓝月亮圆盘/月晕）
    一局内时间推进（默认开启，可开关，并受表盘 24h 时段控制）:
        - TIME_SLOTS = ['morning', 'noon', 'evening', 'night']（早/中/晚/夜，对应 dayPhase 0.0 / 0.25 / 0.5 / 0.75）
        - 周期缩短至 90 秒一圈（默认 `timeCycleEnabled = true`）；内置 24 小时真实日光光谱关键帧表 `SOLAR_24H_STOPS` + `sampleSolarCycle(dayPhase)`（0.00 日出桃金 `#ffb36b` → 0.12 晨阳 `#fff1d4` → 0.25 正午纯白 `#fffdf6` → 0.40 午后 `#ffd594` → 0.50 夕照橘红 `#ff7d3e` → 0.58 蓝调暮色 `#6e84cf` → 0.75 午夜银蓝 `#9ec2ff` → 0.90 破晓微曙 `#7285c4`），同步驱动天穹、地平线晚霞、主光色彩与草地/角色色温；白天 `sunLight` 跟随东→正中→西太阳弧线，入夜后平滑转向天空月亮 `uMoonDir` 方位，夜晚大幅下调半球补光至 `~0.44`、月光主强 `~0.66`，使草地与地形真实压暗进入月夜
        - 新增 `setTimeSlot(slot)` / `getTimeSlot()` / `getDayPhase()` / `getSunPosition()` / `getLightState()` 供时钟圆盘手控与草地/角色着色器每帧同步（`lightState` 同步导出 `sunIntensity` / `hemiIntensity` / `hemiSkyColor` / `hemiGroundColor` / `snowCover`）
    积云: 14~20 朵噪声球簇，顶白底蓝灰，按风速缓慢漂移并环绕回折；阴雨天加厚下压并调暗
    远山: 3 层圆柱剪影带（textures.mountain(0..2)），随季节与雾色过渡
    灯光与雾: 主平行光（high 2048 / medium 1024 软阴影，low 关闭阴影）+ 24h 动态半球光（冬季 `hemiLight.intensity` 增加 `snowMix * lerp(0.46, 0.52, nightBlend)`，`hemiLight.groundColor` 插值至高明度雪面反射色且冬夜呈 `#8eb0e8`、天光呈 `#7e9ee0`，`moonLight.intensity` 增加 `snowMix * 0.22`）+ 指数雾
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
        - 全息 UI 天气/季节/昼夜联动换肤 (`WEATHER_UI_THEMES`): 顶部/底部 HUD、居中弹窗 SVG 羊皮纸底色、木纹按钮、关卡选择器与表盘配色随 `weather`（晴暖阳 / 阴冷雾 / 雨水蓝 / 冬雪霜蓝）与 `timeSlot === 'night'`（柔冷夜韵）自动同步重绘
        - 居中环境设置弹窗 (`settingsBg`, `z = 8..9`): 点击 `⚙ 环境` 打开时配合全屏半透明遮罩居中弹出（点击遮罩外缘或右上角 `✕` 关闭按钮 `settings-close` 收起，并阻断穿透点击与滚轮缩放）；优先加载 `web/pig-level/assets/ui/*.svg`（`panel-parchment.svg`、`btn-close.svg`、`dial-pointer.svg`、`center-knob.svg`、`btn-pill.svg`）矢量皮肤动态着色绘制，桌面端采用大号居中卡片（约 540×696，时钟表盘放大至 `462×462`），手机竖屏与矮横屏按视口自适应饱满撑开：
            * 单指针无遮挡同心时钟圆盘 (`clock-dial`): 支持通用 `N` 等分扇区（`step = 2π / ring.items.length`）：外环 24h 时段（4 等分 早/中/晚/夜 位于细刻度外环，仅此 1 根 `dial-pointer.svg` 三角指针绕外圈旋转指示，完全不压汉字）；中环天气（3 等分 120° 晴/阴/雨，无指针，天蓝扇区高亮）；内环季节（4 等分 90° 春/夏/秋/冬，无指针，嫩绿扇区高亮）；圆心 `center-knob.svg` 金扣切换天光流动/锁定，同时映射 `season-*` / `weather-*` / `time-*` 屏幕坐标供测试点选
            * 其余控件: 画质(自动/高/中/低)、天光流动开关(流/定)、音乐/音效开关、视角复位(V)、简洁 2D 控件开关(C)、切回 2D 版
        - 关卡滑动选择面板: 内置圆角列表凹槽底板 + `PICK_ROWS_VISIBLE + 1` 行缓冲平滑滑动，配合 `uClipRect` 与 6px 渐隐遮罩严格裁剪上下出界格子，命中拾取同步限制在列表可视遮罩内
        - 结算全息浮窗: 全屏半透明暖深褐遮罩 `modalBackdrop`（#2b140c, opacity 0.56, renderOrder 111）覆盖底层棋盘与背景 HUD 并拦截穿透点击与滚轮，居中弹窗自适应宽度与 188px 高度，主副标题排布于上半区（0.25/0.46），两个按钮排布于下半区（y=h/2-48）留出 > 28px 安全间距绝不与文字重叠
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
        - 雨天/冬雪自动降低音符密度并加大滤波暖度（冬季 `rain` 按雪景静谧密度与柔和风声处理）
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
    轨道阻尼控制: 左键/单指按下拖拽平移（无论落点在地面还是小猪身上均正常平移视角，松手超拖动阈值不误触发点击离场）、PC 右键拖拽 360° 无极旋转与俯仰（全局捕获拦截 contextmenu 弹窗，围绕按下时鼠标地面射线交点旋转与轻量惯性自转，最大角速度 2.6 rad/s + 8.5/s 指数阻尼）、PC 滚轮缩放以鼠标下地面交点为焦心锁点、移动端双指只控制垂直轴（`yaw`/转盘 Z 轴）360° 无极旋转（融合双指拧转角变化与纯平行横向滑动，带轻量甩手惯性）+ 双指捏合缩放且实时以两指比例中心对应地面点为锚点，缩放/滚轮高度通过 autoPitchForZoom(zoom) 自动计算俯仰角（0.58~1.24 rad）；每帧按当前渲染姿态实时反解 `panOffset`（范围 `[-28, 28]`）消除旋转/缩放插值中途的弦线漂移；双指先后抬指同步剩余坐标防止视角跳变且保留甩手惯性；取消双击地面复位，仅保留 V 键与全息复位按钮按最短角差平滑回正
    输入分发:
        - pointerdown/move/up: 优先交由 holoUI 精确包围盒拾取、居中平滑关卡列表拖动与进度条拖动；未命中 UI 时若移动距离 <= 8px 且非右键旋转视为点击：
          优先对在场非离场动物真实 3D 躯体网格做射线检测（失败再查包围盒）-> onPick(id) + 哼哼音效
          其次对 10 棵季节树做射线拾取 pickTree() -> scenery.shakeTree + particles.burstTree + grass.stamp(tree.x, tree.z, 1.35, 0.95) + 沙沙音效
          否则命中地面 -> grass.stamp(pt.x, pt.z, 1.1, 1.0) + particles.burstGrass(pt.x, pt.z, season)（点击才飞溅雪花/草屑）+ 草地沙沙声
        - pointermove 移动/悬停地面 -> 仅调用 grass.stamp(pt.x, pt.z, 0.85, 0.65) 压出雪槽/拨开草叶，不触发雪花/草屑粒子飞溅
    sync({ level, state, hintId, ui }): 同步全部猪/象/鸭/笼、启动位置滑行撞障补间、检测逃出棋盘的小鸭并通过空格 BFS 搜索通路启动蹦跳逃出动画、炸弹归零定位爆炸点、更新地面+猪背表面贴花提示、更新卡通浮动 UI
    animateExit(id): 蓄力下蹲后沿朝向冲刺跑出棋盘并淡出，沿途写入 grass 踩踏与白金冲刺尾迹，累计帧间隔确保完整播放
    shake(id, message): 前方受阻时前冲撞击喷火花+挤压回弹再左右摇摆；锁定态原地扭动身体；弹出红色叉号 + blocked/spring 音效
    cancelAnimations(): 立即完成或停止进行中补间，确保状态瞬间落位
    测试钩子 window.__pig3d = { ready, tier, preset, timeSlot, dayPhase, fps, getGrassCount, getGrassLightState, getGroundPbrState, getSnowInteractSample, stampGround, shakeTree, getTreeState, getPigLightState, getClockDialSize, getBoardScreenBounds, getCameraState, screenOf(id), getGuideHandScreen(), holoButton(name), setSeasonWeather(s, w), setTimeSlot(slot), resetCamera }
```
