# 自测功能文档

## MMD AR 定位图底面/立面切换（2026-09-26）

`npm run build:web:mmd-ar-test` 成功。`node --test tests/mmd-ar-camera-runtime.test.js` 1/1 通过：底面原有中心映射保持，立面时角色脚底投影对齐目标图下边缘中点；模式切换立即更新相机，模型位置、缩放与物理根节点不变。面板和 MindAR 锚点回归 8/8 通过，覆盖按钮本地保存/刷新恢复、分类开合与自定义图重启。`git diff --check` 通过；本次未发布网页或 APK，真实手机立面观感待现场验收。

## MMD AR 蓝框与角色相机重锁同步（2026-09-26）

`npm run build:web:mmd-ar-test` 成功；`node --test tests/mmd-ar-web-tracking.test.js` 1/1 通过，覆盖首锁、失锁、重锁时没有后续 `targetUpdate`、PMX 暂时拒绝位姿后恢复同步；`node --test tests/mmd-ar-camera-runtime.test.js` 1/1 通过，覆盖失锁后继续跟随及 100%/50% 距离下角色脚底中心与定位图中心投影一致；`node --test tests/mmd-ar-background-resume.test.js` 1/1 通过。适配器语法与 `git diff --check` 通过。仅本地构建，未发布外网或 APK；真实手机蓝框/角色对齐和缓动观感待现场验收。

## MMD AR 相机防抖版外网发布（2026-09-26）

重新执行 `npm run build:web:mmd-ar-test` 成功；与外网对比仅首页、显示模块和 PMX 相机运行时三个文件不同。三文件暂存后 SHA-256 与本地一致，按 runtime→显示模块→首页顺序原子切换；公网 HTTPS 三文件内容 SHA-256 全部一致，首页为 `c8a24f2a4c1da1bc0484b74bb3313c081d93ca107397cd3044b0aea259a68d52`。除远端既有隐藏文件外，整站资源哈希与本地构建一致。`MMD_AR_TEST_URL=https://c.aasc.us/mnt/mmd-ar/ node --test tests/mmd-ar-web-tracking.test.js` 1/1 通过；本地面板 7/7、相机合成姿态 1/1、相关回归 10/10 已在发布前通过。未打 APK；真实手机弱光抖动和跟手体验待现场确认。

## MMD AR 相机防抖与中心连线距离（2026-09-26）

`npm run build:web:mmd-ar-test` 成功。`node --test tests/mmd-ar-web-panel-groups.test.js` 7/7 通过：新增“相机跟随”分类，四个滑条按默认值显示，修改距离后保存到测试页 localStorage，刷新恢复，手机窄屏开合和滚动仍正常。`node --test tests/mmd-ar-camera-runtime.test.js` 1/1 通过：距离 50% 使相机相对定位图中心的三轴位移均减半，模型根节点和相机朝向不变；微小平移/旋转不触发画面抖动，真实移动仍跟随，缓动无瞬移，失锁时立即冻结未完成的缓动。2026-09-26 新增距离 50% 下定位图越过 1% 死区仍须跟随的断言，确认死区以锚点位姿而非相机位移判定，定向回归 1/1 通过；面板及 A-Frame 锚点回归 8/8 通过。后台恢复、A-Frame 锚点及校准既有回归 10/10 通过；四个 JS 语法检查和差异检查通过。真机弱光抖动、快速移动与 50% 透视效果尚待验收；本次修正未发布外网或 APK。

## MMD AR HTTPS 测试网页外网发布（2026-09-26）

重新执行 `npm run build:web:mmd-ar-test` 成功；本地与外网对比仅有九个静态文件不一致，模型/纹理/VMD 无差异。九个文件经暂存 SHA-256 校验后按脚本、清单、首页顺序原子替换到 `/home/as/a/mmd-ar/`；公网 `https://c.aasc.us/mnt/mmd-ar/` 对九个文件逐一请求，内容 SHA-256 全部与本地一致，首页 SHA-256 为 `aa26b8b9823b2e379baf65f0337bb82621487b3b9b6e960fc1aebf946c9c15ea`。`MMD_AR_TEST_URL=https://c.aasc.us/mnt/mmd-ar/ node --test tests/mmd-ar-web-tracking.test.js` 1/1 通过，涵盖 MindAR 锚点、目标丢失及自定义图重启。真实手机相机与视觉观感仍待现场验收；未打 APK。

## MMD AR 失锁保留与模拟图平面旋转（2026-09-26）

`npm run build:web:mmd-ar-test` 成功；`node --test tests/mmd-ar-camera-runtime.test.js` 1/1 通过：失锁后模型仍可见、根节点和最后相机位置不变，停止定位恢复普通视角。`node --test tests/mmd-ar-sim-camera.test.js` 1/1 通过：非正方形原图按等长平面坐标先旋转、再做经纬度透视，90° 几何关系及 360° 回到原方向均正确，拍照校准和模拟 MindAR 首锁通过。后台恢复、A-Frame 锚点、正式校准定向回归 10/10 通过；三个 JS 语法检查与 `git diff --check` 通过。真实手机视觉和失锁/重锁手感待现场确认；未发布外网或 APK。

## MMD AR 模拟图双侧透视与水平旋转（2026-09-26）

`npm run build:web:mmd-ar-test` 成功。`node --test tests/mmd-ar-sim-camera.test.js` 1/1 通过：左经度、右纬度、下方 0–360° 水平旋转布局与原图比例滑条长度正确；90° 旋转符合绕画面中心变换，360° 回到原方向，重置、图片平移、模拟拍照、MindAR 首锁和流释放均通过。`tests/mmd-ar-background-resume.test.js` 1/1、原定位与校准回归 9/9 通过。真实手机触控和竖屏布局待验收；本轮未发布外网或 APK。

## MMD AR 模拟定位前台恢复与相机独立（2026-09-26）

`npm run build:web:mmd-ar-test` 成功；`node --test tests/mmd-ar-background-resume.test.js` 1/1 通过：测试页用 `document.visibilitychange` 模拟切后台，已运行的模拟定位释放旧轨道，回前台用同一目标建立新轨道；手动停止后不会自行恢复。`node --test tests/mmd-ar-camera-runtime.test.js` 1/1 通过：加载实际 PMX 后模拟目标姿态平移，模型根节点位置和缩放从定位前到停止后始终相同，相机位置随锚点变化。原定位与校准回归 9/9 通过。真实浏览器后台节流及手机实拍待现场验收；未发布外网或 APK。

## MMD AR 模拟取景按原图比例（2026-09-26）

`npm run build:web:mmd-ar-test` 成功；`node --test tests/mmd-ar-sim-camera.test.js` 1/1 通过。无摄像头 Chromium 先加载 662×867 竖图，再切换为 812×429 横图：模拟画布宽度保持 960，纵向分别按原图比例取整；预览记录原图宽高比，纬度滑条分别随原图比例更新。横图的拍照校准、IndexedDB 保存图和 MindAR 输入视频尺寸一致，模拟首锁和流释放通过。原有定位与校准回归 9/9 通过，语法及 `git diff --check` 通过。未运行真实摄像头或手机验收；未发布外网或 APK。

