# 本地 PMX 模型与 VMD 动作接入

## 1. 需求

当前显示端默认使用 VRM/GLB。需要在本地 Node 服务和浏览器显示端中接入用户下载的 PMX 2.0 模型及 VMD 0002 动作，替换本地测试时的默认角色。

先在本地服务和浏览器显示端验证资源；不处理 Offline APK。资源验证通过后，可将同一目录布局作为只读公网静态镜像发布，但默认显示端配置仍保持本地同源资源，切换另行完成。

## 2. 资源

- 模型：PMX 2.0，包含 `tex/` 和 `toon/` 相对纹理目录。
- 动作：VMD 0002，默认循环播放；显式单次播放时保持动作最后一帧，不回退到 T-pose。
- 本地资源目录：`res/models/mmd/miya/` 与 `res/models/mmd/motions/`。

## 3. 运行时方案

新增 PMX/MMD 运行分支，使用 Three.js `MMDLoader` 和 `MMDAnimationHelper`；保留既有 VRM 分支与失败占位。模型、纹理、动作均通过本地服务同源 `/models` 路径提供，动作计划只能引用白名单资源 ID。

## 4. 公网静态资源镜像

公网资源使用版本化目录和安全资源清单，不直接把任意 URL 传给浏览器，也不改动 Offline APK。首个镜像版本发布在 `http://120.79.245.103/mnt/mmd/miya-v1/`，布局为：

- `manifest.json`：与本地生成的清单内容一致；
- `mmd/miya/miya.pmx` 与 `mmd/miya/tex/*.png`：PMX 与相对纹理；
- `mmd/motions/miya-default.vmd`：默认循环动作。

发布先把文件传至同级隐藏暂存目录，逐文件核对大小和 SHA-256 后再同文件系统原子改名为 `miya-v1`。当前只增加此版本目录，不覆盖既有 `default-vroid.vrm`，也不更改显示端的本地 `/models/mmd/...` 默认 profile；后续需要单独实现和验证 WAN 回退、远端配置同步及默认资源切换。

## 5. 本地阶段落地结果

