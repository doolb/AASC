- ✅ [2026-11-24] 将最新网页版 `web/pig-level/`（`?v=20261124e`）同步发布至外网 `https://c.aasc.us/mnt/game/pig-game/`
  - 目标路径：`c.aasc.us:/home/as/a/game/pig-game/`；增量上传 9 个变更文件并核验全量 17 个 HTML/CSS/MJS 及 `level-1.json` 远端与公网 HTTPS SHA-256 与本地逐字节一致，HTTP 状态码 `200`。
- ✅ [2026-11-24] 将环境设置面板升级为居中弹出的大号全息弹窗（`?v=20261124e`）
  - `web/pig-level/3d/holo-ui.mjs`：将 `settingsBg` 与控件提升至弹窗层（`z = 8..9`），点击 `⚙ 环境` 时配合全屏半透明遮罩 `modalBackdrop` 居中弹出（点击遮罩外缘或右上角 `settings-close` 按钮关闭，打开期间阻断底层棋盘点击穿透与滚轮缩放）；竖屏与桌面端卡片放大至 `348×454`（时钟圆盘放大至 `232×232`、按钮行高 `32px`），矮横屏自动切换居中双栏排版；`drawClockDial()`、`resolveClockSector()` 与 `getButtonScreen()` 统一按 `clockDial.w / DIAL_SIZE` 矢量缩放。
  - `web/pig-level/{index.html,app.mjs}`、`web/pig-level/3d/*.mjs`、`docs/spec/pig-game-3d.md`、`docs/task/20261124_环境设置居中大弹窗.md`、`tests/pig-level-3d.test.js`：统一升级 `?v=20261124e`、更新规格/任务记录，并校验环境弹窗居中、放大表盘点选与 `settings-close` 关闭交互。
  - 验证：`npm run test:pig-web`（`119 / 119`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`5 / 5`）全部通过。
- ✅ [2026-11-24] 将最新网页版 `web/pig-level/`（`?v=20261124d`）同步发布至外网 `https://c.aasc.us/mnt/game/pig-game/`
  - 目标路径：`c.aasc.us:/home/as/a/game/pig-game/`；增量上传 9 个变更文件并核验全量 17 个 HTML/CSS/MJS 及 `level-1.json` 远端与公网 HTTPS SHA-256 与本地逐字节一致，HTTP 状态码 `200`。
- ✅ [2026-11-24] 恢复在小猪身上拖动平移相机，并修复旋转视角后 3D 新手引导手指偏斜问题（`?v=20261124d`）
  - `web/pig-level/3d/models.mjs`、`web/pig-level/3d/view.mjs`：移除 `downOnPig` 平移拦截，恢复左键/单指在小猪身上拖动时正常平移相机（保持拖动 `>8px` 抬手不触发点击离场）；将 `handSprite.center` 设到白手套食指指尖 UV `(0.35, 0.84)`，并直接锚定在目标小猪背部中心上方 `(p.x, 0.62 + lift, p.z)` 随当前相机右向微抬轻按，使 360° 任意旋转视角下引导手指始终精准贴合目标小猪；暴露 `getGuideHandScreen()`。
  - `web/pig-level/{index.html,app.mjs}`、`web/pig-level/3d/*.mjs`、`docs/spec/pig-game-3d.md`、`docs/task/20261124_恢复猪身拖动与引导手势视角跟随.md`、`tests/pig-level-3d.test.js`：统一升级 `?v=20261124d`，同步更新规格/任务文档与端到端测试（第 1 关旋转视角后手势贴合校验、PC/移动端猪身拖动平移校验）。
  - 验证：`npm run test:pig-web`（`119 / 119`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`5 / 5`）全部通过。
- ✅ [2026-11-24] 将最新网页版 `web/pig-level/`（`?v=20261124c`）同步发布至外网 `https://c.aasc.us/mnt/game/pig-game/`
  - 目标路径：`c.aasc.us:/home/as/a/game/pig-game/`；增量上传 9 个变更文件并核验全量 17 个 HTML/CSS/MJS 及 `level-1.json` 远端与公网 HTTPS SHA-256 与本地逐字节一致，HTTP 状态码 `200`。
- ✅ [2026-11-24] 环境面板升级为 3 指针时钟圆盘（季节/天气/24h）、主光源随时间联动并缩短周期、限制第 1 关引导误点与猪身拖动平移，同时下调移动端草叶数量（`?v=20261124c`）
  - `web/pig-level/3d/environment.mjs`：新增 24h 时段 `TIME_SLOTS`（`morning`/`noon`/`evening`/`night`，对应 早/中/晚/夜），昼夜自动循环周期由 600 秒缩短至 90 秒；主平行光位置 `sunLight.position`、`uSunDir`、仰角/色温、月光与星空随 `dayPhase` 连续变化；新增 `setTimeSlot` / `getTimeSlot` / `getDayPhase` / `getSunPosition`（点击时段同步即时刷新光照）。
  - `web/pig-level/3d/holo-ui.mjs`：使用统一 `DIAL_RINGS` / `DIAL_SECTOR_MAP` 配置表将设置面板中的季节、天气与 24h 时段重绘为 3 指针同心时钟圆盘 `clock-dial`（外圈 24h 时段金橙细长针可随天光流动实时转动、中圈天气天蓝中针、内圈季节青绿短粗针，中心表冠切换天光流动/锁定），极坐标拾取同步兼容 `season-*` / `weather-*` / `time-*` 坐标定位。
  - `web/pig-level/3d/view.mjs`：新增 `downOnPig` 按下命中检测，左键/单指在小猪身上按下拖动时不触发相机平移（空白地面拖拽平移与右键/双指旋转缩放保持不变）；接入 `onTimeSlot` 与 `dayPhase` 实时驱动表盘指针，并在 `window.__pig3d` 暴露 `timeSlot` / `dayPhase` / `getSunPosition()` / `setTimeSlot()`。
  - `web/pig-level/app.mjs`：在第 1 关新手引导前两步期间拦截对非引导目标小猪的点击，保持当前步骤并提示“请先点击手势指引的高亮小猪”与触发轻摇提醒；统一升级资源版本号 `?v=20261124c`。
  - `web/pig-level/3d/grass.mjs`：将手机端 `MOBILE_GRASS_COUNTS` 三档草叶数量由 `36000 / 22000 / 12000` 调整为 `8000 / 4000 / 2000`。
  - `docs/spec/pig-game-3d.md`、`docs/task/20261124_时钟圆盘与引导限制及草叶调整.md`、`tests/pig-level-3d.test.js`：同步更新伪代码规格、任务文档、测试用例（验证第 1 关引导拦截、PC/移动端猪身拖动不平移、3 指针时钟圆盘冬雪及早/晚/夜主光源方向联动与移动端草叶数）。
  - 验证：`npm run test:pig-web`（`119 / 119`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`5 / 5`）全部通过。
- ✅ [2026-11-24] 为 3D 结算弹窗补充全屏暗色遮罩与模态点击拦截（`?v=20261124b`）
  - `web/pig-level/3d/holo-ui.mjs`、`web/pig-level/3d/view.mjs`：新增全屏半透明遮罩 `modalBackdrop`（`#2b140c`、`opacity: 0.56`、`renderOrder: 111`）覆盖背景 HUD 与棋盘，弹窗打开时拦截底层误触及滚轮缩放并随重开/切换自动关闭；暴露 `hasModalBackdrop()`。
  - `web/pig-level/{index.html,app.mjs}`、`web/pig-level/3d/*.mjs`、`docs/spec/pig-game-3d.md`、`docs/task/2026-11-24_结算弹窗遮罩.md`、`tests/pig-level-3d.test.js`：同步升级 `?v=20261124b`、更新规格/任务记录并校验遮罩显隐与穿透拦截。
  - 验证：`npm run test:pig-web`（`119 / 119`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`5 / 5`）全部通过。
- ✅ [2026-11-24] 将最新网页版 `web/pig-level/`（`?v=20261124a`）同步发布至外网 `https://c.aasc.us/mnt/game/pig-game/`
  - 目标路径：`c.aasc.us:/home/as/a/game/pig-game/`；增量上传 11 个变更/新增文件（含 `level-1.json`）并核验全量 17 个 HTML/CSS/MJS 及 `level-1.json` 远端与公网 HTTPS SHA-256 与本地逐字节一致，HTTP 状态码 `200`。
- ✅ [2026-11-24] 新增新手第 1 关默认入口并加入 3D/2D 新手点击引导提示（`?v=20261124a`）
  - `web/pig-level/level-1.json`、`web/pig-level/{index.html,app.mjs,style.css}`：新增依据实机截图记录重建的 `4 × 3` 第 1 关（6 只 2 格小猪，6 步通关顺序 `1→5→2→4→6→3`，`victory_verified`），并将首页默认关卡由第 48 关调整为第 1 关；2D 视图同步新增 `.hint-hand` 与 `.guide-banner` 新手提示条。
  - `web/pig-level/3d/{textures,models,holo-ui,view,scenery,environment,grass}.mjs`、`docs/spec/pig-game-3d.md`、`docs/task/2026-11-24_新增第一关及新手引导提示.md`：新增 `handPointer()` 卡通白手套点击手势贴图与 `markers.handSprite` 轻按动画，全息 UI 新增棋盘下方不拦截点击的 `guide-banner` 呼吸提示条（第 1 关前两步及受阻引导），版本号统一升至 `?v=20261124a`。
  - 验证：`npm run test:pig-web`（`119 / 119`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`5 / 5`）全部通过。
- ✅ [2026-11-24] 将最新网页版 `web/pig-level/`（`?v=20261123h`）同步发布至外网 `https://c.aasc.us/mnt/game/pig-game/`
  - 目标路径：`c.aasc.us:/home/as/a/game/pig-game/`；增量上传 10 个变更文件并核验全量 16 个 HTML/CSS/MJS 文件远端与公网 HTTPS SHA-256 与本地逐字节一致，HTTP 状态码 `200`。
- ✅ [2026-11-24] 提高夏季草地、草坪地面与远景丘陵饱和度（`?v=20261123h`）
  - `web/pig-level/3d/presets.mjs`：`SEASON_BASE.summer` 调整为 `grassRoot: '#3ea824'`、`grassTip: '#8ee632'`、`lawn: '#62cb34'`、`ground: '#48ac26'`、`hillColor: '#52b832'`。
  - `web/pig-level/{index.html,app.mjs}`、`web/pig-level/3d/*.mjs`、`docs/spec/pig-game-3d.md`：同步升级 `?v=20261123h` 与夏季预设伪代码规格。
  - 验证：`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`5 / 5`）全部通过。
- ✅ [2026-11-23] 将最新网页版 `web/pig-level/`（`?v=20261123g`）同步发布至外网 `https://c.aasc.us/mnt/game/pig-game/`
  - 目标路径：`c.aasc.us:/home/as/a/game/pig-game/`；增量上传 10 个变更文件并核验全量 16 个 HTML/CSS/MJS 文件远端与公网 HTTPS SHA-256 与本地逐字节一致，HTTP 状态码 `200`。
- ✅ [2026-11-23] 修复手机双指旋转视角后全息 UI 消失隐患并升级资源版本（`?v=20261123g`）
  - `web/pig-level/3d/holo-ui.mjs`：取消正交 HUD `root.rotation.y` 偏航倾斜（防止旋转视角后在移动端被裁剪或触发着色器异常），扩展 `uiCam` 纵深至 `[-1000, 1000]`、开启 `DoubleSide` 与 `frustumCulled = false`，将默认 `uClipRect` 收敛为 `[-32000, 32000]` 兼容移动端 GLSL ES `mediump float`，并在 `resize()` 时重绘当前状态纹理、对 `update(dt, time)` 做 `Number.isFinite` 守卫。
  - `web/pig-level/3d/post.mjs`、`web/pig-level/3d/view.mjs`：`applyTier()` 切档时同步调用 `renderer.setSize()`，`low` 档 `renderScene()` 渲染前显式 `renderer.clear()`；`fitCamera()` 保留 `panOffset`、补充 `orientationchange` / `visualViewport` 监听，并对双指捏合旋转 `dx/dAngle/ratio` 做有限值校验；同步更新 `?v=20261123g`、规格与测试。
  - 验证：`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`5 / 5`）全部通过。
- ✅ [2026-11-23] 将最新网页版 `web/pig-level/`（`?v=20261123f`）同步发布至外网 `https://c.aasc.us/mnt/game/pig-game/`
  - 目标路径：`c.aasc.us:/home/as/a/game/pig-game/`；增量上传 9 个变更文件并核验全量 16 个 HTML/CSS/MJS 文件远端与公网 HTTPS SHA-256 与本地逐字节一致，HTTP 状态码 `200`。
- ✅ [2026-11-23] 实现 PC 右键/滚轮鼠标地面射线点锚定及手机双指比例中心旋转缩放并优化惯性手感、取消双击地面复位（`?v=20261123f`）
  - `web/pig-level/3d/view.mjs`：新增独立探测相机 `probeCam`、`pivotMode`（`none`/`spin`/`wheel`）与 `pickGroundAt()` / `pickGroundTarget()` / `lockPivotToScreen()` 解析闭合反解辅助函数：PC 右键旋转围绕按下处地面射线交点，PC 滚轮缩放锁定光标下方地面交点并清空残余自转速度；手机双指旋转与捏合缩放实时围绕两指比例中心对应地面点；渲染帧 `frame()` 按当前姿态同步反解 `panOffset`（放宽至 `[-28, 28]`）消除过渡弦线漂移，大幅收紧旋转惯性（最大角速度 `7.5 -> 2.6 rad/s`、阻尼 `3.8 -> 8.5/s`、松手停顿 `>45ms` 清零），并移除 `dblclick` 监听以取消点击地面复位（保留 `V` 键与全息复位按钮）。
  - `web/pig-level/{index.html,app.mjs}`、`web/pig-level/3d/*.mjs`、`docs/spec/pig-game-3d.md`、`docs/task/2026-11-23_鼠标及双指中心旋转缩放.md`、`tests/pig-level-3d.test.js`：同步升级 `?v=20261123f`、修复 `index.html` 多余闭合标签、更新规格文档、任务记录与 PC/移动端偏心锁点精准度校验。
  - 验证：`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`5 / 5`）全部通过。
- ✅ [2026-11-23] 将最新网页版 `web/pig-level/`（`?v=20261123d`）同步发布至外网 `https://c.aasc.us/mnt/game/pig-game/`
  - 目标路径：`c.aasc.us:/home/as/a/game/pig-game/`；核验全量 HTML/CSS/MJS 文件远端与公网 HTTPS SHA-256 与本地逐字节一致，HTTP 状态码 `200`。
- ✅ [2026-11-23] 改为双指 360° 无极滑动/拧转旋转与缩放高度自动计算俯仰角（`?v=20261123d`）
  - `web/pig-level/3d/view.mjs`：去掉 `targetYaw` 的 `±0.62` 限制并加入 `applySpin()` / `yawVel` 指数阻尼惯性滑行（按下或复位立即刹停，`resetCamera()` 按 `[-π, π]` 就近回正）；`pinchInfo()` 记录两指角度，双指仅控制垂直轴无极旋转（扭转 `dAngle` 解卷绕 + 纯平行横滑补充）与捏合缩放，不再由 `dy` 手动拉俯仰；新增 `autoPitchForZoom(z)` 让缩放高度自动计算俯仰角（`0.58~1.24 rad`）；双指先后抬指回 1 指时同步残余手指坐标防止镜头瞬移与误点。
  - `web/pig-level/{index.html,app.mjs}`、`web/pig-level/3d/*.mjs`、`docs/spec/pig-game-3d.md`、`docs/task/2026-11-23_双指无极旋转与自动俯仰.md`、`tests/pig-level-3d.test.js`：同步升级 `?v=20261123d`、伪代码规格、任务文档与双指无极拧转/惯性/自动俯仰测试。
  - 验证：`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`5 / 5`）全部通过。
- ✅ [2026-11-23] 将最新网页版 `web/pig-level/`（`?v=20261123c`）同步发布至外网 `https://c.aasc.us/mnt/game/pig-game/`
  - 目标路径：`c.aasc.us:/home/as/a/game/pig-game/`；核验全量 HTML/CSS/MJS 文件远端与公网 HTTPS SHA-256 与本地逐字节一致，HTTP 状态码 `200`。
