# 独立减面工程工作规则

- 使用简体中文，简洁报告实际结果。
- 本目录为 Blender SurfaceCageRebuild 项目；不修改原 Unity 游戏代码。
- 未经明确授权不提交、不推送、不安装依赖。
- 先阅读 README、docs 下设计与进展、插件源码及 .workflow-ai/skills/blender-character-optimize/SKILL.md。
- 原高模保持不动，几何操作使用副本；不硬编码验收模型的坐标、对象名或轴向到通用算法。
- bpy/bmesh/mathutils，无外部依赖。独立 background + factory-startup 进程运行测试。
- 当前边界只是候选；不要将测试通过或线数减少称为完整重建成功。
- 检查正、侧、顶、背、斜视；左侧是真正原高模，右侧是候选。
- 本目录后续修改不自动同步回 E:/mp1client-main。
