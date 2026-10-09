# Web MediaCenter - 未完成任务列表（更新于 2026-10-09，code v47/min v34 已发布；Offline 同步 watch 默认 10 分钟）

- ⏳待设备验收 [2026-10-09] 独立MMD AR TAA与Canvas倍率：代码和本地网页构建已实现，抖动强度0–2/周期4/8/16/32及保存复位、真实GPU/模型/相机回归通过；仍需手机WebView检查快速发片/衣服残影、实际AR投影、操作系统后台、倍率及周期帧时与显存。TAA默认关闭/倍率1/抖动1和8帧，运动向量暂缓，不承诺实机提速。任务：`docs/task/20261009_MMDAR_TAA与Canvas倍率.md`、`docs/task/20261009_MMDAR_TAA抖动参数.md`。

- ⏳待实机验收 [2026-10-09] MMD-AR导出PMX：7项定向检查和5个真实模型往返通过，web-dist已构建；合并TAA后修正同名重复下载测试检测，真实网页下载/编辑/ZIP往返/配贴图重载1项通过。手机/独立APK及PMX Editor打开待验收。任务：docs/task/20261009_MMDAR网页导出PMX.md。

- ⏳待现场验收 [2026-10-08] MMD-AR接触阴影与主光阴影位置对齐：已同步主光shadow bias/normalBias并改为几何权重最高样本输出接触alpha；2026-10-09合并远端TAA并提交，原改动构建通过，当前组合未重建/测试。待浏览器同视角确认主光阴影开关、bias调节、不同镜头距离及平滑法线位置；自动测试未运行，未发布。任务：`docs/task/20261008_MMDAR接触阴影与主光阴影位置对齐.md`。

- ⏳待设备验收 [2026-10-09] MMD-AR普通预览后台恢复：生命周期清理及合并后的独立静态资源路径已修正，资源清单/两个真实浏览器用例3/3通过，覆盖模型位置/旋转/距离、重复pagehide/resize、迟到摄像头、实际AR退出及模拟视频轨道恢复；本地web-dist已构建，待设备系统后台返回检查，外网部署以实际发布版本为准。任务：`docs/task/20261008_MMDAR后台空闲清理重置视角.md`。

- ⏳待现场验收 [2026-10-09] MMD-AR接触阴影优化与保边模糊：专用投影追踪、本帧保守半深度/全深度确认、局部透视偏置及独立0–3轮/逐轮半径已实现；198组GPU追踪、真实滤波/奇数归约、刷新/DPR与普通预览后台回归通过。本地web-dist已生成；待手机同视角发际/下巴/透明衣物观感、0/1/3轮和12/30/64步真实GPU耗时及实际发布版本确认。记录：`docs/task/20261009_MMDAR参考文章优化接触阴影.md`。

- ⏳待现场验收 [2026-10-08] MMD-AR联动Stable CSM阴影：稳定切片球、相机旋转尺寸不变和整texel吸附回归通过；resize保留视角与后台清理分别已修正，后台设备验收单列。仍需手机/可用GPU浏览器确认阴影覆盖、镜头移动/转向及cameraScale边缘裁切。实现记录：`docs/task/20261008_MMDAR主相机CSM切片拟合.md`、`docs/task/20261008_MMDAR后台恢复保留预览相机视角.md`。

- ⏸用户暂缓 [2026-10-09] MMD-AR Blender 工程按需加载：外网已部署至 `https://c.aasc.us/mnt/mmd-ar/`；Apache 已启用 `mod_headers` 并按路径提供 COOP `same-origin`、COEP `credentialless`。修复用户反馈的动态导入入口缺少 `mountBlenderWorkbench` 导出，构建有导出断言，6 个修复文件 SHA-256 匹配且线上 HTTP 200。待用真实桌面 Chromium 验收目录授权、相对贴图、Cycles PNG、保存往返及普通首屏不请求 Blender；APK 不包含引擎。Brotli 资源直接请求 `.br` 文件，无需 mod_rewrite。任务：`docs/task/20261008_MMDARBlender工程按需加载.md`。
- ⏸用户暂缓 [2026-10-09] MMD-AR Blender 工程：已集成主视口角色替换、对象变换、骨骼姿态/结构编辑和模式路由；入口状态/错误提示移出折叠面板，目录选择取消会恢复入口。最新 `web-dist` 已发布到外网，13 个公开资源 HTTP 200 且 SHA-256 匹配，站点 COOP/COEP 响应头正常。桌面 Edge 实测目录选择、`.blend` 显示、骨骼编辑、Cycles 与保存回读待验收；自动化 Chromium 导航前报 `ERR_INSUFFICIENT_RESOURCES`。任务：`docs/task/20261008_MMDARBlender角色与骨骼编辑集成.md`、`docs/task/20261008_MMDARBlender工程入口反馈修复.md`。



- ⏳待现场验收 [2026-10-03] MMD刚体XPBD WebGL2：实验后端、构建与浏览器验证已完成；手机硬件GPU的3/10/45/180子步同条件中位数/P95、小物件稳定性、复杂接触及本地模型/VMD连续切换待测。软件GPU明显较慢，保留CPU/Ammo选择。任务：`docs/task/20261003_MMD刚体XPBD_WebGL2.md`。

- ⏳待现场验收 [2026-10-03] 六轴IMU测试网页真实运动精度：测量手机实际平移距离/旋转轨迹与估计误差，执行真机六面校准、横竖屏切换、iOS授权/后台恢复与长时间性能。网页实现及11项自测、Android约60Hz真实采集/静置校准/同房间共享已完成，不重复列开发任务。任务：`docs/task/20261003_六轴IMU共享3D测试网页.md`。








- ⏳待现场验收 [2026-10-02] mmd-ar 用户功能已合并正式网页/Offline 显示端：Ammo/刚体XPBD/风、本地资源与相机VMD、重力/IMU、阴影及面板参数已接入，保留相机第二层缓动，排除诊断/顶点布料/SLAM。代码已提交共享迁移及新相对气流，独立构建及静态检查、31项风/光照回归完成；待Android设备切换回滚、权限/后台、定位/重力/阴影/物理观感与耗时，正式code46已发布LAN/WAN并通过签名/全组件HTTP大小与SHA-256校验。全功能真机验收未完成。任务：`docs/task/20261002_MMDAR用户功能合并正式显示端.md`。

- 📋待确认 [2026-10-02] mmd-ar边缘光避开AO：候选共用开关默认开、当前帧AO遮蔽平滑门控仅边缘光，复用AO边界修正；AO与边缘光均开时多一张全尺寸遮蔽图和一次角色绘制。方案已记录，待确认后实施。任务：`docs/task/20261002_MMDAR边缘光避开AO.md`。

- ⏳待现场验收 [2026-10-02] TMP14顶点布料：自动组/固定根部及自由末端、开关/青橙预览、与基础Ammo共享骨骼、身体代理/风、UV接缝/正反层/表情/透明/阴影/AO、AR旋转缩放、模型/VMD/物理开关和失败回滚、3/5/10/45子步手机耗时。源码已实现、本地web-dist重建和静态检查通过，未执行测试或模拟；首版无自碰撞。任务：`docs/task/20261002_MMDAR顶点布料方案.md`。

- ⏳待现场验收 [2026-10-02] mmd-ar阴影像素网格对齐：默认倍率仍1、基准半幅0.5，主补光网格对齐和角色移动/缩放/复位跟随已实现；十项单元、真实PMX回归及两项面板静态检查通过，web-dist已重建。手机检查阴影闪动改善、小范围裁切、动作/重力/定位/旋转/换模型覆盖和帧率。任务：`docs/task/20261002_MMDAR阴影像素网格对齐.md`。


- ⏳待现场验收 [2026-10-01] mmd-ar阴影尺寸及ShadowMap预览：四档尺寸/真实PMX主补光整图/覆盖估算、资源回收、刷新复位及7项功能自测、4项面板回归已通过，web-dist已生成；手机比较1024/2048/4096阴影细节、贴图角色占比与预览4Hz的帧率开销。任务：`docs/task/20261001_MMDAR阴影贴图尺寸可设置.md`。

- ⏳待现场验收 [2026-10-01] THREE-XPBD移除后：旧偏好刷新迁移到XPBD、Ammo/XPBD切换与失败回滚、骨骼/碰撞体/动作复位及模型/VMD切换，手机实际耗时。本地网页重建与静态检查已完成，设备尚未验收。任务：`docs/task/20261001_MMDAR移除THREEXPBD与呆毛排查.md`。



- ⏳待现场验收 [2026-10-01] XPBD直接锚点全锁/部分旋转锁轴：固定只保留原静态锚点直接邻体，不再向动态链传递；本地web-dist及静态检查已完成，本轮源码/文档提交归档。待米娅右側髪_0_1/呆毛1发根固定、呆毛2～4（重点呆毛4）和包1～6的动作/风/碰撞响应、包0/7端点固定、部分锁轴/自由轴/非零锁值/反向连接、动态多关节残差、reset/换模型/VMD与手机耗时。下游自身PMX限制保持，实际摆动幅度未验证；未运行/新增测试或模拟。任务：`docs/task/20261001_MMDAR全锁绑定不向末端传递.md`。


- ⏳待现场验收 [2026-10-01] 关节六K移动轴/旋转轴图形已实现并重建web-dist：检查XYZ直箭头/旋转圆弧、固定K色阶、图形区间/锁定/自由、选中实际白标/越界红标、无物理未模拟、球尺度（含原RGB选中轴）、球先画/轴最后叠加（透明队列opacity1，99/100/101顺序）、仅选中归属关节不显示下一节/未选全部、反向连接/无親缘第二端归属、旋转缩放/偏好/VMD/后端切换和手机密集图形性能。面板保留图例/数值，静态检查通过，未运行测试/模拟。任务：`docs/task/20261001_MMDAR关节XYZ刚度可视化.md`。

- ⏳待现场验收 [2026-10-01] 自写XPBD效果对齐：静摩擦/平均材质/合成速度响应、一阶姿态/逐体限角/阻尼顺序与胶囊双点已实现，本地web-dist及静态检查完成，源码/文档本轮提交归档，现场验收继续待处理。待同模型/动作/风/诊断下对照Ammo与自写XPBD的静止、滑动、接触支撑、type0/1/2及3/5/10/45子步精度与手机耗时；未运行或新增测试。任务：`docs/task/20261001_MMDAR自写XPBD效果对齐.md`。




- ⏳待现场验收 [2026-10-01] XPBD明显抖动：已补关节硬限位速度投影、尺寸相关接触容差及低速反弹抑制，网页构建/静态检查完成；保持每帧N子步/每子步1轮和参数含义。待真实模型静止、动作及强风下确认改善，覆盖10/45/180子步、不同帧率和手机耗时；未运行或新增测试。任务：`docs/task/20261001_MMDAR可选XPBD刚体求解.md`。

