# Virt-A-Mate 1.x资源格式

以下为VaM 1.x常见原生资源类型，不表示mmd-ar已支持导入。

| 格式 | 用途 |
|------|------|
| `.var` | 分发资源包，可包含场景、角色外观、Morph、衣服、头发、插件等；常置于AddonPackages。 |
| `.json` | 场景、子场景及包元数据meta.json。 |
| `.vap` | JSON格式预设，用于外观、姿势、衣服、头发、Morph、皮肤、插件等设置。 |
| `.vmi` / `.vmb` | VaM Morph元数据和二进制形变数据，通常配套使用。 |
| `.dsf` | DAZ来源的Morph数据，可由VaM编译成自身的Morph文件。 |
| `.vam` / `.vaj` / `.vab` | 自定义衣服、发型配套文件；不能仅凭扩展名视为完整人物模型。 |
| `.assetbundle` / `.scene` | Unity编译资源，用于CustomUnityAsset等，不能直接由Three.js加载。 |
| `.cs` / `.cslist` | C#插件源码及脚本列表。 |
| `.vac` | 较旧的场景打包文件。 |
| `.fav` | 收藏引用，不是模型数据。 |

角色外观通常由预设、Morph、皮肤贴图、衣服/头发和依赖引用共同描述；仅有一个.vap不代表已经取得完整人物网格、骨骼和物理信息。评估mmd-ar接入时，应检查真实VAR包和配套依赖，而不是只为扩展名增加加载入口。

依据：[VaM官方File Types and Presets](https://hub.virtamate.com/threads/08-file-types-and-presets.55029/)、[官方Package Manager](https://hub.virtamate.com/wiki/package_manager/)、[官方版本记录](https://cdn.virtamate.com/Release/VaM_PatchNotes.html)及[MorphMerger作者代码](https://github.com/ProjectCanyon/morph-merger/blob/master/MorphMerger.cs)。2026-10-11核对；VAM接入仍待样例和范围确认。
