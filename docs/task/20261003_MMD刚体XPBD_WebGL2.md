# MMD刚体XPBD WebGL2 ping-pong后端

日期：2026-10-03。状态：测试版后端已实现，真机性能/观感另列验收。

## 需求与范围确认

用户要求XPBD改WebGL、使用ping-pong贴图。建议先将PMX刚体XPBD增加为独立测试版GPU可选后端，CPU保留回退/对照，TMP14顶点布料与正式版不在首阶段。用户已确认按此范围实施。

## 设计与实现依据

设计：docs/design/mmd-xpbd-webgl.md；伪代码：docs/spec/mmd-xpbd-webgl.md。现有JS每子步使用当前CPU状态产生接触且顺序修正共享刚体；直接翻译循环不等价于并行shader。采用float32 ping-pong、关节图着色、接触槽/邻接收集、GPU风与锚点插值、每帧一次骨骼位姿读回。

## 文件与执行任务

1. 用户确认候选范围，补充必要验收阈值；先锁定伪代码。
2. 新增web-xpbd-webgl-{state,shaders,joints,collision,solver,physics}.mjs及-inject.js，实现能力探测、数据布局、数值pass、碰撞和生命周期。
3. 修改web-xpbd-build.js、web-physics-solver.js、build.js，接入renderer/面板/指纹与实际后端回显。
4. 新增数值/真实WebGL浏览器自测，按design验证所有形状对、关节/风/type2/清零及50次释放；运行npm run build:web:mmd-ar-test。
5. 测量同条件CPU/GPU/读回/P95与显存，核对生成资源；更新README/usage/self-test及design/spec/task/todo/changelog。

## 兼容、性能与风险

依赖WebGL2和float renderability实际探测，不增加npm或原生依赖；保留当前参数与兼容回退。读回同步、O(N²)候选对、多pass调度、Jacobi接触收敛和float32精度为主要风险。不能宣称更快或与CPU逐帧一致；不静默丢接触。目标Android设备性能与微小刚体稳定性需实测。初步工时：可运行对照后端约2–4工作日，移动设备与接触调优另需1–3日，随形状/精度验收结果调整。

## 需求分析（enterprise，已确认）

主L6：后端状态和renderer/骨骼接口替换（强3）、兼容与生命周期（强3）、碰撞与约束并行契约（强3）；次L4：ping-pong具体操作（中2）。置信度9/11×0.75=0.614，评分23+18+17+19+13=90/100。建议下放L4，按数据布局/数值pass/碰撞/包装/验证拆分，草案见spec。结论需补充：范围（测试PMX刚体还是同时正式/顶点，建议先测试刚体，避免无边界扩张）；规则（并行接触需可测误差容限，建议按CPU基线及模型尺度定义，不补充无法判断稳定性）；验收（目标手机GPU与性能预算未知，建议列设备和同条件P95，不补充不能承诺收益）。用户已确认测试版刚体范围；按上述模块实施。未调用其他技能。

## 实施与本机验证

- 新增6个WebGL数值/状态模块和生成注入模块，保留原CPU求解器；Three共用上下文，状态、关节、接触与累计诊断标记均在GPU执行。每帧一次读回6项状态及接触标记。修正GLSL保留字/结构体条件表达式兼容、Euler奇异分支及上下文恢复删除旧句柄的问题。
- `npm run build:web:mmd-ar-test`通过；70个脚本、4段inline及58个内容指纹引用通过语法/哈希核对。本机网页已更新，正式包未迁移/发布，Offline状态不变。
- `tests/mmd-ar-xpbd-webgl.test.js`真实Chromium/SwiftShader：重力/风10帧CPU位置误差3.96e-8；六种形状组合均产生接触并向外修正；六轴关节/锚点/type2/非零全锁成立；每帧一次读回；50次创建步进释放前后geometry/texture/program均0；无renderer回退及context lost/restore通过。
- 原风力回归：`node --test tests/mmd-ar-rigid-wind.test.js tests/mmd-ar-physics-wind.test.js`，24/24通过，包括真实Ammo/XPBD米娅。
- 生成网页默认米娅实际GPU运行：183刚体、261关节、11540保守允许对、16关节颜色；3子步317 passes、8571232字节（约8.17MiB）；读取状态时CPU墙钟4650.1ms、读回4623.3ms，异步GPU查询3521.1ms（前序帧，并非同帧分项）。首帧含编译约5970.6ms。此为SwiftShader软件驱动单帧样本，不能当硬件或P95结果。
- 本机单自由刚体在3/10/45/180子步、30/60FPS做过CPU/GPU数值路径和计时采样；存在并行测试负载、仅6个有效样本，结果不作为正式性能对比。当前软件GPU显著慢于CPU。桌面硬件/手机相同动作风与子步的中位数/P95、长期VMD/模型切换、小物件抖动/摩擦反弹观感仍待现场验收。

## 剩余验收（不阻塞实验后端使用）

目标手机GPU型号/驱动和性能预算未提供；现场复测左右蝴蝶结6_1、高子步、静止悬挂、堆叠摩擦/反弹、完整模型与VMD反复切换。不能把原子步Hz解释延伸为GPU加速承诺。接触采用跨对Jacobi平均，与CPU顺序解算有数值差异；尚未实现GPU动态空间划分或批量MRT优化。
