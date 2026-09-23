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
- 默认、柔和、明亮预设和“恢复默认”。

灯光更新只修改已经创建的 Three.js light 对象，不重新加载模型、纹理或 VMD，因此不会重新触发加载过程中的穿帮。用户调整后的规范化值保存到当前显示端浏览器 `localStorage`，显示端重新打开时恢复；不发送 WebSocket，不写入服务端配置，不进入 Offline APK。

默认光照沿用当前播放器：白色环境光强度 `1.8`，白色主方向光强度 `2.3`，主光方向约为经度 `31°`、纬度 `46°`；光源距离固定，阴影默认开启。输入值在浏览器端和 runtime 端都进行范围限制，避免异常值破坏渲染。旧版 X/Y/Z localStorage 设置读取后只做一次经纬度迁移，不再作为界面或规范化配置输出。角色网格在阴影开启时同时投射并接收自阴影，另保留透明接收平面用于地面投影；阴影贴图使用 `1024×1024`，并按模型包围盒动态收紧阴影相机范围、定位主光 target，减少大范围贴图造成的锯齿和模糊。关闭阴影时同时停用阴影贴图、投影和角色自阴影，减少移动 WebView 的渲染开销。

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
