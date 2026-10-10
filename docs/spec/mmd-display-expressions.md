# 正式显示端表情实现

## 实现前伪代码

```text
Loader.buildGeometry(data):
  MMD.morphs = map(data.morphs, 原始名称/英文名称/type/panel/supported)
  supported = 非空顶点Morph 或成员全为顶点的组合Morph
runtime.create:
  expressions = createManualExpressions(getMesh, getProfile, getHelper, onChanged)
  onChanged -> invalidateTemporal(); startRendering()
renderFrame:
  expressions.before(frameHelper)  // 恢复基线、包装物理前回调
  advancePmxMotionFrame()
  finally expressions.after()     // 无物理/暂停仍应用
runtime.dispose:
  expressions.dispose()          // 恢复基线并卸载自有回调
runtime.API:
  getManualExpressions -> token/ready/items(index/name/panel/type/supported/selected/weight)
  setManualExpression(index, weight|null) -> 有限0–1覆盖或释放
  clearManualExpressions -> 释放全部手动覆盖并还原动作
DisplayMmd.API:
  仅在modelReady且runtimeType为pmx时转发；其他模型返回未就绪状态
UI:
  查找正式或独立面板ID
  动作面板显示时500ms同步，隐藏/后台停止，不新增逐帧循环
  模型token改变 -> 批量重建分类列表
  交互先校验token，拒绝过期索引；清除不把VMD权重永久置零
独立build:
  从正式src复制mmd-expressions及UI
  验证共享runtime/API/Loader标记；不再注入另一控制器或metadata
  UI动态import与runtime静态import按实际文件内容指纹引用
  保留独立面板以及MPL读取API的兼容性
```

共享控制器的覆盖/恢复详细伪代码见 `mmd-ar-expressions.md`。表情迁移初始范围不包含MPL；随后用户要求一并接入，MPL迁移见 `mmd-display-mpl.md`。本轮仍不迁移编辑器；后续TTS已接入，临时层及音频生命周期伪代码见 `mmd-display-lipsync.md`。

## 待验收

正式PMX首次加载、表情组合/0强度/清除、VMD暂停/换动作、模型切换/物理重载、其他Morph禁用、手机与桌面显示；独立MPL和表情回归。未获测试指令，本轮不新增或运行测试。

## 实现结果

上述伪代码已实现：正式Loader简表、runtime覆盖/恢复、DisplayMmd API、动作下可折叠表情面板；UI通过实际所属动作面板监听隐藏状态，兼容正式与独立ID。独立构建保留模块内容指纹，只验证共享入口与Loader元数据，不重复注入。

`npm run build:web:mmd-ar-test`成功；8源文件/5生成模块语法及共享模块逐字节一致检查通过，git差异空白检查通过。未新增或运行测试；servicePackage=true，未构建发布正式服务包。

TTS/预览临时权重合并顺序为手动→临时，先恢复上一帧的VMD基线再由动画与物理前回调覆盖；setTransient仅启动渲染，不逐帧清TAA，换mesh/dispose清临时层。