- ⏳待现场验收 [2026-10-01] MMD AR布料计算Ammo / XPBD选择：基准数值作为每帧子步数、下限3/步长1、每子步1轮、当前子步显示及网页构建/静态检查已完成；待真实模型长时间稳定性、六轴限制、三类碰撞、风、缩放/旋转、刷新/换模型/换VMD及10/45/180子步、不同画面FPS/掉帧和手机同条件耗时对照。未执行或新增自动测试。任务：`docs/task/20261001_MMDAR可选XPBD刚体求解.md`。

- 📋待处理 [2026-10-01] MMD AR自测与当前实现同步：骨骼测试夹具补齐renderer.capabilities并检查新角色深度资源接口；本地资源测试物理默认断言65Hz改为当前90Hz后复验。非日志/非模型提交前38项定向测试31通过、上述7项失败；本轮未修改测试逻辑。

- ⏳待现场验收 [2026-10-01] mmd-ar Ammo物理风场：经纬度/强度/阵风实现与58项回归及LAN交互完成；风力上限已开放30并完成14项强风回归；手机确认高强度风效果、布料/蝴蝶结末端观感和90/180Hz CPU开销。任务：`docs/task/20261001_MMDAR物理风场.md`。


- ⏳待现场验收 [2026-10-01] mmd-ar默认纠错45Hz与物理90Hz：网页与真实Ammo回归完成，手机布料末端手感/静止抖动及CPU开销待观察；已有保存值仍恢复，可手动设45/90对照。


- ⏳待现场验收 [2026-10-01] mmd-ar强补光背光过渡：已将范围由0至0.05扩大为-0.3至0.3，web-dist已同步，原阴影遮挡继续继承；检查强补光、转动角色及深背光。关联 `docs/task/20261001_MMDAR补光继承背光区域.md`。

- ⏳待现场验收 [2026-10-01] mmd-ar补光范围参数及骨骼遮挡处半透明：过渡起点/终点（默认-0.3/0.3）和遮挡处不透明度（默认50%）已实现、本地保存，web-dist已生成，本任务按片段独立提交；检查范围交叉/复位、球局部穿出角色、半透明与球间遮挡、动作/形变、刷新/换模型/旋转屏幕及帧率。关联 `docs/task/20261001_MMDAR补光范围与骨骼遮挡透明度.md`。

- ⏳待现场验收 [2026-10-01] mmd-ar小球相互遮挡：已按用户纠正实现前球挡后球，开启时本层清深度并启用球深度测试/写入，始终穿透角色；默认关闭/保存沿用，web-dist已同步。检查同/跨类型重叠球、视角旋转、AO及保存/重建。关联 `docs/task/20261001_MMDAR骨骼小球遮挡开关.md`。

- ⏳待现场验收 [2026-10-01] mmd-ar主光阴影偏移：同视角逐项调bias/normalBias，观察近距离条纹和接触阴影；检查刷新、恢复默认、模型切换/后台返回及补光阴影模式。控件实现与网页构建已完成，本次按阴影相关片段独立提交；关联 `docs/task/20261001_MMDAR主光阴影偏移.md`。

- ⏸用户要求暂缓 [2026-10-01] mmd-ar眉心红色AO：ao1.jpg及额头半透明覆盖面线索已记录，运行时材质/深度写入及隐藏对比未确认；原法线/合成修改候选未实施。

- ⏳待现场验收 [2026-10-01] mmd-ar低模浅凹AO：近距离比较4.5/10/20度暗带、真实接触遮蔽和法线预览，检查半/全分辨率、刷新保存与恢复默认。滑块及网页构建已完成；关联 `docs/task/20261001_MMDAR低模浅凹AO抑制.md`。

- ⏳待现场验收 [2026-10-01] mmd-ar后蝴蝶结6_1旋转回写：修复/65项回归及本地网页构建已完成；手机在180Hz下检查两末端播放/暂停及大角度旋转，区分回写自旋与真实刚体残余扰动，现场模型来源待补充。关联：`docs/task/20261001_MMDAR后蝴蝶结末端旋转抖动.md`。



## 控制端

- ⏳待现场验收 [2026-09-30] 显示端状态栏独立开关
  - 使用两台在线显示端分别切换，确认配置互不覆盖；开关显示在 VAD 面板内而不在设备列表；关闭后时间和媒体文件名继续显示；刷新控制端/显示端并重连后设置恢复；竖屏导航固定在底部、横屏导航固定在左侧。
  - 关联文档：`docs/design/display-status-bar.md`、`docs/spec/display-status-bar.md`、`docs/task/20260930_显示端状态栏独立开关.md`。

- ⏳待现场验收 [2026-09-30] 显示端背景光晕参数
  - 检查中心颜色、中心亮度范围（纯色中心区域，不是透明度）和扩散范围的全局调节、多个显示端同步及重连恢复；确认媒体内容不变、睡眠遮罩仍为黑色。横屏检查时间不与灯光/动作/定位按钮重叠，竖屏确认顶部留白；控制端竖屏导航在底部、横屏在左侧。
  - 关联文档：`docs/design/display-background-glow.md`、`docs/spec/display-background-glow.md`、`docs/task/20260930_显示端背景光晕与状态栏位置.md`、`docs/task/20260930_背景光晕中心范围与横屏时间避让.md`。

- ⏳待现场验收 [2026-09-29] mmd-ar-test Blinn-Phong 高光：手机浏览器检查颜色、锐度、阴影和帧率。

- ⏳待现场验收 [2026-09-30] mmd-ar-test骨骼小球：手机检查大小倍率、密集名称/局部轴可读性、轻点命中与拖动/双指、累计碰撞筛选及帧耗时；网页扩展与65项验证已完成，本项仅保留真机验收。

- ⏳待现场验收 [2026-10-01] mmd-ar-test碰撞体线框：手机检查头发/裙摆重叠线框可读性和两诊断同时开启的帧耗时；网页实现与40项自动验证已完成，仅保留现场验收。

- ⏳待现场验收 [2026-10-01] mmd-ar-test 碰撞体按质量着色：手机深色背景下质量色带可读性、密集部位（头发/裙摆）质量差异辨识、图例范围文字与渐变刷新。
  - 线框颜色改为物理有效质量对数色带（0 质量浅灰），色阶固定为全模型、过滤不漂移；刚体 10/10、真实网页 1/1、骨骼 9/9、面板 8/8、相机动作 2/2 通过，web-dist 已生成，未发布外网。
  - 任务：`docs/task/20261001_MMDAR碰撞体按质量着色.md`。

- ⏳待现场验收 [2026-10-01] mmd-ar-test 碰撞体实体模式与真实遮挡：手机检查实体描边粗细与遮挡边缘观感、顶光着色下不同面的区分度与质量色辨识、密集部位（头发/裙摆）与角色互相遮挡的可读性、实体模式下帧率（每帧一遍角色深度直写仅实体+全量+AO生效时）。
  - 新增「碰撞体样式」线框/实体分段按钮（默认实体、本地记忆）与「隐藏角色」开关；选中骨骼过滤时穿透；描边放大 1.04；刚体与骨骼小球共用固定顶光着色（不联动真实灯光）。刚体 11/11、真实网页 1/1、面板 8/8、骨骼 9/9、相机动作 2/2 通过，web-dist 已生成，未发布外网。
  - 任务：`docs/task/20261001_MMDAR碰撞体实体遮挡.md`。

- ⏳待现场验收 [2026-10-01] mmd-ar 关节纠错基准Hz可调：手机 180Hz 下对照不同基准（65/90/130 等）的关节手感与静止抖动，确定现场推荐值；当前默认纠错45Hz、物理90Hz；旧手动值继续恢复，只改纠错强度。
  - 物理分类新增“纠错基准 Hz”滑条（30–180、5Hz 步长、本地记忆、实时重算六轴 STOP_ERP）；物理定向 20/20、面板 8/8、本地资源 3/3 通过，web-dist 已生成，未发布外网。
  - 任务：`docs/task/20261001_MMDAR关节纠错基准Hz可调.md`。

- ⏳可选任务 [2026-08-31] 能力拆分为内置任务或用户任务
  - 候选：天气查询、媒体搜索/播放、提醒管理、显示端控制、TTS 生成、系统诊断、RSS/数据处理和自定义工作流。
  - 建议优先级：`weather.query` → `media.search` → `reminder.*` → `display.control`。
  - 当前仅登记方案，暂不实现，也不创建对应任务实例。

- ⏳待处理 [2026-08-30] Pi Agent 主动压缩上下文
  - Pi AgentSession 自带上下文压缩能力，当前 PiRuntimeManager 暂不封装手动压缩入口和自动阈值触发；保留后续增加控制端按钮或按上下文占用触发的需求。
  - 关联任务：`docs/task/2026-08-30_Pi主动压缩暂不实现.md`。

- ⏳待处理 [2026-08-30] 群聊统一历史中的旧工具调用异常文本
  - 现象：未指定角色的群聊使用 `group/default` 历史时，可能收到并播报 `[Error: write after end]`。
  - 疑似来源：旧 Pi Agent/工具调用流程遗留的未闭合 Chat2API 工具调用记录；当前历史中存在 `profileName=qwen3.5`、`templateId=default` 的异常内容，具体产生流程待后续确认。
  - 已完成当前 Chat2API canonical 工具标签解析残留修复；历史中已经保存的异常消息和 `write after end` 清理仍暂不处理。
- 处理决定：仅记录，暂不修改代码、历史文件或 TTS 行为。
  - 关联任务：`docs/task/2026-08-30_群聊历史遗留工具调用异常.md`。

## Android ASR APK

- ⏳待现场验收 [2026-09-11] 在独立 ASR 测试 APK 原生页面使用测试 WAV 完成 Sherpa 声纹注册和三种测试模式回归
  - APK 已构建、安装和启动；设备 UI 自动化桥返回空 root，尚未自动完成注册、单段、多段、快速多段及双降噪开关的点击验证。
  - 2026-09-12 已通过同一 APK 的 HTTPS 测试页面完成三个模型/FP32-INT8 的单段和普通分段回归；原生页面按钮链路仍待单独现场点击验收。
  - 相关实现：`docs/design/android-voiceprint-test-apk.md`；`docs/spec/android-voiceprint-test-apk.md`；`docs/task/2026-09-11_ASR测试APK原生页面接入Sherpa声纹UI.md`。

## TTS

- ⏳待现场验收/发布 [2026-09-30] TTS内存音频URL、128MiB可配置容量与Node无文件播放
  - 服务端和Node无临时WAV、默认128MiB及控制端容量设置已实现，静态检查通过。待确认容量保存/热应用/多控制端同步/重连恢复/降额保留旧引用。待确认网页/控制端/Android/Node播放、HEAD/Range、多端/长队列、Windows/Linux声音、停止后恢复录音及AEC；缓存容量/过期与服务器重启后的URL失效需现场验证，未执行自动测试，尚未重启或发布。
  - 方案：`docs/design/tts.md`、`docs/spec/tts.md`；任务：`docs/task/20260930_TTS内存音频下发.md`。