## MMD AR 平放定位图相机与纬度滑条（2026-09-26）

`npm run build:web:mmd-ar-test` 成功。`node --test tests/mmd-ar-sim-camera.test.js` 1/1 通过：纬度滑条高度由横向滑条宽度和 960×540 取景比例计算、受预览高度限制，模拟图仍可被 MindAR 首锁并向 PMX 发送相机姿态。`node --test tests/mmd-ar-camera-runtime.test.js` 1/1 通过：加载实际 PMX 后，平放目标锚点的逆矩阵将相机放在图上方，模型脚底在目标中心；锚点平移带动视角，失锁隐藏模型，停止恢复普通展示状态。原有定位与校准回归 9/9 通过。上述为 Chromium 合成输入/姿态测试，非真实手机摄像头验收；外网网页和 APK 未发布。

## MMD AR 电脑模拟视角控制（2026-09-26）

`npm run build:web:mmd-ar-test` 成功；`node --test tests/mmd-ar-sim-camera.test.js` 1/1 通过。无实体摄像头 Chromium 在内网式深层路径上传 `testimg/mindar.JPG`，经纬度与缩放滑条改变同一平面的透视，画面拖动仅改变平移，重置恢复默认。模拟拍照校准保存的四角与画面一致，官方目标仍可从模拟流首锁；`getUserMedia` 未被调用，停止后流已释放。控件布局和透视几何断言已加入测试。正式校准及面板等定向回归 15/15 通过；A-Frame 锚点测试与另一个 Chromium 测试并跑时首锁失败一次，单独复跑 1/1 通过。真实手机摄像头及外网页面不是本轮验收范围；未发布外网或构建 APK。

## MMD AR 测试网页拍后矩形选区（2026-09-26）

`npm run build:web:mmd-ar-test` 成功；`node --test tests/display-mmd-ar-calibration.test.js` 8/8 通过，覆盖网页矩形八个缩放块、整体移动、右边和左上角缩放，以及正式显示端 0°/90°/180°/270° 四角拖动原行为。`node --test tests/mmd-ar-sim-camera.test.js` 1/1 通过：浏览器从内网式深层路径加载，模拟画面拍照后移动并缩放矩形，IndexedDB 保存的 `selectedQuad` 与选区一致；随后官方目标仍可首锁，模拟流停止后无页面异常。真实手机手指命中与视觉效果待现场验收；本轮没有发布外网或重打 APK。

## MMD AR 内网路径与模拟拍照校准（2026-09-26）

同一 `web-dist` 在 `/mnt/mmd-ar/` 与 `/mnt/AASC/3rd/mmd-ar-test/web-dist/` 两种路径的浏览器回归分别通过；模拟模式下“拍照校准”预览 960×540 透视画面，拍摄并保存的 IndexedDB 图片也是 960×540，未调用 `getUserMedia`，保存后绘制计时器结束，随后可再次运行 A-Frame 官方目标定位。实际内网 HTTP `http://192.168.1.39/mnt/AASC/3rd/mmd-ar-test/web-dist/` 返回最新本地构建，Chromium 在 `isSecureContext=false` 下正常打开模拟校准，取消后流停止，页面错误 0；页面 JS/CSS、MindAR vendor、官方图、MMD 清单和 PMX 请求返回 200。`node --test tests/mmd-ar-web-tracking.test.js tests/mmd-ar-sim-camera.test.js` 2/2、面板 7/7、正式校准/编译/阴影 11/11 通过。外网仍是上次发布内容，未执行本轮外网发布。

## MMD AR HTTPS 网页模拟摄像头透视输入（2026-09-26）

`npm run build:web:mmd-ar-test` 成功；无实体摄像头 Chromium 上传 `testimg/mindar.JPG`，透视四角拖动改变画布内容，隐藏/恢复操作点保持当前四角，重置恢复默认。A-Frame 使用 960×540 模拟流，真实 MindAR 官方目标成功首锁，`getUserMedia` 调用 0 次；停止后绘制定时器与视频轨道释放。定位与面板定向回归 9/9 通过。已发布到 `https://c.aasc.us/mnt/mmd-ar/`，首页及两份变更脚本通过外网 HTTP 和 SHA-256 校验；未构建 APK。真机真实摄像头首锁仍待现场验收。

## MMD AR HTTPS 页 A-Frame 目标锚点定位（2026-09-25）

`npm run build:web:mmd-ar-test` 成功。`node --test tests/mmd-ar-web-tracking.test.js` 本地及 `MMD_AR_TEST_URL=https://c.aasc.us/mnt/mmd-ar/` 线上各 1/1 通过；Chromium 将 `testimg/mindar.JPG` 持续绘制到模拟相机，官方 MindAR Basic `.mind` 目标触发 `targetFound` 和 `targetLost`，蓝色矩形与十字附着在 A-Frame 目标锚点，单次相机申请，停止后宿主隐藏、视频移除、Controller 释放；自定义目标经既有裁剪/编译生成临时 `.mind` 后成功重启。校准/面板/阴影回归 16/16，编译与指标测试 6/6；语法与 `git diff --check` 通过。已发布 `https://c.aasc.us/mnt/mmd-ar/`：当前构建的 55 个资源线上 SHA-256 均与本地一致，其中首页 `166f126a78dd53d9837ce42a7ee72f5d0cf76bd1aaeae28eb8c282a0d767d94f`。真实手机的首锁、透视对齐和高分辨率性能待现场验证。旧 Controller 分辨率档位及其历史自测记录不适用于新版 A-Frame 网页。

## MindAR Basic 自定义图片定位（2026-09-25）

语法检查通过；`node --test tests/mind-basic-custom-target.test.js tests/mind-basic-custom-target-browser.test.js`：8/8 通过。390×844 Chromium 视口模拟摄像头端到端验证完整帧拍摄、默认四边内缩 10% 的蓝色叠加框、框体移动、角点缩放、没有单独裁剪缩略图、重拍重置、IndexedDB 保存及控制面板默认展开/折叠/恢复。真实 MindAR 1.2.5 Compiler 对调整后的目标实际编译并启动通过；HTTPS 发布页同一浏览器测试通过。首页/CSS/JS/几何脚本本地与 HTTPS SHA-256 一致：`c04e5dc27499af557112001b0a0e17951c57edf02fceaba9854abe90006b7446`、`388c228dbae5dffe176341e5206ee939a3d28c85647863a3cb28361f06073d36`、`297fcdd1f3bfcfbb5cf2fc091fd179f106722dc79652f0fdc3995b2d6fce72ca`、`ceb2f1f9f900c1eac34d34b31e20ed26ec69d5e1e83943a018f6f1df7750f6f9`。`/mnt/mmd-ar/` 首页 SHA-256 未变化。照片未上传；手机真触摸命中、真实摄像头目标首锁及模型对齐待现场验证。

