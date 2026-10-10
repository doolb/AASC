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

## 页面接口

PMX和动作库就绪后使用window.MmdArHumanInterface，current取得当前模型的实际HumanInterfaceElement实例。

~~~js
const human = window.MmdArHumanInterface;
human.capabilities();
await human.physiology.set({ breathing: true, blinking: true, strength: 0.35 });
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