## 文本媒体

## 聊天系统

- 🔄进行中 [2026-09-19] 修复 Qwen Chat2API 请求通道返回固定拒答
  - 已复现：同一账号和 `Qwen3.6-Flash → Qwen3.7` 映射下，本地 Chat2API 会把 Qwen 上游固定拒答或风控 JSON 归一化为空成功回复。
  - 当前修复：网页聊天请求不再注入固定 `X-Platform/X-DeviceId`；风控 JSON 改为明确错误；保持 Qwen 原生 `session_id/parent_req_id/scene_param` 首轮与续接契约。
  - 现场验证：当前上游返回 `FAIL_SYS_USER_VALIDATE` 验证码响应，代码已能识别，但仍需有效网页登录风控状态后确认正常答案链路。
  - 关联文档：`docs/design/chat2api-builtin-task.md`、`docs/spec/chat2api-builtin-task.md`、`docs/task/20260919_Chat2API_Qwen发送链路修复.md`。

- ⏳待现场验证 [2026-09-19] 临时模式首次唤醒确认提示区分
  - 纯助手名已改为从“嗯，我在”“啊，我在”“我在呢”“在呢”“听着呢”中随机播报；助手名带内容已从“好的”“收到”“明白”“好嘞”“没问题”“交给我吧”中随机确认，后续临时消息和一次性群聊不重复使用临时确认。
  - 需使用真实显示端确认短确认与模型回答的连续 TTS 播放顺序，以及显示端 TTS/服务端 TTS 两种配置下的实际播放目标。
  - 关联文档：`docs/design/display-voice-conversation.md`、`docs/spec/display-voice-conversation.md`、`docs/task/20260919_临时模式唤醒确认提示区分.md`。

- ⏳待现场验证 [2026-09-19] Pi Agent Chat2API 工具格式错误回退普通回复
  - 代码已在 Provider 层对损坏工具协议保留安全普通文本，不执行不完整工具调用，也不向聊天/TTS输出协议残留；需使用真实 Chat2API 模型复现一次缺少开始标签的响应，确认聊天正文和 TTS 均正常恢复。
  - 关联文档：`docs/design/llm-agent-mode.md`、`docs/spec/llm-agent-mode.md`、`docs/task/20260919_Chat2API工具格式错误保留普通回复.md`。

- 🔄进行中 [2026-09-19] 控制端与显示端 render 刷新来源诊断
  - 通用 render 诊断打印暂时关闭；TTS 输入历史已移除会导致原生弹窗自动关闭的失焦节点重建，改为独立 autocomplete 表单，后续仅保留通用 render 异常复现任务。

- 🔄进行中 [2026-09-19] 显示端聊天与 VRM/MMD 同位分层
  - 已确认使用单个 `display.html`，拆分 `display-stage.js`、`display-chat.js`、`display-mmd.js` 和独立 CSS，不使用 iframe。
  - 聊天位于 MMD 上层并可单独隐藏；隐藏后 MMD Canvas 接收点击，通过 Raycaster 触发本地动作，聊天联动默认关闭。
  - 🔄待现场验证 [2026-09-23] 角色上拖动旋转与轻点触摸分离：从角色或空白处达到 8 像素后旋转，松开不触摸；请在 PMX/VRM 真机触屏检查轻点、快拖、拖出画布和取消。关联任务：`docs/task/20260923_MMD角色上拖动旋转与点击触摸分离.md`。
  - 当前实现范围：同页模块总线、聊天入口/对象选择/会话选择、流式消息、聊天隐藏切换，以及无外部运行时时的 MMD Canvas 交互降级。
  - 已完成静态 VRM 模型迁移：默认模型通过 `http://c.aasc.us/mnt/mmd/` 文件资源加载，服务端 DNS 解析为 IPv4 后不保留 Host，并支持 `.vrm`、`.glb` 及 zstd 压缩文件的安全 profile 切换；模型不打入 APK。VMD/VRMA 动作资源和复杂动作生成仍留在后续阶段。
  - PMX 已完成同源内置 Ammo/WASM 物理解算：仅含刚体数据的模型按需启用，物理网格固定原始单位、相机/灯光/阴影按原始 bounds 取景，且显示后的下一渲染帧才执行首个物理步进；失败时保留 VMD/骨骼动画回退。模型、动作和纹理仍不进入 APK。后续复杂动作生成不受影响。
  - 🔄待现场验证 [2026-09-23] PMX 旋转缓动布料扰动：已修正单位缩放浮点误差导致脱离枢轴的问题，容差为 0.001；快速旋转暂停物理阈值默认 720°/秒、上限 1440°/秒。检查真实模型 yaw/pitch、组合旋转、反向拖动、停转惯性、减速恢复瞬间及不同阈值/物理频率的视觉效果。
  - 当前现场试验任务：`docs/task/20260923_PMX旋转锚点牵引布料试验.md`、`docs/task/20260923_PMX快速旋转暂停物理.md`、`docs/task/20260923_PMX旋转物理阈值默认值与上限调整.md`；若仍失稳，重新评审备选设计 `docs/superpowers/specs/2026-09-23-pmx-rotation-substep-sync-design.md`，不得直接恢复整批刚体传送。
  - 聊天/MMD 两个显示开关已调整到左下角，保留安全区和软键盘内缩。
  - 已修复 `defer` 模块初始化时序，聊天入口会在模块注册后生成聊天窗口。
  - render-display 已调整为仅高于媒体层；聊天页面主题化，对象/会话切换改为 HTML 下拉菜单；下拉菜单已区分未选中、悬停/聚焦和已选中颜色；聊天输入操作区位于输入框下方并横向排列；聊天已改为全屏透明背景、控件实色；code v11 已发布并完成真机验收。
  - 普通 `response` TTS 弹窗已统一进入 MMD 与聊天之间的播报辅助层，聊天打开时隐藏，关闭后按原生命周期恢复；code v21 与 dependencies v5 已发布到 LAN/WAN。
  - 已修复普通聊天和天气播报在有 `voicePlayback` 能力的来源端重复显示文字弹窗的问题；code v23 已发布到 LAN/WAN，沿用 dependencies v5。
  - TTS 播报文字已按逻辑画布和文本长度自适应字号与竖屏边距；code v24 已发布到 LAN/WAN，沿用 dependencies v5。
  - TTS 和天气响应弹窗改为按当前逻辑视口宽度的 5% 动态计算左右边距，并限制在 12px–64px，适配 100%/200%/300% WebView 缩放；聊天下拉选中项保持深色、未选中项保持浅色。code v27 已发布到 LAN/WAN，沿用 dependencies v5 和 min APK v32。
  - 角色/会话下拉菜单已统一状态样式，聊天操作区恢复输入框右侧竖排并调整为发送在上、清空在下；定向测试 20/20 通过，code v28 已发布到 LAN/WAN，沿用 dependencies v5 和 min APK v32。
  - 多助手/群聊对象名称和历史范围切换已修复；角色继续使用 `roleHistory`，定向测试 35/35 通过；code v30 已发布到 LAN/WAN，沿用 dependencies v5 和 min APK v33。
  - 首期沿用全局聊天上下文，按 `displayId` 独立保存留待后续。
  - 关联文档：`docs/design/display-chat-mmd.md`、`docs/spec/display-chat-mmd.md`、`docs/task/20260918_显示端聊天与MMD分层设计.md`、`docs/superpowers/plans/2026-09-18-display-chat-mmd.md`。

- ⏳待处理 [2026-09-16] 将显示端聊天模式与私聊目标按 displayId 独立保存和路由
  - 当前 offline APK 暂时沿用服务进程全局 chatSession，控制端手动切换后同步当前在线且启用语音监听的显示端；后续需支持每个显示端独立的群聊/私聊模式、助手目标、session 和语音路由。
  - 关联任务：`docs/task/2026-09-16_Offline启动权限串行与语音聊天自动路由.md`。

- ⏳待验证 [2026-09-13] 临时页签连续切换角色：确认收到服务端快照后选择器可再次选择

- ⏳待现场验收 [2026-09-25] 历史临时会话下拉选择器
  - 确认下拉摘要显示时间、角色和消息数量；选择历史组后内容只读，切回“当前对话”恢复发送。
  - 关联任务：`docs/task/2026-09-25_历史临时会话下拉选择器.md`。

- ⏳可选任务 [2026-09-01] 自动测试请求级聊天隔离
  - 当前自动测试仍可能连接现有服务器并写入真实群聊；聊天历史持久化已先增加防误删保护。
  - 后续可增加 `testOnly/testRunId` 临时会话命名空间，禁止测试持久化 AASC、Pi 和 Responses 历史。
  - 本次配置排查确认现有聊天相关测试使用临时目录或只读契约，不直接写入真实 `config/config.json`；后续仍需补充统一测试隔离。
  - 临时页签角色选择使用服务端 WebSocket 快照，不新增测试持久化配置；统一测试隔离仍待后续处理。

- ⏳待处理 [2026-08-31] 控制端无 `displayId` 时无法启动普通 Pi Agent 聊天
  - 现象：控制端发送 `chatMessage` 且不带 `displayId` 时，服务端回退处理因缺少显示端上下文提前返回，不产生 `chatChunk` 或 `chatResponse`。
  - 当前带已连接显示端 ID 的控制端流程正常；后续需将普通聊天处理从显示端上下文门控中拆出，支持无显示端的控制端会话。

- ⏳待处理 [2026-08-31] `commandMode` 开关当前未使用
  - 现代显示端的 `waitingWake` 由会话状态门控过滤，`activeGroup` 和 `activePrivate` 会绕过该过滤；当前开关只保留配置、控制端同步和旧调用路径兼容。
  - 暂不删除或重定义，后续再决定是否移除，或改为控制 Agent 系统工具权限。

- ⏳待讨论 [2026-08-31] 私聊聊天 Agent 调用受限系统工具
  - 设计文档：`docs/design/private-chat-agent-tools.md`；当前只记录方案，不实现代码。
  - 待确认工具确认策略、静音是否包含取消静音、切换助手后的历史/session 规则，以及 Pi/Codex 统一工具协议。

## 开发工具