## MindAR Basic 官方示例外网发布（2026-09-25）

官方 Basic 副本首次发布记录：旧版首页 HTTP 200，2,631 bytes，SHA-256=`ff688f1a6715d07912b41ac57321e6efdf3512425e42533d3cd32f4a00cb9d4a`；后续已由上方自定义目标版本替换。A-Frame、MindAR、目标文件、卡片图、glTF、bin 和纹理资源均为官方 CDN 资源。页面保留官方 MindAR target 与 Softmind 动画模型，并展示 CC BY 4.0 署名。

## MMD AR 测试网页纯定位标记（已被取代的中间版本，2026-09-25）

当时短暂构建并发布过不加载 MMD 的纯定位页；该版本已按用户澄清被完整 MMD 测试页取代。其历史自动化结果不能作为当前网页验证。

## MMD AR 完整测试页定位标记分支（2026-09-25）

`npm run build:web:mmd-ar-test` 成功，完整输出 54 个文件、19,350,632 bytes（18.45 MiB），包含 MMD canvas/runtime、Three.js/Ammo、MindAR、默认 PMX/12 张纹理/VMD 和 profile。HTTPS 首页 HTTP 200，41,337 bytes，SHA-256=`1bd94c8e6eacc9df5fd67359792639505ad8cf60f983c864b619a287ea1a3abd`；全部 54 个文件均 HTTP 200 且公网 SHA-256 与本地一致。静态结构确认模型初始化存在，标记分支显示后提前返回、不调用该帧模型姿态更新；构建脚本与 AR 脚本 `node --check`、定向 `git diff --check` 通过。未运行自动化测试套件；手机摄像头、标记视觉对齐及实时模型交互待现场验收。MindAR Basic 首页继续 HTTP 200 且哈希未变。

## APK 与 Offline 热更产物 Git 来源

在 Git 仓库中分别生成 APK、服务 code-only/all 包及 min APK 清单。检查 APK `build-manifest.json` 的 `source.gitCommit` 是完整提交 hash，`source.gitDirty` 与打包时工作区状态一致；检查服务签名清单 `components.code.source`、all 模式下新生成的 `components.dependencies.source` 和 min APK 的 `components.apkMin.source` 与各自输入一致。修改 payload 后清单 RSA 签名应仍可校验；无 Git 仓库的打包测试夹具应得到 `gitCommit=null`、`gitDirty=null`，旧的无 source 清单仍可通过验签和解析。

## testimg/mindar.JPG 定位找到后回放（2026-09-25）

只读诊断，无代码或发布变更。`3rd/mmd-ar-test/testimg/mindar.JPG` 为 812×429 网页截图，官方定位图位于截图局部。Chromium 将整张截图绘制到 1920×1080 模拟相机，使用页面内置官方 PNG 为目标、35% 识别输入（672×378）：约 4.1 秒首锁，采到 6 个新样本、3 个可见样本、3 次姿态更新；点击回调约 0.94 秒，切空白画面后返回 `lost`。这验证直接 MindAR session 路径，不等于完整页面模型显示通过。静态 `canvas.captureStream()` 在本机没有重绘时 1.6 秒产生 0 次 `requestVideoFrameCallback`，持续重绘后同等时间产生 15 次，因此静态源不能用于验证依赖视频帧回调的完整页面流程。完整页面重绘回放在无硬件 GPU 的 Chromium 中超时，未取得可用的模型姿态/按钮/停止流程结论；ADB 当前无设备。真机上需用该图再次检查“开始定位 → 找到 → 模型跟随 → 面板可点 → 丢失 → 结束定位”。

## HTTPS MMD AR 识别分辨率档位（2026-09-25）

`npm run build:web:mmd-ar-test` 成功；`node --test tests/mmd-ar-web-panel-groups.test.js tests/mmd-ar-web-tracking.test.js tests/display-mmd-ar-calibration.test.js`：15/15 通过。生成页只在 HTTPS 模式出现 25%／35%／50%／75%／100% 档位，默认 100% 相对摄像头原始帧。浏览器测试验证 35% 对 1920×1080 得到 672×378、刷新后选项恢复、运行中选择 50% 提示下次生效，且仍可锁定官方图、响应点击和退出定位。公网首页与 MindAR 适配脚本 SHA-256 和本地一致。100% 高分辨率真机性能未模拟，现场需测并可预先降档。

## HTTPS MMD AR 识别后页面响应（2026-09-25）

`npm run build:web:mmd-ar-test` 成功。`node --test tests/mmd-ar-web-tracking.test.js tests/display-mmd-ar-calibration.test.js tests/mmd-ar-web-panel-groups.test.js`：15/15 通过。Chromium 使用 1920×1080 合成视频对准官方定位图，MindAR 输入限制在 640×480 像素预算内；识别后页面点击回调在 1 秒内执行，姿态写入限速，随后空白帧能退出定位。网页首页和两段 AR 脚本的公网 SHA-256 与本地一致。合成视频不代表真机 GPU/PMX/AO 压力，手机持续跟踪时实际按钮响应与帧率待现场验收。

## HTTPS MMD AR 单算法、手机滚动和阴影来源（2026-09-25）

`npm run build:web:mmd-ar-test` 后检查生成页不含算法选择器/旧跟踪器脚本，`web-dist/js/` 不含旧跟踪器文件。`node --test tests/mmd-ar-web-panel-groups.test.js tests/display-chat-mmd.test.js tests/display-mmd-ar-calibration.test.js`：59/59 通过，包含真实触摸上滑、分组、阴影旧配置迁移与 AR 校准。PMX AO/阴影浏览器定向回归 12 通过、2 项因测试环境跳过。使用 `testimg/target.jpg` 和三张实拍图独立会话静态回放 MindAR，3/3 可锁定；结果仅代表样本，真机连续视频首锁与阴影画质仍需现场验收。外网 5 个页面/脚本文件公网 SHA-256 与本地一致，旧网页跟踪器文件已精准移除；正式源码保留。`display-mmd-runtime.test.js` 仍有 1 项既有 helper 签名断言失败。

## MindAR 编译回调修正版外网发布（2026-09-24）

独立 MMD AR 测试 APK 已覆盖上传到 `http://120.79.245.103/mnt/aasc-offline/apk/aasc-mmd-ar-test.apk`。本地、SSH 远端文件和公网 GET 响应的 SHA-256 均为 `54e4e2be3acfbf56dff1b59259c05410ab0dc657d3deab8f02114b971a39a985`，文件大小均为 `13,620,450` bytes，HTTP 返回 200。未修改服务更新清单。MindAR 实际相机编译与图片首锁仍待设备验证。

## 显示端交互层旋转适配（2026-09-23）

