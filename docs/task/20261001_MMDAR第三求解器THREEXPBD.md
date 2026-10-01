# 2026-10-01 MMD AR第三求解器THREE-XPBD

> 历史归档：用户于2026-10-01确认移除第三后端，其选项/适配器/vendor现已删除，不再执行本任务的第三后端验收；当前状态以`20261001_MMDAR移除THREEXPBD与呆毛排查.md`为准。

## 需求与状态

用户要求再接入一组Three.js XPBD实现；已识别为前面提到的markeasting/THREE-XPBD。用户已确认具体方案，代码接入及本地网页构建完成；真实模型和设备验收待进行。

## 设计与实现候选

参见docs/design/mmd-ar-test-apk.md及docs/spec/mmd-ar-test-apk.md第三求解器章节。固定上游df1c273107dff7ea8cbedfc1d7a929c1b0aeb0df及MIT许可证，收录实际核心，剥离Game.gui/World演示层，新增PMX刚体/6DOF/骨骼适配；修改求解器选择/所有模型与VMD入口、风和诊断、构建指纹。沿用基准数值为每帧N子步、每子步1轮及物理Hz禁用；不增加用户参数。

## 检查与验收计划

不新增/运行测试；只网页构建和静态语法、指纹/控件检查。后续人工比较三种后端的刷新/保存/换模型/动作/暂停/后台/切换失败、type0/1/2、球/盒/胶囊、碰撞分组、质量与惯量、六轴限制及弹簧、强风、缩放/旋转和诊断显示。性能在同模型动作/帧率/子步数下对照，不能据演示推断更快或更稳。

## 风险与范围

上游是演示项目，不是直接可用的PMX库；凸体近似和GJK/EPA性能/退化情况、PMX六轴与上游关节语义不同，需要适配。核心/许可证固定并注明本地变化，避免后续上游漂移。只独立网页/APK共同生成路径，不修改正式求解器，不出APK/发布/提交。预计一个接入轮次加现场验证，未承诺设备结果。

## 完成文件与检查

- 新增vendor/three-xpbd固定核心、来源哈希、两份MIT许可证、离线转换脚本/产物和适配说明。新模块web-three-xpbd-joint.mjs、web-three-xpbd-physics.mjs、web-three-xpbd-build.js实现实际第三后端及指纹生成。
- 共同web-xpbd-physics.mjs加入后端工厂和初始化失败释放；web-physics-solver.js支持三项保存/创建/回滚/面板，build.js和动作/诊断/基准显示入口完成适配。正式显示端源码保持原后端。
- npm run build:web:mmd-ar-test完成；29源/核心模块、28生成模块、5内联/importmap语法、4控件唯一性、3选项、62本地导入及24指纹检查通过；两源物理类离线导入完成。未新增或执行测试，不把静态检查视为物理效果验证。
- 基准10–180/默认45/每子步1轮保持，物理Hz只对Ammo生效；凸球/胶囊近似、无CCD、上游16次GJK/EPA上限和手机高子步成本需现场观察。未APK/发布/提交；Offline已有minApk/servicePackage=true、dependenciesPackage=false保持。