- ⏳待现场验收 [2026-09-26] Node Offline min 跨平台服务更新入口
  - `release/allserver-min.js` 已调整为单文件引导：目标机只需该文件和 Node/npm；启动器从签名 Offline manifest 下载独立 `nodeMinSeeds` ZIP，补齐 release 配置、用户配置和任务，再下载 code ZIP 并安装 ZIP 内生产依赖；部署推荐 Node.js 24 LTS，开发机版本记录为 `v26.8.1`。
  - 启动器与 `noserver`、`withserver` APK 已一起发布到独立外网目录 `http://120.79.245.103/mnt/node-min/`，不放在 `aasc-offline`；启动器修改或 APK 重建后同步对应文件并核对公网大小及 SHA-256。
  - `npm run build:offline-update` 生成并签名 `nodeMinSeeds` ZIP；现有发布器和同步器会传输该组件。`nodeMinSeeds v39` 已发布到内网及公网更新源，服务代码保持 v39；公司更新源本次连接超时，目标机可从其他可用更新源回退下载。
  - 尚未在 Windows/Linux 目标机实装验证首次下载、依赖安装、代码更新、自动重启与回滚；未运行自动化测试。关联文档：`docs/design/offline-node-min-runtime.md`、`docs/spec/offline-node-min-runtime.md`、`docs/task/2026-09-26_Node-Offline-min跨平台热更新入口.md`。

- ⏳待处理 [2026-09-22] 使用 esbuild 处理后端纯 JavaScript 依赖
  - 仅记录方案，暂不安装 esbuild、暂不创建 bundle、暂不改变服务器启动入口和 Offline APK 发布链路。
  - 预期采用纯 JS 依赖内联、ASR/TTS/声纹原生模块和 Puppeteer 外置、动态任务与数据修复能力保持兼容的混合方式。
  - 正式实施前需要完成服务启动、模型加载、动态任务、数据修复、服务器更新、Offline APK manifest 和回滚测试。
  - 关联文档：`docs/design/server-release.md`、`docs/spec/server-release.md`、`docs/task/20260922_esbuild后端依赖打包方案.md`。

## 媒体播放

## AI 角色

## Android APK

- ⏳待下一次出包验收 [2026-09-25] APK 与 Offline 热更清单中的 Git 来源信息
  - 用 `build:apk:offline` 核对 `build-manifest.json` 的完整 `source.gitCommit` 和 `source.gitDirty`；生成 code-only/all 服务包及 min APK 清单，确认各自组件来源与签名校验一致。
  - 关联任务：`docs/task/2026-09-25_构建产物Git提交信息.md`。

- 🔄进行中 [2026-09-16] Offline APK 服务热更新与原生增量 APK
  - 🔄待现场验收 [2026-09-20] code v12 与 min v21 已联合发布，包含聊天播报文字隐藏和服务器启动后 30 秒隐藏分辨率诊断；待 SM-N9500 通过外网更新卡片确认 code/min 更新及真机行为。
  - [2026-09-21] 更新卡片下载/校验/安装期间已支持 10 秒无触摸收起，收起入口按进度填充并显示状态色；分辨率/DPI/缩放诊断提示改为 10 秒隐藏；修复 code-only 在已有热更依赖时错误使用 `legacy-root`，并在 Offline Node 启动时迁移旧 active release，按清单动态选择依赖版本；控制端收起按钮贴合屏幕边缘。Android JVM 单测 25/25 通过；min APK v31（`0.2.29-offline-min`）已构建并发布，仍待真机现场安装验收。
  - [2026-09-23] 多内网热更源和外网资源同步已完成；`allserver-min` v34（`0.2.32-offline-min`）已重新构建并发布到内网/外网，完整 APK 未构建。
  - [2026-09-23] 服务代码 `code-v34` 已发布到内网/外网，继续复用 `dependencies-v6`；代码包已完成 ZIP、SHA-256、清单签名和旧版本精确清理校验。
  - 待处理：完整 Offline APK 首次安装不创建 `updates/active-release.json`；首次 code-only 更新找不到版本化依赖目录时会将根目录内置依赖标记为 `legacy-root`。暂不修复，后续需确定是否在首次启动初始化版本化基线 release。
  - 服务更新支持 `code-only`（lock 指纹一致时不发布/下载依赖）与 `all`（代码+生产依赖）；`code-only` 检测到 lock 指纹变化时自动升级为 `all` 并递增依赖版本；`allserver-min` 只更新原生代码和 allowlist Runtime 动态库，保留服务数据与模型缓存。

  - Node 更新包/发布器与 Android 验签、服务代码/依赖切换、APK 签名/包名/版本检查及系统安装流程已实现；本轮服务更新 Node 定向测试 31/31、Android JVM 单测 25/25 通过。全量 `npm test` 为 826/827，唯一失败是既有 Windows 子显示端声纹策略断言，与本任务无关。
  - full v2/min v3 APK、code/dependencies v3 包及 min v3 更新清单已生成并通过静态完整性/签名校验；min v4 已升版为 `0.2.2-offline-min` 并正式发布，LAN/WAN manifest 字节一致且签名有效。
  - min v4 APK 地址为 `http://192.168.1.39/mnt/aasc-offline/apk/aasc-display-offline-min-v4.apk` 和 `http://120.79.245.103/mnt/aasc-offline/apk/aasc-display-offline-min-v4.apk`，大小 `89205130` bytes，SHA-256 `be31e437ca17488fab20eefd1874be2a1b40689cac59f667873e761dd17b1027`；LAN HTTP 整包、WAN 远端文件及 WAN HTTP 首段/HEAD 校验通过。
  - 固定显示端 ID 与 Chat2API 完成按钮的 min v6 已追加发布：`http://192.168.1.39/mnt/aasc-offline/apk/aasc-display-offline-min-v6.apk`、`http://120.79.245.103/mnt/aasc-offline/apk/aasc-display-offline-min-v6.apk`；大小 `89208438` bytes，SHA-256 `0f7af47dbba366758ebbe818994da37f39028bd8174ba6b3dfa8754f33366b68`，两站点 manifest/签名和 HTTP Content-Length 已复验。
  - v7（`0.2.5-offline-min`）已正式发布到 LAN/WAN，APK 大小 `89535999` bytes，SHA-256 `80501f7ea36a96377f8cddec3f238e0ec31b2d2bc30681d3f4b650c3ada324af`；SM-N9500 真机已安装并确认 Activity 位于 Display 2，固定 `offline-display` 服务健康接口和 UI 自动化按钮检查通过。v7 校正前按 1280 像素长边计算为 150%；真实触控/截图受 `touch NONE` 和 Desktop 虚拟屏限制未完成，现行比例以 v8 DPI 校正记录为准。
  - v8（`0.2.6-offline-min`）已完成 DPI 校正并正式发布，APK 大小 `89231402` bytes，SHA-256 `470c19c57ca528d84e87729ece45b74d48a3e2acdfbf124a16751a04786b0d2c`；按 `1280px@320dpi=100%` 公式，Display 2 `1920×1080@160dpi` 为 75%。SM-N9500 真机已覆盖安装并确认 Display 2 窗口、固定 `offline-display` 健康接口和 Qwen ready 状态正常。
  - v9（`0.2.7-offline-min`）已完成右下角诊断浮层构建、真机验证和 LAN/WAN 正式发布，APK 大小 `89233662` bytes，SHA-256 `32181e75e3dbfe7b381bd0660f49778860ca62c4683bc69d7dbb3254eef549b7`；UI 自动化读取到 `分辨率 1920×1018 | DPI 160 | 缩放 75%`。默认域名 `c.aasc.us` 返回备案拦截 403，本次使用 WAN 直接 IP 验收。
  - v11（`0.2.9-offline-min`）已发布本次控制端输入框自动缩放修复，APK 大小 `89235646` bytes，SHA-256 `0b3ab8871ca17e32fa1dc5db767ef8b31049a973d8d678faa471e1ad4ac396da`；LAN/WAN HTTP、清单、签名、ZIP 完整性和远端 hash 均通过，尚未覆盖安装真机。
  - v12（`0.2.10-offline-min`）已正式发布控制端聊天设置 profile 协议保护；APK 大小 `89236426` bytes，SHA-256 `c4c20af9ab6b71c5e0e5dad1b4d3d2f1cdfce8cb7eaee91d6dde0ff1afdcf253`，服务 code v4 大小 `13996510` bytes、SHA-256 `7ca5adf90be5738ee94b47e31534d574b411a1934e3b0d0db6702955b1247bd2`；更新日志已写入签名清单，LAN/WAN 直连 IP HTTP、清单签名、APK v2 和远端文件校验通过。
  - [2026-09-20] 聊天 TTS 打断与 Offline 前台定时更新已联合发布：code v14（`15173599` bytes，SHA-256 `a0fd191e9d9b2eeabb9e56807b0c6715818cd5e60f9b31c518b085b6d5f6aa8d`）复用 dependencies v4；min v24（`0.2.22-offline-min`，`89264782` bytes，SHA-256 `faed86143a39eff7fa398b2815b9952e35867c68d5776cd0d9a565cec195c7b6`）已同步 LAN/WAN，清单/签名/HTTP/远端 hash 和旧版本精确清理通过。
  - full 已对齐 min v9（`versionCode=9`、`0.2.7-offline`）并发布为 `aasc-display-offline-v9.apk`，大小 `957310007` bytes，SHA-256 `b1625bdf269e256d98aa45254c14a9531dcdfa3399d0b7d31b18daccbe1f83a7`；LAN/WAN IP HTTP 200、Content-Length 和远端 hash 一致，旧 full v2 已清理，服务 manifest 未替换。
  - full v12（`0.2.10-offline`）已对齐当前 min versionCode 12 并正式发布为 `aasc-display-offline-v12.apk`，大小 `957319386` bytes，SHA-256 `b107d7963bf4dd18068404427e12f4edc72ff8253e8914e3d1909ca66e6c8183`；LAN/WAN 直连 IP HTTP、Content-Length、远端 hash、APK v2 签名和 ZIP 完整性均通过，旧 full v9 保留。
  - full v13（`0.2.11-offline`）已正式发布本轮 Chat2API 账号凭证与 Android 外部网页恢复代码，文件 `aasc-display-offline-v13.apk`，大小 `957338670` bytes，SHA-256 `326d30feada394860925d2f11320bd4fb60b84cae1a710135303b89be203429c`；LAN/WAN 直连 IP HTTP、Content-Length 和远端 hash 均通过，服务 manifest 未替换。
  - min v14（`0.2.12-offline-min`）已配套发布，文件 `aasc-display-offline-min-v14.apk`，大小 `89245126` bytes，SHA-256 `062aee3158d5534c18b57bf8dcf28dccdffe9b27ebd33cbaa00b35fc0143382f`；versionCode 高于 full v13，LAN/WAN 直连 IP 的清单、签名、HTTP 200/Content-Length、完整 hash 和 SM-N9500 v10 更新提示均通过。
  - Chat2API 账户管理四按钮问题已通过 code-only v5 修复并发布：`code/code-v5.zip`，大小 `14005201` bytes，SHA-256 `dae26685353195f23afb4828980b829bb30e5aef6822887233e927714576de9e`；沿用 dependencies v3 和 apkMin v14。SM-N9500 重启后已原子切换 `code=5, dependencies=3`，设备脚本含独立账号凭证导出/导入按钮。
  - full v14（`0.2.12-offline`）已覆盖安装到 SM-N9500，内置 API 28 归档签名兼容读取；随后 min v15（`0.2.13-offline-min`）已在真机完成下载、校验、系统确认安装，安装后版本码为 15，服务数据和 Node 启动均保留。
  - min v15 文件 `aasc-display-offline-min-v15.apk` 大小 `89245994` bytes，SHA-256 `ad33c255829a01045d47c665d2dc18705eb9233f47502c77d2bb181fc5284def`；full v14 文件 `aasc-display-offline-v14.apk` 大小 `957339538` bytes，SHA-256 `39b6b907cfa334d98870a7ba20814099bd9f7a074ed7bd8e0de84c907698978e`。LAN/WAN 直连 IP HTTP、Content-Length、签名和远端 hash 已复验。
  - full v2 APK 已上传外网 `http://120.79.245.103/mnt/aasc-offline/apk/aasc-display-offline-v2.apk`，远端完整 hash 与本地一致；本次追加 min v6、v7、v8 版本文件并更新签名清单。
  - 独立 RSA 密钥对已接入打包工具并存放于 `~/.config/aasc-user/`；更新包构建已支持临时工作区与输出目录跨文件系统，归档复制到输出同目录临时文件后再原子切换。
  - 外网主机登录 shell 为 fish；发布器已通过 `/bin/sh -c` 执行远端 POSIX 脚本，并在远端 manifest 原子切换前设置 `0644`，真实发布通过。
  - SM-N9500 真机原有 v1 APK 已按测试要求卸载，fresh install full v2 成功，首次解包约 911 MiB；`/api/status`、`/v1/models` 和默认模型聊天通过。
  - 已修复 ZIP 目录项规范化后的 `src` / `node_modules` 根目录白名单问题；真机 fresh install 后 code/dependencies v3 成功应用，`active-release.json` 的 `pendingHealth=false`，`/api/status`、`/v1/models` 和默认模型聊天通过。
  - min v3 已携带 `libaasc_node.so` 并在 SM-N9500 Android 9 上原位安装成功；配置、任务、模型缓存和 code/dependencies v3 active release 保留，`/api/status`、`/v1/models`、默认模型聊天和显示端 WebSocket 通过。正式发布的 min v4 已完成双站点工件验收，设备安装回归仍待单独执行。
  - 仍待：回滚/异常降级、code-only 与 LAN/WAN fallback/bad-hash/低空间场景，以及 ASR/TTS 完整业务回归；v10 缩放曲线和本次 code v5 账号按钮发布已完成。
  - 设计：`docs/design/android-offline-hot-update.md`；伪代码：`docs/spec/android-offline-hot-update.md`；任务：`docs/task/2026-09-16_OfflineAPK服务热更新与原生增量APK.md`。