- ✅ [2026-11-23] 优化默认镜头内圈棋盘填满适配并将手机端草叶每档降一档（`?v=20261123c`）
  - `web/pig-level/3d/view.mjs`：`fitCamera()` 贴合内圈棋盘实际边界（`hw = cols/2 + 0.15`、`hh = rows/2 + 0.15`、`y = 0..0.92`），横屏以安全区高度 `safeH * 0.96`、竖屏以透视前边宽度 `safeW * 0.96` 为基准填满并迭代精准居中 `baseLookTarget`；暴露 `getBoardScreenBounds()` 与 `getGrassCount()`。
  - `web/pig-level/3d/grass.mjs`：新增 `grassCountForTier()` 查表映射，桌面端维持 `140000 / 36000 / 22000`，手机端每档往下降一档为 `36000 / 22000 / 12000`（软光栅 `1500`）。
  - `web/pig-level/{index.html,app.mjs}`、`web/pig-level/3d/*.mjs`、`docs/spec/pig-game-3d.md`、`docs/task/2026-11-23_镜头填满适配与手机草叶降档.md`、`tests/pig-level-3d.test.js`：统一升级 `?v=20261123c`、同步伪代码与任务记录，并补充镜头占满率与手机草叶数量校验。
  - 验证：`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`5 / 5`）全部通过，横/竖屏实景截图居中填满。
- ✅ [2026-11-23] 将最新网页版 `web/pig-level/`（`?v=20261123b`）同步发布至外网 `https://c.aasc.us/mnt/game/pig-game/`
  - 目标路径：`c.aasc.us:/home/as/a/game/pig-game/`；核验全量 HTML/CSS/MJS 文件远端与公网 HTTPS SHA-256 与本地逐字节一致，HTTP 状态码 `200`。
