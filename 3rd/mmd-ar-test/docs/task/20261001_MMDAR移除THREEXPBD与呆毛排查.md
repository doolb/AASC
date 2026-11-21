# 2026-10-01 MMD AR移除THREE-XPBD与呆毛排查

## 需求与状态

用户要求移除THREE-XPBD，并询问呆毛静止原因。只读排查完成，用户确认“移除，并另行讨论呆毛旋转范围”。先同步spec后实施，移除与本地网页构建已完成；模型与锁轴保留。

## 排查证据

本地web-dist/mmd/miya/miya.pmx：“呆毛1～4”刚体170–173，关节248–251串联至type0头部4，六轴上下限均0、六个K均0。自写求解器现有静态锚点全锁绑定把整条链固定到头部。K=0仅关闭弹簧，不取消硬锁；此前摆动来源未实测。模型不修改、不按呆毛名称放开锁轴。

## design需求/spec方案与影响模块

详见design/spec/mmd-ar-test-apk.md本轮章节。修改web-physics-solver.js、build.js及四处诊断/复位/面板后端判断；web-three-xpbd-build.js改为web-xpbd-build.js，只复制自写碰撞/刚体/适配模块并保留指纹。删除web-three-xpbd-physics.mjs、web-three-xpbd-joint.mjs及vendor/three-xpbd的Git跟踪资源；旧three-xpbd偏好和输入映射到xpbd。保留Ammo、自写XPBD与全锁/部分锁轴、基准3–180/default45。同步当前说明及待验收项，历史任务保留并标注已移除。

## 检查、兼容、性能与风险

确认后用现有npm run build:web:mmd-ar-test重建本地网页，检查脚本语法/本地资源引用/指纹及两个选项。未授权新增或运行测试；刷新旧偏好、切换后端、骨骼/碰撞/动作复位与手机耗时留现场验收。删除范围按Git跟踪清单，保护不相关工作区与模型；风险是残留第三模块引用或保存值导致初始化失败。移除核心可减少资源加载，具体耗时未测量，不承诺性能数字。预计确认后一轮实施；不提交、发布或打包APK。

## 完成记录

- 第三选项、实例导入和骨骼/碰撞/复位/单位判断已同步两后端；共享normalizePhysicsSolver将旧值转为xpbd，Display初始化尝试写回，写入失败保留已读取选择。
- web-xpbd-build.js替代旧构建器，依次生成collision/rigid/physics并带内容指纹；按Git清单删除43个vendor资源及3个旧适配/构建文件，未清理模型或无关工作区文件。
- npm run build:web:mmd-ar-test退出0；10源模块/10生成模块、5段内联/importmap语法通过，25本地导入和20内容指纹通过，4控件唯一、两个选项ammo/xpbd、生成目录无第三后端资源、基准3–180/step1/default45均静态确认。
- design/spec/task/usage/README/self-test/changelog/todo同步。当前实施项从todo移除，保留偏好迁移/切换/诊断与手机验收，以及呆毛旋转范围讨论；旧第三后端任务标记历史归档。
- 未新增或运行测试、模拟或设备验证；未提交/发布/APK。Offline状态原minApk/servicePackage=true、dependenciesPackage=false保持。

## 后续补充：呆毛和包

用户补充“呆毛和包”，将包也纳入摆动范围讨论。只读解析米娅PMX确认包包_0_1至_7_1为174–181号8个type1刚体，关节252–260共9个全部六轴上下限0、六K全0；首段174和末段181分别由253、252关节接type0下半身2。现有通用全锁图因此固定整条包带链。

候选保留呆毛发根/包带两端连接位置，后续/中间段开放有限旋转；局部轴、角度、参数保存方式尚未确定。未测量Ammo对照或旧摆动来源，不据元数据推断实际求解误差。仅同步design/spec/task/todo/changelog，无代码/模型改动、测试/模拟、构建、提交或发布；后续具体修改方案仍须按AGENTS确认。

## 后续补充：Ammo会动，呆毛下半段也不动

用户进一步指定“呆毛4”：173号加载后type1，经251关节连接呆毛3，再经250/249/248间接接头部；整链绑定同样固定该末端体。后续兼容方案需覆盖这一明确对象。

源码确认新createAnchoredBindings把呆毛1～4沿全锁图全部纳入fixed，零求解有效逆质量/惯量并直接继承头部相对位姿，整链静止有直接代码依据。Ammo只创建原PMX六轴约束、保留动态质量，通过顺序冲量及有限ERP纠错；默认45/90的ERP约0.275431，本地Ammo JS封装支持setParam。Ammo仓库Bullet上游get_limit_motor_info2按ERP/h将误差转成纠错目标速度；有限动态求解允许瞬时偏差/滞后，本地WASM对应源码版本、实际迭代配置及运动幅度仍未测量。

因此优先讨论XPBD动态全锁关节的有限纠错兼容，保留PMX；此前直接建议改模型角度不够完整。具体方案尚未确定/确认，不修改绑定、部分锁轴或模型，不测试/模拟/构建/提交/发布。上游参考：https://raw.githubusercontent.com/kripken/ammo.js/main/bullet/src/BulletDynamics/ConstraintSolver/btGeneric6DofConstraint.cpp。
