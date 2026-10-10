# 独立 MMD-AR HumanInterfaceElement 实现

## 实现文件

- web-human-model.mjs：PMX能力/签名、唯一名称匹配、人工映射、部位遮罩、固定MPL骨骼转换。
- web-human-vmd/compiler.mjs：VMD边界验证与角色轨道采样、按需Worker编译和取消。
- web-human-mixer.mjs：按轨道混合、绑定姿态增量、淡入淡出、时钟、请求历史、骨骼恢复。
- web-human-physiology/reflex.mjs：呼吸/眨眼与明确事件规则。
- web-human-storage/interface.mjs：按模型签名保存行为库、VMD及版本，统一公共入口和生命周期。
- web-human-panel.js/ui.mjs/build.js：独立面板、接口、生成运行时/共享Morph通道/Helper钩子、指纹。
- web-mpl-ui、web-reply-player/parser/ui：已有MPL、回复、高级动作、口型改用Human入口。

## 伪代码

~~~text
createHumanInterfaceElement(runtime):
  构建注入startRendering: () => startRendering()，延迟到初始化完成后调用
  不在Human创建点读取尚未声明的const startRendering
  持有model/generation、mixer、physiology、reflex、pending、cache、library
  capabilities读取当前模型绑定；getState读取准备状态/活动层/库/保存错误
bind(mesh):
  mesh变化 -> 中止编译/下载，恢复自有骨骼并释放层，解绑旧helper
  从PMX骨骼name/parent/pos/rotq/rigidBodyType和可用Morph建立签名
  异步读取IndexedDB库，generation仍匹配才重建名称绑定
  默认开启呼吸/眨眼，强度0.35；已有模型设置覆盖默认
  同名唯一才绑定；缺失/歧义报告；真实索引不持久化
learn.register({actionId,vmd或source,mask,expression,loop}):
  VMD校验header、计数、边界、有限数值、时长；只解析骨骼/Morph
  MPL按需启动固定Worker，最多两组准备请求，30秒超时/Abort取消
  本地文件或已登记本地资源/同源mmd地址读取，不持久化BlobURL
  已登记本地VMD使用configureLocalLoader({manager},asset)，正确传入加载器manager与资源URL
  保存VMD ArrayBuffer或MPL source为新版本，保留parent与旧版本
learn.revise(actionId,patch):
  从当前默认版本复制，追加source/mode/mask/start/duration/strength
  先编译并核对遮罩存在可控制轨道，再保存新version并设为默认
learn.selectVersion(actionId,version):
  校验版本存在，保存默认version；下一次perform使用所选版本
learn.expression(name,weights):
  保存语义或真实Morph名称与0–1权重；播放时重新解析索引
learn.reflex(rule):
  保存事件、阈值、冷却、动作/表情、时长、强度
learn.export/import:
  JSON定义+base64 VMD；验证全部定义/资源，按当前模型重新绑定
  IndexedDB按模型签名存一条完整记录；写操作串行，错误显示可导出备份
perform({action,expression,duration,strength,count,owner,version,loop,priority}):
  优先同名已登记版本；缺失时尝试有限高级MPL模板
  基础VMD与补丁采样器按遮罩编成层，duration改变采样速度
  登记行为count为完整周期重复1–8次，模板count在自身时间内重复
  附加组合表情常量轨道，提交owner所属请求
mpl.play(source,options):
  编译轨道只保留代码明确涉及的骨骼和Morph
  固定编译器日文名称映射到当前唯一绑定，单独支持手指节/足先EX
  不调用loadSelectedMotion，不新建helper/物理
mouth.play/getState/stop:
  转发到现有唯一文字口型player；权重回写通过Human.mouth.setWeights
  五元音人工映射仍在口型分类，停止指定sequence不打断后来口型
reflex.emit({type,strength}):
  阈值、clock冷却通过 -> perform owner=reflex:ruleId priority=90
  默认touch.head→害羞、stimulus.surprise→惊讶；可登记/删除规则
physiology.sample:
  呼吸Morph优先，缺失时胸部绕X轴小幅增量；物理骨骼不强写
  眨眼间隔2–6秒，闭合80ms/保持40ms/睁开160ms
  明确眼部层、手动眼部或基础VMD眼部权重大于0.1时暂停自然眨眼
runtime.before(delta):
  恢复上一帧Human保存的原骨骼姿态，clock推进最多0.1秒
  绑定helper.onHumanPose；基础动作切换取消旧自动层
helper._animateMesh:
  基础mixer restore/update/save（保存的骨骼不含Human贡献）
  无mixer或暂停动画 -> 恢复基础backupBones；首次无备份则保存
  Human混合基础姿态后的生理/动作/反射/MPL
  更新世界矩阵 -> 原PMX IK/grant -> 原Ammo/XPBD物理
  动态刚体type1/2骨骼跳过直接覆写
mixer.mix:
  默认遮罩禁止根移动，显式root/all/bone:name允许
  低优先先应用，高优先同轨道覆盖；不相交轨道同时运行
  生理先处理，回复/高级默认50、反射90、手动MPL100
  同owner替换；同优先级后启动优先；首尾淡化默认120ms
  override=位置lerp/四元数slerp，additive=相对绑定姿态位移/旋转
  自然结束释放层回归本帧基础VMD；request历史保留64条
Morph:
  基础VMD→生理/动作/回复/反射/MPL混合→手动selected→口型transient
  回复自动表情作为priority50贡献；不覆盖更高优先MPL/反射
  帧前恢复Morph基线，物理前/帧末应用，共用setHuman通道
  自有层更新不清空TAA历史，不重置物理
lifecycle:
  模型/基础VMD/helper变化、编辑、后台、隐藏显示和离页取消旧请求
  所有异步结果校验generation/Abort/基础动作/helper/前台状态
  stop(owner)只释放此owner的骨骼/表情；mouth由其sequence单独管理
build:
  仅WEB_MODE注入；按依赖顺序hash模块、Worker、runtime、display及helper
  正式src和Offline状态不受本功能影响
~~~

## 限制与参数

每模型64行为、每行为16版本、总128版本、每版本8修正层；VMD每文件16MiB、库合计64MiB、元数据1MiB；JSON导入96MiB；MPL源64KiB、缓存8项；同时16请求。时长最多3600秒，VMD每种帧最多70000条。拒绝重名/保留名和无可控制轨道。

MPL继承上游固定骨骼角度限制，VMD使用Three原插值；不新增骨骼限位求解或任意绑定轴重定向。MPL修正保存为运行时层，原VMD二进制保持。人工映射用于语义/MPL；原始VMD按真实名称匹配，非标准模型需要专用VMD。库导入替换当前模型库，不会自动改变不同模型的动作。

首版后天学习是人工登记行为、组合和事件关联以及版本修正。在线动作训练、自然语言自由动作生成、自动触摸检测和外部音频接口尚未接入；独立文字口型仍是无声估算。

## 构建与验收

完成本地web-dist构建及源码/生成模块语法、依赖指纹、面板与固定资源静态检查，具体数量记录changelog。未新增或运行自动/浏览器功能测试，未发布外网。

设备待验收：多PMX/能力缺失/重名、VMD+修正+呼吸+眨眼+反射+口型同播、显式闭眼与手动优先、版本切换/导入导出、暂停/停止恢复、不累加姿态、不重置物理、编辑/模型/后台与异步取消、手机帧时。静态检查不替代设备播放验收。
