# 独立 MMD-AR HumanInterfaceElement 实现

## 头部动作开始与恢复的统一融合过渡（2026-10-11，已实现）

~~~text
已有声明：上帧显示四元数、旋转通道请求/层/循环身份、占用权重、跟随目标、恢复状态
新增定义：头部过渡统一时长 = 0.6秒（进入与恢复共用）
新增定义：头部进入状态 { 显示起点, 已过时间 }

出现新的正强度头部身份：
  上帧实际显示四元数 → 进入起点，进入时间置零
  取消旧恢复，重置释放标记；首帧保持该起点
已有动作实时采样与权重混合 → 动作姿态
当前相机/点击目标、普通headMs、剩余可用权重 → 跟随贡献
动作姿态加剩余跟随 → 动态进入终点
存在进入或恢复过渡：
  首帧不推进计时，随后累计有限帧间隔（最多0.1秒）
  经过时间 / 统一0.6秒 → 有界比例t → t² × (3 - 2t)
  固定显示起点与动态终点四元数插值 → 显示姿态
  基础save/restore保持；达到1 → 清理当前过渡
开始释放/停止：
  取消进入，从上帧实际显示姿态开始同一600ms恢复
  短动作也采用600ms进入；若先释放则当前显示姿态直接转恢复，不延长请求或强行完成进入
再次新身份接管 → 从当前显示姿态重新进入，旧进入/恢复均不继续执行
同一身份与权重变化不重启计时；普通跟随及无头部轨道不进入
关闭注视/换模型/后台/隐藏/编辑/销毁 → 清理进入和恢复
~~~

用户要求“暂时都使用配置的600ms”，已确认覆盖此前300ms及短动作缩短建议。沿用现有时长值并统一为同一常量，不新增UI或持久化配置。已有旋转通道信息足够，mixer与interface无需新增时长字段。23项定向自测（20项头部与3项已有注视）通过，网页重建成功；6项语法、13项Human导入指纹、3项生成过渡检查通过，外网发布/手机验收待执行。

## 头部动作释放后的跟随恢复（2026-10-11）

~~~text
已有声明：HumanMixer旋转占用、HumanGaze头部状态、headMs、相机或点击目标
新增定义：头部恢复时长 = 0.6秒
新增定义：旋转通道信息[骨骼索引] = { 请求与层身份集合, 是否全部处于淡出 }
新增定义：头部显示状态 = { 上帧显示四元数, 上帧身份集合, 本轮已开始释放, 恢复起点与经过时间 }

HumanMixer.mix每帧：
  保留现有请求、遮罩、权重、采样、骨骼/表情混合
  对允许的正强度四元数轨道记录请求id、层序号与循环轮次（包括淡入起点零权重）
  请求结束淡出或层窗口结束淡出 → 该身份正在释放
  同一骨骼全部身份正在释放 → 通道全部释放；循环请求无整体结束淡出
  已有占用权重与旋转通道信息 → HumanGaze（眼球继续只读取占用权重）
HumanGaze头部处理：
  首次启用/换模型 → 初始化当前显示姿态，清空历史身份
  本帧出现新请求或新层 → 取消旧恢复，重置释放标记，按上节启动600ms进入
  上帧有动作身份且本帧全部淡出或已无身份，尚未恢复：
    上帧实际显示四元数 → 固定恢复起点，经过时间 = 0，标记本轮已释放
  按原headMs与占用权重计算本帧跟随旋转
  存在恢复：
    首帧保持起点，其后累计有限帧间隔（0到0.1秒）
    t = 限制(经过时间 / 0.6, 0, 1)
    平滑比例 = t² × (3 - 2t)
    保存Human基础姿态供下一帧restore，恢复起点与本帧跟随旋转slerp → 显示旋转
    t达到1 → 结束恢复，不因后续动作删除重新计时
  保存本帧显示旋转与身份集合（完全被动作占用时也保存）
关闭头部/关闭注视/换模型/后台/隐藏/编辑/销毁：清空显示与恢复状态
普通跟随headMs、眼球/手动眼球、动作采样时钟及其他骨骼：保留已有行为
~~~

实现完成：13项头部恢复与3项已有注视自测通过，web-dist构建成功；6项语法、13项Human导入指纹、3项接线检查通过。不新增RAF、timer或持久化参数；外网发布和真实设备观感/性能待验收。

## 实现文件