- 模型来源：[Aplaybox 米娅 Miya](https://www.aplaybox.com/details/model/VXOJHQfoLr6E)；动作来源：[Aplaybox 星铁联动大白兔奶糖](https://www.aplaybox.com/details/motion/9D1EFP26zPay)。资源按来源页面的非商业和视频用途限制使用。
- `scripts/models/install-local-mmd-assets.js` 从 `D:\down` 的两个 ZIP 校验 PMX/VMD 文件头、相对路径和 SHA-256，并生成被 Git 忽略的 `res/models/mmd/manifest.json`。
- 服务端新增 `GET /api/mmd/resources`，只返回 manifest 中的同源 `/models/mmd/` profile；VRM 代理接口保持不变。
- 显示端按 `modelType` 在 PMX 和 VRM runtime 间切换；切换前释放旧 renderer、场景和动画循环。PMX 使用本地 vendored Three.js 0.160.0 MMDLoader/MMDAnimationHelper，VMD 默认按 `playMode=loop` 使用 `LoopRepeat + Infinity` 播放；单次模式保持最后一帧。
- 本次下载包的 `toon/` 目录只有空目录条目，没有可复制的 toon 文件；MMDLoader 对模型默认 toon 贴图使用内置数据纹理。`tex/` 下的 12 个 PNG 已通过本地服务请求验证。
- 浏览器验证结果：Chromium 忽略本地开发证书后打开 `https://127.0.0.1:8081/display`，状态为“PMX 模型已加载”，WebGL 可用，PMX、12 个 PNG 纹理和 VMD 请求均 HTTP 200，页面无异常。

## 6. 加载阶段防穿帮

PMXLoader 构造 SkinnedMesh 时会立即返回材质对象，而材质引用的 PNG/toon 纹理仍在异步解码；旧实现还会在 VMD 完成前先把 PMX 加入场景，因此模型可能逐材质出现或短暂显示默认姿势。运行时为每次 PMX/VMD 加载创建独立 `LoadingManager`，把模型、纹理和动作保存在 staged 资源中，全部成功后再一次性替换当前场景对象。

切换失败时释放 staged 资源；若已有完整模型则继续保留旧模型，只有首次加载没有可用模型时才显示占位角色。该方案只改变浏览器显示端的加载时序，不改变资源白名单、灯光、Offline APK 或外网发布边界。

## 7. 显示端灯光设置

显示端在舞台右上角时间区域下方提供“灯光”按钮。点击后展开详细设置面板，控制当前 PMX 或 VRM runtime 使用的环境光和主方向光：

- 环境光颜色、强度；
- 主光颜色、强度；
- 主光经度/纬度方向；光源到角色的距离固定；
- 角色阴影开关，默认开启；
- PMX 物理目标步进频率，范围 30–90 Hz、步长 5 Hz、默认 65 Hz；
- 默认、柔和、明亮预设和“恢复默认”。

灯光/物理设置通过既有 `DisplayMmd.setLighting()` 流程传给当前 runtime，规范化值保存到当前显示端浏览器 `localStorage`，显示端重新打开时恢复；不发送 WebSocket，不写入服务端配置，不进入 Offline APK。灯光值只更新已创建的 Three.js light 对象。物理频率只作用于 PMX：将 `MMDPhysics.unitStep` 设为 `1 / physicsFps`，当前模型即时生效，新建 helper 也使用相同值；不重新加载模型、纹理或 VMD。VRM 忽略该设置。物理频率是目标步进频率，实际步数仍受渲染帧率及 `maxStepNum=3` 限制；调高频率会增加物理计算开销，模型间的稳定性可能不同。

默认光照沿用当前播放器：白色环境光强度 `1.8`，白色主方向光强度 `2.3`，主光方向约为经度 `31°`、纬度 `46°`；光源距离固定，阴影默认开启。输入值在浏览器端和 runtime 端都进行范围限制，避免异常值破坏渲染。旧版 X/Y/Z localStorage 设置读取后只做一次经纬度迁移，不再作为界面或规范化配置输出。角色网格在阴影开启时同时投射并接收自阴影，另保留透明接收平面用于地面投影；阴影贴图使用 `1024×1024`，并按模型包围盒动态收紧阴影相机范围、定位主光 target，减少大范围贴图造成的锯齿和模糊。关闭阴影时同时停用阴影贴图、投影和角色自阴影，减少移动 WebView 的渲染开销。

PMX 材质的“环境色”与场景环境光并非同一设置。Three.js `MMDLoader` 会将 PMX 环境色映射成材质 `emissive`，导致两盏场景灯都为 0 时人物仍呈灰色。按当前显示规则，所有 PMX 在加载完成、尚未入场时清零 `MMDToonMaterial.emissive`，始终忽略 PMX 环境色；保留 diffuse、纹理、透明度和 toon 阶调，不修改 vendored 加载器或 VRM 材质。此规则对本地和同源代理加载的 PMX 一致，普通光照下角色会比以前略暗；两盏灯都为 0 时模型不再因环境色自行显灰。

物理频率滑块按 5 Hz 调整，规范化范围为 30–90 Hz，默认 65 Hz。选择柔和/明亮灯光预设保留当前物理频率；“恢复默认”同时将物理频率恢复为 65 Hz。旧 localStorage 设置缺少该字段时沿用 65 Hz 默认值。面板显示目标频率；实际计算由浏览器 render delta 驱动，单帧最多执行 3 个物理子步。

空白区域旋转属于后续交互需求，待确认采用“按住空白区域拖动旋转”还是“单击空白区域自动旋转”。角色区域现有点按动作交互保持不变。

## 8. Offline APK 外网 MMD 代理

Offline APK 不内置 PMX、纹理或 VMD，也不由 WebView 直接请求外网。它复用静态 VRM 的规则：内嵌 Node 服务只接受固定的公网静态根 `http://c.aasc.us/mnt/mmd/miya-v1/`，先将域名解析为 IPv4，再从解析后的地址下载并以同源路径响应给显示端。这样可避免 WebView 混合内容、CORS 和任意 URL 注入问题。

PMX 的纹理是相对模型 URL 解析的，因此不能使用 VRM 的单文件 query 代理。服务端应返回路径型同源地址，例如 `/api/mmd/static/mmd/miya/miya.pmx`；MMDLoader 后续请求的 `tex/*.png` 会自然落到同一前缀。服务端只允许随版本固定的 14 个文件（PMX、12 张 PNG、VMD），在代码中固定其路径、大小和 SHA-256，不接受查询参数、任意文件名或路径穿越。

`/api/mmd/resources` 优先返回本地 `res/models/mmd/manifest.json` 的 profile，便于桌面内网验证；仅当本地清单确实不存在时回退为固定的公网 `miya-v1` profile。清单存在但格式、文件或 hash 无效时必须返回错误，不能静默切到公网。公网下载没有持久缓存：每次显示端请求由本地 Node 代理受限的上游文件；断网、上游非 200、大小或 SHA-256 不一致时，显示端保持占位降级，聊天、媒体和灯光功能不受影响。

本功能只修改服务端/显示端代码，因此通过服务代码更新交付给既有 Offline APK；不改 `allserver`/`allserver-min` profile，不构建或发布完整 APK、min APK，也不将模型二进制写入 Git 或 APK assets。

## 9. Offline 静态代理实施结果

已在服务代码中固定 `miya-v1` 的 14 个运行时文件记录、版本 `ca07d84b494577f5dab90d71465bc08e01ec036fe66278a2393313b6febf56c6`，并为 PMX/VMD 返回 `/api/mmd/static/mmd/...` 同源 profile。服务端仅在本地 `mmd/manifest.json` 缺失时回退；清单存在但 JSON、文件大小或 hash 校验失败时继续返回错误。

`GET /api/mmd/static/...` 不接受查询参数，路径必须完整命中固定白名单。上游请求使用 `c.aasc.us` 的 IPv4 解析结果、禁止重定向，且只在 HTTP 200、`Content-Length`、完整读取字节数和 SHA-256 都与固定记录一致后返回内容。浏览器只新增 `/api/mmd/static/mmd/` 这一同源前缀；外部 URL、协议相对 URL、路径穿越、反斜杠和 query/hash 仍拒绝。

Android Runtime 打包逻辑现在无条件排除 `res/models/mmd`，避免后续服务包或 APK Runtime 意外携带 PMX、VMD 与纹理；该排除不影响服务器源码中的 MMD 模块。实施过程未执行 APK、服务更新包构建或发布，也没有复制或提交任何模型二进制。

## 10. PMX 内置 Ammo 物理解算

PMX 的刚体和关节数据由 Three.js r160 的 `MMDAnimationHelper`/`MMDPhysics` 处理，其底层依赖 Ammo（Bullet 的 WebAssembly 绑定）。显示端将与当前 Three.js 版本匹配的 `ammo.wasm.js`、`ammo.wasm.wasm` 放入既有同源 vendor 根 `public/js/vendor/three/libs/`，不从 CDN 或第三方页面拉取运行时。

Ammo 不随页面初始化而加载。PMX 模型归一化后，运行时先读取 `mesh.geometry.userData.MMD.rigidBodies`：数组为空或不存在时仍按既有方式创建无物理的 helper；只有至少存在一个刚体时才注入同源脚本并初始化 WASM。初始化请求在页面范围内去重，成功后的模块复用；失败时清除失败的单例状态，使下次模型加载可重试。

带刚体的模型会在最终场景层级中完成 helper 准备。Ammo 初始化成功时，以 `physics: true` 创建 helper，既有 VMD、IK、grant、循环与单次动作语义保持不变；没有 VMD 的 PMX 也可启用物理。Ammo 脚本、WASM、初始化或物理 helper 任一阶段失败时，以 `physics: false` 重新创建 helper，并向显示端给出“PMX 物理不可用，已回退骨骼动画”的可观察状态。模型和 VMD 不会因此失败、也不会降级为占位角色。

PMX 的物理网格始终保持原始单位和 `scale = (1, 1, 1)`：Three.js r160 的 MMDPhysics 在非 1 缩放下会临时解除父级并以原始单位回写动态骨骼，导致布料脱离显示比例、持续向上飘。运行时只把模型平移至地面和水平中心，使用模型原始边界适配相机距离、裁剪面、方向光相对位置和阴影平面范围，不缩放物理网格；VMD 的位置轨道、刚体、关节和碰撞体因而保持同一坐标系。

首次加载仍先创建中心枢轴、将其以不可见状态加入最终场景并更新世界矩阵，再建立物理 helper；但刚体 PMX 固定传入 `warmup: 0`，加载阶段只重置初始刚体状态、不推进物理模拟。成功提交并显示枢轴后，下一次 `requestAnimationFrame` 的 `helper.update(delta)` 才执行第一步物理解算。该流程不修改 PMX 原始刚体、关节、阻尼或重力参数；VRM 继续按模型自己的 SpringBone 和 `vrm.update(delta)` 路径处理，不复用 Ammo。

本功能只增加显示端静态代码和 vendor 的 Ammo 文件；PMX、VMD、纹理仍遵循既有不内置、按同源服务/代理读取的边界。未构建或发布 Offline APK、更新包，也未改变远端配置或 WebSocket 协议。

## 11. 中心旋转时由 PMX 锚点牵引布料

中心旋转枢轴处于 PMX 网格外层，而 Ammo 的动态刚体保存的是世界坐标。此前两次试验均整批传送动态刚体的位置/姿态：先在物理前传送，后改为物理完成后传送。用户反馈两者在 yaw/pitch 缓动期间仍会扰乱布料。简化 Ammo 约束复现显示，整体传送会放大转动期间的关节误差；在传送后再补同一次旋转的速度还可能造成下一物理步重复位移。

当前试验改为先推进中心枢轴缓动并刷新模型/骨骼世界矩阵，再调用 `MMDAnimationHelper.update(delta)`。Three.js `MMDPhysics` 从新骨骼姿态更新 type=0 运动学锚点；type=1/2 动态刚体留在 Bullet 世界坐标中，不由显示端直接传送或重写线/角速度，而由原有关节约束牵引，形成转动滞后和惯性。物理更新后的动态骨骼在当前枢轴下回写，最后渲染。

不在缓动帧调用 `MMDPhysics.reset()` 或清空速度、角速度、外力；不修改 PMX 刚体/关节、重力、风、VMD/IK/grant、物理频率设置，也不影响 VRM SpringBone。真实 PMX 仍须现场检查 yaw、pitch、反向拖动、30/65/90 Hz 下的布料穿模及自然收敛。当前方案不在 Bullet 的多个固定子步间插值枢轴；若低渲染帧率或快转时仍乱，需重新评审 `docs/superpowers/specs/2026-09-23-pmx-rotation-substep-sync-design.md`，不能宣称已完全解决。

## 12. PMX 物理目标频率

Three.js r160 的 `MMDPhysics` 默认 fixed step 为 `1/65` 秒，默认每个渲染帧最多补算 3 个子步。显示端灯光面板提供 30–90 Hz、每格 5 Hz 的 PMX 物理目标频率设置，默认 65 Hz。该值换算为 `unitStep=1/fps`，用于新建 PMX helper，并可即时更新当前 helper 的 `physics.unitStep`；运行时持续按 `requestAnimationFrame` 的 delta 调用 helper，最大子步数仍保持 3，因此它代表目标频率，实际步数受页面渲染帧率和补算上限约束。

设置沿用灯光面板的浏览器 `localStorage` 保存/恢复方式，不经过 WebSocket 或服务器配置。灯光预设只调整灯光参数，保留当前物理频率；“恢复默认”将其重置为 65 Hz。旧设置缺字段时规范化为 65 Hz。该配置仅 PMX 使用，VRM SpringBone 路径不读取它。

## 13. PMX 角色环境遮蔽 AO

当前 PMX 角色可在显示端“灯光”面板切换屏幕空间环境遮蔽，默认开启。AO 用于表现衣袖、发丝与躯干等相邻表面的接触暗部；它随模型动画、旋转和相机画面逐帧计算，不修改 PMX 纹理或灯光参数。开关沿用现有 `DisplayMmd.setLighting()` 和浏览器 `localStorage` 设置对象，旧设置缺少该字段时默认开启；亮度预设保持当前 AO 状态，“恢复默认”重新开启。VRM 运行时忽略该 PMX 专属选项。

PMX runtime 先把原场景渲染到带深度纹理的透明色彩目标，再以不超过画布一半且上限 `1280×720` 的分辨率计算 AO。着色器根据深度重建可见表面位置和法线，采样周围深度估计遮蔽。半分辨率 AO 图再经过水平与垂直两次按视空间深度保边的模糊，减轻随机采样在衣服和头发上的颗粒噪点；合成时继续按深度边缘抑制背景/前景串色，仅调整原色彩的 RGB，保留 alpha，使角色和透明舞台的分层关系保持一致。

“灯光”面板可即时调整 AO 颜色（默认 `#931231`）、强度（默认 `0.6`，范围 `0–2`）、半径（默认角色高度的 `6%`，范围 `1–20%`）及分辨率。分辨率默认 `half`，沿用画布一半且上限 `1280×720`；切换到 `full` 时，AO 和模糊目标使用实际绘制缓冲区的完整像素，不再受该上限限制。切换立即重新分配 AO 目标，不重新加载模型或动作，色彩/深度目标保持画布原生尺寸。半径始终按当前模型世界包围盒高度换算，适配不同原始单位的 PMX；参数沿用浏览器本地灯光设置保存，旧设置缺字段时使用新默认值，已保存的合法自定义值保持不变，“恢复默认”重置各项。无 WebGL2、开关关闭或当前没有 PMX 模型时沿用直接渲染；隐藏显示端停止渲染循环，切换模型复用 AO 目标，销毁 runtime 时释放目标和材质。全分辨率至少增加约四倍 AO 像素量，高 DPI 下可能更多；目标 Android WebView 的画质与帧率需现场确认。

该功能只修改本地显示端代码、测试和文档。渲染通道会增加深度读取和全屏采样成本，实际 Android WebView 帧率、透明发丝边缘与人物衣褶效果仍需现场观察；已在本机 Chrome 的透明画布和本地米娅 PMX 上做像素级浏览器验证。
