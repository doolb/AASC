// 高级动作是有限的语义模板；与原始MPL共用编译与身体动作所有权。
export function createHighLevelMpl({ name, duration = 2, strength = 0.7, count = 1 }) {
    const angle = value => Number((value * strength).toFixed(3));
    const pairs = {
        点头: ['head reset;', `head bend forward ${angle(20)};`],
        摇头: [`head turn left ${angle(20)};`, `head turn right ${angle(20)};`],
        歪头: ['head reset;', `head sway right ${angle(16)};`],
        鞠躬: ['upper_body reset; head reset;', `upper_body bend forward ${angle(25)}; head bend forward ${angle(10)};`],
        挥手: [`arm_r bend forward ${angle(65)}; elbow_r bend forward ${angle(65)}; wrist_r sway left ${angle(20)};`,
            `arm_r bend forward ${angle(65)}; elbow_r bend forward ${angle(65)}; wrist_r sway right ${angle(20)};`],
    };
    const pair = pairs[name];
    if (!pair) throw new Error(`没有高级动作模板：${name}`);
    if (!Number.isFinite(duration) || duration < 0.2 || duration > 15 || !Number.isFinite(strength) || strength < 0 || strength > 1
        || !Number.isInteger(count) || count < 1 || count > 8) throw new Error('高级动作参数超出范围');
    const reset = name === '挥手' ? 'arm_r reset; elbow_r reset; wrist_r reset;' : name === '鞠躬' ? 'upper_body reset; head reset;' : 'head reset;';
    const poses = `@pose rest {\n ${reset}\n}\n@pose first {\n ${pair[0]}\n}\n@pose second {\n ${pair[1]}\n}`;
    const frames = [' 0: rest;'];
    for (let index = 0; index < count; index++) {
        const start = duration * index / count;
        frames.push(` ${(start + duration / count * 0.25).toFixed(4)}: first;`);
        frames.push(` ${(start + duration / count * 0.6).toFixed(4)}: second;`);
        frames.push(` ${(start + duration / count * 0.9).toFixed(4)}: first;`);
    }
    frames.push(` ${duration.toFixed(4)}: rest;`);
    return `${poses}\n@animation gesture {\n${frames.join('\n')}\n}\nmain {\n gesture;\n}`;
}
