# 独立 MMD-AR Human 生理与后天行为

当前在本地生成的3rd/mmd-ar-test/web-dist提供，尚未发布外网。打开「动作 → Human 生理与后天行为」。

## 操作

1. 加载PMX，等待动作库就绪。呼吸、自然眨眼默认开启，生理强度0.35，可关闭或调整。自然眨眼避开显式眼部动作。
2. 在「模型能力与人工映射」查看缺失项，按当前模型名称手动匹配骨骼/呼吸/闭眼表情。五元音映射仍在「口型」分类。
3. 填行为名称，选择VMD并「登记VMD」；不选文件时登记当前基础VMD。选择控制部位可限制行为轨道，可指定已保存的组合表情名称。
4. 选已登记行为和版本，点「播放行为」预览。登记了“点头”等同名行为后，高级按钮及明确回复标记优先使用该版本。
5. 在「MPL覆写 / 叠加原动作」输入代码，或从MPL分类复制；选择部位、混合方式、开始秒数、时长和强度。「修正当前基础动作」直接叠到当前VMD。
6. 选动作库行为后，「保存行为的新版本」将修正附加到当前默认版本。旧版本保留，选择旧版后「切换默认版本」可恢复旧定义；下一次播放使用它。
7. 「组合表情」用JSON权重保存组合，例如 {"开心":0.7,"害羞":0.3}；也可用当前PMX原始名称。保存后可预览，或通过 [表情:友好] 调用。
8. 「条件反射」登记事件与行为/表情的关联；发送事件可预览。默认touch.head→害羞、stimulus.surprise→惊讶，支持阈值、冷却与删除。事件来源由调用方提供。
9. 动作库按PMX骨骼/Morph签名存当前浏览器IndexedDB；「导出动作库」同时备份VMD及定义。「导入」替换当前模型库，不自动修改其他模型库。保存失败时页面显示原因，可导出备份。

原VMD持续播放，修正结束回归本帧原姿态。MPL覆写只影响指定轨道，原文件保留；加法是相对绑定姿态叠加。默认禁止根移动，root/all遮罩或bone:原名可显式启用。动态刚体骨骼继续由物理控制。

表情、动作、口型可同时播放。相同轨道按优先级混合：生理→高级/回复→反射→手动MPL；手动表情最后覆盖，嘴型由口型播放器控制。动作面板的停止按钮只停止自身动作层。

## 待机、服务器动作与防穿模

独立网页默认循环待机，使用用户给定MPL：双臂bend forward 35°、双肘10°、双腕-10°，不含turn，8秒循环；跳舞需要在「动作 → 高级动作」手动选择。时长留空时，服务器VMD按原速原长播放，当前跳舞15.2秒；填时长才调整速度，次数按完整周期重复。强度/次数留空采用来源默认值。停止或自然结束后回到基础待机，同名登记行为仍优先。

「动作 → 物理 → 手部防穿模」默认开启，使用物理现有刚体检测并用手臂IK避让；开关保存到当前浏览器，刷新或切换模型/物理后端会恢复。接触时承接当前避让姿态并过滤目标，短暂断续不立即回拉；当前避让姿态没有穿透时，会按600ms限速尝试回到原动作；遇到碰撞就停在安全位置，继续检查。原动作稳定无接触和关闭后按600ms预算平滑释放。此待机原始姿态手部贴近裙面，建议保持手部防穿模开启。需要模型提供可靠手臂链和对应刚体；刚体未覆盖的衣服细节及不可达动作仍可能出现穿模。

高级动作旁的「编辑MPL」会展开MPL编辑器：待机和内置五动作提供源码，可直接修改并点「编译并播放」预览，或下载MPL/编译后的VMD。当前只编辑、预览和下载，不提供保存高级动作入口。跳舞只有VMD，显示暂无MPL源码；服务器以后可在条目中提供同源mmd目录`mplUrl`。当前模型同名本地MPL优先；本地VMD或多层修正提示从Human动作库查看，不冒充另一份源码。

后续服务器动作：将VMD放在站点的`mmd/`目录，在`mmd-actions.json`的actions数组新增唯一id/name、type=`vmd`、相对url，刷新页面即可显示并用`[动作:名称]`调用。例：`{ "id": "greet", "name": "问候", "type": "vmd", "url": "./mmd/motions/greet.vmd" }`。项目维护时修改`3rd/mmd-ar-test/server-actions.json`并运行`npm run build:web:mmd-ar-test`；发布时一起同步目录JSON与VMD。无需每个动作修改源码，清单与文件当前仅在本地构建提供。