运行 `node --test tests/display-stage-rotation.test.js tests/display-chat-mmd.test.js tests/display-broadcast-text-rotation.test.js`，59/59 项通过：覆盖 0°/90°/180°/270°逻辑视口、安全区和软键盘边映射、MMD Canvas 逆旋转坐标、聊天/MMD 分层和独立播报层旋转。`node --check` 检查 `display-stage.js`、`display-mmd.js`、`display-mmd-ar.js` 通过。四方向视觉布局、真实触摸命中、软键盘与 Android WebView 表现仍需现场验收。

## MMD AR HTTPS 测试页（2026-09-24）

2026-09-25 主光阴影/MindAR 取帧回归：`npm run build:web:mmd-ar-test` 成功；`tests/mmd-ar-web-tracking.test.js` 在 Chromium 合成 640×480 视频中先人为设定 300×150 DOM 视频尺寸，启动时同步为 640×480 后可定位内置官方图，切空白帧后能退出定位。主光默认开启、标题开关本地保存与补光三模式组合由 `tests/mmd-ar-web-panel-groups.test.js` 和 `tests/mmd-ar-web-shadow.test.js` 覆盖；真实 PMX WebGL 组合回归包含在 62/62 通过的定向测试中。HTTPS 测试页首页与四个变更脚本的公网 SHA-256 和本地一致；现场摄像头首锁仍须手机复测，真机效果不由合成视频结果代替。

2026-09-25 校准/双光回归：执行 `npm run build:web:mmd-ar-test` 及 `node --test tests/mmd-ar-web-panel-groups.test.js tests/mmd-ar-web-shadow.test.js tests/display-chat-mmd.test.js tests/display-mmd-ar-calibration.test.js`，62/62 通过。Chromium 360×600/DPR 3 下校准弹窗未越出可视区，单个定位按钮在摄像头关闭时禁用、跟踪中显示“结束定位”并调用停止；真实 PMX 加载后依次切换补光无阴影、沿用主光阴影、自身阴影，没有 GLSL/WebGL 编译错误。四个改动文件的公网 SHA-256 与本地一致；真机摄像头拍照后四角拖动、短屏滚动和双阴影画质/帧率待现场验收。正式显示端及测试 APK 不启用网页专用双阴影标记。

2026-09-25 分类回归：运行 `node --test tests/mmd-ar-web-panel-groups.test.js`，3/3 通过；确认灯光六类、定位三类、首组默认展开、原控件 ID/值保留，新增未分类控件会使构建失败。Chromium 390×844/DPR 3 下独立开合 AO 与跟踪组，两个首组保持展开，面板宽度未超出视口。`npm run build:web:mmd-ar-test` 成功；公网 HTTPS 首页 200，SHA-256 与本地/SSH 远端均为 `0d39655885b6c22a7d85a87037c01476048f95c13e2cd16a8a8cc3e813dcb0c3`。真实手机触摸和相机流程待现场验收，独立 APK 未重打。

2026-09-25 标题开关回归：灯光分类扩展为七类（边缘光 1/2 独立），定位三类；AO、补光、边缘光 1/2、体感环绕开关移入浅色标题行。`node --test tests/mmd-ar-web-panel-groups.test.js` 3/3 通过；Chromium 390×844/DPR 3 验证点开关不展开、点展开按钮不改变开关、原控件值和面板宽度保持正常。网页构建、脚本语法和差异检查通过；HTTPS 200，公网首页 SHA-256=`9664cd6a1bc6e0a10c87611fe7848502134333063d8132e0cc6a76bc5db90205` 与本地/SSH 远端一致。真机触摸和相机未现场测试；APK 未重打。

2026-09-25 分类标题误触修复：测试真实标题文字的浏览器点击路径，而非仅调用右侧展开按钮。原来的长文字位于复选框 `<label>` 内，点击会改变开关；修复后仅复选框保留在标签内，描述文字占据展开按钮主体。`npm run build:web:mmd-ar-test` 成功，分组定向测试 3/3 通过；Chromium 390×844/DPR 3 下点击 AO 标题文字展开且不改变开关、点击复选框只改开关、再次点文字收起。公网 HTTPS 200，34,993 bytes，SHA-256=`f2daf5204103db0b71d583fc645031fa68a6e9e5c597e8d216c31ec14c8fc20c` 与本地和 SSH 远端一致；APK 未重打。

2026-09-25 完整网页事件链回归：旧版在线页面中 AO 分类点击前后均为收起（`hidden=true`），原因是原灯光/定位面板的 `stopPropagation` 阻断了绑定在 `document` 的开合监听。改为分类按钮自身监听后，`node --test tests/mmd-ar-web-panel-groups.test.js` 4/4 通过：新测试加载全部生成页脚本，并真实打开灯光、定位面板，各分类都能展开及收起。上线后再以完整线上页面验证 AO `true→false→true`、定位跟踪组 `true→false`；Puppeteer 真实点按线上分类标题也确认 AO 展开且开关未变化、跟踪组展开。仅更新测试网页首页，HTTPS 200，34,949 bytes，本地/SSH/公网 SHA-256=`7e03c8da6c8e795f7562df7e14e2dfe9ff91d5061e4faf8abb7e467c29d528ee`；APK 未重打。

运行 `npm run build:web:mmd-ar-test`，确认 `3rd/mmd-ar-test/web-dist/` 包含首页、静态 profile、默认 PMX/VMD、MindAR 和 Ammo WASM。核对所有生成路径以 `/mnt/mmd-ar/` 为前缀；打开 `https://c.aasc.us/mnt/mmd-ar/`，检查首页/清单/PMX/VMD/MindAR/模块/WASM 请求均为 200。远端与本地首页、PMX 和 MindAR 入口 SHA-256 一致。Puppeteer 浏览器检查到 `PMX 模型已加载`、`modelReady=true`，没有页面脚本或资源错误；390×844、3 倍设备像素比下灯光和定位按钮均能打开对应面板。真实摄像头授权、拍照选区和目标首锁仍需手机现场复测。

模型加载进度回归：重新构建网页后，记录 `#mmdArLoadingProgress` 的 `aria-valuenow`，确认 PMX、纹理、VMD、初始化分段单调不倒退，模型 `modelReady=true` 后才到 100%，约 1.5 秒后自动隐藏；无可用 Content-Length 时允许维持阶段起点再跳到下一阶段。窄屏需确认进度条不遮挡灯光/定位按钮。独立 APK 和正式显示端不传 `onLoadProgress`，保持原状态文案。

验证结果：真实 HTTPS Chromium 请求的 PMX 进度从 1% 连续推进到 70%，随后纹理 73–84%、VMD 85–94%、初始化 95/99%、模型 ready 后 100%；`aria-valuenow` 单调，完成后进度层隐藏，页面/资源错误为空。`node --test tests/display-chat-mmd.test.js tests/mmd-ar-benchmark-metrics.test.js tests/mmd-ar-benchmark-compiler.test.js` 为 50/50 通过；手机现场窄屏观感待确认。

