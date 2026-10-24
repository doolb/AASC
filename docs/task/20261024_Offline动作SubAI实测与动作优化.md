# Offline动作SubAI实测与动作优化

状态：测试已授权，真实生成/候选闭环通过；自然克制优化已完成并通过测试，待后续服务包发布。

需求：ADB Offline APK测试；用户明确由本次子代理临时充当动作SubAI；优化数个内置动作、表情/微动作及跳舞肘部穿模。design/spec见mmd-human-interface同日段落。

等级：主L6（模板和碰撞契约），次L5（准备/播放/候选及实机验收），须下放L4。证据：动作SubAI测试与已存在候选接口（L6强）；内置动作与肘部碰撞算法（L6强）；美观和实机流程（L5中）。置信度0.675。评分层级23/25、证据18/20、完备16/20、风险17/20、落地13/15=87。技术可实施，风格/范围按已确认的自然克制方案实施。

## 已完成测试

Note8 SM-N9500、min74、code161，实际米娅signature pmx-489fbb30-321-29。MPL由会话子代理生成，4.6秒、真实Morph口角上げ/にこり。正式motion-coordinator本机运行，通过ADB CDP连接APK原createChatActionPlayer与Human/Worker。原模型选择不改、没有真实Provider或主AI对话请求。首次本机与手机25.7秒时差触发超时；临时协调器切到手机时钟模拟Offline同机后通过一次生成→准备→播放→完成→候选保存。再次读取手机IndexedDB确认1条候选，原actions为空未改变。providerId明确标session-subagent/model=current-agent，不冒充真实配置模型。

测试证据暂存/tmp/offline-subagent-motion-result.json、/tmp/offline-subagent-motion-run.log、/tmp/subai-gentle-chest-greeting.mpl与ADB录像截图；不提交APK/模型/视频。测试候选保留供用户预览。初次打开应用有服务v162更新提示，选择稍后，未升级代码。

## 已确认的实现范围

- public/js/mmd-reply-gestures.mjs、mmd-reply-actions.mjs：挥手/鞠躬/比心/猫咪撒娇/拥抱独立时序、头手错相、缓收和独立表情强度；兼容现有模板入口、duration/count。
- mmd-human-interface.mjs及必要的生理/表情采样模块：舞蹈低强度表情包络复用现有混合通道，不压过口型、不重复随机眨眼；固定VMD保持。
- mmd-human-arm-avoidance.mjs：躯干type=0语义白名单，肘部目标/修正与退出平滑；不全量开放静态刚体碰撞。
- tests/mmd-ar-emoji-gestures.test.js、mmd-ar-human-arm-avoidance.test.js、display-mmd-tts-actions.test.js及新增真实舞蹈回归：模板真实编译、动作首尾和时长、穿透帧/深度、基准恢复及表情口型优先。
- 更新相关design/spec/usage/self-test/todo/changelog；修改服务/网页代码后servicePackage置true并推送，APK/服务发布按实际构建另记。

## 自测、兼容和性能

保留同PMX/镜头/物理设置基线：五动作各一段、舞蹈正面/侧面完整15.2秒至少两轮。目标是穿透帧/深度下降且无明显折肘/跳变；骨长/根不变、无NaN、结束恢复。已有呼吸/眨眼、TTS口型、手动优先、SubAI候选、不同骨架缺Morph降级均回归。记录手机帧率/避让frameMs，不以桌面结果替代手机观感。预计2–4开发日含实机迭代，不承诺任意衣物/动作完全不穿模。

未知项：用户具体审美偏好以“自然克制”为建议；若需要更活泼可调整。绝对deadline跨机时差是当前协议风险，Offline同机不受此测试桥问题影响；后续可改相对预算，但不未经确认扩大此次代码范围。后续技能可选代码翻译/伪代码同步/不额外调用，当前未调用前两者。

## 基线画面检查

已采集五个内置动作中段截图、子代理候选预览及舞蹈正面/约60°侧面各一轮15.2秒播放，舞蹈录像各20秒。证据保存在本机未提交目录 `.cache/offline-motion-review-20261024/`。最初五动作长录制被终止，只有部分录像；已补齐拥抱截图和两轮独立舞蹈录像，不将部分录制声称为完整五动作视频。

实际画面：挥手中段手臂较直接近平举；比心和猫咪撒娇的手势较相似；舞蹈正侧面可见肘/衣袖边缘异常交叠。录制过程中约9–17FPS，影响顺滑度判断；动作是否更优美需同条件修改后再比较。正面三个稀疏采样的现有避让penetration约0.00272/0.04854/0.00708（原引擎单位），并非毫米、并非全片最大值，且旧检测不含被过滤的躯干对，不能用它宣称量化全部肘穿模。图片表情也含既有眨眼，不能因单帧笑眼推断VMD含Morph。

测试结束恢复正面镜头，停止adb-review轨道；生成候选保留，未采用为默认。已拉取并删除本次新建的手机Download录像，不触碰用户其他文件。用户已回复“是”确认方案，已先更新spec再实施运行代码。

## 实施与验收结果

正式端修改六个模块：mmd-reply-gestures/actions/expressions、mmd-human-interface/mixer/arm-avoidance。实验端3rd源码不变；对应两份回归测试改为直接导入正式端，避免误测旧实现。五手势新增归一时序与低表情强度，挥手屈肘并转臂80°；拥抱加大肘弯形成包围弧，猫爪内旋30°区别比心。Human每轮前10%/后25%用平滑权重回到当前基础动作；直接导出的MPL仍以绑定姿态reset结尾，Human高级动作的基础混合包络属于运行层。

舞蹈保持固定VMD，只为无Morph、无显式expression的内置dance增加0–0.18眉/嘴角层。眼部、元音不纳入，手动表情/瞬态TTS继续覆盖。避让新增可靠hips/waist/upperBody/chest静态白名单；仅局部快照把手臂标为dynamic以通过双静态检测过滤，原PMX type、组掩码、相邻关节排除、35°/600ms预算不变。

测试：npm run test:mmd-production为227通过/1项GPU能力跳过；npm run test:mmd-production:browser真实PMX集成1/1；npm run test:sub-ai-motion 17/17；npm run test:mmd-production:ik 8/8；新增挥手腕高于肘断言后模板定向10/10。真实米娅15.2秒VMD/60Hz隔离衣物动力学回归，累计穿透267.566045→40.257140，阈值0.001以上帧697→540，最大0.955482→0.778328，骨长不变、速度角度有界。指标为引擎单位，不能换算成整件衣服网格穿模率。

Note8保持min74/code161，六个网页模块临时替换；Human接口仅补本次差异以兼容旧版本，没有把未安装的IK依赖混入。完成正面和约60°侧面各20秒舞蹈录像、35秒五手势录像，以及固定播放时间的手势截图。最终挥手已清楚竖起前臂。舞蹈正面稀疏采样穿透0/0.03905/0，侧面0/0.06155/0.00716，避让5.3–10.1ms、录屏约7.5–13.1FPS；低帧率/采样时刻不同，不能与旧稀疏点直接算改进率。衣袖边缘仍有局部交叠，后续若需彻底改善，应评估模型蒙皮/代理形状，不能继续无界增大IK修正。

测试原文件逐一SHA-256恢复、停止adb-review轨道、镜头回正，生成候选保留供用户预览；不改变服务激活清单、模型配置或默认动作。证据位于未提交的.cache/offline-motion-review-20261024/after。release状态仅servicePackage置true，未构建/发布APK和服务包。自测、设计、实现、使用说明和变更日志同步；todo只保留发布验收及明确的后续项。
