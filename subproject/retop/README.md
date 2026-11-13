# Surface Cage Rebuild 独立工作目录

- 当前 Blender 工程：`current-retopo.blend`（从当前会话保存，包含原高模、候选与手工曲线）。
- 插件源码与测试：`Tools/Blender/SurfaceCageRebuild/`。
- 设计和实施进展：`docs/superpowers/`。
- 高模 FBX、历史工程、报告、对照图：`artifacts/SurfaceCageRebuild_20261030/`。
- 当前工程引用的外部 Blender 库：`dependencies/`。
- 建模技能：`.workflow-ai/skills/blender-character-optimize/SKILL.md`。

二维手绘五档轮廓实验：[直接打开网页](web/contour-lab/dist/index.html)，无需安装依赖。支持闭合填充、五档预览及 SVG/JSON 导出；中档默认5区仅I，近档同拓扑曲化，超近默认上限12区细分并联合拟合外圈与孔圈，数量可调，近/超近自动选CSI无比例配额，近档禁止C–C/S–S，超近允许C–C及S–S相连，C限定单段双柄；说明与验证口径见 [网页 README](web/contour-lab/README.md)。另有独立的三维候选工具 [Contour Lab 3D](web/contour-lab-3d/README.md)，提供五档保形减面、真实切角卡线和静态OBJ导出；两个网页均不修改Blender工程。 公网版：[c.aasc.us/mnt/contour-lab/](https://c.aasc.us/mnt/contour-lab/)，发布文件位于服务器 `~/a/contour-lab/index.html`；分区上限300，支持随UV流动的本地颜色图。

当前最新功能为“面积＋曲率差异边界”候选识别。肩甲尚未完成完整包边重建，不能视为通用成品。历史 0.1.0 ZIP 不包含最新源码；以 Tools 下源码为准。

新增“生成前四档形体”：远长方体、远中连续四边面大形、中大曲面、近结构形体，超近直接使用原高模。远中已改为共享顶点的正背面与侧壁，可只更新这一档；不再使用独立体块合并。四档仍为可编辑几何候选；近档未完成规则包边/切角卡线拓扑验收。详见插件 README 与 `docs/superpowers/specs/2026-10-31-five-level-shape-rebuild.md`。

边界现统一为同一原高模上的远/远中/中/近四种立方邻域，四档都必须同时通过面积比与曲率差；不使用起伏分区或单独夹角补边。可切换四档边界与分组预览，原高模及已有形体候选不变；候选未保证闭合或完成重建。

后续开发以本目录为工作目录。原 Unity 仓库与原输出文件保留，未删除或覆盖。
历史报告、日志和辅助渲染脚本按原样归档，其中的旧绝对路径仅表示历史运行位置；复用这些辅助脚本时需调整路径。插件及自动测试使用相对目录导入。

使用已安装的 Blender，在本目录运行独立测试：

```powershell
& 'C:/Program Files/Blender Foundation/Blender 4.3/blender.exe' --background --factory-startup --python-exit-code 1 --python './Tools/Blender/SurfaceCageRebuild/tests/run_blender_tests.py'
```

插件不会仅因打开 blend 自动安装。当前会话已加载插件；重启 Blender 后可安装源码文件夹对应插件，或按插件 README 加载。测试和 create_examples.py 不可在用户工作场景直接执行。
