# MMD-AR HS2 ZIPMOD接入可行性

- 状态：待样例、资源类型及范围确认，尚未实现。
- 任务：评估Honey Select 2 zipmod资源接入mmd-ar；不以解包成功代替模型可渲染。
- Design：`docs/design/mmd-ar-hs2-zipmod.md`。
- Spec：`docs/spec/mmd-ar-hs2-zipmod.md`，候选数据流使用伪代码。
- 需求分析：默认enterprise；明确性检查待完整角色/部件、输出功能、样例及依赖确认，尚未正式判级。
- 受影响代码候选：`web-local-assets.mjs`、模型选择面板、`web-characters-build.js`、构建入口、新资源解析/转换模块及按目标格式选定的运行时；具体清单待样例验证。
- 自测计划：清单/GUID/游戏识别、包内容与缺失依赖报告、真实网格/骨骼/Morph/材质对照、导入失败保留原角色和资源释放；实施时按确认范围细化。
- 兼容计划：PMX/VMD/Human/物理及静态GLB原路径回归，不把HS2部件与PMX骨骼自动视为兼容。
- 性能计划：记录包大小、展开大小、加载时间、转换成本、内存和显示帧时；测试设备与预算待确认。
- 风险：包可能仅含部件/贴图；缺基础人体或卡片参数；Unity Shader、Prefab和动态组件不可由Three.js直接运行；格式转换不保证保留全部效果。
- 预计工时：样例资源完整性、路线和验收范围确认后估算。
- 未明确事项：样例本地路径；完整角色还是部件；只显示还是包括表情、动作、物理；原生网页解析还是可接受转换。
- 验证记录：核对作者Sideloader ZIP/manifest/AssetBundle扫描代码和AssetRipper说明；工作区未找到zipmod样例，未安装转换工具、测试、构建或发布。
