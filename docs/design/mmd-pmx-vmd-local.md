# 本地 PMX 模型与 VMD 动作接入

## 1. 需求

当前显示端默认使用 VRM/GLB。需要在本地 Node 服务和浏览器显示端中接入用户下载的 PMX 2.0 模型及 VMD 0002 动作，替换本地测试时的默认角色。

本阶段只验证本地服务和浏览器显示端，不处理 Offline APK，不上传外网。资源验证通过后，后续再复用同一目录布局进行外网发布。

## 2. 资源

- 模型：PMX 2.0，包含 `tex/` 和 `toon/` 相对纹理目录。
- 动作：VMD 0002，默认循环播放；显式单次播放时保持动作最后一帧，不回退到 T-pose。
- 本地资源目录：`res/models/mmd/miya/` 与 `res/models/mmd/motions/`。

## 3. 运行时方案

新增 PMX/MMD 运行分支，使用 Three.js `MMDLoader` 和 `MMDAnimationHelper`；保留既有 VRM 分支与失败占位。模型、纹理、动作均通过本地服务同源 `/models` 路径提供，动作计划只能引用白名单资源 ID。

## 4. 后续发布

后续外网发布使用版本化资源目录和安全资源清单，不直接把任意 URL 传给浏览器，也不在本阶段改动 Offline APK。

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
- 主光 X/Y/Z 方向；
- 角色阴影开关，默认开启；
- 默认、柔和、明亮预设和“恢复默认”。

灯光更新只修改已经创建的 Three.js light 对象，不重新加载模型、纹理或 VMD，因此不会重新触发加载过程中的穿帮。用户调整后的规范化值保存到当前显示端浏览器 `localStorage`，显示端重新打开时恢复；不发送 WebSocket，不写入服务端配置，不进入 Offline APK。

默认光照沿用当前播放器：白色环境光强度 `1.8`，白色主方向光强度 `2.3`，主光方向 `(1.5, 3, 2.5)`；阴影默认开启。输入值在浏览器端和 runtime 端都进行范围限制，避免异常值破坏渲染。角色网格在阴影开启时同时投射并接收自阴影，另保留透明接收平面用于地面投影；阴影贴图使用 `1024×1024`，并按模型包围盒动态收紧阴影相机范围、定位主光 target，减少大范围贴图造成的锯齿和模糊。关闭阴影时同时停用阴影贴图、投影和角色自阴影，减少移动 WebView 的渲染开销。

空白区域旋转属于后续交互需求，待确认采用“按住空白区域拖动旋转”还是“单击空白区域自动旋转”。角色区域现有点按动作交互保持不变。
