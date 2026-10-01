# THREE-XPBD 离线核心与 PMX 接入

- 上游：https://github.com/markeasting/THREE-XPBD
- 固定提交：`df1c273107dff7ea8cbedfc1d7a929c1b0aeb0df`（MIT，见 LICENSE）。
- `upstream/src/physics` 保存未改动的实际核心；`SOURCE.json` 记录文件 SHA-256。
- `upstream-three` 为已安装 Three.js 0.160.0 的 ConvexGeometry/ConvexHull 原文件（MIT，见 THREE-LICENSE）。
- `esm`、`support` 是离线 ESM 转换产物，`RUNTIME.json` 保存其哈希；构建校验并复制到整体内容指纹目录。
- 转换命令：在项目已安装开发依赖的环境执行 `node 3rd/mmd-ar-test/vendor/three-xpbd/build-headless.js`。使用现有 esbuild，不增加生产依赖；普通网页/APK构建只复制本地转换产物。

## 本地核心变更

所有修改集中在 `build-headless.js`，不改原始文件。剥离 Game.gui、World、BaseScene 及演示调试几何；BaseSolver 只保留无操作 debugContact。MeshCollider 仍使用原 ConvexGeometry 和面法向数据，计算后释放中间几何，无调试网格/材料分配。运行时无 dat.gui、演示场景、远程 CDN 依赖。

修正 RigidBody 角速度回算原地 conjugate 破坏 prevPose、接触在世界原点时遗漏线性逆质量、位置纠正后的错误力臂。EPA 修正最小面 witness 不同步，拒绝非有限/退化结果；GJK/EPA迭代上限仍为上游16。位置接触加入形状尺寸相关微小穿透容差；恢复系数门限按实际重力、容差及固定速度下限计算，使用入射速度判定；已分离接触保留闭合速度。上游 update 的演示固定1/60步长改为dt/N，实际 PMX调度由包装层每次调用一子步。

## PMX 包装边界

`web-three-xpbd-physics.mjs` 使用真实上游 RigidBody、GJK/EPA、ContactSet、位置静摩擦和速度动摩擦/反弹。共同 `XpbdPmxPhysics` 负责模型空间、骨骼、风、type0目标插值、type2位置驱动、每帧N子步、生命周期。包装层补 PMX质量/惯量、阻尼及世界力矩转换；运动学刚体的实际驱动速度进入摩擦。SAP和PMX分组/掩码、相连关节排除决定候选对。

`web-three-xpbd-joint.mjs` 适配 PMX Spring6DOF，而非使用上游球/铰链关节代替。六轴限位及非零刚度（柔度1/k）、Euler XYZ对偶梯度、运动参考轴力臂均通过上游 applyBodyPairCorrection/getInverseMass/applyCorrection 求解；每子步一轮位置和硬限位速度投影，不使用现有独立XPBD的求解循环。单轮初始lambda为0，符合上游简化公式。

球为8×6分段凸体，胶囊为3层球帽×8周向分段凸体，盒为凸盒；曲面存在多面体近似误差。离散碰撞没有CCD，快速运动可能穿透。实际精度、抖动和手机性能需同模型现场验收，不能据上游演示断言快于Ammo或现有XPBD。