- ⏳可选 [2026-09-15] 统计 offline APK 首次启动的分阶段耗时
  - 真机完整校验版本首次安装已测得 Runtime 解包约 133.5 秒、Node launcher 总耗时约 133.6 秒、Activity 启动约 2.1 秒；当前默认不校验版本已测得内容安装约 116.9 秒。仍待补充 APK 进程、WebView、8081 就绪、`llm-server` 恢复和模型首次加载的统一时间线。

- ⏳待现场验收 [2026-09-14] Chat2API Android Provider 真实网页登录验证
  - 普通 APK 已完成构建、安装和启动冒烟；仍需使用测试账号验证网页登录、Authorization/localStorage/Cookie 捕获、Provider 接口校验和账号保存。
  - offline APK 已使用包含当前 Chat2API 源码和生产依赖的运行包重新构建、卸载重装并完成本地聊天/语音接口验收；本轮已导入本机 Qwen 账号并完成真实 Chat Completions 请求，空映射下 `Qwen3.6` 成功而 `Qwen3.6-Flash` 返回 `no_available_account`（该别名仍需显式映射）；控制端手动聊天的 `qwen3.5` profile 当前为 `agent/pi`，真实 WebView 登录捕获仍需现场测试账号，Pi Provider manifest 缺失问题已由 code-only v15 修复并在真机日志中确认不再出现。
  - Offline APK 的 Pi SDK hidden Provider manifest 打包、安装恢复和 active dependency 选择已完成自动化及真机链路验证；真机单条 Pi 回复仍受 MNN 请求超时/服务进程稳定性影响，需另立任务处理。Android 节点策略仅明确禁用外部 CLI（Codex），未将 Pi 标记为业务禁用。
  - 2026-09-15 已生成 `release/apkbuild/allserver/output/aasc-display-offline.apk`，内含 release 配置、任务 results 和默认 MNNChat 模型；本次只完成构建与静态校验，未替代真实 Provider 登录验收。
  - 关联文档：`docs/design/android-chat2api-login-control.md`；`docs/spec/android-chat2api-login-control.md`；`docs/task/20260914_Android Chat2API登录与显示端控制端开放.md`。


- 🔄进行中 [2026-09-13] Android 子服务器媒体库 `~/` 映射到应用专属外部目录
  - 目标目录为 `/storage/emulated/0/Android/data/com.aasc.display/files`，需完成旧字面 `~` 目录迁移和 APK 真机验证。

- 🔄进行中 [2026-09-13] APK 内置 Node 子服务器支持 Android 10 及 Android 11+ 共享存储文件访问
  - 已完成 SAF 文件夹选择器、原生回环网关、虚拟根 `/`、Node provider 和本地回归；SM-N9500 Android 9/API 28 已验收 APK 启动、Node 健康接口和旧版媒体库列举；Android 10/11+ 真机媒体库验收仍待执行。

- ⏳待现场验收 [2026-09-08] 完成 APK 内置 Node.js 子服务器的生产依赖打包和真机业务验收
  - Node Runtime、安装器、Service、主服务器主动连接和能力裁剪已实现；生产 `node_modules` 已用于 offline APK，server-app 启动、AASC 注册、本地聊天、显示端 ASR/TTS 路由已完成 API 级真机验收。
  - 仍待验收媒体库浏览/上传/直连播放、热更新，以及 Android 10/11+ SAF 真机流程。
  - 设计：`docs/design/android-embedded-node-server.md`；实现伪代码：`docs/spec/android-embedded-node-server.md`；任务：`docs/task/20260908_APK内置Node.js子服务器.md`。

- ⏳可选任务 [2026-09-02] 为 Android YOLO11 测试 APK 增加带标注验证集的准确率评估
  - 当前已记录 `bus.jpg` 单图定性结果；正式 Precision、Recall、mAP 需要目标场景的图片和标注数据。

- ⏳待处理 [2026-09-01] 将 Termux 服务器试运行整理为正式 Android 节点
  - 当前 `~/aasc-server-test` 已能在 Termux 以 runit 服务运行，使用 8081 端口；服务器发布包现由 `npm run build:server-package` 显式生成，主服务器媒体索引聚合、远程媒体直连优先/代理回退、控制端媒体写入、APK 子服务器重启恢复和节点就绪后的正常播放重播已完成，后续仍需认证和完整 Android 生产包现场验收。
  - 当前 ASR、TTS Wine、Puppeteer 暂不迁移；正式节点需要在配置和控制端明确不可用能力。

- ⏳待处理 [2026-08-25] 修复 APK 原生 ASR 识别结果为空及声纹 native 崩溃
  - 2026-09-13 offline APK 在 display 2 上使用 SenseVoice 测试音频已返回“你好，小爱。”；当前待处理范围收敛为声纹稳定性、原生桥异常日志、速度/P95 和长稳内存压测，不再把普通 ASR 空结果作为当前复现结论。
  - 2026-08-27 对照测试：WeSpeaker 单段和 Sherpa 两种流程均可返回文字/声纹；WeSpeaker 多段滑窗 embedding 在四个音频上均触发 OOM，即使不加载 ASR 模型仍复现。
  - 2026-08-27 独立测试 APK 已移除 WeSpeaker 测试，当前验收范围仅保留 Sherpa 单段/多段；WeSpeaker 多次 embedding 的 OOM 不再阻塞该 APK。
  - 仍需继续定位生产显示端原生桥异常/结果日志，修复后再完成速度、P95 和长稳内存压测。

## AASC 网络

- ⏳待处理 [2026-09-05] 设计并实现 AASC 权限认证
  - 在节点注册、媒体索引和任务路由稳定后，再增加用户、节点、媒体库和操作权限。

## 批量播放模式

- ⏳待现场验证 [2026-09-24] 批量图片切换不再打断并回退 TTS
  - 图片切图已跳过空音视频元素的 `pause/load`；TTS 只在当前语音确实暂停时执行恢复。
  - 需在目标 Android WebView 验证自动/手动切图、循环播放、开启文件名播报及聊天 TTS 同时播放的组合。
  - 关联文档：`docs/design/batch-playlist.md`、`docs/spec/batch-playlist.md`、`docs/task/2026-09-24_批量图片切换打断TTS修复.md`。

# 当前任务

## 显示端 VRM/MMD

- 📋方案待确认 [2026-10-02] mmd-ar单目IMU自动标定与SLAM锚点恢复：用户已确认功能目标，具体改动方案待确认。自动读取设备信息、引导采集/电脑求解、验证后启用IMU；按地图保存/恢复锚点并处理参考关键帧和地图合并，明确暂时失锁/重建/恢复状态。任务：`docs/task/20261002_MMDAR单目IMU自动标定与锚点恢复.md`；本轮未改运行代码。
  - [2026-10-03] 用户要求先写独立六轴IMU网页实验，本APK方案保留为后续，未开始实施。
  - SM-N9500有加速度计/陀螺仪，相机时间戳UNKNOWN，现有REALTIME门控不能直接启用；需要实测同步关系。电脑尚无Kalibr/rosbags，求解环境、标定板尺寸及真实运动/静置采集仍待落实。启用IMU不能替代地图锚点恢复修正。

- 📋待验收 [2026-10-01] mmd-ar 原生定位手机现场：原图首定位/尺度、移开图片跟踪、失锁重定位/回环、新地图重新看图、手机目录PMX/贴图及标定导入、后台释放、相机裁切/旋转、实际相机与 IMU 标定/时间同步及性能。APK已同步全部网页功能并覆盖安装SM-N9500，三面板点击与官方图读取已确认；本项仅保留现场定位/文件选择验收。外网发布待用户安排。任务：`docs/task/20260930_MMDAR_ORB-SLAM3定位迁移评估.md`、`docs/task/20261001_MMDAR网页全功能同步测试APK.md`。

- ⏳待现场验收/发布 [2026-09-30] mmd-ar 180Hz与Ammo子步稳定性：本地网页已构建，关节纠错时间归一/type2子步位置驱动/全Hz预算已完成，86项覆盖通过；用户局域网地址HTTP200已提供新实现。待手机具体PMX/小物件观感、实际帧率/CPU与不同动作验收，外网尚未发布。关联：`docs/task/20260930_MMDAR跨Hz布料手感与小物件抖动.md`、`docs/task/20260930_MMDAR布料物理频率上限180Hz.md`。


