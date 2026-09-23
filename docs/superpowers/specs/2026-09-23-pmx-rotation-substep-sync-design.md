# PMX 旋转缓动期间固定物理子步同步设计

状态：备选设计，暂缓实施；当前先试验只移动角色与运动学锚点、动态布料由约束牵引。旧的整批刚体传送与速度重写思路须重新论证，不能直接照此实施。

## 目标与现状

角色通过拖动旋转时，中心枢轴以指数缓动追赶目标角度。用户反馈裙摆、头发等布料主要在缓动过程变乱，缓动停止后又逐渐稳定。此前运行时在每个 requestAnimationFrame 中先把完整 pivot 增量传给 Ammo 刚体，再调用 MMDAnimationHelper.update(delta)。当前先试验反向帧序：上一帧 pivot 下调用 helper.update(delta)，完成后才推进 pivot 并搬运刚体；Three.js r160 的 MMDPhysics.update() 仍在内部执行 Bullet 固定子步并回写骨骼。

此前渲染帧的最终 pivot 姿态先作用于刚体，而 Bullet 子步只看到已经到达最终姿态的边界锚点。当前试验让 Bullet 子步先看到上一帧的边界锚点，但同一渲染帧内仍未逐子步呈现旋转轨迹。速度处理也只旋转已有线速度/角速度，没有表示角色旋转本身对刚体速度的贡献。该错位可能发生在缓动时；枢轴静止后不再产生增量，约束有机会重新收敛。

启动预热固定为 warmup = 0、模型显示后的下一渲染帧才启动，不是这次持续缓动期间扰动的来源。PMX 目标物理频率仍由灯光面板配置，VRM 继续使用 SpringBone。

## 设计路径比较

1. **只在渲染帧同步时补枢轴速度**：修改面最小，但 Bullet 一次调用内部仍可能跑多个子步，运动学锚点仍处于最终姿态，不能保证缓动轨迹与求解器时间对齐。
2. **在 PMX 实例的固定步进边界同步（推荐）**：对当前 MMDPhysics 实例包装 _stepSimulation，将一段 render delta 内的枢轴变换插值到实际固定子步；每个子步同步动态刚体姿态/参考系速度，并按插值后的骨骼姿态更新 type=0 锚点，再执行一次 Bullet 单步。不修改 vendor 文件，限定在 PMX helper/runtime。
3. **将整个物理世界改为模型局部坐标**：理论上可以避免刚体随父级旋转时的世界坐标搬运，但需要改写重力坐标、骨骼回写与所有物理边界，影响面远超当前问题，不采用。

## 推荐方案与数据流

- 渲染循环只更新目标 pivot 的缓动值；不再在 helper 更新前将完整 render-frame delta 一次性传送给所有刚体。
- 为启用 Ammo 的 PMX physics 实例安装专属固定步进包装，保留 Three.js unitStep = 1 / physicsFps、maxStepNum = 3 和已有 warmup 策略。
- 每帧累计 elapsed time。availableSteps = floor(accumulator / unitStep)，stepCount = min(availableSteps, maxStepNum)；只执行 stepCount 个固定步，并丢弃超出上限的完整积压步、保留不足一个 unitStep 的余数，避免债务无限增长。stepCount 为 0 时不推进 Bullet。
- 根据本次待处理区间的时间进度，从上一个已模拟 pivot 到当前 render pivot 插值每个固定步姿态；若超出 maxStepNum，跳过最旧的未执行区间，只计算最近可执行的子步。每个子步更新已模拟 pivot 基线。
- 子步开始时临时将外层 pivot 设置为插值姿态并刷新子骨骼世界矩阵；将增量变换应用给动态刚体的位置和姿态。线速度、角速度先换算为旧 pivot 参考系下的相对速度，再旋转到新参考系并加上新 pivot 的刚体点速度/角速度；不清零布料自身的相对运动。
- 每个子步从插值骨骼更新 type=0 运动学锚点，再调用 Ammo 的单个固定步进 world.stepSimulation(unitStep, 0)。Bullet 文档要求 maxSubSteps=0 时保持 timeStep 固定；此处每次都传同一个 unitStep。完成后恢复 render-frame 的最终 pivot 与骨骼矩阵，交还 MMDPhysics 原有动态骨骼回写流程。
- helper 或模型替换时释放该实例的包装/状态；无物理 PMX、VRM 和启动 warmup 路径保持原样。

## 约束

- 不编辑 src/apps/web-mediacenter/ui/public/js/vendor/three/**。
- 仅改 PMX helper/runtime 与现有 PMX design/spec/task、自测/变更文档。
- 保持线速度和角速度在 pivot 参考系下的相对分量；角色转动产生的参考系速度单独叠加。
- 不更改 PMX 刚体/关节、重力、风、阻尼、模型资源、VRM SpringBone、灯光面板持久化和 Offline APK。
- 如果当前 Ammo WASM 绑定不能安全执行单个固定步进调用，停止实施并重新评审方案，不回退到旧的逐渲染帧整体传送。
- 当前内置 Ammo 虽导出 setInternalTickCallback，但没有暴露 addFunction/函数表注册，因此不依赖 native 内部子步回调。拆成多个 stepSimulation 单步调用会让 Bullet 在每次调用后清除累计力；当前 first-party PMX 代码只设置世界重力，没有调用 applyForce/applyTorque，故不改变现有 PMX 受力行为。若后续加入外部力/风力，必须另行设计跨子步的力保持机制。

## 验收标准

1. PMX yaw 与 pitch 连续缓动时，裙摆/头发的关节相对关系不出现明显爆散；停止后自然衰减，不靠清零速度复位。
2. 高频旋转、反向快速拖动、旋转中播放 VMD、不同 physicsFps（30/65/90）下都不出现持续漂移或瞬移。
3. 低渲染帧率补算多个 Bullet 子步时，pivot 与运动学锚点随子步插值；正常渲染高于 physicsFps 时保留时间余数，不因每个 render frame 固定多算而改变目标频率。
4. 首次显示后下一渲染帧才开始物理；warmup 仍为 0。
5. 无 physics 的 PMX、VRM、动作/IK/grant、灯光设置行为不变。

## 受影响文件与风险

- src/apps/web-mediacenter/ui/public/js/mmd-pmx-helper.mjs
- src/apps/web-mediacenter/ui/public/js/display-pmx-runtime.js
- docs/design/mmd-pmx-vmd-local.md
- docs/spec/mmd-pmx-vmd-local.md
- docs/task/20260923_PMX旋转缓动固定步进布料同步.md
- docs/self-test.md、docs/todo.md、changelog.md

主要风险是 Three.js 私有 _stepSimulation 契约与 Bullet accumulator 的细节；必须先完整核对当前 vendored r160 与 Ammo 导出，再包装单步调用。逐子步更新骨骼/运动学锚点会增加 PMX 刚体遍历成本，但最大子步保持 3。拆分步进会使 Bullet 在每个单步调用末清除累计力；当前显示端没有显式施力调用点，因此仅保持现有重力行为。该方案仅作为备选设计，待上一帧时序试验的现场反馈后再评审。
