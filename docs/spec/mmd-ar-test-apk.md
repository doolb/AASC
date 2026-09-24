# MMD AR 独立测试 APK / HTTPS 网页实现规范（伪代码）

本文描述 `3rd/mmd-ar-test/` 的本地测试 APK 实现。伪代码与独立 Android 工程、资源准备脚本和复用的显示端 MMD/AR 模块保持同步。

## HTTPS 静态网页构建与发布

```text
buildMmdArTestWeb
  通过 npm run build:web:mmd-ar-test 调用现有资源准备脚本的 --web 模式
  目标目录 ← 3rd/mmd-ar-test/web-dist
  复用 APK 测试页的 DOM、JS/CSS、Three.js、MindAR 和固定 SHA-256 模型清单
  将生成副本中的 /js、/css 与 MMD profile/API 路径改成 /mnt/mmd-ar 下同源静态路径
  将 /api/mmd/resources 的响应预生成到 mmd-resources.json
  不调用 Gradle，不修改正式显示端源码，也不启动 AASC 服务
  校验首页、清单、模型、MindAR、Ammo 与模块路径都只依赖此目录

publishMmdArTestWeb
  上传 web-dist 内容到远端 /home/as/a/mmd-ar
  HTTPS 入口 ← https://c.aasc.us/mnt/mmd-ar/
  校验入口、模型清单和代表性模型/运行时资源可通过 HTTPS 读取
  浏览器申请相机权限；定位图及灯光状态按 HTTPS origin 保存在本机浏览器
  真机现场验证摄像头授权、目标首锁、灯光、布料和拖动旋转
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