- ⏳待现场验收/发布 [2026-09-30] mmd-ar 换PMX继承当前VMD与T Pose分帧初始化：本地web-dist已生成，67项自测通过；待发布后检查手机换模型/动作的布料稳定性、不同模型动作兼容性与首帧观感。任务：`docs/task/20260930_MMDAR继承当前动作与Tpose分帧初始化.md`。

- ⏳待现场验收/发布 [2026-09-30] mmd-ar 重力缓动默认20ms：本地web-dist已生成；待发布并在无已保存参数的浏览器确认默认20ms及跟随观感，已有手动保存值仍恢复。任务：`docs/task/20260930_MMDAR重力缓动默认20ms.md`。

- ⏳待现场验收/发布 [2026-09-30] mmd-ar Ammo内存释放修复：最新web-dist已生成，尚未发布；67项自测通过。
  - 手机持续交替切换PMX/VMD与物理开关，检查内存/布料/帧率；大模型切换仍有新旧短暂并存峰值，已abort的页面需在更新后刷新。
  - 任务：`docs/task/20260930_MMDAR频繁切换Ammo内存泄漏.md`。

- ⏳待现场验收/发布 [2026-09-30] mmd-ar 重力摄像头背景与面板默认外观
  - 本地web-dist已生成，待发布外网；待手机确认重力/背景快速切换、授权取消/拒绝、图片识别时隐藏背景、校准交接、前后台、横竖屏及真实/模拟输入切换无相机重复占用；检查50%默认值与原手动值恢复。
  - 任务：`docs/task/20260930_MMDAR重力摄像头背景与默认外观.md`。本轮未执行自动或真机测试。

- ⏳待现场验收/发布 [2026-09-30] mmd-ar 重力过滤、手动 VMD 顺序、加载进度与初始化速度清理
  - web-dist 已生成；待真机确认前后/左右倾斜、仅航向变化无倾斜、手动旋转前后叠加、居中/关闭保留手动、权限取消/横竖屏/后台/模型重载、与 IMU 相机融合同时使用，以及动作/物理与帧率。此前重力过滤和VMD顺序版本已有外网发布记录；本轮新增加载进度与初始化速度清理共61项自测通过，最新web-dist已生成，尚未发布。待手机检查目录/PMX/VMD加载提示、同步初始化时的可见阶段、横竖屏、换模型/动作布料稳定性及循环重播。
  - 任务：`docs/task/20260930_MMDAR完整实时重力方向.md`、`docs/task/20260930_MMDAR切换VMD先应用动作后物理.md`、`docs/task/20260930_MMDAR本地模型动作加载进度.md`、`docs/task/20260930_MMDAR初始化物理速度归零.md`。

- ⏳待现场验收 [2026-09-29] mmd-ar MindAR One Euro Filter 调节：滑条已发布，值在停止后重新开始定位时应用；需在同一设备和定位图下比较静止抖动、快速移动滞后与失锁重锁。

- ⏳待现场验收 [2026-09-29] MMD 角色右键拖动与相机滚轮/双指缩放，near 固定为 1
  - mmd-ar HTTPS 测试页、PMX 普通/AR 相机和 VRM 正式相机均已将 near 固定为 1；页面更新已发布，62 个静态资源的远端校验无差异。Offline 正式服务包 code-v45 已发布到内网和外网，复用 dependencies v6、Node seeds v39、min APK v34；未重跑自动测试。待桌面检查相机距离变化，并在 Android 正式 APK 与 mmd-ar HTTPS 测试页确认双指手势、near 裁剪观感、失锁重锁保留角色偏移及停止后复位。
  - 关联文档：docs/design/display-chat-mmd.md、docs/spec/display-chat-mmd.md、docs/design/mmd-ar-test-apk.md、docs/spec/mmd-ar-test-apk.md、docs/task/20260929_MMD_AR角色拖动和连续缩放.md。

- ⏳待现场验收 [2026-09-29] 正式 Offline 显示端合并 MMD AR 用户功能：检查 Android WebView 上的分类面板、模型加载百分比、AO 边界修正/高光、MindAR 首锁与失锁重锁；当前无 ADB 设备，尚未完成真机验收。

- ⏳待现场验收 [2026-09-29] mmd-ar-test 独立动作面板与只读 VMD 进度：外网发布后检查手机竖屏面板、循环与暂停状态。

- ⏳待现场验收 [2026-10-01] mmd-ar 测试网页相机动作 VMD：本地选择相机动画 VMD 后仅在未定位的普通预览驱动虚拟相机，定位中暂停、退出恢复，循环播放且进度只读。
  - 新增 `3rd/mmd-ar-test/web-camera-motion-inject.js`，更新 `build.js`、`web-panel-groups.js`、`web-local-assets-ui.mjs`；网页与独立测试APK共用，正式显示端与 Offline 产物不变。桌面 Chromium/SwiftShader 自动验证通过（相机动作 2/2、面板 8/8），web-dist及同步版APK已生成；待手机确认文件选择、真实镜头 VMD 观感与循环、定位往返、与体感/重力及物理同时使用。
  - 任务：`docs/task/20261001_MMDAR测试网页相机动作VMD.md`。

- ⏳待现场验证 [2026-09-28] 对比 Android Vivaldi 与正常浏览器的 WebGL2 原始深度读数
  - 半分辨率边界修正开关及法线预览白边保护已发布外网；用户确认横条消失、边界效果改善。仍待 Vivaldi 对照细发丝、运动和边界密集时的帧率，再决定正式显示端同步。
  - 独立 `3rd/mmd-ar-test/depth-probe.html` 已在桌面 Chromium/SwiftShader 验证标准透视深度；待两款手机浏览器对照两组裁剪范围中的已知值、片元深度、纹理采样三路读数，并保存报告后判断 AO 错位原因。
  - 测试网页“基础光照”已加入当前投影 near/far 读数；现场比较时同步记录普通/AR 模式和该读数，避免只用初始化的 0.01、100 推断深度精度。
  - 关联文档：`docs/design/mmd-ar-test-apk.md`、`docs/spec/mmd-ar-test-apk.md`、`docs/task/20260928_独立WebGL深度纹理诊断页.md`、`docs/task/20260928_MMDAR测试网页相机裁剪范围读数.md`。

- ⏳待现场验收 [2026-09-27] MMD AR 布料首屏姿态与抖动对照
  - 已按现场反馈移除首载 180 步隐藏预热和初始化时自动应用 VMD 第 0 帧；新模型首个实际渲染帧只更新物理且不绘制角色，第二帧才推进动作并显示，显式换动作和暂停恢复不延迟。此前预热方案不再是当前行为。
  - HTTPS 测试页已加默认开启且本地持久化的“播放动作”开关；关闭只暂停 VMD，布料物理继续。此开关用于隔离变量，不代表上漂问题已修复。
  - HTTPS 测试页“物理”分类已加默认开启的有/无物理对照开关；切换会重载 PMX。待现场比较裙摆穿模，并验证重新开启后的布料状态。
  - 测试网页已发布外网；待用实际 PMX 在浏览器/Android WebView 检查刷新后的布料稳定性、动作暂停时物理表现与首屏耗时。
  - 关联文档：`docs/design/mmd-pmx-vmd-local.md`、`docs/spec/mmd-pmx-vmd-local.md`、`docs/task/20260926_PMX布料首屏稳定预热.md`、`docs/task/20260926_MMD-AR动作播放开关.md`、`docs/task/20260926_MMD-AR测试网页物理开关.md`、`docs/task/20260927_PMX取消首帧与物理预热.md`、`docs/task/20260927_PMX首次动作延迟一帧.md`。

- ⏳待验证/发布 [2026-09-30] mmd-ar 合并 Mind Basic 相机预测
  - web-dist 已重新生成；待手机确认校准/静置抗漂移、双场景旋转和平移、首次失败接管/三帧重获、可信度、固定蓝框、停止/换图/后台恢复，以及原相机死区/第二层缓动、near=1、缩放/拖动/物理继续正常。本次未运行测试、未发布外网。
  - 任务：`docs/task/20260930_MMDAR合并MindBasic相机预测.md`。

- ⏳待现场验证 [2026-09-25] MindAR Basic 外网示例手机识别
  - [2026-09-30] 待验证并发布相机预测版本 `20260930-camera-world-5`：检查固定锚点世界变换不随 IMU/视觉改变、相机纯旋转/平移、参考图对齐、near/far、重获纠偏、双场景开关及停止/换图；本次未运行测试。任务：`docs/task/20260930_MindAR-Basic相机预测与固定模型.md`。
  - [2026-09-30] 两个场景开关版本已发布，待现场验收：每个同时控制旋转和平移；现场检查可见/不可见开关四种组合、失锁和重新识别、关闭冻结及重新开启连续性。版本 `20260930-imu-phase-4`。
  - [2026-09-30] 死区×2和首个失败帧接管版本已发布，待现场验收；手机快速左右移动检查失锁保持/连续三帧重获，慢转检查扩大死区后的灵敏度。版本 `20260930-imu-deadzone-3`。
  - [2026-09-30] 旋转/平移抗漂移版本已发布，待真机对照：静置、慢转、快转、匀速移动、失锁、恢复；检查静止判定、原始/校正后数据、低速跟手与漂移。需填写真实图宽，至少静置 1.2 秒完成双零偏校准。
  - [2026-09-30] 质量观测面板已发布，待真机比较遮挡、模糊、小目标和斜视角的质量分/匹配点/重投影误差；估算分数尚未标定，不参与融合权重。当前共 6 个运行资源，包含 `mind-basic-quality.js`。
  - [2026-09-29] 待发布并进行 Android IMU＋MindAR 融合实验：22/22 本地回归已通过；按实物填写图宽，检查正常跟踪平移、失锁超时停止平移但继续旋转、三帧稳定重获、传感器中断及画面背景。任务：`docs/task/20260929_MindAR-Basic同时视觉惯性定位.md`。
  - [2026-09-29] 待发布并确认 Android 镜头黑底兼容修复、失锁后保留模型、预测到期冻结、重新识别恢复，以及停止/切换清除；本轮未运行自动化测试。
  - 整帧照片上的蓝色裁剪框叠加、移动/缩放及控制面板默认展开/收起已在 Chromium 通过；不显示单独裁剪缩略图。仅待真机触摸命中、实际相机目标首锁、切换/停止与模型对齐验收。
  - 待发布与真机验收 [2026-09-29] IMU 主导旋转优化：本地算法/浏览器模拟已覆盖逐帧预测、视觉纠偏、矩阵读取、过期降级、失锁恢复与单位换算；尚未同步外网。需 Android HTTPS 验证横竖屏轴向、静止抖动、快速转动拖后、短时失锁漂移和重获过渡。任务：`docs/task/20260929_MindAR-Basic-IMU主导旋转.md`。
  - 关联文档：`docs/design/mindar-basic-web.md`、`docs/spec/mindar-basic-web.md`、`docs/task/2026-09-25_MindAR官方Basic示例外网发布.md`、`docs/task/2026-09-25_MindAR-Basic自定义图片定位.md`、`docs/task/2026-09-25_MindAR-Basic固定矩形裁剪.md`、`docs/task/2026-09-25_MindAR-Basic裁剪编辑与面板收起.md`、`docs/task/20260926_MindAR-Basic-IMU姿态防抖与失锁补偿.md`。