- web-human-model.mjs：PMX能力/签名、唯一名称匹配、人工映射、部位遮罩、固定MPL骨骼转换。
- web-human-vmd/compiler.mjs：VMD边界验证与角色轨道采样、按需Worker编译和取消。
- web-human-mixer.mjs：按轨道混合、绑定姿态增量、淡入淡出、时钟、请求历史、骨骼恢复。
- web-human-physiology/reflex.mjs：呼吸/眨眼与明确事件规则。
- web-human-gaze.mjs：骨骼继承能力识别、相机/点击世界目标、有界缓动及主指针事件释放。
- web-human-storage/interface.mjs：按模型签名保存行为库、VMD、注视设置及版本，统一公共入口和生命周期。
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
  帧内setHuman只合成Morph，不调用onTransientChanged/startRendering
renderFrame结束:
  若frameHandle为空才requestAnimationFrame，已由其他回调排队则复用
  startRendering仍保留可见性/已有帧判断；外部操作负责唤醒渲染
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

## 注视层实现伪代码

~~~text
bind(model):
  识别head（缺失用neck）与eyes或leftEye/rightEye，人工映射优先
  检查动态骨骼与grant继承关系，避免共有眼与继承眼重复旋转
  加载该模型注视设置；缺省启用头部和眼球跟随，目标为相机
  模型变化重置注视缓动状态，异步结果仍校验generation
frame(existingHumanHook):
  读取当前相机世界位置与本帧基础骨骼姿态
  将注视方向换算到相应骨骼父级坐标，求有界偏转
  依据帧间隔平滑，头部较慢、眼球较快
  对可用且已启用的绑定应用低优先贡献，保存基础姿态供下一帧恢复
  注视世界方向转到当前骨骼局部坐标，默认+Z正面；共有眼参考左右眼中点及预测grant旋转
  Human显式同部位动作优先；头部释放按上节执行600ms显示恢复，考虑最终头部姿态后计算眼球剩余偏转
  原IK/grant与物理沿用既有顺序，表情和口型继续独立合成
  不增加requestAnimationFrame，不在每帧贡献中唤醒渲染
settings/UI:
  两个开关、强度、最大转角与缓动，通过Human接口校验并持久化
  getState/capabilities报告绑定与可用性；缺失不写其他骨骼
~~~

用户已确认：默认跟随相机，触摸/点击后暂时看向点击位置，再返回相机。

~~~text
pointer(canvas):
  只处理主指针轻触/点击，拖动与pointercancel不触发；不阻止原有交互
  先复用DisplayStage.mapViewportPointToStage换算横竖屏CSS旋转坐标；没有舞台接口才用canvas矩形
  用当前相机投影及头部深度，把画面点击位置换算成相机平面上的世界目标
  保存该世界目标与截止时间（默认3秒，可配置0.2–30秒）
  原有渲染帧内到期切回相机，缓动回归；无定时渲染循环
  模型切换/编辑/后台/隐藏/销毁清除临时目标和缓动
mixer.mix末尾:
  按骨骼记录本帧显式旋转轨道最大权重w和动作身份/释放信息；普通注视贡献乘(1-w)，头部释放另用600ms显示过渡
  先应用可用头部，再按新头部姿态计算眼球
  共有眼仅在左右眼都从该骨骼继承非局部旋转、grant比例为1且未同时作为眼骨骼祖先时驱动
  共有眼与目标眼均不得由动态刚体控制；其他旋转grant跳过；无grant的左右眼可直接驱动
  非标准旋转grant、动态/歧义/重复绑定降级并报告，不重复施加旋转
  恢复下一帧基础姿态仍使用原mixer保存流程
settings:
  head/eyes=true, strength=0.7, headYaw=45°, headPitch=25°,
  eyeYaw=20°, eyePitch=15°, headMs=200, eyeMs=60, holdSeconds=3
  限制的是相对本帧基础姿态的附加角；正面默认+Z，可选择-Z
highLevelMpl:
  每条骨骼语句单独一行，不生成“upper_body reset; head reset;”
  保持固定WASM编译器及已有动作语义
~~~

公开接口：gaze.get/set、gaze.point(normalizedX,normalizedY)、gaze.reset（平滑返回相机）；getState含gaze与gazeStatus绑定/目标/剩余时间/降级原因。point使用画面NDC [-1,1]、Y向上，临时目标为点击时保存的世界坐标；不追踪拖动，主指针移动达到8 CSS像素或取消/离开不触发。默认旧schema1库没有gaze字段时采用默认设置；设置、导入/导出与模型映射沿用同一动作库持久化。
