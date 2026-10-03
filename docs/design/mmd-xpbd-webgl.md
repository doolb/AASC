# MMD刚体XPBD WebGL2后端设计（测试版已实现）

## 需求与范围

用户提出将XPBD改为WebGL版本，使用ping-pong贴图计算。现有XPBD为PMX刚体六轴约束求解，JS子步执行积分、关节/接触位置修正、锁轴投影、速度回算、摩擦/反弹和限位速度修正，帧末回写Three骨骼。

已确认第一阶段在独立mmd-ar测试版增加XPBD（WebGL2）选项，保留CPU XPBD与Ammo作兼容回退和对照；本阶段处理刚体XPBD，不迁移TMP14顶点布料，不直接改变正式版。默认求解器保持现值，旧偏好可恢复。

## 计算与数据

复用显示端WebGLRenderer上下文；探测WebGL2、EXT_color_buffer_float、RGBA32F帧缓冲完整性、纹理大小。位置、四元数、线/角速度、前姿态、约束lambda以明确布局的RGBA32F贴图存储，索引在独立Float32纹理中精确表示；Nearest、不生成mipmap、不进行颜色空间转换或混合。每个pass只采样读集合并写另一集合，完成后交换，不读写同一纹理。

每帧上传两端动画骨骼锚点；每子步GPU插值，应用重力、阻尼、相对气流风与预测姿态，求解关节/碰撞、锁轴终态投影、回算速度及速度约束。type0跟随锚点；type2保持锚点位置、允许动态旋转；直接全锁绑定保持CPU定义、不向动态子链传播。重置/T-pose及动作切换时两套状态与前姿态一起初始化并清零速度/lambda。

共享刚体不能被多个约束同时无序写入：静态关节拓扑在CPU加载时图着色，同色不共享可写刚体，按色分pass；约束结果先写自己的槽，再由刚体pass收集修正。接触采用GPU逐对检测与按刚体邻接收集的并行迭代，每对内部按有效质量求解，跨对以有效接触对数倒数松弛；不依赖浮点原子操作或浮点加法混合。保持XPBD柔度alpha/h²和lambda语义，不能用简单位置平均冒充XPBD；并行次序/float32产生数值差异，不承诺与CPU逐帧完全相同。

加载时CPU根据碰撞组、静态类型和排除规则建立保守允许对表，GPU每子步进行AABB及球/盒/胶囊精确接触检测。接触槽按形状算法上界预分配，超出纹理/内存预算显式回退，不静默漏碰撞。允许对数量最坏O(N²)，首版需记录实际对数与显存预算；不在CPU每子步读回生成碰撞对。

帧末将刚体位置/四元数打包到一个结果目标，只集中同步读回一次，复用当前骨骼回写；保持当前帧动作和物理一致。每子步不readPixels。首版不采用可能跨帧延迟的异步姿态读回，不迁移整条骨骼层级和蒙皮；GPU计时扩展可用时统计GPU耗时，始终记录CPU墙钟耗时与同步读回等待。子步诊断不能偷偷恢复逐子步读回，GPU模式明确标记为帧末采样，累计碰撞可在GPU保留标记后按需读回。

## 兼容与异常

无能力/不支持模型容量时切回CPU XPBD并显示实际后端及原因；初始化成功才提交新后端，失败释放新资源并保留原实例。WebGL context lost事件中暂停并销毁自有旧GL句柄，保留CPU姿态；上下文恢复后重新探测并从已保留姿态重建，不能宣称共享上下文丢失时仍可正常渲染。销毁/换模型/换动作清理所有RenderTarget、材质及自有buffer，不能销毁共用renderer。

## 验收与性能

验证静止悬挂、六轴锁定/非零锁值、type0/1/2、质量/惯量与碰撞过滤、球盒胶囊所有形状对、摩擦/反弹、强风及经纬度、模型旋转缩放、动作锚点插值、T-pose初始化清零、失败回滚和上下文恢复。CPU对照按约束误差/有限状态/接触穿透与能量变化评估，不要求位级相同；重点复测左右蝴蝶结6_1等小物件。模型/动作切换至少50次，无GPU资源持续增长。

相同模型/动作/风/子步3、10、45、180和30/60FPS下测CPU总帧时间、GPU计时（扩展可用才记录）、readPixels等待、pass数、显存与整体画面帧率，报告中位数及P95。数百刚体与大量pass/readback时可能更慢，未实测前不宣称加速；目标手机实测另列。

## 实现文件

新增3rd/mmd-ar-test/web-xpbd-webgl-{state,shaders,joints,collision,solver,physics}.mjs及web-xpbd-webgl-inject.js（各模块不超1000行）；修改web-xpbd-build.js、web-physics-solver.js、build.js用于模块指纹、选项和renderer传递；必要的GPU适配集中于新包装，CPU数值实现保留作为基准。新增tests/mmd-ar-xpbd-webgl.test.js、tests/mmd-ar-xpbd-webgl-browser.test.js，以及README/self-test/usage/design/spec/task/todo/changelog。仅测试端时不改变Offline发布状态。

## 依据

- https://registry.khronos.org/webgl/extensions/EXT_color_buffer_float/ ：RGBA32F可渲染及RGBA/FLOAT读回契约。
- https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ：扩展/上限探测与同步读回等待。

## 当前实现边界

状态为每刚体6个vec4（位置/四元数/线速度/角速度/前位置/前四元数）；关节结果11个vec4；每允许对8个接触槽，每槽3个vec4。每子步1轮，关节lambda从零开始；接触lambda保留到该子步速度摩擦阶段。允许对32768、刚体4096、颜色128、纹理总预算64MiB；超过明确回退CPU。模型初始化仅建拓扑及上传，子步无CPU碰撞扫描。

球盒胶囊解析接触、盒SAT/裁面、胶囊平贴双点支撑、锁轴投影、风及锚点插值均在shader内执行。未实现GPU空间哈希，保守对检测仍可能昂贵；多pass和读回可能抵消并行收益。本机SwiftShader结果不能代表手机硬件性能，真机小物件抖动、碰撞观感与性能仍待现场验收。