- ⏳待现场验证 [2026-09-23] 显示端交互层适配旋转角度
  - MMD、聊天、灯光/定位控件和底部三个按钮已接入 `currentRotation`，四方向真机/浏览器布局、触摸命中和面板滚动待验收。
  - 关联文档：`docs/design/display-chat-mmd.md`、`docs/spec/display-chat-mmd.md`、`docs/task/2026-09-23_显示端旋转布局适配.md`。

- ⏳待现场验证 [2026-09-23] 显示端摄像头能力开关
  - 控制端设备能力树和能力编辑弹窗已增加逐显示端开关，服务端保存并在重连时恢复；关闭会停止普通摄像头会话和 AR 跟踪。
  - 待在浏览器与 Android WebView 验证关闭时摄像头轨道释放、请求被阻止、重连状态恢复，并确认麦克风录音不受影响。
  - 关联文档：`docs/design/display-camera-chat.md`、`docs/spec/display-camera-chat.md`、`docs/task/2026-09-23_显示端摄像头开关.md`。

- ⏳待现场验证 [2026-09-23] MMD AR MindAR 真机跟踪效果
  - 正式端 MindAR 相机参数和物理/动作开关已随 Offline code-v41 发布；算法固定为 MindAR 后，待新版服务代码和测试 APK 可用时检查摄像头构图、首锁、连续跟踪、失锁/重锁、底面/立面、布料和触控。当前 Windows 构建脚本无法启动 `gradlew`，直接调用 `gradlew.bat` 受 Gradle loopback 连接失败阻断。
  - 2026-09-26 HTTPS 测试页本地新增底面/立面切换：底面图中心、立面图下边缘中点分别对齐角色脚底；待真机核对竖立图片的方向、比例、切换时无跳错和布料稳定。本次未发布。
  - 2026-09-26 外网测试网页已加入相机平移/旋转死区、逐帧缓动和沿相机—定位图中心连线拉近设置，死区现比较原始定位图位姿。针对蓝框贴图但角色滞留旧位置，锚点位姿逐帧补偿与重锁同步状态已发布外网；待真机检查弱光抖动、快速移动跟手、失锁后重锁、50% 距离的透视和面板触控。
  - 2026-09-26 外网测试网页已改为失锁时保持角色可见和最后相机视角；模拟图 0–360° 旋转已改为先在图片平面按原图比例旋转，再做经纬度透视。仍需真机观察失锁/重锁是否跳变及旋转透视观感。
  - 2026-09-26 模拟图左侧经度、右侧纬度、下方 0–360° 水平旋转已在本地网页接入，自动化透视/拍照/定位回归通过；真机布局和触控待验收，外网尚未发布本版。
  - 2026-09-26 本地测试网页已在模拟定位回前台时自动重建流并恢复目标；AR 相机不再改模型根节点位置/缩放，待真机确认后台恢复画面、布料物理和透视比例。未发布外网。
  - 2026-09-26 模拟取景已按原图宽高比生成画布与预览、纬度滑条，拍照校准与 MindAR 读取同一比例的视频帧；电脑竖图/横图切换回归通过。真实手机上的长画面性能、触控和画面裁切仍待验收，外网尚未发布本版。
  - 2026-09-26 本地测试网页已按 960×540 取景比例，从经度滑条宽度计算纬度滑条高度；平放目标图的 A-Frame 锚点已驱动 PMX 相机，角色脚底固定在图中心，失锁隐藏、停止恢复。浏览器合成矩阵和模拟首锁通过；真实手机仍需确认尺寸、方向、裁切和连续跟踪，外网尚未发布本版。
  - 2026-09-26 电脑模拟摄像头已改为上方缩放、右侧纬度、下方经度与图片拖动平移；本地浏览器回归通过，外网尚未发布此版。旧四角模拟交互只属于已发布的历史版本，后续外网验收需以新版本发布后进行。
  - 2026-09-26 测试网页拍后校准已改为可移动、沿边角缩放的矩形，浏览器保存与定位回归通过；真实手机触控尺寸和手势仍待现场验证，外网尚未发布本次改动。
  - 2026-09-26 内网深层路径的资源加载和模拟拍照校准已修复；实际内网 HTTP 页在无实体相机 Chromium 中可预览并取消模拟校准。本次尚未重新发布外网，真实设备触控及相机识别仍待现场验收。
  - 2026-09-26 HTTPS 测试网页已发布本地图片模拟摄像头与四角透视控制，关闭控制点后仍保留透视；无实体相机 Chromium 可用官方目标首锁。模拟识别不代替真实手机首锁/透视对齐验收。
  - 2026-09-25 HTTPS MMD AR 测试页已发布 MindAR Basic 的 A-Frame 目标锚点，蓝色半透明矩形和中心十字贴合定位图；原绿色中心标记和旧 Controller 输入分辨率选项已移除。待真机确认蓝框透视对齐、目标丢失/停止隐藏、MMD 正常显示与面板点击响应。
  - 2026-09-25 Chromium 模拟相机回放已用官方 `.mind` 锁定并触发丢失；A-Frame 使用相机原始帧，高分辨率手机的首锁、持续跟踪帧率、焦距/曝光和触控响应仍待现场复测。网页主光阴影可单独关闭，补光自身阴影不受影响。
  - 2026-09-25 测试网页已限制校准弹窗在手机可视区内、合并第一分类的定位开始/结束按钮，并实现主光常驻阴影与补光独立阴影模式；浏览器自动测试完成后仍需真实手机检查拍照后四角拖动、定位状态切换和阴影观感。
  - 2026-09-25 `testimg` 静态回放：MindAR 3/3 锁定、自写 JS 0/3；外网 HTTPS 测试页仍仅使用 MindAR 算法，但保留完整 MMD 测试界面。正式显示端暂保留原跟踪器；手机相机连续视频和定位面板触摸滚动仍待现场验收。
  - 关联任务：`docs/task/2026-09-25_MMD-AR定位标识测试分支恢复完整测试页.md`、`docs/task/2026-09-25_MMD-AR网页接入MindAR-Basic锚点定位.md`。
  - 2026-09-25 HTTPS 测试页已发布 MindAR 官方示例图，可用另一屏幕或打印件复测首锁；真机实际识别仍待现场验证。
  - 2026-09-25 HTTPS 测试网页的灯光/定位分类及标题开关已发布；分类文字误切换开关和面板事件阻断导致无法展开的问题均已修复。手机浏览器上仍需现场检查折叠触摸、长列表滚动和定位相机操作。
  - 2026-09-24 例外重建的测试 APK 已包含当前 AO 脚本，并在 SM-N9500 内屏覆盖安装、启动；与 HTTPS 页的 AO 画质差异仍需在同一真机、相同灯光设置下复测。
  - HTTPS 测试页现仅使用 MindAR 1.2.5；同一定位图和四角选区下可统计准备/编译时间、首锁、实际识别帧率、时间加权可见率、丢失和屏幕锚点 RMS。生产显示端仍只用原 JS tracker；原独立测试 APK 不再维护。
  - MindAR 编译现已传入必需进度回调，实时显示编译百分比；编译/初始化错误也会显示具体原因。竖屏顶部提示已为灯光按钮预留空间；修正版已上传外网，真实图片首锁及 A/B 数据仍待现场验证。
  - 尚待在真机对同一张纹理图片、相同距离/角度/光线下分别采集数据；锚点 RMS 测量时保持目标静止。
  - HTTPS 静态测试页已发布至 `https://c.aasc.us/mnt/mmd-ar/`，可用手机浏览器直接复测相机权限与 MindAR 目标首锁；网页与 APK 的定位图需各自保存。
  - HTTPS 网页模型加载进度已加入，仍待现场确认慢网下百分比和窄屏进度条布局；独立 APK、正式显示端保持原有状态文字。
  - HTTPS 网页 Canvas 已适配窗口/舞台尺寸变化，正式显示端与网页的灯光面板显示实际渲染分辨率；浏览器模拟和线上请求通过，真机横竖屏与 GPU 观感待验收。
  - 关联文档：`docs/design/mmd-ar-test-apk.md`、`docs/spec/mmd-ar-test-apk.md`、`docs/task/2026-09-23_MMD图片跟踪器MindAR对比测试.md`。

- ⏳待现场验证 [2026-09-23] PMX 双边缘光与普通光照默认值
  - 在真实米娅及 Android WebView 上检查两组边缘光各自的方向、颜色、强度与开关；正面不被边缘光照亮，动作与旋转后轮廓连续，观察发丝/裙摆透明边缘及帧率。旧 localStorage 明确保存的 Toon 开启状态应保留，恢复默认后关闭。
  - 关联任务：`docs/task/2026-09-23_PMX双边缘光与Toon默认关闭.md`。

- ⏳待现场验证 [2026-09-23] PMX Toon / 普通光照切换的真实模型观感
  - 在米娅 PMX 上用环境光 0、补光强度 0、主光 0.80 验证普通模式背光面转暗；再启用反向补光确认能照亮该面，并检查阴影、AO、动作与 Android WebView 帧率。VRM 应保持原样。
  - 关联任务：`docs/task/2026-09-23_PMX普通光照切换.md`。

- ⏳待现场验证 [2026-09-23] PMX/VRM 补光视觉效果与移动 WebView 帧率
  - 在真实模型上检查默认关闭、白色补光开启后颜色/强度/方向变化、切换模型与刷新恢复；确认补光不会投射阴影，主光阴影开关仍独立有效。
  - 关联任务：`docs/task/2026-09-23_显示端补光源设置.md`。

