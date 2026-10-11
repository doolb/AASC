import { createHumanInterfaceElement } from './mmd-human-interface.mjs';

// 生命周期仍由PMX运行时持有，桥接只整理接口和模型快照，不创建第二个动作/口型循环。
export function createHumanRuntime(options) {
    const human = createHumanInterfaceElement(options);
    return Object.freeze({ ...human, getMplModelState() {
        const state = options.manualExpressions.getState(), mesh = options.getMesh();
        const dictionary = mesh?.morphTargetDictionary || {};
        return { token: state.token, ready: state.ready,
            bones: (mesh?.skeleton?.bones || []).map(bone => bone.name),
            morphs: state.items.map(item => ({ name: item.name, type: item.type, panel: item.panel,
                supported: item.supported && Object.hasOwn(dictionary, item.name) && dictionary[item.name] === item.index })) };
    } });
}

export function humanRuntimeInterfaces(human, expressions) {
    return {
        getHumanInterface: () => human,
        getMplModelState: () => human.getMplModelState(),
        getManualExpressions: () => expressions.getState(),
        setManualExpression: (index, weight) => human.face.set(index, weight),
        clearManualExpressions: () => human.face.clear(),
        setReplyExpressions: (token, weights) => human.setExpressionWeights('reply', token, weights),
        setLipSyncExpressions: (token, weights) => human.mouth.setWeights(token, weights)
    };
}