Canvas 分辨率回归：`npm run build:web:mmd-ar-test` 后在 Chromium 模拟 390×844/DPR 3，实际绘制缓冲与灯光标题均为 780×1688；切换 844×390/DPR 1.5 后二者均为 1266×585。模型加载完成后灯光面板可打开，无页面错误；HTTPS 线上页面重复验证竖横屏数值一致。正式 `display.html` 含相同标题和共享 Canvas 属性监听，定向测试新增断言后 51/51 通过；正式显示端发布及真机观感待验收，原独立测试 APK 停止维护。

## MMD AR 独立测试 APK 构建检查（2026-09-23）

运行 `npm run build:apk:mmd-ar-test`，Gradle `assembleDebug` 成功。构建器核对 applicationId=`com.aasc.mmdartest`，APK ZIP 目录和压缩数据完整，APK v2 签名有效；内置默认 PMX、12 张纹理及 VMD 共 14 个资源逐文件与 `STATIC_MMD_RELEASE` 清单的大小和 SHA-256 一致，未带其他 PMX/VRM/VMD、Node 依赖或 AASC server assets。最新 APK 为 `13,128,697` bytes，SHA-256=`129379eca1856d6d5ab1852f41bf5f5dd9c369116894b6cf3df2c6f4c562cf6c`。已用 ADB 覆盖安装到 SM-N9500（Android 9/API 28）并在内屏 display 0 启动；截图可见测试页和米娅 PMX，首页、默认 profile、PMX 和 VMD 请求均返回 HTTP 200。

灯光/定位触摸回归：display 0 的系统 Insets 为 top=24/right=48 CSS px；ADB 触摸日志确认灯光与定位按钮都成为 DOM target，两个面板分别成功打开和关闭。触摸根因是测试 harness 抽取按钮时漏了 `display-interaction-layer` 的 z-index 50 父层，导致 MMD canvas 截获 hit-test；补回包装层后通过。模型 swipe 后继续响应旋转，VMD 动作保持运行。相机授权、AR 跟踪和布料物理仍未确认；另观察到旧 Activity 未退出时另建实例会有固定端口绑定冲突，单实例启动通过。

## MMD AR 校准四角触控拖动（2026-09-23）

运行 `node --test tests/display-mmd-ar-calibration.test.js tests/display-chat-mmd.test.js`，51/51 通过。模拟舞台 0°/90°/180°/270° 逆旋转映射，逐一拖动四个角点，断言只更新对应点；覆盖 pointercancel、lostpointercapture 后再次拖动，并检查拖动重绘不重复设置 canvas intrinsic 尺寸。`node --check src/apps/web-mediacenter/ui/public/js/display-mmd-ar.js` 与 `git diff --check` 通过。

`npm run build:apk:mmd-ar-test` 构建成功；APK `13,620,354` bytes，SHA-256=`e099999c4c9adb4b002f03efefdd88698c084a109ab3679671b0d570543bc917`，14 个模型资源和 6 个 A/B 资源校验通过，已覆盖安装到 SM-N9500 / Android 9 / API 28 并启动，PMX 正常加载。真机手指拖点仍待现场确认；Android 13 闪退因当前没有 Android 13 设备和 logcat 未能复现或定因。

## MMD AR 测试 APK 启动失败诊断（2026-09-24）

启动 Activity 的同步异常显示阶段/异常摘要诊断页，完整堆栈写入 `MmdArTest` 日志；WebView 恢复失败或 renderer 退出也显示诊断页。iQOO Z5x 反馈 `window.insetsController` 为空，修正版将全屏初始化移到窗口获得焦点后；空值时恢复普通系统栏和默认内容布局并继续运行。

修正版 `npm run build:apk:mmd-ar-test` 构建成功，大小 `13,620,354` bytes、SHA-256=`71a0cb63844b6516624b8150e1f061a35bdd1f16f701f721e88875e669993d94`；覆盖安装 SM-N9500 / Android 9 / API 28 后 `MainActivity` 处于前台且进程存活。外网文件已替换，HTTP HEAD 返回 200/Content-Length `13620354`，远端 SHA-256 与本机一致。Android 13/iQOO Z5x 尚待用户现场重新安装验证。

## MMD AR MindAR 状态与竖屏提示避让（2026-09-24）

MindAR 适配器仅在共享摄像头视频就绪后启动；这一阶段将定位面板状态更新为“MindAR 准备中”，A/B 状态提示显示引擎加载/目标编译，控制器启动后提示寻找定位图。竖屏生成页将顶部提示右边界收至灯光按钮左侧，横屏规则不变。`node --check` 两个改动脚本通过；`npm run build:apk:mmd-ar-test` 成功，APK `13,620,354` bytes、SHA-256=`3409e3e6a182339118b5cc09a32ce3e5ca0aea46a6e9e5bbe45f980dc548174e`。已覆盖安装 SM-N9500 / Android 9/API 28 并前台启动；临时竖屏截图确认文字不遮挡灯光按钮，随后恢复设备自动旋转设置。实际相机授权、MindAR 编译及图片首锁未实测，需要已保存定位图和现场相机。

## MMD AR 跟踪器 A/B 指标

运行 `node --test tests/mmd-ar-benchmark-metrics.test.js`，4/4 通过，检查首次识别、识别帧率、时间加权可见率、丢失次数和锚点偏差。`npm run build:apk:mmd-ar-test` 产物 `13,607,730` bytes，SHA-256=`7ece4967af75858667c1b300d8d9c5d2d893ee5cd08c4ed04094408cf508131c`；APK 内 MindAR 1.2.5 runtime/Controller/UI 与 LICENSE 按大小/SHA-256 检查，APK ZIP 和 v2 签名通过。已覆盖安装 SM-N9500 / Android 9 / API 28，display 0 截图显示米娅 PMX、定位面板和可切换算法选择器；回环读取的三个 JS 资源 SHA-256 与清单一致。尚未请求相机权限或开始实际识别，因此首锁、FPS、可见率和锚点 RMS 仍待可控目标现场采集。

## MindAR 编译进度回调修复（2026-09-24）

运行 `node --test tests/mmd-ar-benchmark-compiler.test.js tests/mmd-ar-benchmark-metrics.test.js`，6/6 通过，覆盖编译器收到进度回调、缺少回调时拒绝启动，以及既有 A/B 指标。`node --check` 检查编译适配器、MindAR benchmark、APK 构建脚本和回归测试通过。`npm run build:apk:mmd-ar-test` 成功，APK `13,620,450` bytes，SHA-256=`54e4e2be3acfbf56dff1b59259c05410ab0dc657d3deab8f02114b971a39a985`；构建器确认 14 个模型文件和 7 个 A/B 资源齐全。实际相机编译进度与图片首锁仍需使用保存的定位图在设备上验收。

## PMX 旋转缩放容差回归（2026-09-23）

