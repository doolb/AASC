import { GESTURES } from './mmd-reply-gestures.mjs';
import { resolveReplyExpression } from './mmd-reply-expressions.mjs';

// 播放与源码编辑都用本函数，将强度直接写入MPL，运行层不再次缩放。
export function createHighLevelMpl({ name, duration = 2, strength = 0.7, count = 1 }, morphs = []) {
    const gesture = GESTURES.get(name);
    if (!gesture) throw new Error(`没有高级动作模板：${name}`);
    if (!Number.isFinite(duration) || duration < 0.2 || duration > 15 || !Number.isFinite(strength) || strength < 0 || strength > 1
        || !Number.isInteger(count) || count < 1 || count > 8) throw new Error('高级动作参数超出范围');
    const angle = value => Number((value * strength).toFixed(3));
    const sequence = gesture.keyframes;
    const bones = [...new Set((sequence ? sequence.flatMap(frame => frame[1]) : [...gesture.first, ...gesture.second]).map(([bone]) => bone))];
    const resolved = gesture.expression === '平静'
        ? { names: [...new Set(['开心', '悲伤', '生气', '惊讶', '害羞', '眨眼', '闭眼'].flatMap(name => resolveReplyExpression(morphs, name).names))] }
        : resolveReplyExpression(morphs, gesture.expression);
    const names = resolved.names || [];
    const face = weight => names.map(name => ` morph ${JSON.stringify(name)} ${weight};`).join('\n');
    const commands = pose => pose.map(([bone, operation, value]) => ` ${bone} ${operation} ${angle(value)};`).join('\n');
    const weight = gesture.expression === '平静' ? 0 : strength;
    const rest = bones.map(bone => ` ${bone} reset;`).join('\n');
    if (sequence) {
        // 姿态显式归零后再赋值，缺失的轴不继承上个关键帧；收尾及重复边界都回到基线。
        const poses = [`@pose rest {\n${rest}\n${face(0)}\n}`];
        sequence.forEach(([, pose, amount], index) => poses.push(`@pose step${index} {\n${rest}\n${commands(pose)}\n${face(Number((weight * gesture.expressionStrength * amount).toFixed(4)))}\n}`));
        const frames = [' 0: rest;'];
        for (let cycle = 0; cycle < count; cycle++) {
            for (const [index, [at]] of sequence.entries()) frames.push(` ${((cycle + at) * duration / count).toFixed(4)}: step${index};`);
            frames.push(` ${((cycle + 1) * duration / count).toFixed(4)}: rest;`);
        }
        return `${poses.join('\n')}\n@animation gesture {\n${frames.join('\n')}\n}\nmain {\n gesture;\n}`;
    }
    const poses = `@pose rest {\n${rest}\n${face(0)}\n}\n@pose first {\n${commands(gesture.first)}\n${face(weight)}\n}\n@pose second {\n${commands(gesture.second)}\n${face(weight)}\n}`;
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
