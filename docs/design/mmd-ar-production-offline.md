# 正式 Offline 显示端 MMD AR 同步设计

## 相对气流与光照修复同步（2026-10-02，已实现，待正式发布）

用户已确认将新受风算法同步正式端，并要求发布正式服务代码包。光照作用域修复及基础用户功能迁移已在b750d74f提交；本次正式风数值模块、XPBD包装与Ammo风方法同步独立测试版的代理迎风面积、相对气流、空间阵风和子步稳定阻力，位置驱动type2保留真实偏移及局部惯量限幅。

独立构建识别正式已含气动实现，跳过重复注入，继续更新共享模块内容指纹。正式与测试数值/包装同源及两后端真实执行验证，覆盖旋转缩放、关闭保留速度、type2位置保持与释放。顶点布料/SLAM/诊断仍只在独立测试版；风控件参数不变。

代码提交推送origion/master后，使用现有npm code-only入口构建签名服务包，复用线上依赖与Node-min种子；核对ZIP、模块内容、清单签名、大小与SHA-256，再同步LAN/WAN并最后原子切换清单、验证和精确清理旧数字版本普通文件。servicePackage在成功覆盖本次代码后复位false，既有minApk和dependenciesPackage状态保留。真实手机观感及全功能现场验收单独保留。

## 用户功能补齐（2026-10-02，已实现，待现场验收与正式发布）

以本任务开始时已提交的 mmd-ar 用户功能（96cf6fda）为合并基线，目标为正式网页显示端和 Offline 服务代码包。复用现有显示端启动、模型配置、摄像头能力控制、生命周期与配置键，按功能补齐差异，不把独立测试页整体替换为正式入口。未实现的边缘光避开 AO、单目 IMU 自动标定与锚点恢复候选方案不属于本次合并基线。

### 合并范围

- 定位：MindAR One Euro 参数；现有 Mind Basic IMU 核心的零偏校准、死区、图片可见/不可见两个预测开关，旋转和平移只预测相机。保留正式相机第二层缓动、底面/立面与距离控制。独立重力模式由重力方向驱动角色锚点并叠加手动旋转，默认缓动 20ms；摄像头背景可选，沿用摄像头能力及前后台释放规则。
- 动作资源：本地 PMX 与纹理、角色 VMD、相机 VMD 加载及失败回滚。相机 VMD 仅在普通视图驱动相机，AR 定位时不争夺相机控制。切换 helper 不丢失本地资源引用与动作状态。
- 物理：默认 Ammo，新增现有自写刚体 XPBD；同步 PMX 六轴弹簧、质量、type2、直接锁轴及不向末端传播锁定的实现。风场开关、方向、强度、阵风和物理频率/基准参数进入动作面板。Ammo 默认物理 90Hz、纠错基准 45；XPBD 用基准数值作为每帧子步数、下限 3，物理 Hz 不参与 XPBD。同步 Ammo 子步锚点及借用对象生命周期修复。
- 渲染：正式端已有 AO 与补光着色实现继续复用，补齐浅凹抑制设置、阴影 bias/normalBias、512/1024/2048/4096 贴图尺寸、范围倍率、像素网格对齐及角色移动/缩放跟随、沿用主光阴影时的背光过渡范围。相机 near 维持 1。
- 面板：灯光、动作、定位默认透明度 50%；不增加独立测试页顶部说明文本。参数按正式面板现有状态存储方式接入；若属于控制端远端设置，复用既有 WebSocket/config.set 流程，不新增同用途 HTTP 接口。

### 排除范围

不合并顶点布料及其后端、组选择/粒子预览；不合并 SLAM、原生桥接或 APK 依赖；不恢复 THREE-XPBD。不合并骨骼、碰撞体、关节 K 值/限制图形、AO 法线预览、阴影贴图预览、模拟摄像头、投影参数诊断、性能 benchmark 与定位质量诊断面板。

### 文件与组织方案

- 正式入口：`src/apps/web-mediacenter/ui/public/display.html`、`css/display-mmd.css`、`js/display-mmd-panel-groups.js`，按原 ID 补齐用户控件并加载拆分模块。
- 正式状态与相机：`js/display-mmd.js`、`display-mmd-lighting.js`、`display-mmd-ar.js`、`display-mmd-ar-mindar.js`、`display-mmd-ar-pose.js`、`display-pmx-runtime.js`；新增定位 IMU、重力、资源与相机动作模块，独立于调试命名和测试全局开关。
- 正式物理：`js/mmd-pmx-helper.mjs`、`mmd-ammo-physics.mjs`、`vendor/three/animation/MMDPhysics.js`、`MMDAnimationHelper.js`；新增 `mmd-physics-rate.mjs`、`mmd-physics-wind.mjs`、`mmd-xpbd-physics.mjs`、`mmd-xpbd-rigid.mjs`、`mmd-xpbd-collision.mjs`，按当前测试页功能核心整理依赖。
- 正式渲染：`js/display-pmx-ao.mjs`、`display-pmx-lighting-mode.mjs` 及拆分阴影模块；参数从正式状态输入，不依赖 `MmdArTest*` 配置。
- 独立测试构建：`3rd/mmd-ar-test/build.js` 及对应功能注入适配器改为复用正式实现，避免重复声明、重复控件和依赖失效；测试专有顶点布料、诊断、SLAM 可继续留在独立测试包。
- 新增模块不超过 1000 行；不增加 npm 生产依赖。本次实现需标记 `release/offline-release-status.json` 的 `servicePackage=true`，不因网页功能额外改变原生或依赖包状态。