`tests/mmd-pmx-physics-rotation.test.js` 直接执行内置 MMDPhysics 源码与 Ammo，验证中心枢轴连续缓动 180 帧的 yaw/pitch/组合旋转不丢失世界锚点；三个轴分别检查 0.0009 误差保留父节点、0.0011 误差执行既有尺度处理。相关六个测试文件共 72/72 通过。现场需刷新显示页，检查真实 PMX 连续拖动、反向拖动和停转后的布料惯性；自动测试不替代视觉验收。

## 概述

自测功能用于自动检测显示端控制页面的所有功能是否正常工作，帮助开发者快速定位问题。

## 使用方法

### 启动自测

1. 打开控制端页面 (`/upload.html`)
2. 点击页面右下角的绿色测试按钮 (🧪)
3. 自测程序将自动执行所有测试项目

### 查看结果

- 自测完成后会自动显示结果弹窗
- 结果按类别分组显示
- 绿色勾号表示测试通过
- 红色叉号表示测试失败
- 可点击"导出结果"保存测试报告

## 测试项目

### 基础功能测试

| 测试项 | 说明 | 前置条件 |
|--------|------|----------|
| 显示端连接测试 | 检查是否有显示端连接 | 无 |
| WebSocket连接测试 | 检查WebSocket连接状态 | 无 |
| 控制模块初始化测试 | 检查所有模块是否正确加载 | 无 |
| 服务器状态测试 | 检查服务器连接状态 | 无 |

### 播放控制测试

| 测试项 | 说明 | 前置条件 |
|--------|------|----------|
| 播放命令测试 | 测试播放命令发送 | 已选择显示端 |
| 暂停命令测试 | 测试暂停命令发送 | 已选择显示端 |
| 音量控制测试 | 测试音量调节 | 已选择显示端 |

### 画面控制测试

| 测试项 | 说明 | 前置条件 |
|--------|------|----------|
| 画面填充-适应测试 | 测试适应模式 | 已选择显示端 |
| 画面填充-高度铺满测试 | 测试高度铺满模式 | 已选择显示端 |
| 画面填充-宽度铺满测试 | 测试宽度铺满模式 | 已选择显示端 |
| 画面填充-裁剪测试 | 测试裁剪模式 | 已选择显示端 |
| 旋转-0度测试 | 测试0度旋转 | 已选择显示端 |
| 旋转-90度测试 | 测试90度旋转 | 已选择显示端 |
| 旋转-180度测试 | 测试180度旋转 | 已选择显示端 |
| 旋转-270度测试 | 测试270度旋转 | 已选择显示端 |
| 裁剪重置测试 | 测试裁剪重置功能 | 已选择显示端 |
| 裁剪-旋转缩放测试 | 0°+90°+180°+270° 下四角手柄向外/向内拖拽，裁剪框应正确缩放 | 已进入裁剪模式 |
| 裁剪-旋转拖拽测试 | 各旋转角度下拖拽裁剪框，应跟随鼠标移动 | 已进入裁剪模式 |
| 裁剪-旋转光标测试 | 各旋转角度下手柄光标应与该角功能方向一致 | 已进入裁剪模式 |

### HTML 媒体测试

| 测试项 | 说明 | 前置条件 |
|--------|------|----------|
| 媒体库 HTML 文件发送测试 | 点击 .html 文件弹滚动设置框，确认后显示端 iframe 铺满纯展示 | 已选择显示端，媒体库有 .html 文件 |
| 分页式滚动测试 | 选分页式 3 秒，显示端每 3 秒滚一屏到底停止 | 已发送长页面 html |
| 平滑/循环滚动测试 | 平滑匀速到底停止；循环滚到底回顶循环 | 已发送长页面 html |
| 短页面不滚动测试 | 内容不足一屏的 html 静态显示不滚动 | 已选择显示端 |
| 裁剪框拖拽 HTML 测试 | 裁剪框拖入 .html 文件弹滚动设置框，临时模式发送，裁剪预览区无图片/视频 | 已选择显示端 |
| 粘贴代码发送测试 | 工具栏「发送 HTML」粘贴含中文/data: 图片代码，临时发送渲染正确 | 已选择显示端 |
| 粘贴代码保存媒体库测试 | 勾选「同时保存到媒体库」，媒体库出现 粘贴代码_*.html 且按 url 发送 | 已选择显示端，媒体库可写 |
| 批量播放 HTML 测试 | 含 html 文件夹批量播放：按间隔切换、默认分页 5 秒滚动、暂停冻结/恢复继续 | 已选择显示端 |

### 语音功能测试

| 测试项 | 说明 | 前置条件 |
|--------|------|----------|
| 自定义语音播报测试 | 测试自定义TTS播报 | 已选择显示端 |

### 显示端语音聊天实时顺序手动测试

| 测试项 | 说明 | 前置条件 |
|--------|------|----------|
| 实时完成顺序与刷新历史一致 | 显示端语音输入后观察控制端流式消息，完成时应按“用户输入、助手回复”顺序显示；刷新后顺序和回复正文一致 | 网页控制端连接；显示端语音聊天可用 |
| 临时会话快照保留操作字段 | 临时会话回复完成后确认助手消息思考内容和语音文本仍可通过原有思考/播放入口查看或播放 | 已选择临时页签并配置语音回复 |
| 历史临时会话下拉切换 | 使用下拉选择历史组，确认摘要含时间/角色/条数、历史内容只读；切回“当前对话”后恢复实时记录和发送能力 | 临时页签已有至少一组历史会话 |

### Node 子显示端语音唤醒与路由手动测试

| 测试项 | 说明 | 前置条件 |
|--------|------|----------|
| 等待唤醒拦截普通语音 | Node 子显示端处于 `waitingWake` 时说普通文本，不应发到群聊；内置免唤醒功能命令仍可执行 | Node 子显示端已更新并连接；语音监听开启 |
| 纯唤醒词只切换状态 | 等待唤醒时说纯助手名或“你好+助手名”，确认服务端切换到临时群聊/私聊并播报提示，唤醒词本身不进入聊天 | 已配置至少一个助手 |
| 活跃会话路由 | 唤醒进入群聊/私聊后发送普通语音，确认路由到当前会话；退出或超时后恢复等待唤醒并拦截普通语音 | Node 子显示端支持 TTS，ASR 服务就绪 |
| Go/C# 兼容范围 | Go/C# 客户端代码和连接协议未改；未标记 Node 的子显示连接保持原路径 | 可连接 Go/C# 客户端 |

### Node 子显示端 WebSocket 重连手动测试

