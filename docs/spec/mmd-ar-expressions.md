# 独立 MMD-AR 手动表情实现

## 实施前伪代码

```text
stageRuntime(webMode):
  非网页返回
  复制controller与UI，添加内容指纹
  生成PMX runtime实例创建expressionController(getMesh,getProfile,onChanged)
  renderFrame动画推进前：controller.before(frameHelper)
  renderFrame动画推进后：controller.after()
  暴露getManualExpressions/setManualExpression/clearManualExpressions
  在生成display模块转发API并动态导入UI
stageVendor:
  在生成MMDLoader几何metadata增加morphs简表（name/englishName/type/panel/supported）
  支持type1；type0所有成员都是type1才支持
  importmap指向修改后MMDLoader内容指纹URL
controller.bind:
  当前mesh变动 -> 恢复旧mesh覆盖前值、卸载旧helper回调
  modelUrl/resourceId/表情签名改变 -> 清空选择
  同模型重新加载 -> 保留原始索引选择，绑定新权重数组
  只通过索引匹配，不修剪原始名称或混淆重复名称
controller.before(helper):
  bind(); helper改变 -> 移除旧回调、清除旧VMD基线
  若同helper -> 先把上一帧手动权重还原为保存的VMD值
  包装helper.onBeforePhysics：先调用原回调，再捕获动画值并应用选择
  重置本帧已应用标志
controller.after:
  若物理回调未应用 -> 捕获动画值并应用选择（无物理/暂停兼容）
set(index,weight|null):
  控件事件先同步当前helper，处理切换完成到下一渲染帧之间的VMD基线
  检查当前PMX与支持类型，有限权重限制0–1
  先还原当前覆盖；null删除选择，否则记录指定权重
  重新应用剩余选择并刷新TAA历史
clear:
  还原全部覆盖前值，清空选择，不修改动画轨道
UI:
  按模型token/表情列表签名批量生成分组按钮/滑条/output
  点击按钮：选中设为滑条值，再点击取消；拖动：按索引设权重
  按钮事件先检查模型token仍为本次列表的token，拒绝切换后的过期索引
  同步API选择、强度、aria-pressed；不加载时禁用控制
  静态GLB或无Morph显示原因；名称/英文名均来自模型，不硬编码表情列表
  定时低频同步模型变化，不新增独立逐帧循环
```

## 文件与范围

`web-expressions.mjs`实例状态与覆盖；`web-expressions-ui.mjs`面板；`web-expressions-build.js`构建副本注入。`build.js`新增网页面板/资源/Loader指纹，`web-panel-groups.js`仅存在该面板时加入表情组。

不修改生产src、PMX资源或正式发布状态。字段仅从生成Loader读取，支持声明依据现有Three实现，不能把空Morph宣称支持。

## 本轮结果

通用读取、分组/按钮/强度、VMD基线和helper回调覆盖已实现；构建器的唯一锚点及内容指纹生成成功。web-dist构建、源/生成语法及差异空白检查通过，未新增或运行测试，浏览器效果待验收。