用户确认后已实现上述基线功能。正式端新增 `display-mmd-settings.js`、用户参数脚本、IMU/重力摄像头脚本和 `mmd-*` 功能模块；PMX 主运行时拆分为模型资源、AR 相机、相机 VMD、灯光与通用辅助模块，主文件 982 行、显示主模块 993 行，新功能模块均不超过 1000 行。已有超长定位及第三方 vendor 文件沿用原结构，不整体重写第三方库。

独立构建通过 `web-production-shared.js` 识别共享标记并更新依赖指纹；只在测试副本展开模型提交流程以附加骨骼/刚体诊断，`web-production-test-extras.js` 为测试包追加顶点布料与 ShadowMap 预览。正式源未包含这些后端/诊断模块，也不计时物理帧。正式参数使用 `aasc.display.mmd.*` 与 `DisplayMmd*` 入口，测试参数保持独立命名；原有正式灯光、相机和面板偏好键继续保留。

源码静态语法检查及独立网页构建完成；正式控件无重复 ID、新模块依赖完整。未执行自动测试、物理/浏览器模拟或真机验收。Offline `servicePackage` 已为 true 并保持待出包状态；现有 min APK 待出包状态不变，无新增生产依赖。本轮未提交、构建或发布正式服务代码包。

## 测试页用户功能合并（2026-09-29）

正式 Offline 显示端以已验证的 HTTPS mmd-ar 页面为用户功能基线：灯光、动作物理和定位分别成面板，内部按功能分类；保留原配置键、模型与定位图数据。模型加载期间显示阶段与百分比，成功后短暂保留、错误时清除。渲染合并高精度深度采样、半分辨率 AO 边界修正、高光和双光阴影；MindAR 合并目标锚点到 PMX 相机的同步重试。模拟摄像头、AO 法线预览、投影 near/far 读数和 benchmark 属于测试诊断，不进入正式 UI。上线优先走 Offline 服务代码包热更，不重打完整 APK。

- 日期：2026-09-27
- 范围：将已在 MMD AR 测试页验证的 PMX 首屏/物理行为与 MindAR 图片定位相机流程接入正式 Offline 显示端。

正式显示端现有定位仍使用自写 JS 特征匹配和模型外层屏幕锚点；测试网页使用 A-Frame 1.5.0、MindAR 1.2.5 的目标锚点与相机矩阵，失锁保持最后视角，底面/立面、死区、缓动和相机距离可调。本次以本地固定版本脚本替换测试页的公网脚本，并把正式显示端的默认定位切到 MindAR；旧 JS 跟踪器保留为显式回退。普通聊天/MMD 启动不加载 AR 引擎。

所有 AR 资源保存在显示端静态目录，随 Offline code-only 包发布：A-Frame、MindAR A-Frame 适配与目标编译器及各自许可证。示例 `.mind` 图只供测试页使用，正式显示端仍用用户拍照保存的目标，不上传任何相机图像。静态资源不新增 npm 生产依赖，也不需要原生 min APK。

PMX 首次提交后第一个实际渲染帧只更新物理、不绘制角色，第二帧推进 VMD 并显示。正式灯光面板提供 VMD 播放和 PMX 物理对照开关；物理切换通过重建 helper 实现，避免冻结旧布料形变。定位面板提供底面/立面、相机位姿死区、缓动和相机距图中心的设置。MindAR 锚点只驱动相机，PMX 根节点、布料世界和 VMD 状态不随跟踪矩阵重建。显示端现有摄像头能力开关、页面后台释放及本地数据存储继续有效。

发布仅生成并发布更高版本的签名服务代码包到 LAN/WAN，复用现有 dependencies 和 Node-min 种子引用，不把 `release/task/results` 日志重新收入最小更新。已安装 Offline APK 热更后使用新版显示端；不重打完整 APK、min APK 或依赖包。旧整包新安装时，需要先获取这次 code 更新。实际识别、相机与布料视觉效果须在 Android WebView 真机验收。

## 当前进度

已将固定版本 A-Frame、MindAR A-Frame 与目标编译模块、官方示例 `.mind` 及许可证收入正式显示端静态目录；HTTPS 测试页构建改为复制本地资源，运行时不再引用 AR CDN。正式显示端已接入懒加载 MindAR、旧 JS 回退、相机参数和 PMX 动作/物理开关；浏览器模拟相机首启、停止、再次启动与轨道释放通过。Offline code-v41 已发布内外网；真实 Android 相机视觉验收仍待完成。