| 测试项 | 说明 | 前置条件 |
|--------|------|----------|
| 首次连接失败后持续重试 | 暂停或断开服务端后启动 Node 子显示端，确认进程保持运行且每 3 秒重试；恢复服务端后无需重启即可连接 | Node 子显示端可运行；可临时断开服务端 |
| 重连 ID 保持不变 | 记录首次连接 URL 和控制端显示列表 ID，断开并恢复 WebSocket 后确认请求中的本地 `displayId` 与显示列表项 ID 不变 | Node 子显示端已连接服务端 |
| error/close 单飞和录音恢复 | 触发网络断开或服务端重启，确认异常 socket 被清理、麦克风释放且没有重复连接；重连获得权威能力后，录音关闭时保持关闭、开启时仅恢复一个采集流 | 可观察 WebSocket 连接与系统麦克风占用；可切换录音能力 |

### Node 子显示端麦克风能力关闭手动测试

| 测试项 | 说明 | 前置条件 |
|--------|------|----------|
| 关闭能力释放麦克风 | 控制端关闭目标 Node 子显示端的语音录音能力，确认系统麦克风占用指示熄灭，PvRecorder/AudioIO 设备被停止释放，关闭后不会继续提交 ASR | Node 子显示端已更新并连接；可观察操作系统麦克风占用 |
| 重新开启麦克风 | 重新开启能力，确认服务端确认允许后只创建一个采集流，识别恢复且 TTS 暂停/恢复行为正常 | ASR 服务就绪，目标子显示端有麦克风 |
| 关闭状态重连恢复 | 关闭后重启 Node 子显示端或断开再连接，确认能力仍为关闭且服务器确认前没有麦克风占用；开启后能恢复采集 | 能控制目标子显示端重连 |
| 断线释放与识别竞态 | 连接断开时确认麦克风被释放；正在返回的 ASR 结果在能力关闭后不再触发对话 | 可断开 WebSocket 或服务端连接 |

### 显示端控制测试

| 测试项 | 说明 | 前置条件 |
|--------|------|----------|
| 显示端切换测试 | 测试显示端切换功能 | 至少2个显示端 |

### 显示端摄像头能力开关手动测试

| 测试项 | 说明 | 前置条件 |
|--------|------|----------|
| 控制端关闭摄像头 | 在设备能力树和能力编辑弹窗分别关闭“摄像头采集”，确认显示端普通实时预览及 AR 定位轨道停止、控件禁用，服务端拒绝新摄像头请求 | 显示端支持摄像头，控制端已连接 |
| 摄像头配置重连恢复 | 关闭摄像头后重连显示端，确认控制端仍显示关闭状态，显示端不启动摄像头；重新开启后拍照/预览可用 | 能查看同一 displayId 重连 |
| 摄像头开关与麦克风隔离 | 关闭摄像头后确认麦克风录音能力及现有语音监听设置不变 | 显示端有麦克风 |

### 显示端交互层旋转适配手动测试

| 测试项 | 说明 | 前置条件 |
|--------|------|----------|
| 四方向布局 | 逐个设置 0°、90°、180°、270°，确认 MMD、聊天、灯光/定位按钮和底部三个按钮朝向与媒体一致且没有越界 | 显示端连接控制端，可修改当前显示端旋转角度 |
| 旋转后的面板操作 | 四个角度分别打开聊天、灯光和定位面板，确认输入、滚动、关闭及按钮触摸正常 | 显示端支持触摸或浏览器指针输入 |
| 旋转后的 MMD 命中 | 四个角度分别点击角色和拖动旋转，确认命中位置及旋转方向正确 | 已加载 VRM/PMX 或 Canvas 占位角色 |
| 独立播报层 | 旋转后检查 TTS/天气弹窗和语音文字只旋转一次，定位视频与 MMD 位置对齐 | 可触发播报弹窗并开启定位相机 |

### 显示端 MMD 物理设置手动测试

| 测试项 | 说明 | 前置条件 |
|--------|------|----------|
| PMX 物理频率设置 | 打开显示端“灯光”面板，将频率从默认 65 Hz 改到其他档位，确认当前布料继续模拟且输出值同步 | 已加载启用 Ammo 的 PMX |
| 角色上拖动与点击分离 | 分别从 PMX/VRM 角色身体、头部和空白处拖动，确认都能旋转且松开不触发触摸；在角色上轻点确认只触发一次触摸；拖动后取消或移出画布也不触发触摸 | 聊天面板关闭且角色画布可交互；重点检查触屏 8 像素附近的手感 |
| PMX 快转暂停物理 | 将“旋转暂停物理阈值”设为默认 720°/秒，快速拖动 yaw/pitch 和反向拖动，确认动作与角色旋转继续、布料不再被快速锚点牵引穿模；减速后观察布料重新贴合及继续摆动 | 已加载带布料刚体的 PMX；对比 30、720、1440°/秒，留意恢复瞬间跳变 |
| PMX 旋转阈值保存 | 调节阈值后刷新显示页确认恢复；旧版保存的 180°/秒仍应保留；切换柔和/明亮灯光预设应保留该值，“恢复默认”回到 720°/秒 | 浏览器允许 localStorage |
| PMX 锚点牵引旋转试验 | 在模型空白区域连续进行 yaw/pitch 和反向拖动；确认角色真实旋转，布料在缓动中滞后跟随而不爆散/明显穿模，停下后保留惯性并自然收敛；分别试 30、65、90 Hz 和较低渲染帧率 | 已加载带布料刚体的 PMX；与改动前画面比较 |
| PMX 物理频率保存 | 刷新显示页，确认滑块恢复到上次设置；点“恢复默认”后应回到 65 Hz | 浏览器允许 localStorage |
| PMX 灯光预设保持频率 | 改变物理频率后选择柔和/明亮预设，确认物理频率不变 | 已加载 PMX |
| VRM 不受 PMX 频率影响 | 切换 VRM 后改变该设置，确认 VRM SpringBone 正常摆动 | 已加载 VRM |
| VRM 不受 PMX 旋转阈值影响 | 切换 VRM 后快速旋转并改变阈值，确认 SpringBone 仍按原行为更新 | 已加载 VRM |

### 显示端 PMX AO 手动测试

