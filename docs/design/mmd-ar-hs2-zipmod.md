# MMD-AR Honey Select 2 ZIPMOD接入可行性（待样例，尚未实现）

2026-10-11用户询问能否接入Honey Select 2（HS2）的zipmod。目标按mmd-ar理解，尚未确认包是完整角色、衣服/头发/饰品还是其他资源；已询问真实样例本地路径。此需求作为独立格式候选，不取消此前VAM待确认事项。

已核对BepisPlugins的Sideloader作者源码：zipmod通过ZIP读取；manifest.xml提供GUID、版本与适用游戏等信息；加载器枚举.unity3d的AssetBundle、CSV列表与PNG资源，最后使用Unity的AssetBundle接口。ZIP解包和清单解析不能替代Unity资源解析、角色组装和浏览器渲染适配。

现有mmd-ar本地导入只接受PMX，GLB角色路径是静态路径，没有HS2/Sideloader运行环境。未找到工作区内zipmod样例，未验证真实资源。

候选路线（工程推断，待样例验证）：

- 分阶段转换接入：检查清单/目录/资源类型，提取Unity资源并验证网格、材质、骨骼、蒙皮和BlendShape；资源完整后转换到目标模型格式，再接入mmd-ar。AssetRipper等可辅助分析Unity资源，但不保证自动转换成完整可用角色。
- 网页直接解析zipmod：需增加ZIP与Unity序列化资源解析、资源依赖和Prefab组装、材质重建；完整角色还可能依赖HS2基础资源及角色参数/卡片。并非为扩展名增加入口即可完成。
- 如果包仅含部件：先确定对应人体、骨骼与安装规则；不能把衣服或发型包作为独立完整人物。

建议先验证一个真实样例的可显示资源，再决定静态显示还是完整角色控制。动作需骨骼/坐标重定向与表情映射；HS2的Shader、插件、动态骨骼或物理行为不由PMX后端自动复现。若目标转换为PMX，仍需有效MMD骨骼、Morph与刚体/关节配置；当前静态GLB路径不提供动作。

需求分析默认enterprise，明确性检查发现资源类型、输出/功能范围及样例不足，暂未正式判级。后续先给具体文件改动方案、验收和工时，再按AGENTS.md等待代码方案确认。

依据：[Sideloader清单代码](https://github.com/IllusionMods/BepisPlugins/blob/master/src/Core_Sideloader/Core.Sideloader.Manifest.cs)、[包资源扫描/加载代码](https://github.com/IllusionMods/BepisPlugins/blob/master/src/Core_Sideloader/Core.Sideloader.ZipmodInfo.cs)、[AssetRipper作者说明](https://github.com/AssetRipper/AssetRipper)。任务：`docs/task/20261011_MMDAR_HS2_ZIPMOD接入可行性.md`。
