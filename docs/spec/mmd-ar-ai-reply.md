# 独立 MMD-AR：回复识别与动作调度实现

## 实现前伪代码

```text
parseReply(text):
  限定输入64KiB，最多64事件/16身体动作
  先保护普通代码围栏/行内代码；显式mpl区段生成低级动作并剔出speech
  识别白名单Emoji/颜文字/括号或星号标记、[表情:]与[动作:]
  抽取持续秒数/强度/次数；记录净文字offset；未知符号不执行
  保留chat原文，返回speech、表情事件、高级或mpl身体动作、提示
resolveExpression(modelItems, name):
  支持且真实名称唯一 -> 使用真实索引
  语义名按眉/眼/嘴角等候选匹配当前PMX元数据
  缺失和歧义显式跳过；不能用米娅固定索引
controller生成副本:
  自动层Map与手动selected/口型transient独立
  apply顺序automatic→selected→transient；restore沿用上一帧VMD基线
  setAutomatic(token,pairs)校验并更新，不改手动选择或口型，不重置物理/TAA
  换mesh/dispose清自动层；仅WEB_MODE补接口
motionDirector:
  同一调度器持有request序号、模型token、原动作/开关、本次资源
  编译原始MPL或高级模板到VMD，有限大小/30秒超时，可取消
  回包和加载后验证token/动作所有权；按队列执行身体动作
  手动MPL/高级按钮/AI回复共用取消和恢复，避免互相覆盖
  停止或结束只恢复仍拥有的原动作；新用户选择保留
  未引用资源及时释放；回复/高级单次动作在LoopOnce结束后继续队列，队列与情绪/口型结束再恢复
  恢复也加入相同Promise队列；停止旧owner不能取消新owner
  原手动MPL沿用当前播放方式，不改变原循环策略
lipSync生成副本:
  暴露独立预览API，保持同一player拥有临时嘴型
  预览返回准备Promise和请求序号、时间/时长只读快照
  取消只停止相同请求，不打断后来启动的口型
replyDirector.play:
  取消旧请求；解析，读取model token，准备口型/身体动作
  开始后按口型unit(label,start,end)定位净文字offset对应的表情时刻
  口型准备失败使用同一拼音时间线估算，无字音时回退有限字符时长
  口型自然结束后沿用同一起点，直到表情及身体队列完成
  表情强度带淡入淡出；自动层只写本会话权重
  身体动作到时送入共享Worker，编译时表情/口型继续；晚到事件显示提示
  身体以getMotionProgress的实际timeSeconds/durationSeconds判定单次完成
  缺失进度或暂停最多等待120秒；用户换动作/新MPL时释放本回复
  结束/中断/模型或后台切换释放自己的表情、口型与身体动作
  缺失映射/不支持符号显示原因，不阻断其他可用轨道
build:
  仅独立新增AI回复/高级动作分类，原MPL改名MPL低级动作
  先补controller/runtime/UI接口，再计算依赖内容指纹
  独立代码不回迁正式src，不修改servicePackage/minApk/dependenciesPackage
```

## 实现文件与边界

待设备验收（未执行）：米娅和其他PMX、尾随空格/重名/缺失Morph、Emoji/颜文字/普通Markdown/代码保护、完整回复外部调用id去重、表情+动作+口型、MPL纯表情/混合、编译失败/取消/换模型、与手动调试冲突、停止恢复、后台/编辑和手机性能。用户未要求测试，不新增或运行自动/浏览器测试；只构建、语法/导入/指纹/资源静态检查。

独立源码：web-reply-parser/expressions/actions/player/ui.mjs及web-reply-build/panel.js；web-mpl-ui暴露同一身体播放API，web-panel-groups加入分类。构建只补生成的controller/runtime/display/lipsync接口，再按依赖顺序指纹；正式源码没有对应接口。

`MmdArReplyPreview.play(text)`返回准备结果，`parse(text)`只读解析，`stop()`释放本次请求，`receive({id?,text})`和`mmd-ar-ai-reply`事件接收完整回复，最多保留128个id去重。流式片段/历史列表需要调用方先合并筛选。当前仅无声预览，没有真实音频接入。首次MPL加载或动作切换可延迟，显示队列延后；高级模板要求标准MMD骨骼，不是动作库检索。

## 构建与静态检查

现有 `npm run build:web:mmd-ar-test` 已成功生成本地web-dist。24个源码/生成模块语法、46处内容指纹引用、33项固定拼音/MPL资源大小和SHA-256，以及3个新面板ID唯一性检查通过。正式ui/public源码及Offline状态无差异。未新增或运行自动/浏览器功能测试；这些检查不代表实际播放验收。