| 测试项 | 说明 | 前置条件 |
|--------|------|----------|
| AO 默认与开关 | 打开“灯光”面板，确认 AO 默认开启；关闭后人物衣褶、头发接触处暗部减弱，恢复默认后再次开启 | 已加载 PMX |
| AO 与透明层 | 检查人物发丝、裙摆边缘及角色外部背景；切换 AO 不应出现黑色方框或背景变实色 | 显示端背景有其他内容 |
| AO 与动作旋转 | 播放 VMD 并拖动旋转角色，AO 应随当前姿态更新且不改变布料物理行为 | 已加载带 VMD 的 PMX |
| AO 性能 | 对比目标 Android WebView 上开关 AO 的帧率和触控响应 | 目标显示设备 |
| AO 保存 | 关闭 AO 后刷新页面应保持关闭；选择柔和/明亮预设应保持开关，恢复默认应重新开启 | 浏览器允许 localStorage |
| AO 去噪 | 观察浅色衣服和头发平坦区域，开启 AO 后不应出现明显随机颗粒；旋转和播放 VMD 时暗部应连续且不越过前后景轮廓 | 已加载 PMX，建议在目标 Android WebView 复查 |
| AO 参数 | 将颜色改为其他颜色、强度调到 0/2、半径调到 1%/20%，确认实时变化、刷新后保存；强度 0 应接近关闭 AO，恢复默认后为 `#931231`/`0.60`/`6%`/半分辨率 | 已加载 PMX |
| AO 分辨率 | 默认显示半分辨率；切换全分辨率后无需重载模型即可看到画面，刷新页面仍为全分辨率；恢复默认回到半分辨率。对比边缘细节及目标 Android 上的帧率/触控响应 | 已加载 PMX |
| AO 采样与降噪 | 默认 24 次，切换 12/32 次后即时生效且刷新保留；恢复默认回 24 次。高强度与移动模型时对比颗粒/闪烁、透明背景和目标手机帧率 | 已加载 PMX |
| AO 多轮模糊 | 默认 1 轮/3 px；切 0 轮后颗粒应更明显，切 2/3 轮并分别设 1/5 px 后检查画面即时变化；刷新后保留，恢复默认回 1 轮/3 px。对比高 DPI 手机帧率、细节与透明轮廓 | 已加载 PMX |
| PMX 环境色忽略 | 关闭 AO，并将环境光、主光强度都调至 0；人物不应因 PMX 材质环境色保持灰亮。恢复灯光后纹理和 toon 阶调仍应显示 | 已加载 PMX |

### 辅助功能测试

| 测试项 | 说明 | 前置条件 |
|--------|------|----------|
| 时间解析功能测试 | 测试通用时间解析 | 无 |

### AASC系统测试

| 测试项 | 说明 | 前置条件 |
|--------|------|----------|
| AASC模块加载测试 | 检查AASC系统模块是否正确加载 | 无 |
| AASC消息API测试 | 测试AASC消息协议API | 无 |
| AASC执行者注册表测试 | 测试执行者注册表API | 无 |
| AASC用户存储测试 | 测试用户存储功能 | 无 |
| AASC能力注册表测试 | 测试能力注册表功能 | 无 |
| AASC集群状态测试 | 测试集群状态功能 | 无 |

### 能力组合系统测试

| 测试项 | 说明 | 前置条件 |
|--------|------|----------|
| AASC管道模块测试 | 测试能力管道执行器模块加载 | 无 |
| AASC组合模块测试 | 测试能力组合定义模块加载 | 无 |
| AASC等级计算器模块测试 | 测试能力等级计算器模块加载 | 无 |
| AASC能力配置文件测试 | 测试能力配置文件加载 | 无 |
| AASC能力等级分布测试 | 测试能力等级分布是否合理 | 无 |
| AASC能力分类测试 | 测试能力分类是否完整 | 无 |
| AASC能力继承测试 | 测试能力继承关系是否正确 | 无 |
| AASC入口导出测试 | 测试入口文件是否正确导出所有模块 | 无 |

## 自测流程

```
1. 初始化
   ├── 加载历史测试结果
   └── 重置测试计数器

2. 执行测试
   ├── 遍历所有测试项
   ├── 显示进度条
   ├── 执行单个测试
   │   ├── 检查前置条件
   │   ├── 执行测试逻辑
   │   └── 记录测试结果
   └── 更新测试统计

3. 显示结果
   ├── 按类别分组
   ├── 显示通过/失败统计
   └── 保存结果到本地存储

4. 导出报告
   └── 生成JSON格式报告
```

## 测试结果说明

### 结果字段

| 字段 | 说明 |
|------|------|
| id | 测试项唯一标识 |
| name | 测试项名称 |
| category | 测试类别 |
| description | 测试描述 |
| success | 是否通过 |
| message | 测试结果消息 |
| details | 详细信息 |
| timestamp | 测试时间戳 |

### 结果示例

```json
{
  "testResults": {
    "passed": 15,
    "failed": 2,
    "skipped": 0,
    "total": 17
  },
  "results": [
    {
      "id": "display_connection",
      "name": "显示端连接测试",
      "category": "基础功能",
      "success": true,
      "message": "已连接 1 个显示端",
      "details": "192.168.1.100",
      "timestamp": "2026-03-30T10:00:00.000Z"
    }
  ],
  "exportTime": "2026-03-30T10:05:00.000Z"
}
```

## 注意事项

### 测试前准备

1. **确保显示端已连接**
   - 打开显示端页面 (`/display.html`)
   - 确认显示端列表中显示已连接

2. **检查网络连接**
   - 确保控制端和显示端在同一网络
   - 检查WebSocket连接状态

3. **检查服务器状态**
   - 确认服务器正在运行
   - 检查服务器日志无错误

### 测试期间

1. **不要操作页面**
   - 测试期间避免点击其他按钮
   - 等待测试完成后再操作

2. **观察显示端**
   - 部分测试会发送命令到显示端
   - 观察显示端是否正确响应

3. **检查控制台**
   - 如有测试失败，检查浏览器控制台
   - 查看是否有错误日志

### 常见问题

| 问题 | 可能原因 | 解决方法 |
|------|----------|----------|
| 显示端连接测试失败 | 显示端未打开 | 打开显示端页面 |
| WebSocket连接测试失败 | 网络问题 | 检查网络连接 |
| 播放命令测试失败 | 未选择显示端 | 先选择一个显示端 |
| 时间解析测试失败 | 服务器API问题 | 检查服务器状态 |
| 模块初始化测试失败 | JS加载失败 | 刷新页面重试 |

## 扩展测试

### 添加新测试项

在 `public/js/self-test.js` 的 `tests` 数组中添加新测试：

```javascript
{
    id: 'custom_test',
    name: '自定义测试',
    description: '测试描述',
    category: '自定义类别',
    run: async () => {
        // 测试逻辑
        if (success) {
            return { success: true, message: '测试通过', details: '详细信息' };
        } else {
            return { success: false, message: '测试失败', details: '错误信息' };
        }
    }
}
```

### 测试函数规范

- 必须是异步函数 (`async`)
- 返回对象包含 `success`, `message`, `details` 字段
- `success`: 布尔值，表示测试是否通过
- `message`: 简短的结果描述
- `details`: 详细信息（可选）

## 相关文件

| 文件 | 说明 |
|------|------|
| public/js/self-test.js | 自测功能实现 |
| public/css/upload.css | 自测界面样式 |
| public/upload.html | 控制端页面 |
| server.js | 服务端API |

## API 接口

### GET /api/status

获取服务器状态

**响应示例：**
```json
{
  "status": "ok",
  "uptime": 3600,
  "displayCount": 1,
  "controlCount": 1
}
```

### POST /api/time/parse

解析时间表达式

**请求体：**
```json
{
  "text": "5分钟后"
}
```

**响应示例：**
```json
{
  "status": "success",
  "result": {
    "timestamp": 1711785600000,
    "description": "5分钟后",
    "type": "relative",
    "confidence": 0.95
  }
}
```
