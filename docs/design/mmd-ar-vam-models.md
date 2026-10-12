# MMD-AR VAM角色接入可行性（待明确，尚未实现）

2026-10-11用户询问“可不可以加入VAM模型支持”。暂按Virt-A-Mate理解；已询问原生`.var`、转换后的PMX/VRM/GLB或VRMA动作文件，等待确认。不将格式猜测作为开发授权。

现有独立网页本地选择只接受PMX，现有GLB角色路径用于静态显示；共享VRM运行时与PMX的VMD/Human/MPL/刚体路径尚未打通。

已进一步核对VaM 1.x官方文件类型说明：VAR为分发包，JSON为场景或元数据，VAP为JSON预设；VMI/VMB/DSF属于Morph，VAM/VAJ/VAB属于衣服和发型配套文件，ASSETBUNDLE/SCENE为Unity资源，CS/CSLIST为插件，VAC为旧场景包。不能把某一个扩展名直接等同于完整人物模型。格式用途与参考见`docs/usage/vam-resource-formats.md`；本次格式问答不改变候选路线和待确认状态。

VaM官方Package Manager说明VAR可能包含衣服、头发、Morph、贴图、插件、场景及Unity资源，并可能引用其他VAR包。因此原生导入需要先解决依赖、角色网格/骨骼重建、材质和Morph适配；包中场景、插件及物理行为不能由现有Three.js加载器自动运行。上述工作量判断为依据文档及当前代码作出的工程推断，未做真实模型验证。

候选路线：

- 原生VAR：先用真实包及配套依赖验证是否能获得完整角色数据，再设计导入器与角色运行时，不能承诺所有包兼容。
- 转换后导入：由可用转换工具输出PMX、VRM或带骨骼/Morph的GLB；先核对数据保留，再选择现有路径或新增适配。PMX还需要有效的MMD骨骼、表情、刚体/关节配置；GLB当前静态路径不能承诺动作支持。
- 如果实际指VRMA，则按动作导入需求单独设计，不作为VAM模型导入。

建议先以一个真实角色验证显示、材质、表情和骨骼，再评估VMD/Human及头发衣物物理。需要明确输入格式、保留功能和样例路径后，才能给出具体代码文件、验收标准与工时并等待代码方案确认。默认使用需求分析enterprise模式，明确性检查未通过，尚未进入正式判级或调用后续技能。

依据：[VaM官方包管理说明](https://hub.virtamate.com/wiki/package_manager/)。执行记录：`docs/task/20261011_MMDAR_VAM模型支持可行性.md`。