- 🔄进行中 [2026-09-22] 实现普通图片基准图 AR 第一阶段
  - 已实现右上角定位入口、独立拍照/四角编辑弹窗、IndexedDB 目标管理、本地图像特征跟踪、MMD 下方摄像头画面和脚底屏幕锚点。
  - 定位视频层级已调整为仅覆盖媒体内容，位于语音/任务状态和 MMD/聊天交互界面下方；待目标设备验证。
  - 图片识别已加入方向与多尺度描述子，首次识别前显示“寻找中”；需在目标 Android 设备确认实际匹配率和帧率。
  - 持续“查找中”反馈已修正视频取帧宽高比并增加分阶段提示；需在目标 Android 设备确认实际识别率。
  - 第一阶段及后续修正服务代码已发布为 `code-v38.zip` 到局域网和外网；完整 APK 未发布，依赖继续使用 v6。
  - 计划支持显示端拍照、手动四角选区、本地目标跟踪、VRM/PMX 姿态叠加和 IndexedDB 目标保存。
  - 入口计划放在显示端右上角现有“灯光”按钮正下方，仅新增“定位”入口；AI/聊天继续复用已有入口，定位支持运行中切换目标。
  - 已加入六轴体感观察：只控制虚拟相机视角，不旋转角色；角色继续通过屏幕拖动旋转，并支持灵敏度和重新居中。
  - 进行中：将六轴体感明确为不依赖图片定位的固定距离独立环绕模式，只改变相机 yaw/pitch，忽略滚转、位移和变焦。
  - 待处理：在目标 Android WebView 上验证自然图跟踪稳定性、PMX/VRM 脚底对齐和帧率；按结果决定是否接入更强的离线 WASM/Worker 识别器。当前实现不上传摄像头帧。
  - 首期不包含 ARCore/WebXR、深度遮挡、真实地面识别和摄像头帧上传。
  - 关联文档：`docs/design/mmd-image-ar.md`、`docs/spec/mmd-image-ar.md`、`docs/task/20260922_MMD图片基准图AR设计.md`。

- ⏳待现场验证 [2026-09-23] PMX 环境遮蔽在 Android WebView 的画质与帧率
  - 本机 Chrome 已验证 AO 开关、颜色/强度/半径、半/全分辨率目标尺寸、透明背景和局部遮蔽；新增 12/24/32 次采样及 0–3 轮独立半径的深度保边空间降噪。待目标 Android 显示端对比静止颗粒、角色移动闪烁、发丝/裙摆边缘及不同采样/分辨率/模糊组合的帧率和触控响应。
  - 外网 HTTPS MMD AR 测试页已更新到 0–3 轮独立半径模糊版本，并完成六个网页文件的哈希校验；外网页面功能测试和目标 Android WebView 画质/帧率仍待现场进行，正式 Offline 服务包仍待另行发布。
  - 如 32 次采样仍有明显移动闪烁，评估具有历史失效与重投影的时域方案，不直接平均旧帧。
  - 关联任务：`docs/task/20260923_PMX角色AO环境遮蔽.md`、`docs/task/2026-09-24_PMX_AO采样与降噪优化.md`。

- ⏳待确认 [2026-09-24] MMD AR 网页贴图下载优化
  - 当前网页仍复制 2048×2048 原始 PNG 纹理，纹理合计约 8.1 MB，PMX 约 4.7 MB；待确认是否接受 WebP 变体及是否保留原图回退。

- ⏳待处理 [2026-09-22] MMD 公网资源默认切换的后续验收
  - 米娅 `miya-v1` 的 Offline 同源代理服务代码已完成，但本任务没有构建、发布或安装服务更新包。
  - 待后续单独完成：资源授权复核、HTTPS/WAN 回退验证、远端配置同步和默认资源地址切换；在这些完成前桌面显示端继续优先使用本地同源模型。

## 控制端语音配置

- ⏳待现场验证 [2026-09-19] 浏览器显示端 ASR 来源绑定修复
  - 代码已让浏览器显示端只通过 multipart 表单 `displayId` 传递持久化来源 ID；已现场验证重启服务端后来源恢复为 `display-izhstb6o`，并成功进入 `voiceInput`/`voiceCommand` 链路。
  - 仍需在显示端刷新和首次启动场景观察日志不再出现 `requested=-`。
  - 关联文档：`docs/design/server-side-asr-voice-input-processing.md`、`docs/spec/server-side-asr-voice-input-processing.md`、`docs/task/20260919_修复浏览器显示端ASR来源绑定.md`。

- ⏳待处理 [2026-08-31] active 群聊/私聊中的其他指令按普通聊天发送
  - 当前仅“搜索”已改为 active 会话普通聊天；天气、提醒、播放、静音、报时、录音及其他自定义指令仍按现有命令优先级处理。
  - 后续逐项确认并调整；`进入群聊` 已按当前需求支持等待唤醒状态下免唤醒进入持续群聊，其他等待唤醒命令规则暂不改变。
  - 当前三种语音会话状态的使用说明见 `docs/usage/voice-conversation.md`。

# Android 显示端缩放

- ✅已完成 [2026-09-20] 发布设备类别缩放系数修正版 Offline min APK
  - 代码已按 `smallestScreenWidthDp` 区分手机/电脑；手机系数 `1.108705`，电脑系数 `1.0`，缩放因子通用限制为 `1.0～3.0`。
  - `2309×1080@480dpi` 仅作为验算样例，手机计算结果为因子 `3.0`；versionCode `23`、versionName `0.2.21-offline-min` 已发布到 LAN/WAN。
  - APK 大小 `89264066` bytes，SHA-256 `dfed13b4b2a1946dd14c64ae0cfae1881ea1728184d82a43ea58c92e533950d0`；两端签名清单、HTTP `200`/`Content-Length` 和旧 min 精确清理通过。

# Android 显示端音频

- ⏳待现场验收 [2026-09-20] 正式 APK 使用标准 Bluetooth SCO 接入 AIMIC-M4 单路录音
  - 已完成不接入厂商 SDK 的 SCO 路由、Android 12+ `BLUETOOTH_CONNECT` 权限、无设备/超时回退、录音停止/页面销毁恢复音频模式和自动化验证。
  - 已补充控制端声音输出设备选择、按 displayId 持久化和 API 26–30 系统默认媒体路由回退；仍需现场完成 API 28 真机录音/输出、AIMIC-M4 断开回退、连续启停和 Android 12+ 权限流程验证。
  - 设计：`docs/design/android-display.md`；实现伪代码：`docs/spec/android-display.md`；任务：`docs/task/20260920_正式APK蓝牙SCO录音接入.md`。

## 外部应用焦点

- ⏳待现场验收 [2026-09-25] Node 子显示端语音唤醒与群聊路由
  - Node 子显示端已接入与网页显示端相同的服务端唤醒状态机，并使用固定 3 秒持续重连；待在 `voice-display-node-arch0` 上验证唤醒路由、首次连接失败后的恢复、重连 ID 不变及单一连接/录音恢复。Go/C# 客户端代码和协议未改。
  - 本轮未向目标节点部署或重启；关联文档：`docs/design/display-voice-conversation.md`、`docs/design/display.md`、`docs/spec/display-voice-conversation.md`、`docs/task/20260925_Node子显示端语音唤醒与群聊路由.md`。

- ⏳待现场验收 [2026-09-25] Node 子显示端录音能力关闭时释放麦克风
  - 控制端关闭 `voiceRecording` 后，节点应停止并释放底层采集器；重连权威能力到达前也保持关闭。重新开启后只启动一个采集流，断线后麦克风占用应结束。
  - 需在 `voice-display-node-DESKTOP-1I50TLH`（192.168.1.33）验证系统麦克风占用指示、关闭/开启、断线重连后显示端 ID 保持不变，以及 ASR 就绪前后的行为；本轮未远程部署或重启该节点。
  - 关联文档：`docs/design/display-capability.md`、`docs/spec/display-capability.md`、`docs/task/20260925_Node子显示端关闭录音释放麦克风.md`。

- ⏳待现场验收 [2026-09-12] Windows 子显示端语音输入端到端回归
  - 需在 Windows 10/11 同步最新 Node 子显示端代码并重启，验证“开始输入”/“结束输入”提示完成后持续产生 `asrAudio`，普通文本注入、 “返回”、 “发送”保持输入模式、30 秒超时退出及窗口切换保护。
  - 还需验证 `Alt+C` 在 `inherit`/`false` 间切换、重启后本地持久化；缺失/`undefined`/`null` 的本地策略按 `false` 处理，显式 `inherit` 才跟随服务器；以及 `voiceRecordingConfig`/`displayRecordingRequest` 不再产生未知消息。
  - 当前主服务端已重启加载状态提示播放门控修复；本环境无 Windows，无法替代远端实机验收。
  - 关联文档：`docs/design/windows-voice-text-input.md`、`docs/spec/windows-voice-text-input.md`、`docs/task/2026-09-12_子显示端Windows语音转文字输入.md`、`docs/task/2026-09-12_Windows语音输入超时声纹策略与录音协议修复.md`。

## TTS 播放
- ⏳待运行验收 [2026-10-03] 顶点布料GPU：浏览器/Android检查GPU与CPU切换、接缝裂开模型、阴影/AO/透明/表情、组开关与VMD回滚、能力回退/上下文恢复和3/5/10/45子步耗时；代码与独立网页已构建，尚未运行模拟或真机验收。任务：`docs/task/20261003_MMDAR顶点布料WebGL2与接缝.md`。



- ⏳待运行验收 [2026-10-03] 骨骼驱动+顶点自碰撞CPU/WebGL2：包体/包带/挂件连续性、跨组点面/边边接触、初始重叠与快速动作、形状跟随/表情/旋转、组开关不重启骨骼物理、阴影/AO/预览和手机3/5/10/45子步耗时。代码/独立网页已完成构建与静态编译，未运行模拟/真机，未发布。任务：`docs/task/20261003_MMDAR顶点布料WebGL2与接缝.md`。

- [ ] 真机验收 mmd-ar GPU 顶点布料500ms回退：刷新恢复、超时保留Ammo、正常完成、高DPI切片、切组/动作销毁及上下文丢失；确认首次驱动阻塞时的恢复延迟。

- [ ] 真机验收角色面板：米娅/西施互切、失败恢复、刷新记忆、本地模型入口与资源释放、静态控件禁用、AR/重力/灯光；核对西施材质修复后的身体/龙须自发光、裙子/角透明度、高光染色和头发PBR近似观感。

- [ ] 设备复核西施“模型地址无效”修复：使用最新web-dist确认实际GLB加载、材质显示及米娅往返切换。

- [ ] 设备验收西施人物拆分及角色URL：无龙/龙须且保留人物角；URL优先于记忆、面板互切同步地址、无效参数回退、加载失败地址不变及其他参数/hash保留。


- [ ] 设备验收mmd-ar接触阴影/SSGI：默认关闭、开关组合/AO关闭、主光方向、透明背景/头发、镜头移动与屏幕边缘；比较SSGI模糊0–3轮/逐轮半径对颗粒、细节及帧率的影响。功能本地已构建，未发布。2026-10-08补充：较大深度跨越的门控漏判已修正，三档受控GLSL检查通过；仍待用户模型同视角画面及手机性能验收。




- 屏幕接触阴影/SSGI降噪：设备评估可调0–3轮与逐轮半径的额外开销、残余低采样颗粒/条纹及透明衣物边界。

- MMD-AR完整页：排查双效果始终关闭时也出现的GL_INVALID_VALUE(1281)，以及软件渲染连续测试SIGKILL；新增滤波独立fixture未复现GL错误。

- MMD-AR编辑器：后续权重刷、顶点/UV/Morph、保真PMX导出、视频逐帧输出。
- MMD-AR编辑器：手机/独立APK多选、手柄与工程/PNG下载实机验收；大型模型性能、撤销内存上限优化。