## 高级动作与动作库保存格式

内置点头、摇头、歪头、鞠躬、挥手是源码中的MPL文本模板；播放时根据名称、时长、强度和次数生成MPL，编译为VMD数据再采样，不会仅因点击播放就自动登记到动作库。同名已登记行为优先于内置模板。

登记动作库按PMX签名保存在当前浏览器IndexedDB：动作名称、版本、默认版本、遮罩、参数和MPL修正等为结构化定义；MPL行为保存原始source文本，VMD行为保存ArrayBuffer并通过assetId引用。导出为 `mmd-human-<模型签名>.json`，VMD二进制编码为Base64内嵌；MPL面板另可下载编译后的 `mpl-motion.vmd`。

## 头部与眼球注视

「Human 生理与后天行为 → 头部与眼球注视」中分别开启头部/眼球跟随；新配置默认两者开启，注视强度0.7。默认看向当前相机。轻触或点击画面后暂时看向该位置，默认3秒后平滑返回相机；拖动角色/相机不切换目标。「返回相机」可提前结束临时目标。

修改后点「保存注视设置」，按当前PMX签名保存。可调水平/垂直附加角、头部/眼球缓动及停留时间。附加角是在当前基础动作之上计算，头部默认45°/25°、眼球20°/15°；缓动默认200ms/60ms。标准PMX正面为+Z，正面相反的模型可选-Z。状态区显示实际头部/眼球绑定和不能自动驱动的原因，人工绑定在「模型能力与人工映射」。

注视不影响口型/眨眼/表情。显式Human头部或眼球动作按权重优先。头部开始动作或被新动作接管时，从当前显示姿态用600ms融合到实时动作与剩余跟随；淡出或停止时，同样用600ms平滑回归相机/点击目标。短动作提前结束会承接当前姿态开始恢复。普通头部跟随仍使用设置的缓动时长。换模型、进入编辑、后台或隐藏显示清除临时点击目标。非标准旋转继承关系、动态眼球骨骼会跳过；共有眼仅支持已识别的比例1非局部旋转grant。

## 页面接口

PMX和动作库就绪后使用window.MmdArHumanInterface，current取得当前模型的实际HumanInterfaceElement实例。

~~~js
const human = window.MmdArHumanInterface;
human.capabilities();
await human.physiology.set({ breathing: true, blinking: true, strength: 0.35 });
await human.gaze.set({ head: true, eyes: true, holdSeconds: 3 });
human.gaze.point(0.5, 0.2); // 画面归一化坐标[-1,1]，Y向上
human.gaze.reset(); // 平滑返回相机
await human.learn.register({
    actionId: '招手', vmd: file, mask: ['rightArm'], expression: '友好'
});
await human.learn.revise('招手', {
    source: mplSource, mode: 'additive', mask: ['head'], start: 0, strength: 0.6
});
await human.perform({ action: '招手', expression: '友好', owner: 'ai', count: 1 });
await human.mpl.play(mplSource, { owner: 'correction', mode: 'override', mask: ['head'] });
const mouth = await human.mouth.play('你好，很高兴见到你。');
human.mouth.stop(mouth.sequence);
await human.reflex.emit({ type: 'touch.head', strength: 0.8 });
human.stop('correction');
human.getState();
~~~

组合需先用learn.expression('友好', {开心:0.7,害羞:0.3})保存。learn.list列出行为和版本，learn.selectVersion(actionId,versionId)选择默认版本；learn.reflex保存规则，learn.removeReflex删除；learn.export返回JSON Blob，learn.import(file)导入。

同owner新请求替换旧请求，不同owner按部位并行。stop(owner)释放该owner的身体/表情贡献，口型用sequence单独停止。切换基础VMD/模型、编辑、后台、隐藏显示或离页取消旧自动层；迟到编译结果不写入新角色。

## 范围和限制

学习由人工登记、关联及版本修正组成。标准骨骼/MPL语义可自动匹配，非标准骨骼可配置；原始VMD按真实骨骼名匹配，绑定轴/比例不同需要专用动作，不提供任意模型自动重定向。

每行为16版本/8修正层，总64行为/128版本；单VMD16MiB、库VMD合计64MiB。MPL最多64KiB，编译30秒超时。独立口型仍为文字估算、无声播放。

已完成构建和静态检查，实际多模型、物理连续性、版本切换及手机性能待设备验收。使用说明不表示已完成浏览器播放测试。
