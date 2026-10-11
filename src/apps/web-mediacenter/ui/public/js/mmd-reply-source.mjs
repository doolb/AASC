import { createHighLevelMpl } from './mmd-reply-actions.mjs';

// 查看与播放采用相同优先级；不能把VMD或多层修正伪装成另一份MPL源码。
export async function getAdvancedMpl({ name, duration, strength, count }, human, catalog) {
    const action = human?.learn.list().find(item => item.actionId === name);
    if (action) {
        const version = action.versions.find(item => item.id === action.active);
        if (!version?.source) throw new Error(name + '的本地版本只有VMD，暂无MPL源码');
        if (version.patches?.length) throw new Error(name + '的本地版本包含多层修正，请在Human动作库查看各层源码');
        return version.source;
    }
    const entries = await catalog.load();
    if (entries.some(item => item.name === name)) return catalog.source(name);
    return human?.mpl?.advancedSource
        ? human.mpl.advancedSource({ name, duration, strength, count })
        : createHighLevelMpl({ name, duration, strength, count });
}
