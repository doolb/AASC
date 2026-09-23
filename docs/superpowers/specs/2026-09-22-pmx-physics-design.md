# PMX 内置 Ammo 物理解算设计

## 背景

显示端 PMX runtime 已使用 Three.js r160 的 `MMDAnimationHelper` 播放 VMD、IK 和 grant，但创建 helper 时固定传入 `physics: false`。因此，PMX 内的刚体与关节数据没有参与解算，头发、裙摆和饰品等物理部件保持骨骼动画姿态。

本设计只为 PMX 启用 MMD/Bullet 物理解算；VRM 现有 `springBoneManager` 不在本次范围内。模型仍保持本地旋转、射线互动、灯光与阴影功能。

## 目标与边界

### 目标

- 为含 MMD 刚体数据的 PMX 在显示端启用 Ammo.js/Bullet 物理解算。
- 固定 Three.js r160 对应的 Ammo JavaScript 和 WASM 文件，运行时仅从同源静态目录读取，不依赖网络或 CDN。
- Ammo 加载或物理初始化失败时保留 PMX/VMD 的骨骼动画，明确展示降级状态。
- 同一页面只初始化一份 Ammo 模块；现有 runtime 同时只维护一个活动 PMX 模型。

### 不做事项

- 不新增控制端开关、WebSocket 配置或服务端持久化。
- 不改变 VRM SpringBone、PMX/VMD 的资源白名单或外网模型代理。
- 不构建、发布或修改 Offline APK 产物；静态资源随既有服务代码更新机制提供。

## 资源与兼容性

从与项目 `three@0.160.0` 相同版本的发行内容预下载以下文件，并保存至既有 Three.js vendor 目录：

| 文件 | 同源地址 | 作用 |
| --- | --- | --- |
| `ammo.wasm.js` | `/js/vendor/three/libs/ammo.wasm.js` | Ammo 工厂与 WASM 初始化入口 |
| `ammo.wasm.wasm` | `/js/vendor/three/libs/ammo.wasm.wasm` | Bullet 物理引擎二进制 |

导入时记录来源版本 `three@0.160.0`、SHA-256 和 Ammo.js 的 zlib 许可头。浏览器不得请求第三方 URL；WASM 的 `locateFile` 必须固定映射到上述同源 `.wasm` 地址。

现有服务器已经将 `ui/public` 作为同源静态目录提供，Offline APK 的服务代码同样带有该目录，因此无需新增 HTTP 接口或跨域策略。

## 运行时设计

### Ammo 单例加载

`display-pmx-runtime.js` 在模块范围维护 `ammoLoadPromise`。首次需要 PMX 物理时动态插入同源 `ammo.wasm.js` 脚本，随后调用其工厂：

```text
过程 ensureAmmoPhysics()
  如果 globalThis.Ammo 已是已初始化模块
    返回该模块
  如果 ammoLoadPromise 已存在
    等待并返回同一 Promise
  加载 /js/vendor/three/libs/ammo.wasm.js
  factory = window.Ammo
  module = 等待 factory({ locateFile: 固定 wasm 同源地址 })
  globalThis.Ammo = module
  返回 module
```

脚本加载、工厂缺失、WASM 拉取和模块初始化都必须拒绝该 Promise，并给出可读错误。失败结果只影响当前模型的物理步骤，不影响后续模型重新尝试初始化。

### PMX 助手创建

读取 `mesh.geometry.userData.MMD.rigidBodies`：

- 刚体数组为空时不加载 Ammo，按既有 VMD/IK/grant 方式创建 helper，并标记模型没有可解算的物理数据。
- 刚体数组非空时，先等待 `ensureAmmoPhysics()`，再由 `MMDAnimationHelper.add(mesh, { animation, physics: true })` 创建物理 helper。
- 无 VMD 的 PMX 也创建含 `physics: true` 的 helper，使模型的 PMX 物理数据仍可被每帧更新。

物理 helper 在模型归一化后、挂入角色中心旋转枢轴前完成初始化。每帧仍先调用 `helper.update(delta)`，再更新外层旋转枢轴；物理解算只写入模型内部骨骼，不更改鼠标旋转目标角、命中网格或外层 pivot。

### 降级与资源释放

```text
过程 createPmxHelper(mesh, clip, playMode)
  如果 mesh 没有刚体
    返回 physics=false 的骨骼动画 helper
  尝试等待 Ammo 并创建 physics=true helper
  成功时返回物理 helper 和“已启用”状态
  失败时记录原因，返回 physics=false 的骨骼动画 helper 和“已降级”状态

过程 disposeCurrentModel()
  从 MMDAnimationHelper 移除 mesh，释放 MMDPhysics 的刚体和约束
  释放模型几何与材质
  清空当前 helper、模型和旋转枢轴
```

模型、纹理、VMD 与物理 helper 均在 staging 阶段准备；任一关键资源失败时不替换当前已显示模型。仅物理初始化失败属于可降级错误：模型会原子切换到无物理的 helper，并通过 `onStatus` 提示“PMX 物理不可用，已回退骨骼动画”。

## 性能与风险

- Ammo WASM 约 0.65 MB，Ammo 默认内存约 64 MB；只在模型实际含刚体时按需初始化，并在页面生命周期内复用单例。
- `MMDAnimationHelper` 的默认物理步长为 `1 / 65`、单帧最多 3 个子步；沿用这一稳定配置，不在首版增加高频调参界面。
- 当前 runtime 始终只有一个活动 PMX，避免多角色物理世界叠加。
- 物理数据质量由 PMX 制作决定；非标准刚体/关节可能出现穿模或抖动，属于模型资源兼容性问题，应降级保留画面可用。

## 测试与验收

- 检查两个 Ammo 静态资源存在、版本来源固定，且 WASM URL 为同源地址。
- 检查含刚体 PMX 的 helper 先等待 Ammo 并传入 `physics: true`。
- 检查无刚体 PMX 不加载 Ammo，保持现有骨骼动画。
- 检查 Ammo 加载失败时回退 `physics: false`，VMD 仍然播放并输出状态提示。
- 检查模型切换/销毁会移除物理 helper，中心枢轴旋转、Raycaster 命中和阴影刷新不回归。
- 执行 PMX/MMD 定向 Node 测试、JavaScript 语法检查与 `git diff --check`；完整 `npm test` 的既有 Windows 环境失败单独记录，不归因于本功能。