- ✅ [2026-11-23] 反转 PC/移动端镜头拖拽交互并修复局域网 HTTP 桌面端高画质默认判定（`?v=20261123b`）
  - `web/pig-level/3d/view.mjs`：将 PC 左键/手机单指拖拽改为 `applyPan` 平移视角（`<= 8px` 轻点仍正常选中 UI/小猪），PC 右键与手机双指中心拖动改为旋转视角（`targetYaw` / `targetPitch`），同时保留双指捏合缩放与右键弹窗拦截；新增 `window.__pig3d.getCameraState()`。
  - `web/pig-level/3d/post.mjs`：`detectInitialTier()` 对非移动端多核（`cores > 4`）且浏览器在非 HTTPS 下隐藏 `navigator.deviceMemory` 的情况按 `8GB` 回退，避免 `http://192.168.x.x` 桌面端默认误降至 `medium`。
  - `web/pig-level/{index.html,app.mjs}`、`web/pig-level/3d/*.mjs`、`docs/spec/pig-game-3d.md`、`docs/task/2026-11-23_反转镜头拖拽与局域网高画质适配.md`、`tests/pig-level-3d.test.js`：同步升级 `?v=20261123b`、伪代码规格、任务文档与 PC/手机拖拽手势校验。
  - 验证：`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`4 / 4`）全部通过。
- ✅ [2026-11-23] 修复 3D 结算弹窗按钮与文字重叠，并为关卡滑动列表增加像素级遮罩（`?v=20261123a`）
  - `web/pig-level/3d/holo-ui.mjs`：`modalBg` 改为自适应宽高并划分上下文字/按钮分区与分隔线，消除按钮顶部压住副标题的问题；`h <= 34` 双行徽章（如 `第 118 关 / 自由试玩`）拉开上下行距，`settingsBg` 增加矮屏防溢出约束；在 `CARTOON_VERT` / `CARTOON_FRAG` 新增 `uSelfRect`、`uClipRect` 与 `uClipFeather`（`6px` 渐隐），配合 `pickerBg` 圆角凹槽底板、5 行平滑缓冲及 `hitWidget` 遮罩区间命中限制，解决滑动穿帮并支持平滑裁剪进出。
  - `web/pig-level/style.css`、`web/pig-level/{index.html,app.mjs}`、`web/pig-level/3d/*.mjs`：补充窄屏 `.win-card` 弹性间距，静态资源版本号统一升至 `?v=20261123a`。
  - `docs/spec/pig-game-3d.md`、`docs/task/2026-11-23_修复弹窗按钮重叠与关卡列表遮罩.md`、`tests/pig-level-3d.test.js`：同步伪代码规格、任务记录与第 46 关胜利弹窗间距/关卡列表半行滚动遮罩验收测试。
  - 验证：`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`4 / 4`）全部通过；PC `1280×720` 与手机 `390×844@2x` 实景截图 `0` 报错，弹窗图文分离、列表遮罩滑动自然。
- ✅ [2026-11-22] 基于外网原版底座叠加远景雾化、5 瓣星形花、鲜艳红提示贴花与切窗防误降档（`?v=20261122o`）
  - `web/pig-level/3d/{environment,scenery,grass}.mjs`：`environment.mjs` 暴露 `getHorizonColor()`；`scenery.mjs`（`groundMat`/`lawnMat`）与 `grass.mjs` 在 `20.0~36.0` 范围按 `uHorizonColor` 做柔和低饱和空气透视雾化；`scenery.mjs` 保留外网花朵数量上限（`1800 / 900 / 420`）与山丘正弦聚簇分布，并将 `high/medium` 升级为 8 顶点交叉双面 5 瓣星形花面片（`high` 带微风摆动、`low` 保持圆片），同步贴合丘陵高度。
  - `web/pig-level/3d/{textures,models}.mjs`：新增手绘 `flowerSprite()`；`hintDecal()` 改为高饱和鲜艳红（`#ff2432` / `#ff5454`）环形光晕与角标，`models.mjs` `bodyDecalMat` 补全 `#include <tonemapping_fragment>` 与 `#include <colorspace_fragment>`。
  - `web/pig-level/3d/{post,view,holo-ui}.mjs`、`web/pig-level/{app.mjs,index.html}`：`post.mjs` 改为跳过首轮窗口并需连续 2 个统计周期（约 5 秒）`< 38fps` 才降档，`view.mjs` 在 `visibilitychange` / `focus` / `blur` 时调用 `resetFpsMonitor()` 防切换窗口误降档，所有静态资源版本号统一升至 `?v=20261122o`。
  - `tests/pig-level-3d.test.js`、`docs/spec/pig-game-3d.md`、`docs/design/pig-game-3d-scene-polish.md`、`docs/task/2026-11-22_猪了个猪3D场景画面美化.md`：同步伪代码规格、设计/任务记录与连续两周期降档单测。
  - 验证：`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`4 / 4`）全部通过，零控制台/页面报错；独立 GPU Chromium 实景截图核验 PC `1360×820` `high` 档与手机竖屏 `390×844@2x` `medium` 档渲染正常。
- ✅ [2026-11-22] 将 3D 场景及网页代码完全还原为外网版本（`?v=20261122c`）
  - `web/pig-level/{index.html,app.mjs,style.css,engine.mjs}` 与 `web/pig-level/3d/*.mjs`：全部恢复至与外网 `https://c.aasc.us/mnt/game/pig-game/` 完全一致（逐文件 `diff -q` 零差异），取消前述雾化、池塘、星形花面片、夏天改色、去掉底椭圆、默认 78° 俯角与取消双击复位等改动。
  - `tests/pig-level-3d.test.js`、`docs/spec/pig-game-3d.md`、`docs/design/pig-game-3d-scene-polish.md`、`docs/task/2026-11-22_猪了个猪3D场景画面美化.md`：同步回退测试断言与文档记录。
  - 验证：`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`3 / 3`）全部通过，零控制台/页面报错。
- ✅ [2026-11-22] 3D 场景整体回归外网原版为主并保留雾化、池塘、当前花朵模型与夏天草色，同步最俯视默认视角与取消双击地板复位（`?v=20261122n`）
  - `web/pig-level/3d/{presets,textures,models,scenery,grass,environment,post}.mjs`：整体回退为外网版本光照、天气、后期、草地不均匀分布（`140k / 36k / 22k`、棋盘内 `28%`、叶宽 `0.072`）与卵石/栅栏/树木构图，保留并融合：① `scenery.mjs` 与 `grass.mjs` 20～36 格远景雾化（`aerial`）；② 左下角渐变荷花池塘及环境抽屉「池塘」本地开关；③ 花采用外网分布（`1800 / 900 / 420` 环形聚集并避开池塘）搭配现在的 5 瓣星形交叉面片模型（`high` 档风摆、`low` 档圆片）；④ 保持去掉猪底部暗椭圆且猪体受光跟随真实 `sunDir`；⑤ `SEASON_BASE.summer` 保留当前草地与草叶配色（`grassRoot: #61a843`、`grassTip: #94cc56`、`lawn: #94d762`、`ground: #64ab46`、`hillColor: #6bb44d`）。
  - `web/pig-level/3d/{view,holo-ui}.mjs`、`app.mjs`、`index.html`：`DEFAULT_PITCH` 调整为最俯视 `1.36`（约 `78°`）并改进 `fitCamera()` 按 `holoUI` 安全边距校验全棋盘角点完整入镜；移除画布 `dblclick` 监听以去掉点击/双击地板触发的相机复位（保留「视角复位」按钮与 `V` 键）；环境设置抽屉精简为只保留「池塘」开关；统一递增模块版本号至 `?v=20261122n`。
  - `tests/pig-level-3d.test.js`、`docs/spec/pig-game-3d.md`、`docs/design/pig-game-3d-scene-polish.md`、`docs/task/2026-11-22_猪了个猪3D场景画面美化.md`：同步更新预设/池塘开关/双击不复位校验及设计实现文档。
  - 验证：`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`3 / 3`）全部通过；`DISPLAY=:0` 独立硬件 GPU Chromium 实景截图核验第 48 关春晴、第 48 关夏晴、第 70 关秋晴、第 100 关冬雪竖屏（`390×844`）与第 61 关铁笼关卡（全部 `medium` 档 `60fps`，`0` 报错，全内棋盘完整入画）。
- ✅ [2026-11-22] 精准还原外网春晴草地与草叶色度并新增草叶菲涅尔天光边缘反光（`?v=20261122m`）
  - `web/pig-level/3d/post.mjs`、`environment.mjs`、`scenery.mjs`：将后期 `uSaturation` 调回 `1.0`、`uSplitStrength` 设为 `0.0`；晴天 `hemiLight` 恢复纯净 `#fff7e8` 且不叠加 `rimLight` 洗亮平地（仅阴雨/黄昏轻度介入）；统一将云影区间收拢至 `mix(0.82, 1.02, ...)`。
  - `web/pig-level/3d/grass.mjs`：移除 `hueShift` 还原外网草叶原色与 `vTint > 0.87` 麦草比率，叶片晴天保持 `1.0` 原色基准、阴雨/冬雪/笼夜随 `uGroundLight` 等比联动而草根（`vY<=0.05`）仍严格对齐地面；在 `vY > 0.18` 叠加菲涅尔天光边缘反光 `rim`（`pow(1 - ndv, 3)`，雨湿增强、阴影削弱）。同步更新 `docs/spec/pig-game-3d.md`、`docs/design/pig-game-3d-scene-polish.md`、`docs/task/2026-11-22_猪了个猪3D场景画面美化.md` 及入口 `?v=20261122m`。
  - 验证：`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`3 / 3`）全部通过；独立硬件 GPU Chromium（`DISPLAY=:0`）实景对比第 48 关春晴与外网右侧草区均值基本重合（`HSV 85.3° / S 47.0%` vs 外网 `HSV 85.5° / S 46.1%`），并核验春阴、春雨、秋晴、冬雪与第 61 关铁笼月夜（均为 `medium` 档 `60fps`，`0` 报错）。
- ✅ [2026-11-22] 恢复外网春天草色并统一全季节×全天气草根与地面无缝过渡（`?v=20261122l`）
  - `web/pig-level/3d/presets.mjs`：恢复 `SEASON_BASE.spring` 外网草地与地面原色（`grassRoot: #74bf54`、`grassTip: #b4e36e`、`lawn / lawnLit: #96d462`、`ground: #78c252`、`hillColor: #7cc458`）。
  - `web/pig-level/3d/environment.mjs`：按 Three.js `MeshToonMaterial` 水平地表（`N=(0,1,0)`）受光公式累加太阳、月光、轮廓光与半球天光生成权威 `groundLight`，随 `getAtmosphere()` 下发至草地着色器。
  - `web/pig-level/3d/scenery.mjs` & `grass.mjs`：统一 `scCloud` 区间为 `0.72..1.10`；草根（`vY<=0.05`）直接匹配地面/草坪线性纹理均值与占格 AO，在 `vY=0.05..0.35` 渐入单株色相、15% 麦穗、亮斑、湿润反光与雪尖，消除阴雨/冬雪/笼夜下的草根接缝与亮斑断层。
  - `web/pig-level/3d/post.mjs`：减弱冷暖分离强度（`uSplitStrength: 0.12 → 0.06`）并仅作用于暗部，同步更新 `docs/spec/pig-game-3d.md`、`docs/design/pig-game-3d-scene-polish.md`、`docs/task/2026-11-22_猪了个猪3D场景画面美化.md` 与 `?v=20261122l`。
  - 验证：`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`3 / 3`）全部通过；独立硬件 GPU Chromium（`DISPLAY=:0`）实景截图核验第 48 关春晴/春阴/春雨、第 70 关秋晴、第 100 关冬雪及第 61 关铁笼月夜（均为 `medium` 档 `60fps`，`0` 报错）。
- ✅ [2026-11-22] 猪了个猪 3D 场景美化设计稿补充阴天/雨天降光设定（仍只做设计，未改代码）
  - `docs/design/pig-game-3d-scene-polish.md` 与任务文档：下调 `WEATHER_BASE` 阴天（`sunIntensity 1.4→1.05`、`hemiIntensity 1.06→0.88`）与雨天（`sunIntensity 1.08→0.78`、`hemiIntensity 1.02→0.82`）光照强度，拉开晴/阴/雨明暗氛围并突出雨天暖窗与闪电对比。
- ✅ [2026-11-22] 移除猪底部暗椭圆接触阴影贴片（`?v=20261122k`）
  - `web/pig-level/3d/models.mjs`：移除 `shadowGeo`、`shadowMat` 与 `createActor()` 中的 `shadowMesh`，统一由实时太阳阴影贴图和棋盘占格 AO 表现接触暗部，画面更清爽且减少约百个 draw call；同步更新 `docs/spec/pig-game-3d.md`、`docs/design/pig-game-3d-scene-polish.md` 与 `?v=20261122k`。
  - 验证：`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`3 / 3`）全部通过；独立硬件 GPU Chromium 实景核验第 48 关春晴截图（`medium` 档 `60fps`，`0` 报错）。
- ✅ [2026-11-22] 提高春天草地与地面明度（`?v=20261122j`）
  - `web/pig-level/3d/presets.mjs`、`grass.mjs`、`scenery.mjs`：将 `SEASON_BASE.spring` 提亮至 `grassRoot: #84cf62`、`grassTip: '#c5ee7f'`、`ground: '#86ce60'`、`lawn / lawnLit: '#a6df74'`、`hillColor: '#8ad066'`，保持草根与地面无缝衔接；同步更新 `docs/spec/pig-game-3d.md`、`docs/design/pig-game-3d-scene-polish.md` 与 `?v=20261122j`。
  - 验证：`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`3 / 3`）全部通过；独立硬件 GPU Chromium 实景核验第 48 关春晴截图（`medium` 档 `60fps`，`0` 报错）。
- ✅ [2026-11-22] 春、秋、冬三季草色恢复外网原版配色（`?v=20261122i`）
  - `web/pig-level/3d/presets.mjs`、`grass.mjs`、`scenery.mjs`：恢复外网版本春（`#74bf54 → #b4e36e` / `lawnLit #96d462` / `ground #78c252`）、秋（`#c8a85a → #f0cf72` / `lawnLit #dfc274` / `ground #c6a65c`）、冬（`#9cb5aa → #f6fafc` / `lawnLit #ebf3f7` / `ground #e2ecf2`）三季草色与地面/草坪配色，保留 54k 草叶密度、根部无缝融合与阴雨降亮效果；同步更新 `docs/spec/pig-game-3d.md`、`docs/design/pig-game-3d-scene-polish.md` 与 `?v=20261122i`。
  - 验证：`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`3 / 3`）全部通过；独立硬件 GPU Chromium 实景核验第 48 关春晴、第 70 关秋晴与第 100 关冬雪竖屏（`medium` 档 `60fps`，`0` 报错）。
- ✅ [2026-11-22] 调低春天草地饱和度至柔和水粉嫩绿（`?v=20261122h`）
  - `web/pig-level/3d/presets.mjs`、`grass.mjs`：将 `SEASON_BASE.spring` 调整为 `grassRoot: #72a85f`、`grassTip: #a1c776`、`ground: #72a75e`、`lawn / lawnLit: #a0cb7d / #a2cc80`、`hillColor: #78ac65`，去掉偏荧光感同时保持草根与地面无缝衔接；同步更新 `docs/spec/pig-game-3d.md`、`docs/design/pig-game-3d-scene-polish.md` 与 `?v=20261122h`。
  - 验证：`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`3 / 3`）全部通过；独立硬件 GPU Chromium 实景核验第 48 关春晴截图（`medium` 档 `60fps`，`0` 报错）。
- ✅ [2026-11-22] 提升草地密度、根部融合度与色彩层次（`?v=20261122g`）
  - `web/pig-level/3d/grass.mjs`、`presets.mjs`：`medium` 档草叶增至 `54,000`、`low` 档增至 `28,000`（`high` `140,000`），棋盘内占草比例收至 `16%` 并将草叶基底加宽至 `0.082`；移除草叶整体 `* 0.82` 压暗，改为草根（`vY=0`）直接衔接 `uGroundColor` / `uLawnColor` 实现与地面/草坪无缝融合；中上段加入青翠 ↔ 暖嫩绿单株色相变化与 15% 金色麦草秆，并在不过曝前提下恢复大尺度暖阳/冷荫斑块对比；同步更新 `docs/spec/pig-game-3d.md` 与 `?v=20261122g`。
  - 验证：`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`3 / 3`）全部通过；独立硬件 GPU Chromium 实景核验第 48 关春晴与春雨截图（`medium` 档 `60fps`，`0` 报错），草根自然融入地面、草丛饱满且色差丰富。
- ✅ [2026-11-22] 下调草地整体亮度并修正猪受光面与投影方向一致（`?v=20261122f`）
  - `web/pig-level/3d/models.mjs`、`environment.mjs`、`view.mjs`：修复 `models.mjs` 中 `uLightDir` 硬编码为 `(-0.74, 0.44, 0.50)` 与太阳方向 `+X` 相反的问题，改为通过 `environment.getAtmosphere().sunDir` 实时同步主太阳方向，使猪体受光面与地面/树木投影方向一致。
  - `web/pig-level/3d/grass.mjs`、`presets.mjs`：草叶整体乘以 `0.82` 降亮、收拢 `patchTint`/`cloud` 亮斑上限（`1.05`/`1.04`）并随阴雨天 `uAmbientScale` 自动减弱晒亮斑块；同步微调四季 `grassRoot`/`grassTip` 色阶并更新 `docs/spec/pig-game-3d.md`、递增 `?v=20261122f`。
  - 验证：`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`3 / 3`）全部通过；独立 Chromium 实景截图核验第 48 关春晴/春阴/春雨，草地亮度柔和、猪亮面与投影方向一致且 `0` 报错。
- ✅ [2026-11-22] 下调阴雨天环境光与着色器同步（`?v=20261122e`）
  - `web/pig-level/3d/presets.mjs`、`environment.mjs`：阴天调整为 `sunIntensity: 0.85 / hemiIntensity: 0.54 / ambientScale: 0.80`，雨天调整为 `0.58 / 0.44 / 0.68`（晴天 `1.0`、雪天 `0.94`），并在天气过渡时平滑插值 `ambientScale`。
  - `web/pig-level/3d/grass.mjs`、`models.mjs`、`scenery.mjs`、`view.mjs`、`app.mjs`、`index.html`：草叶、小猪材质与花朵同步接入 `ambientScale`（猪体保留轮廓光确保可读），并同步更新 `docs/spec/pig-game-3d.md`、`docs/design/pig-game-3d-scene-polish.md`、`tests/pig-level-3d.test.js`。
  - 验证：`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`3 / 3`）全部通过，独立 Chromium 实景截图核验第 48 关春阴与春雨亮度渐变自然、`0` 报错。
- ✅ [2026-11-22] 完成猪了个猪 3D 场景画面美化实现与验收
  - 先更新 `docs/spec/pig-game-3d.md` 伪代码，随后完成 `web/pig-level/3d/{presets,textures,models,scenery,grass,environment,post,holo-ui,view}.mjs` 及 `app.mjs`、`index.html`、`tests/pig-level-3d.test.js` 修改，并统一递增入口与更新模块版本号至 `?v=20261122d`。
  - 主要改动：棋盘贴地圆角原木框 + 冬季雪檐 + 下沉暖土带与碎卵石；棋盘淡格线与动态猪间占格 AO；6 组微调色差猪材质 + 暖白 Fresnel 轮廓光 + 接触软阴影放大加深；花按画质分档（high 摆动花带 1100 / medium 静止花带 560 / low 收紧散花 420）+ 近环灌木团；加粗栅栏 + 冬/夜暖色灯串；左下渐变荷花池塘；平滑树冠内收与树下季节贴花；木屋暖窗自发光与地面光斑；远景剪影林线与距离色彩透视；阴天（`sun 1.05 / hemi 0.88`）与雨天（`sun 0.78 / hemi 0.82`）降光；铁笼关月夜蓝紫基调、加粗笼杆与 `steelGlow` 发光计数牌；逆光轮廓灯与后期有效饱和度（`1.08`）/冷暖分色/中档柔光（`0.10`）/高档水粉纸纹；环境抽屉新增 4 个本地 `localStorage` 装饰开关。
  - 验证结果：`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）、`npm run test:pig-3d`（`3 / 3`）全部通过；并在 `DISPLAY=:0` 独立硬件 GPU Chromium 下核验第 48 关春晴/雨天、第 70 关秋晴、第 61 关铁笼月夜、第 100 关冬雪竖屏实景截图（`medium` 档 `60fps`，`0` 报错）；已从 `docs/todo.md` 移除已完成条目。
- ✅ [2026-11-22] 猪了个猪 3D 场景美化设计稿完成定稿（只做设计，未改代码）
  - 确认最终一项待定项：默认镜头俯角先不降（保持现状约 52°，仅预留 `DEFAULT_PITCH` 常量便于后续调整）。4 项需求已全部落盘至 `docs/design/pig-game-3d-scene-polish.md`、`docs/task/2026-11-22_猪了个猪3D场景画面美化.md`、`docs/design.md` 与 `docs/todo.md`（标记为待实现）。
- ✅ [2026-11-22] 猪了个猪 3D 场景美化设计稿补充需求确认（仍只做设计）
  - `docs/design/pig-game-3d-scene-polish.md`：棋盘改为不抬高，用贴地木框和下沉土带区分边界；花按画质分档（high/medium 用花带，low 用收紧散花）；新增“装饰”开关（池塘/灯串/花带灌木/远景林线，存 `localStorage`，不走远端配置）；默认俯角仍待确认。同步更新 task 文档与 `docs/todo.md`。
- ✅ [2026-11-22] 完成猪了个猪 3D 场景画面美化设计稿（只做设计，未改代码）
  - 新增 `docs/design/pig-game-3d-scene-polish.md`（8 项现状问题诊断、季节色板、L0～L4 分层构图、光照与后期、季节/天气/铁笼月夜专项、档位性能预算、验收标准）和 `docs/task/2026-11-22_猪了个猪3D场景画面美化.md`；`docs/design.md` 增加索引，`docs/todo.md` 增加待确认实现项。
  - 依据：本地 Chromium 截取第 48/70/61/100 关现状画面，并生成春季晴天与冬季黄昏概念参考图。
- ✅ [2026-11-22] 修复冬季积雪草叶未参与阴影计算的问题
  - 修复 `web/pig-level/3d/grass.mjs` 片元着色器执行顺序：此前冬季草尖积雪（`uSnow`）在方向光与云影之后覆盖为纯白导致约 85% 阴影被抵消；现将 `uSnow` 与 `uWet` 移至 `shadowK` 云影和 5 点 PCF 太阳阴影之前融合，使冬季雪草同样清晰呈现树影、木屋与栅栏冷青投影，并同步递增 `?v=20261122c` 模块版本参数。
  - 验证与发布：`npm run test:pig-3d`（`3 / 3`）、`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）全部通过；已在 `DISPLAY=:0` 独立 Chromium 核验第 113 关冬季雪草投影截图与公网 `https://c.aasc.us/mnt/game/pig-game/?level=113&weather=sunny` 3D 加载（`0` 报错，SHA-256 一致）。
- ✅ [2026-11-22] 深化草地阴影线性压暗与丘陵贴合，并统一 ES 模块版本参数彻底消除外网缓存错配
  - 草地阴影深化与地形贴合（`web/pig-level/3d/geometry.mjs`、`scenery.mjs`、`grass.mjs`）：抽出共享地形高度函数 `groundHeight()`，为草地增加 `aBaseY` 使外围丘陵草叶与树木贴合坡面不再埋地；草地阴影片元改用 `bias=0.0009`、5 点 PCF 采样与匹配地面的线性阴影倍率 `vec3(0.22, 0.30, 0.38)`，实测树影内草叶均色压暗至 `[55, 116, 53]`（受光草叶 `[150, 183, 103]`）。
  - 修复外网 ES 模块旧缓存报错（`index.html`、`app.mjs`、`3d/*.mjs`）：为入口与全部内部 `.mjs` 导入统一附加 `?v=20261122b` 版本号，解决浏览器旧缓存 `geometry.mjs` 缺少 `shadeGradient` 导出导致回退 2D 的问题。
  - 验证与发布：`npm run test:pig-3d`（`3 / 3`）、`npm run test:pig-web`（`118 / 118`）、`npm run test:pig-animation`（`1 / 1`）全部通过；已同步至 `https://c.aasc.us/mnt/game/pig-game/` 核验 SHA-256 一致，且独立 Chromium 实测公网与局域网 `192.168.1.39` 3D 加载均 `0` 报错。
- ✅ [2026-11-22] 强化猪头渐变与饱和度、修复手机端 HiDPI 分辨率模糊，并为草地接入实时阴影采样
  - 猪头渐变与饱和度（`web/pig-level/3d/geometry.mjs`、`models.mjs`）：新增 `shadeGradient()` 并在 `mergeParts()` 中保留部件顶点色，将猪头着色由单色升级为下颌深珊瑚红（`#d9635e`）→ 额顶暖蜜桃（`#faafa6`）渐变，同步加深躯干/鼻筒/腮红/双耳饱和度，并在 `toonMat` 叠加 `wrapGrad` 曲率渐变。
  - 手机端高分屏清晰度（`web/pig-level/3d/post.mjs`、`holo-ui.mjs`）：移除高像素手机降为 `low` 的限制，并通过 `computePixelRatio()` 在 `high`/`medium`/`low` 档分别保持 `2.5x`/`2.0x`/`1.75x` DPR 上限；`holo-ui.mjs` 文本画布最高采用 `3x` 采样，消除手机端退化为 `1x` 的模糊感。
  - 草地实时阴影采样（`web/pig-level/3d/environment.mjs`、`grass.mjs`、`view.mjs`）：`environment.mjs` 暴露主太阳方向光阴影贴图与矩阵，草地着色器通过 4 点 PCF 采样 `uShadowMap`，使树木、木屋、栅栏与小猪阴影直接投射并压暗草叶（冷青阴影 `mix(1.0, [0.54,0.64,0.72])`）。
  - 验证与发布：`npm run test:pig-3d` `3 / 3`、`npm run test:pig-web` `118 / 118`、`npm run test:pig-animation` `1 / 1` 全部通过（含移动端 `390×844@2x` 画布 `780×1688` 与实景截图核验）；已 `rsync` 发布至 `https://c.aasc.us/mnt/game/pig-game/` 并核对核心文件 SHA-256 一致。
- ✅ [2026-11-22] 拉开晴天光照亮暗反差、修复眨眼眼球定位与列表背景 Hover、增强关卡列表惯性、新增小鸭逃出动画与计时炸弹实时倒计时
  - 光照亮暗反差（`web/pig-level/3d/{models,textures,presets,environment,scenery,grass}.mjs`）：`toonMat` 改为侧前斜射双阶水粉着色（亮部 `1.16` + 高光阶、暗部暖玫瑰可可 `vec3(0.48, 0.38, 0.45)`、接触阴影 `0.38`），压深 `gradient3` 四阶暗部，晴天 `sunIntensity=2.55`、`hemiIntensity=0.58`（`groundColor #5a7d3e`），`camBound` 扩至 `22` 并为全部树冠开启 `castShadow/receiveShadow`，草地增加大尺度暖光区（`1.16`）与云影冷区（`0.72`）层次。
  - 细节与机制完善：
    - `web/pig-level/3d/models.mjs`：猪眼改为以眼窝中心 `Y=0` 为局部原点构建并整体偏移 `eyeMesh.position.y`，彻底修复眨眼压扁时眼球掉出头部的问题。
    - `web/pig-level/3d/holo-ui.mjs`：关卡列表拖动启用指数平滑初速度累加（`×52`）与低阻尼长惯性衰减（`pow(0.24, dt)`），滚轮叠加惯性；禁用 `pickerBg` 与 `card` 类底板的 hover 变色与缩放。
    - `web/pig-level/3d/view.mjs`：小鸭离场时通过空格 BFS 寻路生成至棋盘边缘外路径，播放蹦跳摇摆跑出、压草与尾迹粒子动画；炸弹归零爆炸准确落位在对应炸弹小猪位置。
    - `web/pig-level/app.mjs`：新增计时炸弹每秒倒计时（`1000ms` tick），归零触爆失败，撤回保底恢复至少 15 秒；最后 10 秒炸弹球体脉冲闪烁提示。
  - 验证与发布：`npm run test:pig-3d` `3 / 3`、`npm run test:pig-web` `118 / 118`、`npm run test:pig-animation` `1 / 1` 全部通过（在 `DISPLAY=:0` 独立 Chromium 实测第 48 关晴天明暗对比、第 113 关冬晴倒计时 `79->77`、第 63 关小鸭逃出动画及眼位偏移）；已 `rsync` 同步至 `https://c.aasc.us/mnt/game/pig-game/` 并核对 12 个核心文件 SHA-256 一致。
- ✅ [2026-11-21] 修复 3D 后期渲染色彩空间过饱和与草叶根部偏暗，并切换至 `DISPLAY=:0` 独立硬件 GPU Chromium（DebugPort `9333`）验证发布
  - 修复 `web/pig-level/3d/post.mjs` 的 `quadMat` 缺少 `#include <tonemapping_fragment>` 与 `#include <colorspace_fragment>` 导致的线性颜色直出过饱和与暗部压深；将饱和度倍增回归 `1.0`、对比度微调柔和化为 `0.08`，并调整桌面端硬件 GPU 2 核设备默认运行于 `medium`（阴影 + 后期、`pixelRatio=1`）。
  - 同步调整 `web/pig-level/3d/presets.mjs`、`web/pig-level/3d/grass.mjs` 与 `web/pig-level/3d/view.mjs`：提亮草叶根部 `grassRoot`（春 `#74bf54` / 夏 `#68b84c` / 秋 `#c8a85a` / 冬 `#9cb5aa`）、着色器渐变从 `0.25` 起跳并提高云影/色块暗部下限至 `0.93~0.94`，曝光调为 `1.04`、`sunny` 主光 `1.85`、`medium` 草叶数调优为 `36000`。
  - 更新 `tests/pig-level-3d.test.js`：禁用 SwiftShader 软光栅且不复用 `9222`，自动检索 `/tmp/xauth_*` 在 `DISPLAY=:0` 启动独立 `/usr/bin/chromium`（DebugPort `9333`）验证硬件 GPU 渲染。
  - 验证与发布：`npm run test:pig-3d` `3 / 3`、`npm run test:pig-web` `118 / 118`、`npm run test:pig-animation` `1 / 1` 全部通过；独立 Chromium 实测为 `ANGLE (Intel, Mesa Intel(R) HD Graphics 610 (KBL GT1), OpenGL 4.6)`、`medium` 档 `60 fps`；已 `rsync` 发布至 `https://c.aasc.us/mnt/game/pig-game/` 并核对核心文件 SHA-256 一致。
- ✅ [2026-11-21] 完成猪了个猪网页 3D 化改造（手绘水粉风格、可交互草地、四季×四天气、3D 卡通浮动 UI、程序音乐音效）并发布外网 `https://c.aasc.us/mnt/game/pig-game/`
  - 新增 `web/pig-level/3d/` 全部 12 个模块与 `vendor/three.module.min.js`，更新 `index.html`、`style.css`、`app.mjs`、`scripts/serve-pig-level.js`、`package.json`、`tests/pig-level-animation.test.js`（固定 `?view=2d`）及新增 `tests/pig-level-3d.test.js`。
  - 画面与交互：参考 Painted Valley 实现高饱和水粉草地与短阶明暗对比、金色麦草秆与花丛漂带；草地支持鼠标/手指拨草、点击溅起草屑花瓣与小猪踩踏痕迹；支持春夏秋冬 × 晴雨阴雪 16 种环境平滑过渡、昼夜流转与月夜月亮月光；支持小猪滑行撞障、蓄力冲刺离场（离场未结束即可继续点下一只猪）、受阻撞击与摆动身体、地面+猪背双重表面贴花提示环；支持 PC 右键平移（全局拦截浏览器右键弹窗）与移动端双指平移缩放；内置居中平滑滑动关卡列表（不循环）、“简洁 2D 控件”切换、WebAudio 四季音乐与 14 种程序音效、`?view=2d`/无 WebGL 自动回退 2D。
  - 验证与发布：`npm run test:pig-web` `118 / 118`、`npm run test:pig-animation` `1 / 1`、`npm run test:pig-3d` `3 / 3` 全部通过；已同步 124 个静态文件至服务器 `/home/as/a/game/pig-game/`（备份旧版至 `pig-game.bak-3d`），公网 SHA-256 校验一致且 Chromium 公网 3D/`?view=2d` 核验 `0` 报错。
- ✅ [2026-11-21] 将横竖屏自适应一屏布局同步发布至外网 `https://c.aasc.us/mnt/game/pig-game/`（服务器 `/home/as/a/game/pig-game/`，旧版保留服务器备份）
  - 公网逐文件校验：全部 `111 / 111` 个静态文件（包含更新后的 `index.html`、`style.css`、`app.mjs`、`engine.mjs` 及 107 份 `level-*.json`）公网 HTTPS 200 且 SHA-256 与本地一致。
  - 公网 Chromium 多视口核验：`https://c.aasc.us/mnt/game/pig-game/?level=117` 在 `390×844`、`844×390` 与 `1280×720` 下均满足一屏无滚动（`docH == winH`、`appSH == appCH`）、棋盘比例 `0.706`、横屏左棋右控双栏且第 54 步顶行 `.hint-arrow` 未裁剪；`?level=118` 渲染 91 只猪与自由试玩徽章，全程 `0` 报错。
- ✅ [2026-11-21] 实现猪了个猪网页横竖屏自适应一屏布局（横竖屏与手机矮屏均不超出一屏）
  - 布局与样式（`web/pig-level/index.html`、`style.css`、`app.mjs`）：`.app` 固定 `100dvh` 视口高并禁止整页溢出；新增 `.board-stage`（`container-type: size`）配合 `width: min(100cqw, calc(100cqh * var(--cols, 12) / var(--rows, 17)), 560px)` 实现棋盘等比自适应缩放且继续保留顶行 `.hint-arrow` 未裁剪。竖屏保持四段流式一屏排布；横屏（`orientation: landscape` 且 `min-width: 560px`）自动切换为左棋盘满高 + 右标题/控制/规则说明双栏，并对手机矮横屏（`max-height: 520px`）与矮竖屏（`max-height: 700px`）收紧间距。
  - 验证结果：`npm run test:pig-web` `118 / 118` 通过；`npm run test:pig-animation` 在 Chromium 中通过（同步将方向动画等待从固定 120ms 改为 `waitForFunction` 实际位移判断），覆盖 `390×844`、`360×640`、`844×390`、`1280×720` 视口的一屏无滚动与 `12:17` 棋盘比例校验；外网同步待用户确认后覆盖发布。
- ✅ [2026-11-21] 发布新版猪了个猪独立网页至外网 `https://c.aasc.us/mnt/game/pig-game/`（服务器 `/home/as/a/game/pig-game/`，覆盖 `2～91、94～95、97～104、112～118` 共 107 关与界面美化版本，旧版保留服务器备份）
  - 公网逐文件校验：全部 `111 / 111` 个静态文件（`index.html`、`app.mjs`、`engine.mjs`、`style.css` 及 107 个 `level-*.json`）公网 HTTPS 200 且 SHA-256 与本地一致。
  - 公网 Chromium 加载核验：`https://c.aasc.us/mnt/game/pig-game/?level=117` 显示正常且第 54 步顶行 `.hint-arrow` 位于棋盘上方（`arrowTop=171 < boardTop=193`、`overflow=visible`）、`#modeBadge` 隐藏；`?level=118` 显示 91 只猪与自由试玩徽章、禁用参考下一步按钮，全程 `0` 控制台/页面报错。
- ✅ [2026-11-21] 第 115～117 关实机无道具通关，第 118 关暂停记录与第 71～118 关网页批量接入暨界面交互美化
  - 实机进度：第 115（107 步）、116（89 步）、117（112 步）关实机无道具通关，第 118 关在剩余 30 只时经 7448 状态 BFS 与实机探针确认无道具死锁（剩余金币 11005、零道具消耗，实机窗口保持暂停）。
  - 网页数据与规则引擎：新增并校验接入 37 关（`71～81、83～91、94～95、97～104、112～117` 共 36 个带完整参考步骤通关关卡，以及无步骤自由试玩的第 `118` 关），现网页共支持 `107` 关（`2～91、94～95、97～104、112～118`）；`web/pig-level/engine.mjs` 补充了弹簧猪遇阻回弹、`shape` 大象计入离场解锁计数、带鸭子时限制离场、`timer_bomb` 场内滑停及空步骤计划兼容；同步更新 `scripts/serve-pig-level.js`、`tests/pig-level-web.test.js`、`tests/pig-level-animation.test.js`、`docs/design/pig-game.md`、`docs/spec/pig-game.md` 与 `docs/task/2026-11-21_补全第71至118关网页接入与界面交互美化.md`。
  - 界面与交互优化：`web/pig-level/style.css`、`index.html`、`app.mjs` 将草地底纹、网格与圆角拆分为独立 `.board-backdrop`（`overflow: hidden`），使 `.board` 改为 `overflow: visible` 彻底修复顶部/边缘猪 `.hint-arrow` 被棋盘裁剪问题；补强小猪耳朵/猪鼻/弹簧圈/倒计时炸弹视觉、新增「上一关 / 下一关」导航、自由试玩徽章、键盘快捷键、错误震动反馈，并修复 `.mode-badge[hidden]` 显示冲突与 `<link rel="icon">` 404。
  - 测试结果：`npm run test:pig-web` 118 项全部通过（0 失败、0 跳过）；`npm run test:pig-animation` 在 390×844 Chromium 中验证通过（覆盖第 48/40/82 关动画、取消、撤回、`#modeBadge` 显隐、第 117 关第 54 步顶行 `.hint-arrow` 未裁剪及第 118 关自由试玩态）。
- ✅ [2026-11-15] 第 59 关实机通关并发布网页：首屏与开笼后画面还原 86 猪、四把锁和铁笼，105 步独立重放及实机核对；`web/pig-level/level-59.json`、网页入口和测试清单已更新。`npm run test:pig-cage` 17 项、`npm run test:pig-web` 66 项通过；公网五个核心资源 HTTP 200 且 SHA-256 一致，Chromium 显示 86 猪且无页面错误。胜利截图底部有隐私提示，成功标题可见。
- ✅ [2026-11-15] 铁笼与锁猪联合核对：`scripts/pig_cage_stage.py` 保守停止未建模锁标，`scripts/pig_level_auto.py` 补充粘连候选，`scripts/play-pig-locked.py` 同时核对笼体与锁标；自动识别样式仍需扩充。
- 🔄 [2026-11-14] 设计独立静态网页首批关卡集成与外网发布边界：只接收具备完整布局、有效步骤、独立重放和胜利证据且兼容当前网页引擎的关卡；鸭子、小象、动态铁笼和第59关阶段性采集暂不发布。已更新 `docs/design/pig-game.md`、`docs/spec/pig-game.md`、`docs/task/2026-11-14_网页关卡集成与外网发布.md` 和 `docs/todo.md`，代码与外网发布待执行。

### 局域网五子棋

- ✅ [2026-11-12] 完成局域网五子棋原型：APK 提供房主服务和网页分发，网页与 APK 共用界面，支持双人对局、二维码邀请、断线和房主服务重启恢复。
  - `RoomServer.java`、`MainActivity.java`、`client.js`、网页资源、设计与伪代码；`npm run test` 2/2 通过，覆盖真实服务、Chromium 页面和图片扫码；`npm run build:apk` 调试构建成功。实际 Android 双设备验收尚未执行；热更新和公网中转尚未实现。
- 🔄 [2026-11-12] 记录独立游戏网页包和 APK 更新的待确认方案：复用 Offline 更新源与签名体系，独立游戏清单和制品；当前尚未实现或发布。
- 🔄 [2026-11-12] 记录 Node.js 公网中转及网页本地房主的待确认方案，保留 APK 局域网房主；当前尚未实现。
- ✅ [2026-11-12] 实现 Node.js 内网中转及网页本地房主；默认只监听本机，可显式绑定内网地址，保留原 APK 局域网房主。
  - `server/relay.js`、`game-host.js`、`client.js` 与网页入口；`npm run test` 4/4 通过，覆盖中转身份、房间隔离、真实网页开房和对局、房主刷新及关闭重连，并回归原 APK 服务和扫码；新增双方落子定向测试 2/2、调试 APK 构建成功，真实 Android 设备尚待验收。
- 🔄 [2026-11-12] 记录多游戏扩展待确认方案，包含注册表、按游戏绑定房间、人数与版本契约、五子棋迁移及旧数据兼容；尚未修改代码。
- ✅ [2026-11-12] 完成多游戏基础模块与五子棋迁移。共享注册表绑定游戏、版本、人数和操作，内网中转按游戏隔离并分配座位，网页加载对应规则和界面；APK 原生房主提供注册接口并保持旧五子棋兼容。
  - `games/catalog.js`、`games/modules.js`、`games/gomoku/`、`server/relay.js`、`client.js`、`NativeRoom.java`、`GomokuRoomServer.java`；`npm run test` 6/6、调试 APK 构建成功，本机 30 个房间握手抽样 454 毫秒。三人游戏仅用于测试；真实 Android 多设备与独立游戏热更新仍待完成。
- 🔄 [2026-11-12] 开始采集“猪了个猪”关卡：已保存第 1 关原始布局及首步状态，逐关保留截图；玩法还原和代码尚未开始。
- 🔄 [2026-11-12] 记录基于 X11 截图和 OpenCV 的关卡提取方案：首关 6 个大斜向轮廓、第二关首图 61 个候选及洗牌后 40 个候选；脚本和方向准确率验证尚待确认后实现。

- ✅ [2026-11-12] 完成猪关卡屏幕提取工具：`scripts/extract-pig-level.py` 根据截图识别小猪候选位置和朝向，支持指定 X11 窗口及标题校验、可选网格映射和不覆盖输出；`docs/references/pig-game/extractions/` 保存首两关候选图与数据。`npm run test:pig-extract` 5/5、`npm test` 6/6 通过，实时游戏窗口截图及逐只方向待验收。
- 🔄 [2026-11-12] 审核猪关卡提取器：确认现有图像含编号和箭头、JSON 含坐标朝向，手指遮挡导致首关一只方向未知；引导手指识别与文字叠加方案待确认。`npm run test:pig-extract` 5/5 通过；第 2 关两份候选记录的 61 只位置、网格与方向一致，但两份记录来源相同，不能视为独立真值。
- ✅ [2026-11-12] 猪关卡提取器增加游戏内引导手指模板检测与遮挡提示，标注图增加逐猪坐标和方向表；`scripts/extract-pig-level.py`、`gesture-template.png`、`tests/pig_level_extractor_test.py`。`npm run test:pig-extract` 6/6，首关模板缩放与第二关无手指检查通过；模板样式之外可能误检或漏检。

- ✅ [2026-11-12] 猪关卡提取图为八个方向增加不同颜色、描边箭头和图例，重新输出两关图片；`npm run test:pig-extract` 7/7。第一关被手指遮挡的小猪另存人工左上方向候选及原始自动未知值，未宣称自动识别成功。

- 🔄 [2026-11-12] 记录猪关卡自动游玩方案：复用屏幕识别和 X11 输入，先保存关卡再自动尝试并记录结果；具体实现和实机测试待确认，未承诺所有关卡均可自动通过。

- ✅ [2026-11-12] 实现当前猪关卡自动游玩：`scripts/play-pig-level.py` 通过 X11 截图与输入选择目标，先保存当前状态，记录逐步画面，通关后停止，不点击道具或切换关卡；`tests/pig_level_player_test.py`、npm 脚本及使用文档。`npm run test:pig-play` 6/6、`npm run test:pig-extract` 7/7；游戏窗口不在前台，实机 X11 点击与通关尚待验收。

- 🔄 [2026-11-12] 记录猪关卡自动游玩实测缺陷：第 2 关出现无畅通目标时仍尝试阻挡小猪，动画坐标漂移会导致重复点击；保留当前局面与过程记录，已停止脚本。逐步重算阻挡、仅点可移动目标与关键截图方案待确认。

- ✅ [2026-11-12] 修复猪关卡脚本的重复点击和错误尝试：每步重新识别并计算阻挡，只点击无遮挡目标，容忍坐标漂移，方向不稳定标为未知；未找到可靠目标标为卡关。默认只保存开始和结束画面，`--save-steps` 可额外保存逐步画面；`npm run test:pig-play` 9/9、`npm run test:pig-extract` 7/7。

- 🔄 [2026-11-12] 根据用户要求改为先保存初始布局、搜索完整解再操作；第 2 关离线网格候选的静态阻挡假设存在 42→49→50→46→42 阻挡环、剩 40 只。该结果只说明当前模型存在疑点，尚不能判定原关卡无解；新搜索与规则校验方案待确认。

- 🔄 [2026-11-12] 根据用户反馈复核猪关卡识别：当前 bbox 仅为腐蚀后身体区域、可能缺少头尾；第 2 关两帧候选位置可对应但两只方向不稳定。外接框内缩 6 像素仅作为未验证的离线碰撞假设，得到两条 61 步候选，不执行；识别与搜索修正方案待确认。

- 🔄 [2026-11-12] 根据用户提示及截图识别记录发现，小猪可在不消失时向前移动；第 2 关一只向左移动约 30 像素、猪数保持 23。离线按假设滑动规则找到初始布局 73 步和已记录 40 只局面 52 步候选，规则和计划尚未验证，未执行。

- ✅ [2026-11-12] 猪关卡脚本改为先搜索完整解再逐步执行：`scripts/pig_level_solver.py` 建模棋盘内移动和离开，有界遍历；`scripts/play-pig-level.py` 保存初始布局及计划、每步校验并在偏差时停止，不点击道具或下一关。`npm run test:pig-solve` 8/8、`npm run test:pig-play` 9/9、`npm run test:pig-extract` 7/7；第 2 关实机验证中，轮廓完整性和真实碰撞规则继续核对。

- ✅ [2026-11-12] 第 2 关实机验证完整搜索和执行：从 61 只初始候选搜索 73 步，其中 12 次为棋盘内滑动；逐步核对后挑战成功，保存初始图、计划和成功图，未使用底部三个道具或切换关卡。

- ✅ [2026-11-13] 第 3 关按完整计划通关，保存初始布局、82 个有效步骤的顺序图、通关画面以及奖励/排名弹窗；一次暂停干预产生的未生效点击不计入。
- 🔄 [2026-11-13] 增加连续关卡采集与顺序图：`scripts/auto-pig-levels.py`、`scripts/pig_level_auto.py`、UI 模板及 `npm run auto:pig`，第 4 关实机执行中。

- ✅ [2026-11-13] 第 4 关完成自动通关与采集，保存 94 个确认步骤、初始布局、顺序图和通关画面；第 5 关保存新动物说明、初始布局及小黄鸭实验画面，未知规则自动停止，未使用关内三个道具。`scripts/auto-pig-levels.py` 双模板确认并留证后关闭新动物说明；`npm run test:pig-auto` 10/10、`test:pig-extract` 8/8、`test:pig-solve` 8/8、`test:pig-play` 9/9 通过。第 5 关一次实验因变量复用误点一只猪，已记录实际移动，鸭子规则尚未确认。
- ✅ [2026-11-13] 实机运行 `auto:pig` 验证第 5 关识别到小黄鸭后以 `unsupported_entity` 停止并留存当前截图，未自动点击棋盘；鸭子固定障碍假设的离线搜索达到时限，不作为无解结论。
- ✅ [2026-11-13] 依据用户说明和画面对比，实现小黄鸭占格、出口可达及连锁离开的假设搜索，`auto:pig --reviewed-layout` 校验完整布局并逐步核对猪鸭状态；第 5 关用户操作后的局面执行 97 步通关，保留计划、步骤图和通关画面，鸭子两次各四只自动离开符合预测。新物件先留证、尝试点击再建模；第 6 关保存初始 91 猪、9 鸭布局并继续搜索。第 5 至 6 关标题差异实测修正切关阈值；未点击底部道具。
- ✅ [2026-11-13] 第 6 关 136 步通关，第 75 步九鸭离开与计划一致；第 99 步后失焦，新增 `resume:pig` 核对待确认动作前后状态并接续原计划，保留完整顺序图。新增可选 `--duck-auto`、新动物说明停机取证及回归测试；第 7 关初始布局已留存，首轮搜索超时但未点击棋盘。`npm run test:pig-auto` 15/15、`test:pig-solve` 9/9、`test:pig-play` 9/9、`test:pig-extract` 8/8。
- ✅ [2026-11-13] 修复相邻鸭子动画使黄色连通区域合并导致漏检：拆分并校验每只候选；复核布局和续跑多帧重试，搜索超时时尝试固定顺序重排。第 7 关找到 110 步计划并从中断处继续；`npm run test:pig-auto` 17/17，覆盖实机相邻鸭子截图与续跑前后状态。
- ✅ [2026-11-13] 第 7 关完成 110 步通关与完整顺序图；修复最后一步奖励弹窗等待及通关后续跑确认。第 8 关入场动画暴露过早保存问题，切关后增加界面载入模板与连续三帧稳定校验；重新保存完整初始画面并开始执行 106 步计划。`npm run test:pig-auto` 18/18。
- ✅ [2026-11-13] 第 8 关 106 步通关，保存首屏、计划、顺序图与通关画面；第 9 关已保存 86 猪、35 鸭候选布局，首轮多个搜索顺序达时限后安全停止且未点击，继续试算。
- ✅ [2026-11-13] 鸭子连锁离开按边界可达性优化，100 组随机棋盘与逐只搜索参考算法一致；第 9 关重排候选后找到 108 步计划并开始实机核对执行。后续关卡使用多种短预算顺序及有限次完整预算重试；`npm run test:pig-solve` 10/10。
- ✅ [2026-11-13] 第 9 关以 108 个确认步骤通关，35 只鸭子按计划离开，保存首屏、步骤图和通关画面；第 10 关保存 73 猪、49 鸭候选，首轮搜索超时后未点击，继续多顺序搜索。
- ✅ [2026-11-13] 第 10 关 97 个确认步骤通关并保存顺序图；第 11 关出现大长猪，保存说明和首屏，按用户要求先直接点击受阻长猪，稳定画面未移动。增加二格/三格猪候选网格、阻挡、滑动和逐帧长度校验；三格规则仍需实机验证，首轮搜索达时限后继续试算。
- ✅ [2026-11-13] 第 11 关搜索到 130 步候选并实机执行，已确认三格长猪离场及棋盘内滑动两格；`npm run test:pig-auto` 19/19、`test:pig-solve` 11/11、`test:pig-play` 9/9、`test:pig-extract` 8/8。
- ✅ [2026-11-13] 第 11 关按 130 个确认步骤通关，保存长猪说明、原始布局、步骤图及通关画面；第 12 关已保存 94 猪、9 鸭初始布局并开始执行 120 步计划。
- ✅ [2026-11-13] 第 12 关以 120 个确认步骤通关，保存初始布局、顺序图与通关画面；第 13 关自动保存 78 猪初始布局，含 6 只长猪，106 步计划执行中。
- ✅ [2026-11-13] 第 13 关以 106 个确认步骤通关，保存初始布局、顺序图和通关画面；切关按钮首次未生效，重新确认成功画面后进入第 14 关，保存 95 猪、9 鸭初始布局并开始执行 139 步计划。
- ✅ [2026-11-13] 修复下一关按钮首次点击未生效导致连续流程停止：连续八帧仍确认成功浮层时最多重试一次，非成功帧重置计数，仍不能确认新关时保留现场；`npm run test:pig-auto` 20/20。
- ✅ [2026-11-13] 第 14 关按 139 个确认步骤通关并保存首屏、顺序图和通关画面。第 15 关常规搜索超时后补充确定性动作排序，求解器独立复算并逐步验证 132 步模型计划，保存首屏并开始实机执行；`npm run test:pig-auto` 22/22、`test:pig-solve` 12/12。
- ✅ [2026-11-13] 第 15 关按 132 个确认步骤通关，保存首屏、顺序图与通关画面；第 16 关保存 85 猪、25 鸭初始布局，首轮搜索超时后未点击，继续离线遍历。
- ✅ [2026-11-13] 第 16 关更大规模离线遍历找到 157 步候选；新增 `--candidate-plan`，必须配合复核布局，使用现有规则逐步独立检查合法动作、长猪占格、鸭子变化及全部离场后才允许执行。非法或不完整计划会拒绝，`npm run test:pig-solve` 13/13、`test:pig-auto` 23/23；第 16 关正在实机逐步核对。
- ✅ [2026-11-13] 将快速离线遍历整理为 `scripts/pig_fast_solver.cpp` 与 `scripts/pig_fast_candidate.py`，常规搜索超时后可在本机有 `g++` 时自动尝试，所有候选经 Python 独立重放；编译器缺失、超限和非法结果安全停止。`npm run test:pig-auto` 24/24、`test:pig-solve` 13/13。
- ✅ [2026-11-13] 第 16 关按独立校验的 157 步计划通关并保存顺序图与通关画面；切关时出现延迟排名弹窗，流程现会先留证、关闭并等待成功浮层。第 17 关保存 94 猪、19 鸭初始布局并开始执行 137 步计划；`npm run test:pig-auto` 25/25。
- ✅ [2026-11-13] 第 17 关第 109 步多次点击未生效时保留现场，用指定 X11 窗口高速截图确认后续点击滑动两格与计划一致；续跑依据动作后全局状态计入一次有效步骤，不重复计数。
- ✅ [2026-11-13] 第 17 关按 137 个确认步骤通关，合并中断前后顺序图并保存成功画面；第 18 关保存 89 猪初始布局并开始执行 148 步计划。
- ✅ [2026-11-13] 第 18 关按 148 个确认步骤通关并保存初始布局、顺序图和通关画面；第 19 关保存 90 猪、21 鸭首屏，多顺序搜索找到 132 步计划并执行。
- ✅ [2026-11-13] 第 19 关以 132 个确认步骤通关，保存首屏、顺序图和通关画面；第 20 关保存 90 猪、16 鸭初始布局并开始执行 144 步计划。
- ✅ [2026-11-13] 第 20 关按 144 步通关并保存步骤图及成功画面；第 21 关留存新动物说明与首屏，直接点击小象一次后未见移动，阻挡范围待验证。
- ✅ [2026-11-13] `extract-pig-level.py` 分别输出视觉框与青色网格估计框并在 JSON 标示估计来源；`pig_level_auto.py`、`auto-pig-levels.py` 对已观察蓝色小象候选保存紫色视觉框并停止自动输入。第 21 关扩大棋盘范围后得到 80 个小猪占格候选，自动流程默认区域仍待适配。
  - 验证：`npm run test:pig-extract` 9 项、`test:pig-auto` 27 项、`test:pig-play` 9 项和 `test:pig-solve` 13 项通过。
- ✅ [2026-11-13] 按用户说明记录小象因前方受阻未移动，未知物件默认作为障碍；`pig_level_solver.py` 对暂定阻挡格验证并计入猪移动、鸭子逃离和候选复算，固定障碍模型结果不宣称实际通关；未知范围仍需确认后才能用于完整计划。
  - 验证：`npm run test:pig-solve` 15 项、`test:pig-play` 9 项、`test:pig-auto` 27 项通过。
- ✅ [2026-11-13] 按用户授权，`pig_level_auto.py` 将未知物件图像框投影为暂定阻挡格并记录与猪鸭重叠的冲突；`auto-pig-levels.py` 在确认阶段计划后按阻挡模型继续、逐帧核对并在未知物件改变时停止；`pig_fast_solver.cpp` 与 `pig_fast_candidate.py` 支持同一障碍集合和独立复算。第 21 关识别 80 猪、6 个小象阻挡格，阶段搜索进行中。
  - 验证：`npm run test:pig-auto` 28 项、`test:pig-solve` 15 项通过；自动流程已包含较高棋盘区域，单次提取默认范围仍可用 `--board` 调整。
- ✅ [2026-11-13] 根据用户澄清，新增 `unlock:pig` 阶段目标搜索：不要求整关计划，但每阶段仍先遍历并保存计划，再核对执行；第 21 关首阶段移猪后实测小象向下移动一格，第二阶段搜索到 49 步并执行。求解器与快速搜索支持矩形物件全宽阻挡；`test:pig-stage` 2 项、`test:pig-solve` 16 项及快速搜索专项测试通过。
- ✅ [2026-11-13] 第 21 关分阶段通关；新增 `merge:pig` 按阶段位置和方向唯一追踪小猪并合并 102 个确认步骤（含两次小象动作）到首屏顺序图，保存胜利截图。`test:pig-merge` 1 项、`test:pig-stage` 2 项通过；第 22 关保存初始画面并执行 68 步阶段计划。
  - 完整回归：`test:pig-auto` 28 项、`test:pig-solve` 16 项、`test:pig-extract` 9 项和 `test:pig-play` 9 项均通过。
- ✅ [2026-11-13] 第 22 关确认首阶段 68 步及两次小象移动并继续搜索；修复已核对网格外黄色装饰造成鸭子误检，`auto:pig --filter-outside-yellow` 显式启用并保留被排除候选，默认保守；新增实机截图回归通过。
- ✅ [2026-11-13] 第 22 关通关并保存初始布局、通关画面与合并后的 103 个确认步骤；第 23 关开始采集。
- ✅ [2026-11-13] 第 23 关九鸭与沙地颜色连通导致漏检，`pig_level_auto.py` 加入实机画面模板并与颜色候选去重；显式复核模式排除与已识别猪占格重叠的黄色候选并留证。现场连续五帧九个鸭格一致，重新采集后继续搜索。
  - 验证：`npm run test:pig-auto` 30 项通过，含九鸭实机截图、误判过滤和旧关卡兼容回归。
- ✅ [2026-11-13] 第 23 关按 126 个确认步骤通关，保存初始布局、步骤图及成功画面；第 24 关开始采集。
- ✅ [2026-11-13] 第 24 关朝左小象取证后，`unlock:pig --direction` 支持上下左右阶段目标及位移核对，找到 27 步阶段计划并执行；`test:pig-stage` 3 项通过。
- ✅ [2026-11-13] 第 24 关完成通关并合并 98 个确认步骤、初始布局与成功画面；第 25 关开始采集。
- ✅ [2026-11-13] 第 25 关紧邻猪身体的分散小鸭存在漏检；`pig_level_auto.py` 增加三种现场外观模板并去重，六帧均识别 11 鸭；第 25、23、5 关截图专项回归通过，已记录 93 猪、11 鸭初始布局并开始搜索。
  - 验证：`npm run test:pig-auto` 31 项通过。
- ✅ [2026-11-13] 第 25 关按 143 个确认步骤通关，小鸭均按计划离场，保存首屏、顺序图和成功画面；第 26 关开始采集。
- ✅ [2026-11-13] 第 26 关留存初始布局；固定小象障碍的整关搜索达到时限后，阶段目标搜索找到 69 步计划并开始逐步执行。
- ✅ [2026-11-13] 修复阶段脚本动画帧长度映射失败直接中断：`unlock-pig-object.py` 有限重试，`merge-pig-stages.py` 独立校验中断待确认动作；第 26 关第 7 步经稳定画面确认已生效，保留中断及核对记录并重搜 62 步。`test:pig-merge` 2 项、`test:pig-stage` 3 项通过。
- ✅ [2026-11-13] 第 26 关小象点击两秒内未移动、后续稳定画面确认离场且金币加一；`unlock-pig-object.py` 有限等待物件移动或连续消失，避免重复点击，`merge-pig-stages.py` 支持带截图的独立延迟离场复核。`test:pig-merge` 3 项、`test:pig-stage` 3 项通过；剩余 29 猪搜索中。
- ✅ [2026-11-13] 修复复核续跑仍用剩余猪重新推算网格的问题：`auto-pig-levels.py` 在复核模式沿用首屏网格并对初始帧应用显式黄色候选过滤；第 26 关重新映射到原 12×19 网格，稀疏棋盘专项回归通过。
- ✅ [2026-11-13] 第 26 关有限进展后当前模型穷举 2,184 状态最多再消除 4 猪，保留卡关证据并按授权重开；小象加入矩形移动搜索后得到独立复核的 132 步完整候选，新增 `elephant:pig` 逐步核对执行。`test:pig-elephant` 1 项、`test:pig-solve` 16 项通过。
- ✅ [2026-11-13] 第 26 关按 132 个确认步骤通关，第 109 步小象按矩形模型离场，保存重开首屏、完整顺序图及成功画面；第 27 关开始采集。
- ✅ [2026-11-13] 第 27 关补充两种紧邻猪体的小鸭画面模板，保存 91 猪、13 鸭完整帧复核布局；部分动画帧漏检时等待完整匹配。第 27、25、23、5 关鸭子专项回归通过，继续搜索。
  - 验证：`npm run test:pig-auto` 33 项通过。
- ✅ [2026-11-13] `resume-pig-level.py` 续跑继承计划中的黄色候选复核过滤，旧计划可显式指定；第 27 关完整帧和待确认动作专项回归通过。
  - 验证：`npm run test:pig-auto` 33 项通过。
- ✅ [2026-11-13] 第 27 关按 139 个确认步骤通关，保存初始布局、完整顺序图及通关画面；第 28 关开始采集。
- ✅ [2026-11-13] 第 28 关初始动画导致帧组偶发不一致；`auto-pig-levels.py` 对整组稳定采样有限重试，不拼接冲突帧。十帧均见 94 猪候选，重新采集并搜索；初始采样重试专项测试通过。
- ✅ [2026-11-13] `play-pig-level.py` 的 X11 适配器优先以 `XGetImage` 获取指定活动窗口画面，像素格式不兼容时回退原方式；现场尺寸与标题像素一致，单次样本约 0.11 秒对 1.42 秒。`test:pig-play` 10 项通过，覆盖行填充、复制及不兼容格式。
- ✅ [2026-11-13] 第 28 关按 134 个确认步骤通关，保存首屏、顺序图与成功画面；第 29 关开始采集。
- ✅ [2026-11-13] 第 29 关保存首屏并复核五个黄色误候选，识别 79 猪、无鸭，找到 112 步计划并开始执行；X11 窗口直读用于实时核对。

- ✅ [2026-11-13] 第 29 关通关，保存 112 步及通关画面。第 30 关补充密集鸭子模板并保存 24 鸭复核布局；旧自动游玩回归 34 项通过，新增第 30 关截图回归通过。窗口验证超时后保留待确认动作并启动续跑。

- ✅ [2026-11-13] 第 30 关通关；第 31 关保存首屏和锁猪说明，实测普通猪离场后两个锁计数均减 1。`progress-pig-level.py` 支持复核棋盘、固定阻挡格和锁区域外观检查，用于解锁前阶段搜索。

- ✅ [2026-11-13] 第 31 关锁猪第一阶段确认 18 只离场；实测第 20 只普通猪离场后第一把锁消失、第二把计数变为 15，解锁猪已重新识别并校验。锁区域回归与既有阶段测试共 6 项通过。

- ✅ [2026-11-13] 第 31 关第二把锁在第 35 只普通猪离场后打开；解锁布局完整匹配后恢复连续搜索。`auto-pig-levels.py` 支持复核布局中的棋盘范围，边缘猪专项测试通过。

- ✅ [2026-11-13] 修复第 31 关蓝色背景整片误判为大象，蓝色棋盘和真实大象样本专项测试通过，恢复剩余布局搜索。

- ✅ [2026-11-13] 新增 `merge-pig-lock-stages.py`，按锁解开阈值重放多阶段实际步骤并在胜利后生成首屏完整顺序图；第 31 关前 36 步验证通过，`test:pig-lock-merge` 通过。

- ✅ [2026-11-13] 第 31 关通关；多阶段 117 步独立重放通过，已保存原始布局、完整顺序图及胜利图，第 32 关开始采集。

- ✅ [2026-11-13] 第 32 关通关并保存记录；第 33 关保留首屏并复核两只计数锁猪，完整搜索达到上限后启动保守阶段搜索。窗口查询超时前未发送点击，已复核后重新尝试。

- ✅ [2026-11-13] 新增 `play-pig-locked.py` 锁猪完整计划执行与 `test:pig-locked`；第 33 关首屏候选解经 Python 独立重放 115 步并核验锁阈值，实机逐步执行中。4 号猪向上离场已通过点击前后画面确认；界面红色高亮是可移动提示，模型搜索失败不代表实际无解。阶段搜索、锁猪合并和完整计划校验测试通过。

- ✅ [2026-11-13] 第 33 关按锁猪完整计划确认 115 步并通关，保存初始布局、动作顺序图及胜利画面；已启动第 34 关采集。

- ✅ [2026-11-13] 猪方向增加八个单位向量的候选分数，方向交界分数接近时输出未知；黄色候选新增第 33、34 关锁模板匹配，识别疑似锁时保存并停止通用游玩。提取 10 项、自动游玩 37 项通过，锁样本及 23、25、30 关鸭子交叉测试通过；锁模板保存在忽略的本地 references 中，其他外观尚未充分验证。

- ✅ [2026-11-13] 第 34 关按 163 个确认步骤通关，已保存初始布局、顺序图和胜利画面；第 35 关复核两只锁猪（30、50）及遮挡猪方向，133 步候选独立重放通过并开始执行。
- ✅ [2026-11-13] 通用游玩增加锁猪完整搜索：锁未解开时仍占格但不能点击，达到计数后允许搜索；新增 `pig_locked_candidate.py`、`pig_fast_locked_solver.cpp` 和锁约束测试。模板仅覆盖已验证样本，识别不确定或与其他物件混合时保留现场。

- ✅ [2026-11-13] 第 35 关按 133 个确认步骤通关，保存初始布局、步骤顺序图和胜利画面，进入第 36 关。

- ✅ [2026-11-13] 第 36 关按 118 个确认步骤通关，保存初始布局、步骤顺序图和胜利画面，继续下一关。

- ✅ [2026-11-13] 第 37 关蓝灰小象与蓝色背景连通导致漏检，新增局部外观模板补充识别；受阻动作修正为实际移动 6 格，续跑通关后将 135 步独立重放合并为首屏顺序图。蓝色背景小象及普通关卡负样本测试通过。

- ✅ [2026-11-13] 第 38 关按 132 个确认步骤通关，保存初始布局、步骤顺序图和胜利画面，继续下一关。

- ✅ [2026-11-13] 锁猪搜索与执行支持鸭子混合关卡；第 39 关复核 16 鸭及两只锁猪，135 步计划经 Python 独立重放并开始逐步执行。锁约束及鸭子后状态回归 3 项通过。

- ✅ [2026-11-13] 第 39 关现场确认锁计数同时包含猪与鸭离场：25 猪 + 14 鸭使 50 锁剩 11。搜索和执行均计入鸭离场，待确认动作及剩余计划已按实况校验续跑。

- ✅ [2026-11-13] 第 39 关混合锁猪和鸭子通关；中断前后 135 步逐项核对并重放，已合并首屏顺序图及胜利记录。

- ✅ [2026-11-13] 对用户提供的第 48 关截图离线提取并补录遮挡猪，按三只剪刀猪离场后才可移动绳猪求得 176 步；独立重放通过，已生成首屏顺序图和逐步棋盘图，未操作游戏界面。

- ✅ [2026-11-13] 第 48 关离线步骤总览图按步骤顺序将数字背景由蓝色渐变为红色，同猪多次操作分别着色；保留 176 步及原布局。

- ✅ [2026-11-13] 放大第 48 关步骤总览图的布局标注和步骤列表文字，保留蓝到红的顺序渐变。

- ✅ [2026-11-13] 第 48 关步骤总览图按小猪分组避让编号，偏移标注用连线指向原位置，校验 95 组标签互不重叠。

- ✅ [2026-11-13] 新增第 48 关独立静态网页 `web/pig-level/` 和预览脚本，支持 `/?level=48`、碰撞滑行、剪刀逐根解绳、绳未解完不可点击、步骤验证回放、进度条、提示开关、自由游玩、撤回及通关界面。`npm run test:pig-web` 3 项通过；Chromium 验证进度、解绳、撤回、提示、自由操作和通关。截图布局尚需真实游戏验证。

- ✅ [2026-11-13] 第 48 关增加小猪离场动画，沿朝向滑出棋盘后再更新进度和解绳；进度跳转或重置可取消动画，棋盘内移动保持即时。`npm run test:pig-animation` 和 `npm run test:pig-web` 通过。

- ✅ [2026-11-13] 发布第 48 关静态网页至 `https://c.aasc.us/mnt/game/pig-game/?level=48`（服务器 `/home/as/a/game/pig-game/`）；5 个网页文件公网 HTTP 200、SHA-256 与本地一致，Chromium 验证关卡加载、绳猪锁定、下一步和撤回。

- ✅ [2026-11-13] 静态网页加入第40关与顶部关卡选择，支持30计数锁及撤回；第48关重排可交换步骤以提高相邻操作空间连贯性。第40关145步、第48关176步均完整重放通过；`test:pig-web` 4项及 Chromium 动画、切关与锁计数测试通过。第40关后半步骤尚未实机验证。

- ✅ [2026-11-13] 发布第40、48关更新至 `https://c.aasc.us/mnt/game/pig-game/`；6个静态文件公网 HTTP 200 且 SHA-256 与本地一致，Chromium 验证第40关锁计数、切换第48关及完整回放。旧版本保留为服务器备份。

- ✅ [2026-11-13] 第 40 关实际通关；四阶段 145 步与首屏完整计划逐项核对，已合并初始布局顺序图与胜利画面。

- ✅ [2026-11-13] 连续采集默认接入 AASC 局部 OCR，可通过 `--no-ocr` 关闭；标题与疑似锁先裁剪，识别结果和置信度留证，异常回退，关卡或锁计数冲突停止。`scripts/pig_ocr.py`、`auto-pig-levels.py`、`test:pig-ocr`；第 40 关标题与锁计数、第 41 关标题经实际显示端验证。

- ✅ [2026-11-13] 红色高亮识别为唯一游戏可点提示，单关选点优先采用；第 41 关实机截图确认高亮猪朝上。`extract-pig-level.py`、`play-pig-level.py` 与提取、选点测试。
- ✅ [2026-11-13] 复核布局支持剪刀猪离场后解除捆绑猪限制，包含鸭子联合搜索、独立重放及执行前逐帧匹配；`pig_fast_locked_solver.cpp`、`pig_locked_candidate.py`、`play-pig-locked.py`、`auto-pig-levels.py`。第 41 关特殊外观仍需人工复核，完整搜索和通关实机验收未完成。
- ✅ [2026-11-13] 第 41 关红色高亮的朝上猪已按游戏提示操作，离场后的整盘与模型一致；保留首屏、动作、后续画面和更新布局，继续搜索后续步骤。

- ✅ [2026-11-13] 第 41 关剪刀猪与捆绑猪实机通关；失焦后核对并续跑，129 步从初始布局独立重放，合并保存顺序图与通关画面。

- ✅ [2026-11-13] 第 42 关过滤重叠的黄色误候选，失焦后核对并续跑，共 143 步通关，保存完整步骤图和胜利截图；普通连续流程对未复核蓝色特殊标记留证停止。

- ✅ [2026-11-13] 第 43 关修复计数锁与背景相连导致的漏检，高饱和金色定位后局部 OCR 识别 25、20；扩展锁与固定未知物件联合搜索和实时外观核对。旧关卡定向回归 3 项、锁猪测试 6 项通过。
- ✅ [2026-11-13] 增加计数锁关卡红框续跑脚本，搜索预算耗尽时核对游戏红框并确认状态后重搜；第 43 关已确认 1 步，后续仍在验证。

- ✅ [2026-11-13] 修正红框只用于每关首次点击；搜索上限返回已探索的有效阶段，独立重放并确认阶段终态后重搜。三项定向测试通过，阶段不能误报通关。
- ✅ [2026-11-13] 阶段计划在小象通路打开时提前结束，核对并尝试让已复核方向的小象离场，成功后清除阻挡继续搜索；第 43 关手动核对通路开放并确认离场，自动流程重新实机验证中。搜索上限仅保留尚有未探索分支的阶段，避免把已经证实的死路作为阶段目标。

- ✅ [2026-11-13] 第 43 关实机自动检测并送走小象，127 步含小象离场从重开首屏独立重放，合并顺序图与通关截图；第 44 关复核剪刀和捆绑布局，阶段续跑支持解绳状态更新。

- ✅ [2026-11-13] 根据用户确认恢复通用动作排序，不再额外优先剪刀猪；第 44 关此前阶段导致死局，已留证并重开后重新搜索。

- ✅ [2026-11-13] 第 44 关普通动作排序下 98 步完整计划实机通关，保存初始布局步骤图与通关截图；第 45 关复核含两只捆绑猪的初始布局。

- ✅ [2026-11-13] 第 45 关复核三只剪刀猪与两只捆绑猪布局，106 步实机通关并保存初始布局、步骤图及胜利画面。

- ✅ [2026-11-13] 第 46 关残局核对 5 步实机执行通关，保存初始布局、步骤图及胜利画面。

- ✅ [2026-11-13] 第 47 关 122 步完整计划实机通关，逐帧核对动作与离场，保存初始布局、步骤顺序图及胜利画面。

- ✅ [2026-11-14] 第 48 关实机通关：根据 X11 实际窗口换算复核布局（95 猪、3 剪刀、1 捆绑猪），176 步候选计划独立重放校验并通过 `play-pig-locked.py` 逐步核对执行，176 个有效步骤全部确认并通关，保存初始布局、步骤顺序图与胜利截图。

- ✅ [2026-11-14] 第 49 关首屏采集与障碍识别：从第 48 关通关界面成功切入第 49 关，保存初始画面；检测到 3 把剪刀与 2 处捆绑绳索（蓝色特殊标记），红框高亮唯一提示位于左侧朝西 43 号猪；未复核特殊标记前按规则留证停止。

- ✅ [2026-11-14] `pig_special.py` 自动定位剪刀手柄与绳索条纹，结合刀刃和猪头确定方向，连续采集多帧核验后搜索并执行；同关历史首屏可为动画遮挡提供证据。第 50 关自动生成 91 猪布局并开始实机执行；特殊识别、OCR、锁猪与阶段测试通过，通关验收进行中。
- ✅ [2026-11-14] 第 47、48、49 关已实机通关并保存原始布局、有效步骤与胜利画面。

- ✅ [2026-11-14] 第 50 关实际通关：自动识别 91 猪、3 剪刀及 1 绳猪；完整计划执行中有一次点击延迟，核实后续跑，保存 126 步原布局顺序图和通关截图。
- ✅ [2026-11-14] 第 51 关新铁笼玩法留证：笼内点击未移动；笼外一只离场后计数由 50 降到 49，已按固定障碍进行阶段搜索与实机核对。
- ✅ [2026-11-14] 第 51 关铁笼计数归零后自动消失；开笼前 73 步、开笼后 61 步实机通关，匹配 10 只笼内猪并合并 134 步与通关截图。铁笼暂使用该关取证后的阶段处理，尚未接入通用自动识别。
- ✅ [2026-11-14] 第 52 关取证两个重叠铁笼：25、40 分别递减，先后归零后自动打开；第二笼呈 L 形。两次分阶段执行分别进入模型死局，保留截图并扩大完整搜索预算，尚未通关。
- ✅ [2026-11-14] 修复显式黄色候选过滤中的重复检测：同格且外框高度重叠时只保留一个候选；第 30 关密集鸭样本与歧义保护测试通过，`test:pig-auto` 41 项、`test:pig-lock-hints` 3 项通过。
- ✅ [2026-11-14] 第 52 关按动态铁笼模型整关搜索得到 164 步；不优先开笼，独立重放并实机通关，失焦后核对状态续接，保存完整步骤图和胜利画面。
- ✅ [2026-11-14] 进入第 53 关并保存首屏；自动识别将 70 计数铁笼误判为未知蓝色物件，未点击并留证停止，待处理。
- ✅ [2026-11-14] 铁笼笼外阶段接入通用连续流程：`pig_cage.py` 提取非矩形和重叠笼体，`pig_cage_stage.py` 局部 OCR、方向多帧核对、解锁目标搜索、未生效动作恢复和开笼后重识别；`pig_fast_locked_solver.cpp` 与 `play-pig-locked.py` 独立支持动态笼格验证。第 53 关已自动识别、执行笼外阶段并确认开笼；阶段路线未保证通关，完整搜索继续。`test:pig-cage` 14 项、`test:pig-locked` 8 项、`test:pig-special` 4 项、`test:pig-ocr` 4 项通过。
- ✅ [2026-11-14] 第 53 关通用流程识别 L 形铁笼、先执行笼外动作并自动核对开笼；修复数字遮挡形成的占格空洞、单数字 OCR 局部误读和仅需达到解锁目标的阶段搜索。两次完整搜索达到预算，开笼后 27 猪的通关仍待验证，保留现场。

- ✅ [2026-11-14] 第 53 关继续执行经验证的阶段动作，余猪从 27 减至 20；后续阶段未找到离场路径，保存 `level-53-continuation-stuck.png`，并独立重放验证 99 步历史前缀，以此前缀为参考的整关回溯达到 180 秒、3679088 个状态，未找到完整解，仍待寻找。

- ✅ [2026-11-14] 整理第 53 关求解交接包：包含首屏及还原标注图、97 猪初始布局、动态笼规则、99 步独立重放验证的历史前缀及当前卡关截图；交接材料位于被忽略的参考目录。

- ✅ [2026-11-14] 第 53 关外部路线经独立重放和逐步实机核对，109 步清除 97 只并通关；保存胜利截图及步骤顺序图。第 54 关锁计数 OCR 为 40，因方向未确认而暂停。

- ✅ [2026-11-14] 第 54 关人工核对锁猪向下，局部 OCR 计数 40；输出 88 猪初始 JSON 并实机确认阶段路线，剩余 19 猪时当前模型无进一步离场路径，保留现场待续。

- ✅ [2026-11-14] 第 54 关按外部提供的 114 步路线实机通关并保存步骤图、胜利图；进入第 55 关，采集两个铁笼关卡的初始识别候选，遮挡与方向尚需核对。

- ✅ [2026-11-14] 完成临时通用启发式求解实验：第 53 关以 2545 个状态复现 109 步，项目验证器通过；第 55 关候选布局 60 秒未找到完整解。实验代码未接入项目。

### 猪了个猪

- ✅ [2026-11-14] 接入可选通用启发式求解策略。
  - 新增 `pig_heuristic_solver.py`、`solve:heuristic-pig` 和自测入口，保留原生求解默认行为；候选路线转换后由现有规则独立重放，搜索超限不等于无解。
  - 第 53 关生成并独立验证 112 步，第 55 关生成并独立验证 117 步；动态笼、非法候选及不支持对象通过针对性检查。

### 猪了个猪

- ✅ [2026-11-14] 第 56 关实机通关：初次分阶段进入死局，利用两次开笼画面还原 93 猪及双笼，独立重放 110 步并在重开后逐步核对执行，保存初始布局、步骤图和通关截图。

### 猪了个猪

- ✅ [2026-11-14] 第 57 关实机通关：根据首屏与开笼画面还原 97 猪布局，搜索并独立验证 114 步，重开后逐步核对执行并保存步骤图和胜利截图。

### 猪了个猪

- ✅ [2026-11-14] 第 58 关实机通关：处理双笼计数 1 漏识别，结合开笼画面还原 91 猪并验证 124 步；窗口遮挡时确认待处理动作未生效后续接，合并首屏步骤图与胜利截图。

### 猪了个猪网页

- ✅ [2026-11-15] 初步接入动态铁笼及第 56、57 关：更新网页引擎、关卡数据和选择入口；`npm run test:pig-web` 通过。动画浏览器测试存在时间断言失败，特殊机制扩展及发布仍在进行中。

- ✅ [2026-11-15] 扩充猪了个猪网页关卡：新增第 5、6、7、9、10、12、17、19～25、27、30、58 关，其中第 58 关包含两个动态铁笼；更新网页选择、静态服务及测试清单，45 项网页测试通过。第 2～58 关的其余接入及公网发布仍未完成。

- ✅ [2026-11-15] 根据胜利记录接入第 53、54、55 关，含锁猪和动态铁笼；网页关卡与规则测试 48 项通过。其余缺失关卡及公网发布仍在进行中。

- ✅ [2026-11-15] 网页引擎增加鸭子连通离场、小象矩形占格，接入第 11、14、16、26、37、38、39 关；`npm run test:pig-web` 57 项通过。其余关卡和发布仍在进行中。

- ✅ [2026-11-15] 拼接并接入网页第 2、3、41 关，覆盖鸭子、剪刀和绳索；网页规则测试 60 项通过。第 43、50、51、52 关尚待还原完整机制。

- ✅ [2026-11-15] 核对第 52 关首屏与开笼画面，按网格还原矩形及 L 形双笼并接入网页；164 步重放与网页规则测试 61 项通过。

- ✅ [2026-11-15] 拼接第 50 关首屏与 126 步通关记录并接入网页；网页规则测试 62 项通过。核对线上和本地均仅对离场播放动画。

- ✅ [2026-11-15] 完成第 2～58 关网页接入及公网发布：第 43 关按首屏还原小象不规则占格，第 51 关对齐开笼前后网格与编号；57 关完整重放、64 项规则测试通过，Chromium 抽查七个关卡加载，公网 61 个资源 SHA-256 与本地一致。

- ✅ [2026-11-15] 修复网页铁笼上缺少倒计时数字：在每个未开笼的笼体内显示独立计数；第 52 关浏览器验证初始、递减、开笼和回退，64 项规则测试通过，公网脚本与样式 SHA-256 核对一致。

- ✅ [2026-11-15] 修复绳猪绑绳方向：横向猪显示竖直绑绳，纵向猪显示水平绑绳并随数量居中；Chromium 验证四个朝向，公网脚本 SHA-256 与本地一致。

### 猪了个猪

- ✅ [2026-11-15] 实机通关第 60、61 关：第 60 关完整路线 124 步；第 61 关人工复核蓝底铁笼与开笼画面，还原 94 猪并执行独立验证的 116 步。各关首屏、步骤图和胜利截图保存在 `docs/references/pig-game/play-runs/`；蓝底铁笼自动识别待改进。

### 猪了个猪

- ✅ [2026-11-15] 第 63 关实机通关：首屏及开笼后画面还原 95 猪与两鸭，确认三猪两鸭离场使铁笼计数从 35 降至 30；完整 132 步分段独立重放并与实机动作核对，首屏顺序图和胜利截图保存在 `docs/references/pig-game/play-runs/level-63-run-20261115-114159-030312/`。蓝底铁笼与鸭子的通用自动流程待完善。

### 猪了个猪

- ✅ [2026-11-15] 实机通关第 64、65、66 关：分别独立重放并核对 106、105、119 步，保留首屏、顺序图与胜利截图；第 64 关人工复核蓝底 L 形铁笼，第 66 关包含 20 鸭和计数 96 锁猪。第 67 关已开笼，完整路线待搜索。

### 猪了个猪

- ✅ [2026-11-16] 实机通关第 67、68、69、70 关：
  - 第 67 关：重开后分段执行已独立重放验证的 121 步完整路线（78 步前置 + 1 步开笼 + 42 步开笼后，93 只猪），保存初始布局、顺序图和胜利截图于 `docs/references/pig-game/play-runs/level-67-run-20261115-221312-792782/`。
  - 第 68 关：分阶段开 30 计数铁笼并结合开笼画面还原 94 只猪与动态笼，启发式搜索并独立重放验证 132 步完整路线（38 步前置 + 1 步开笼 + 93 步开笼后），重开后实机通关并保存完整证据于 `docs/references/pig-game/play-runs/level-68-run-20261116-215323-766300/`。
  - 第 69 关：复核 97 只猪及 45、50、70 三只计数锁猪，延后 40/90 号猪避开死锁环后求得并独立重放验证 130 步完整路线，实机通关并保存完整证据于 `docs/references/pig-game/play-runs/level-69-locked-20261116-224909-599846/`。
  - 第 70 关：提取 91 只猪并由原生 C++ 求解器计算且独立重放验证 125 步完整路线，实机通关并保存完整证据于 `docs/references/pig-game/play-runs/level-70-locked-20261116-230023-093387/`。

- ✅ [2026-11-16] 接入第 60～70 关至网页 `web/pig-level/` 并优化通用求解与执行脚本：
  - 新增 `web/pig-level/level-60.json` ～ `level-70.json`，更新 `app.mjs`、`index.html`、`scripts/serve-pig-level.js`、`tests/pig-level-web.test.js`；修复 `web/pig-level/engine.mjs` 鸭子离场未计入 `exitCount` 的问题；`npm run test:pig-web` 77 项全部通过。
  - `scripts/pig_locked_candidate.py` 新增 `profile_level` / `select_solver_profiles` 机制识别路由及 `strategy='auto'`，并支持多档启发式策略自动回退；`scripts/play-pig-locked.py` 优化 `match_cage_frame` 在蓝底漏检笼体时回退至已复核 `expected_cells` 边界过滤笼内猪；`npm run test:pig-locked`（8 项）与 `npm run test:pig-heuristic`（4 项）通过。
  - 在 `/mnt/AASC/goal/pig-game.md` 记录可复用开局提示词与已完成阶段目标。

- ✅ [2026-11-17] 实机通关第 71、72 关：
  - 第 71 关：复核 106 只猪与 2 只新机制“炸弹猪”（碰撞 3 次引爆），使用 `strategy='auto'` 求得并独立验证 140 步安全路线（炸弹猪碰撞均 ≤ 2 次），实机通关并保存证据于 `docs/references/pig-game/play-runs/level-71-locked-20261117-005010-115675/`。
  - 第 72 关：复核 93 只猪、3 只剪刀猪与 2 只捆绑猪，启发式求解并独立重放验证 135 步完整路线，实机通关并保存证据于 `docs/references/pig-game/play-runs/level-72-locked-20261117-011443-567073/`。
  - 第 73 关：复核 104 只猪与 5 只炸弹猪，使用 `strategy='auto'` 求得 129 步安全路线（每只炸弹猪碰撞均 ≤ 2 次），中断后从第 90 步续跑实机通关并合并保存证据于 `docs/references/pig-game/play-runs/level-73-run-20261117-081902-190190/`。
  - 第 74 关：复核 99 只猪与 3 只炸弹猪（修正 98 号炸弹猪朝向为 `west`），延后 53 号猪重算后半段将 100 号炸弹猪碰撞从 3 次降至 1 次，124 步安全路线实机通关并保存证据于 `docs/references/pig-game/play-runs/level-74-locked-20261117-084100-561849/`。
  - 第 75 关：复核 97 只猪与 2 只炸弹猪，使用 `strategy='auto'` 求得 112 步安全路线（炸弹猪总碰撞均 ≤ 2 次），实机通关并保存证据于 `docs/references/pig-game/play-runs/level-75-locked-20261117-094536-189387/`。
  - 第 76 关：还原 90 只猪与 52 计数 L 形动态铁笼，独立重放验证 131 步完整路线（65 步前置 + 1 步开笼 + 65 步开笼后），重开后分段实机通关并保存完整证据于 `docs/references/pig-game/play-runs/level-76-run-20261117-101408-194944/`。
  - 第 77 关：复核 92 只猪与 4 只炸弹猪（修正 17 号猪朝向为 `east`），延后 44/50 号猪确保炸弹猪总碰撞/滑动次数均 < 3，101 步安全路线实机通关并保存完整证据于 `docs/references/pig-game/play-runs/level-77-run/`。
  - 第 78 关：复核 89 只猪与 4 只炸弹猪，延后 89 号炸弹猪求得 124 步安全路线（炸弹猪总碰撞/滑动次数均 ≤ 2 次），一次实机通关并保存完整证据于 `docs/references/pig-game/play-runs/level-78-run/`。
  - 第 79 关：复核 87 只猪、16 只鸭子、5 把计数锁（87/87/93/93/93）、4 只剪刀猪、1 只捆绑猪与 3 只炸弹猪（80/81/82 碰撞均 ≤ 1 次），通过 88 号先滑动挡住 89 号避免形成死锁环，120 步完整路线一次实机通关并保存完整证据于 `docs/references/pig-game/play-runs/level-79-run/`。

### 窗前折纸工作台

- ✅ [2026-11-23] 完成网页版折纸模拟器首版设计。
  - 在 `goal/gami.md` 记录可复用的会话目标，补充设计、伪代码和实施任务。几何、光照与触控验收均列为开发阶段任务。
- ✅ [2026-11-23] 扩展折纸设计，增加多角向心折、整边翻折以及参考 Pig-game 的程序合成音效与音乐；同步目标、交互、伪代码和验收任务。
- ✅ [2026-11-23] 裁纸设计增加手动行列、方格联动和分区数量预览，同步规格与验收用例。
- ✅ [2026-11-23] 完成《鸢一折纸》游戏首页设计，明确新建、继续、导入、浏览的横竖屏布局、本机存档语义与发布验收目标。
- ✅ [2026-11-23] 发布《鸢一折纸》可玩首版。
  - 新增 `web/gami/`、几何自测与运行入口，支持折纸、分区裁切、陈列、本机存档和合成音乐音效。
  - 通过 `npm run test:gami`，SDDM 实体显示器硬件 WebGL 验证首页与工作台，公网 HTTPS 七个资源摘要与本地一致。

- ✅ [2026-11-23] 记录《鸢一折纸》悬空观察设计修订与在线参考，记录编辑与陈列场景的观察目标。
- ✅ [2026-11-23] 发布悬空折纸与角点吸附。
  - 编辑与陈列可从背面观察；单角和多角拖折支持屏幕空间吸附及释放。DISPLAY=:0 实测背面拖角、释放再吸附、提交后的坐标对齐；3 项几何与吸附自测通过。

- ✅ [2026-11-23] 记录手工拖折手势提案与提交、取消规则，供下一次交互改版确认。
- ✅ [2026-11-23] 默认使用手工拖折，按住角或边缘翻起纸瓣，松手压平并保存。
  - 更新折叠几何、页面手势与输入面板；保留精确折角和多角操作，四项自测及 DISPLAY=:0 硬件拖折验收通过。

- ✅ [2026-11-23] 记录手工折纸松手保持形状的设计修订，补充继续调整与主动压平的规格。
- ✅ [2026-11-23] 手工拖折松手保持纸瓣，支持再次拖动、自动存档、显式压平和逐步撤销。
  - 更新 `web/gami/app.mjs`、`scene.mjs`、`held-fold.mjs` 与页面工具栏，保持旧存档兼容；同步设计、伪代码、任务和使用文档。
  - `npm run test:gami` 验证几何与存档；`DISPLAY=:0 npm run test:gami` 在 SDDM 图形会话与 Intel HD 610 硬件 WebGL 上验证拖折、刷新、取消、压平和撤销。真实移动设备验收待完成。
- ✅ [2026-11-23] 发布手工拖折保持功能至外网 `https://c.aasc.us/mnt/game/gami/`。
  - 8 个网页资源公网 HTTP 200、大小及 SHA-256 均与本地一致；`DISPLAY=:0` 硬件 Chromium 验证首页、新建、拖折保持、继续和压平，页面错误为 0。
  - 外网切换前版本保留在 `/home/as/a/game/gami.backup-1795421769064-136036`。
- ✅ [2026-11-23] 修复手工折角提示已吸附但松手后纸尖未贴合目标的问题。
  - 更新 `web/gami/app.mjs` 与 `held-fold.mjs`：吸附时预览和存档均保持纸尖贴合，重新拖离后恢复弯曲；同步设计、伪代码、任务、使用说明和自测。
  - `DISPLAY=:0 npm run test:gami` 6 项通过；公网鼠标吸附及继续、压平验收通过，8 个资源 HTTP 200 且大小、SHA-256 与本地一致。外网旧版保留于 `/home/as/a/game/gami.backup-1795422429899-615176`。
- ✅ [2026-11-23] 记录有厚度纸张、持久折痕及折痕交点和边可直接操作的待确认方案；补充设计、伪代码、任务和待办，尚未实现。
- ✅ [2026-11-23] 实现并发布有厚度的点边折纸、持久折痕及直接拖动折痕展开。
  - 新增 `web/gami/paper-topology.mjs`、`paper-contact.mjs`，更新 `app.mjs`、`fold.mjs`、`held-fold.mjs`、`scene.mjs`；材料交点和分割边可拾取，纸面具备正背表面与侧壁，折痕及物理层位移随存档保存。
  - 接触扫描阻止纸瓣穿透，接缝按屏幕容差拾取；独立旧纸角可展开，受外层阻挡时保持安全位置。当前新折线需从公共平面建立，复杂弯折轴与移动设备性能保留为后续项。
  - `DISPLAY=:0 npm run test:gami` 13 项全部通过；公网鼠标验收压平留痕、边展开和刷新恢复，页面错误 0，10 个资源 HTTP 200 且大小、SHA-256 一致。
  - 外网旧版保留于 `/home/as/a/game/gami.backup-1795427938377-299768`；同步设计、伪代码、任务、使用说明、目标与待办。
- ✅ [2026-11-23] 记录纸张厚度设置提案，尚未实现。
  - 在 `docs/design/gami.md`、`docs/spec/gami.md`、`docs/task/2026-11-23_纸张厚度设置.md` 与 `docs/todo.md` 记录每纸厚度输入、统一几何及接触参数、存档兼容与穿透校验；待确认后修改代码和验证。
- ✅ [2026-11-23] 增加并发布每张纸独立的厚度设置。
  - `web/gami/index.html`、`style.css`、`app.mjs`：新建/添纸可填写厚度，工作台左上方提供滑块与数值输入；范围为原纸边长 0.1%～1%，默认 0.4%，随每纸存档、撤销、刷新及导入导出保存。控件移出底部面板，避免遮住待压平纸角。
  - `paper-topology.mjs`、`paper-contact.mjs`、`scene.mjs`：统一读取材料厚度用于正背表面、侧壁、折痕、可见拾取、层间距及折痕接触；变更时扫描层位移过渡，穿透或超出预算保留原值，旧存档默认值兼容。
  - `DISPLAY=:0 npm run test:gami` 15 项全部通过（SDDM / Intel HD 610），覆盖厚度输入、独立添纸、撤销、已折纸调整、刷新和真实 JSON 导出再导入，以及原有吸附、折痕、交点与展开。
  - 公网 `https://c.aasc.us/mnt/game/gami/` 10 个资源 HTTP 200，大小及 SHA-256 与测试版本一致；旧版备份 `/home/as/a/game/gami.backup-1795429294592`。同步设计、伪代码、任务、目标、使用说明与待办，完成任务已从待办移除。
  - 公网硬件浏览器实际操作验证新建厚度、滑块、已折纸增厚、撤销、折痕展开及刷新恢复，页面错误 0；390×844 窄屏模拟布局检查通过，真实移动触控性能仍待设备实测。
- ✅ [2026-11-23] 定位层间净间隙为零和吸附标记使用零高度投影的问题，记录修复方案，尚未修改功能代码。
  - 在设计、伪代码、任务及待办记录纸厚 25% 的净间隙、统一可见表面锚点与吸附投影、旧层位移兼容及回归用例，待用户确认。
- ✅ [2026-11-23] 修复重叠纸面无净间隙及吸附提示与可见位置不一致，发布外网。
  - `web/gami/paper-topology.mjs`、`paper-contact.mjs`：层中心距为纸厚的 1.25 倍，表面净间隙为纸厚 25%，接触与厚度调整使用统一包络；旧层位移安全迁移一次，失败保留原形并按旧距离展开。
  - `scene.mjs`、`app.mjs`、`held-fold.mjs`：拾取、拖动反投影、操作点与橙色标记使用实际表面锚点；保存吸附目标材料坐标，预览及再次拖动保持同一目标。修正边中点零高度投影导致的折线偏移。
  - `fold.mjs` 及共面分层：在既有容差检查后恢复精确公共平面，平折输出精确零高度；使用线性投影识别细小重叠片，避免漏分层导致改厚度被拒绝。
  - `DISPLAY=:0 npm run test:gami` 19 项通过，SDDM / Intel HD 610 硬件 WebGL；截图中正面、斜视及背面标记中心误差为 0.093 / 0.114 / 0.108 px。同步设计、伪代码、任务、使用说明、目标和待办，完成项已移出待办。
  - 公网 10 个资源 HTTP 200，大小与 SHA-256 均与测试版本一致；旧版备份 `/home/as/a/game/gami.backup-1795433100636`。
  - 公网硬件浏览器鼠标验收净间隙、材料吸附目标、厚度调整、撤销、折痕展开和刷新恢复，页面错误 0；390×844 窄屏模拟布局检查通过。

- ✅ [2026-11-23] 增加并发布独立「分开」工具，沿已有折痕从点边展开压平纸瓣。
  - 新增 `web/gami/separate.mjs`，更新 `app.mjs`、`scene.mjs`、`index.html`、`style.css`：按所选材料面关联已有折轴，交点分段可选轴，青色折痕及橙色展开轴，拖动角点、边界或折痕实际展开；小角度安全试转投影支持斜视和背面方向。
  - 松手保持、自动存档、撤销、取消及切换工具沿用版本 1；无折痕和待压平纸张提示操作条件，保留厚度、层间净间隙与碰撞约束。同步设计、伪代码、任务、目标、使用说明和待办；完成条目已移除，真实移动设备手感与性能仍待验收。
  - `DISPLAY=:0 npm run test:gami` 21/21 通过（SDDM / Intel HD 610），新增角点、边界、折痕、选轴、取消、撤销、刷新及 390×844 CDP 触控用例，页面错误 0；原有吸附、厚度与真实导入导出回归通过。
  - 公网 `https://c.aasc.us/mnt/game/gami/` 的 11 个资源 HTTP 200，大小与 SHA-256 和测试版本一致；旧版备份 `/home/as/a/game/gami.backup-1795439566166`。
  - 公网 SDDM Chromium 实测角点抬起、边界完全展开、撤销、折痕保留与 390×844 触控通过，页面错误 0。

### 鸢一折纸

- ✅ [2026-11-23] 改善分开手感并发布外网：抓取点沿真实投影轨迹跟随鼠标或手指，支持连续展开、回拖和活动纸瓣高亮。
  - `web/gami/app.mjs`、`separate.mjs`、`scene.mjs`：透视校正边上抓取位置，三维折轴轨迹求角，端点贴合与原接触扫描共同限制展开；取消、松手保持和撤销沿用原存档格式。
  - `tests/gami.test.js`：新增含材料坐标的旋转对照、不同投影及回拖求角；SDDM / DISPLAY=:0 / Intel HD 610 下回拖误差小于 4px，角点抬起、边界完全展开、折痕拖动、取消、切换、撤销、刷新和 390×844 触控通过，页面错误 0。修正导入回归匹配旧确认框的时序。
  - `DISPLAY=:0 npm run test:gami` 22/22 通过；补充材料坐标旋转对照测试通过。旧功能浏览器回归通过，正面/斜视/背面吸附标记误差 0.093/0.114/0.108px。设计、伪代码、任务、目标、使用说明和待办同步；真实移动设备手感仍待验收。
  - 公网 11 个资源 HTTP 200，大小与 SHA-256 均一致；旧版备份 `/home/as/a/game/gami.backup-1795446795121`。

### 鸢一折纸

- ✅ [2026-11-23] 调研手工折纸的点边对齐、预折痕、展开及多折痕协同，记录对向抓取交互草案。
  - 更新 `docs/design/gami.md`、`docs/spec/gami.md`、`docs/todo.md` 及任务文档；当前实现只支持单抓取/单轴，双指仅环视，已记录差距。待确认“对向平行角点”的材料层语义，未修改功能代码或发布。

### 鸢一折纸

- ✅ [2026-11-23] 记录双模式预折痕补充方案：折后保持与压痕后还原起折前姿态分离。
  - 更新 `docs/design/gami.md`、`docs/spec/gami.md`、`docs/todo.md` 和任务文档；明确恢复原位置/纸形/纸层、保留旧折痕及新增交点边，尚未修改功能代码或发布。

### 鸢一折纸

- ✅ [2026-11-23] 定位弯折时角点球被隐藏的条件，记录持续显示角点及取消未完成弯折方案。
  - `scene.mjs` 当前在预览或 heldFold 存在时跳过普通标记；拟按材料拓扑映射弯曲表面。同步设计、伪代码、待办及双模式任务文档，尚未修改功能代码。

### 鸢一折纸

- ✅ [2026-11-24] 实现折痕/预折痕双模式、双角对向分开、弯折角点球及取消整轮弯折。
  - `web/gami/held-fold.mjs`、`paper-topology.mjs`：预折痕细分原材料面并继承原姿态与层位移，保留旧折痕和可操作交点；重复共线压痕去重，取消不新增折痕。
  - `pair-controls.mjs`、`separate.mjs`、`paper-contact.mjs`：编号显式选层，鼠标先固定再拖另一角，双指共轴对向拉开；相对角使用原接触扫描，整体刚性旋转保留材料长度及层间净间隙。
  - `app.mjs`、`scene.mjs`、`index.html`、`style.css`：弯折预览和待压平状态持续显示真实材料角点；左上取消入口终止整轮操作，迟到松手不会重存。模式刷新恢复、撤销和旧存档兼容；预折痕纸不进入原纸裁切路径。
  - `tests/gami.test.js` 新增几何及浏览器用例；专项验证预折痕还原、整轮取消、鼠标固定角与 390×844 CDP 双指分开通过，页面错误 0。完整回归发现并修复底部按钮遮挡纸角；取消按钮移至左上材料参数下方。最终 `DISPLAY=:0 npm run test:gami` 25/25 通过，SDDM / Intel HD 610，未跳过用例。
  - 同步设计、伪代码、任务、目标、使用说明与待办；完成条目已移除，真实移动设备手感及多折轴耦合仍列为后续工作。
  - 公网 `https://c.aasc.us/mnt/game/gami/` 的 12 个资源 HTTP 200，大小及 SHA-256 与测试版本一致；旧版备份 `/home/as/a/game/gami.backup-1795449557943`。
  - 公网硬件浏览器确认预折痕还原、取消入口及双角编号加载正常，页面错误 0。

### 鸢一折纸

- ✅ [2026-11-24] 检查工作台操作 UI，记录游戏化界面方案，待用户确认。
  - 更新 `docs/design/gami.md`、`docs/spec/gami.md`、`docs/todo.md` 及 `docs/task/2026-11-24_折纸游戏化操作界面.md`：建议图标工具栏、模式分段按钮、上下文动作、设置收纳和 HUD 边界避让；尚未修改功能代码或发布。

### 鸢一折纸

- ✅ [2026-11-24] 实现游戏式工作台 UI：悬浮图标工具栏、折痕/预折痕分段按钮、固定确认取消区，以及按需展开的厚度与声音设置。
  - `web/gami/index.html`、`style.css`、`hud.mjs`、`app.mjs`：米白/青绿/暖橙控件、按压与选中反馈、44px 触控目标、横竖屏适配、Escape 关闭设置和焦点恢复；保留已有折纸/存档动作契约。
  - `pair-controls.mjs` 按实际 HUD 边界避让编号；修复工具容器与按钮状态属性冲突，固定提示栏高度，避免第一指抓角后第二编号跳位。
  - `tests/gami.test.js` 更新真实入口，增加桌面/竖屏/横屏的按钮尺寸、点击可达性、设置避让与 UI 不改变存档验证；旧厚度/吸附/待压平/撤销浏览器回归通过，单点分开及 HUD 用例复跑通过；定位双指测试在切换视口后读到桌面旧坐标，增加真实重绘等待后双指专项通过，完整双模式复跑通过。26 项用例分组验证通过（22 项几何/状态 + 4 组浏览器），DISPLAY=:0 / SDDM / Intel HD 610；首轮异常退出不计通过，修正后的用例已重跑。
  - 用户补充角点不跟手和弯折抬高反馈，已记录原因、拟修正文件及实际表面投影求解方案，等待补充确认；本次尚未改动几何算法。
  - 已切换公网 `https://c.aasc.us/mnt/game/gami/`，13 个资源 HTTP 200、大小和 SHA-256 均一致；旧版备份 `/home/as/a/game/gami.backup-1795489841318`。
  - 公网硬件浏览器实测设置开关、预折痕还原、取消入口及双角编号加载通过，页面错误 0。完成 UI 任务已从待办移除，角点跟手/抬高补充方案仍待确认。

### 鸢一折纸

- ✅ [2026-11-24] 修复角点拖动偏离鼠标，降低手工弯折抬高幅度。
  - `web/gami/drag-projection.mjs`、`app.mjs`：根据弯曲后的实际材料表面投影逆解拖动目标，保留按下球心偏移，最多六轮阻尼迭代，不在求解中重建场景；吸附仍使用精确材料目标。
  - `held-fold.mjs`：新弯曲宽度上限 0.42 → 0.14，增益 0.45 → 0.16；继续拖动采用较低增益，旧存档保持原形与原合法范围。
  - `tests/gami.test.js` 新增投影逆解、退化/非法候选和实际浏览器连续跟手验证，支持通过 GAMI_TEST_URL 验证公网。23 项几何/状态 + 3 组受影响浏览器测试通过；正面/斜视/再次抓取误差 <2px，抬高不超过纸边长 4.5%，吸附像素标记误差 <0.12px。厚度、刷新、压平、撤销、预折痕还原、整轮取消及双角鼠标/触控回归均通过。
  - 同步 design/spec/task/usage/goal 文档，已完成事项从 todo 移除；真实移动设备手感与复杂分区性能保留为待办。
  - 已发布公网 `https://c.aasc.us/mnt/game/gami/`，14 个资源 HTTP 200、大小及 SHA-256 一致；旧版备份 `/home/as/a/game/gami.backup-1795495640159`。
  - 公网 DISPLAY=:0 硬件浏览器跟手专项复测通过，页面错误 0。
