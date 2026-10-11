/* 正式显示接口在冻结DisplayMmd前创建；只通过当前Human实例访问模型，不暴露运行时。 */
(function exposeHumanBridge(root) {
    root.DisplayMmdHumanBridge = Object.freeze({ create: human => ({
        getMplModelState: () => human()?.getMplModelState() || { token: '', ready: false, bones: [], morphs: [] },
        setManualExpression: (index, weight) => human()?.face.set(index, weight),
        clearManualExpressions: () => human()?.face.clear(),
        setReplyExpressions: (token, weights) => human()?.setExpressionWeights('reply', token, weights)
    }) });
}(window));
