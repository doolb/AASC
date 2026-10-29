import { GESTURES } from './mmd-reply-gestures.mjs';
import { resolveReplyExpression } from './mmd-reply-expressions.mjs';
import { createIKSampler, IK_TARGET_BONES, normalizeIKPlan } from './mmd-ik-plan.mjs';

// 位移为初始化姿态起算的模型局部身高比例；左右手镜像X，掌向镜像Y/Z。
// 先抬手到身体前方，再在胸前表达，收势走相反路径，避免穿过腰裙。
const point = (position, rotation) => ({ ...(position ? { position } : {}), ...(rotation ? { rotation } : {}) });
const head = rotation => ({ head: point(null, rotation) });
const hands = (x, y, z) => ({ leftHand: point([x, y, z]), rightHand: point([-x, y, z]) });
const right = (position, rotation) => ({ rightHand: point(position, rotation) });
const clearHands = hands(0.02, 0.14, 0.13);
const clearRight = right([-0.02, 0.14, 0.13]);
const nod = head([9, 0, 0]);
const poses = (opening, first, second = first, closing = opening) => [opening, first, second, closing];

// 四个内部关键姿态分别位于18%、38%、62%、82%，两端归零；八轮最多41帧。
// 这里只编排已有身体目标；手指保留模型原姿态，不假装提供精细手指IK。
const templates = new Map(Object.entries({
    点头: poses(head([2, 0, 0]), nod, head([3, 0, 0]), head([7, 0, 0])),
    摇头: poses(head([0, 4, 0]), head([0, 14, 0]), head([0, -14, 0]), head([0, -3, 0])),
    挥手: poses(right([-0.05, 0.18, 0.10]), { ...right([-0.10, 0.31, 0.08]), ...head([0, 0, 3]) },
        { ...right([-0.055, 0.32, 0.08]), ...head([0, 0, 2]) }),
    鞠躬: poses({ chest: point([0, -0.002, 0.005], [3, 0, 0]), head: point([0, -0.004, 0.015], [5, 0, 0]), ...hands(0, 0.005, 0.015) },
        { chest: point([0, -0.012, 0.025], [17, 0, 0]), head: point([0, -0.025, 0.09], [24, 0, 0]), ...hands(0, 0.02, 0.07) },
        { chest: point([0, -0.013, 0.028], [18, 0, 0]), head: point([0, -0.028, 0.095], [26, 0, 0]), ...hands(0, 0.02, 0.075) }),
    歪头: poses(head([0, 0, 3]), head([0, 0, 11]), head([0, 0, 9])),
    开心: poses(head([0, 0, 1]), head([0, 0, 3]), head([0, 0, -3])),
    悲伤: poses(head([3, 0, 0]), head([9, 0, 0]), head([7, 0, 0])),
    生气: poses(head([0, 0, 0]), head([0, 4, 0]), head([0, -4, 0])),
    惊讶: poses(head([-1, 0, 0]), head([-6, 0, 0]), head([-4, 0, 0])),
    害羞: poses(head([2, 0, 1]), head([6, 0, 4]), head([5, 0, 2])),
    眨眼: poses(head([0, 0, 1]), head([0, 0, 3]), head([0, 0, 1])),
    平静: poses(head([0, 0, 0]), head([0, 0, 0])),
    比心: poses(clearHands, { ...hands(-0.12, 0.19, 0.13), ...head([2, 0, 2]) },
        { ...hands(-0.12, 0.19, 0.13), ...head([2, 0, -1]) }),
    亲亲: poses(clearRight, { ...right([0.13, 0.29, 0.12]), ...head([0, 0, 3]) },
        { ...right([0.02, 0.26, 0.24]), ...head([0, 0, 2]) }),
    猫爪: poses(clearHands, hands(-0.03, 0.21, 0.16), hands(-0.03, 0.185, 0.18)),
    猫咪撒娇: poses(clearHands, { ...hands(-0.03, 0.21, 0.16), ...head([2, 0, 8]) },
        { ...hands(-0.03, 0.19, 0.18), ...head([2, 0, -7]) }),
    拥抱: poses(clearHands, hands(0.035, 0.20, 0.20), { ...hands(-0.095, 0.19, 0.23), ...head([2, 0, 2]) }),
    思考: poses(clearRight, { ...right([0.13, 0.25, 0.08]), ...head([2, 0, 7]) },
        { ...right([0.13, 0.25, 0.08]), ...head([2, 0, 5]) }),
    嘘: poses(clearRight, { ...right([0.15, 0.29, 0.10]), ...head([2, 0, 0]) }),
    晚安: poses(head([3, 0, 2]), head([10, 0, 7]), head([11, 0, 7])),
    庆祝: poses(hands(0.01, 0.18, 0.12), hands(0.02, 0.38, 0.06), hands(0.05, 0.40, 0.08)),
    闪亮: poses(clearRight, { ...right([-0.03, 0.28, 0.14]), ...head([0, 0, 4]) },
        { ...right([-0.07, 0.30, 0.12]), ...head([0, 0, -3]) }),
    赞同: poses(clearRight, { ...right([0.015, 0.22, 0.15]), ...head([4, 0, 0]) },
        { ...right([0.015, 0.22, 0.15]), ...head([9, 0, 0]) }),
    加油: poses(clearRight, right([-0.04, 0.28, 0.12]), right([-0.04, 0.32, 0.13])),
    合十: poses(clearHands, { ...hands(-0.15, 0.20, 0.13), ...head([5, 0, 0]) },
        { ...hands(-0.15, 0.20, 0.13), ...head([8, 0, 0]) }),
    敬礼: poses(right([-0.02, 0.16, 0.09], [0, 0, 15]),
        { ...right([0.08, 0.37, 0.05], [0, 0, 90]), rightElbow: point([-0.085, 0.145, 0.045]) }),
    摊手: poses(clearHands, { ...hands(0.02, 0.16, 0.14), ...head([0, 0, 5]) },
        { ...hands(0.04, 0.17, 0.14), ...head([0, 0, -4]) }),
    拒绝: poses(hands(-0.02, 0.16, 0.16), { ...hands(-0.18, 0.24, 0.17), ...head([0, 9, 0]) },
        { ...hands(-0.18, 0.24, 0.17), ...head([0, -9, 0]) })
}));

// 下半身与上身共用四段时序；脚保持原地，轻微降重心交给原关节链自然屈膝。
// 默认位移约1厘米、摆角不到2度，不给敬礼/平静/眨眼等动作额外摇晃。
const lowerRecipes = {
    sway: [point([0.002, -0.001, 0], [0, 0.2, -0.1]), point([0.008, -0.003, 0], [0, 0.7, -0.4]),
        point([-0.007, -0.002, 0], [0, -0.7, 0.4]), point([-0.001, -0.001, 0], [0, -0.15, 0.1])],
    settle: [point([0, -0.001, 0]), point([0.001, -0.006, -0.001]),
        point([0.001, -0.005, -0.001]), point([0, -0.001, 0])],
    bounce: [point([0, -0.001, 0]), point([0.002, -0.007, 0]),
        point([-0.001, -0.002, 0]), point([0, -0.001, 0])]
};
const lowerByName = new Map([
    ['sway', ['挥手', '歪头', '开心', '害羞', '比心', '亲亲', '猫爪', '猫咪撒娇', '拥抱', '思考', '晚安', '闪亮', '摊手']],
    ['settle', ['鞠躬', '悲伤', '合十', '嘘', '拒绝']],
    ['bounce', ['庆祝', '赞同', '加油', '惊讶']]
].flatMap(([key, names]) => names.map(name => [name, lowerRecipes[key]])));

/** 生成与实际播放、源码预览共用的计划；参数只在这里写入一次。 */
export function createBuiltinIKPlan({ name, duration = 2, strength = 0.7, count = 1 }, model) {
    const gesture = GESTURES.get(name);
    let sequence = templates.get(name);
    if (!gesture || !sequence) throw new Error('没有内置IK动作模板：' + name);
    if (!Number.isFinite(duration) || duration < 0.2 || duration > 15 || !Number.isFinite(strength) || strength < 0 || strength > 1
        || !Number.isInteger(count) || count < 1 || count > 8) throw new Error('内置IK动作参数超出范围');
    const warnings = [], channels = new Map();
    for (const pose of sequence) for (const [key, properties] of Object.entries(pose)) {
        const bone = model.bindings['bones:' + IK_TARGET_BONES[key]];
        if (!bone || bone.dynamic) { if (!warnings.includes(key)) warnings.push(key); continue; }
        if (!channels.has(key)) channels.set(key, new Set());
        for (const property of Object.keys(properties)) channels.get(key).add(property);
    }
    if (!channels.size) throw new Error('当前模型缺少内置动作所需的IK部位：' + name);
    const unavailable = warnings.splice(0);
    if (unavailable.length) warnings.push('当前PMX缺少可控制IK部位：' + unavailable.join('、'));
    const lower = lowerByName.get(name);
    if (lower) {
        const supported = ['hips', 'leftAnkle', 'rightAnkle'].every(key => {
            const bone = model.bindings['bones:' + key]; return bone && !bone.dynamic;
        });
        if (supported) {
            sequence = sequence.map((pose, index) => ({ ...pose, pelvis: lower[index] }));
            channels.set('pelvis', new Set(Object.keys(lower[0])));
        } else warnings.push('当前PMX缺少可控制骨盆或双脚，已省略下半身微动作');
    }
    const expression = gesture.expression === '平静'
        ? { names: [...new Set(['开心', '悲伤', '生气', '惊讶', '害羞', '眨眼', '闭眼']
            .flatMap(value => resolveReplyExpression(model.morphs, value).names))] }
        : resolveReplyExpression(model.morphs, gesture.expression);
    const faceNames = expression.names || [];
    if (gesture.expression && gesture.expression !== '平静' && !faceNames.length) warnings.push('当前PMX缺少' + gesture.expression + '表情，仅播放身体目标');
    const expressionStrength = gesture.kind === 'emotion' ? 1 : gesture.expressionStrength ?? 0.22;
    const frame = (time, pose, amount) => {
        const targets = {};
        for (const [key, properties] of channels) {
            targets[key] = {};
            for (const property of properties) {
                const limit = property === 'position' ? 0.45 : 90;
                let vector = (pose[key]?.[property] || [0, 0, 0]).map(value => Math.max(-limit, Math.min(limit, value * strength / 0.7)));
                if (key === 'pelvis') {
                    // 骨盆微动作另限整体幅度：归一位移0.0125对应2厘米；角度向量不超过2度。
                    const maximum = property === 'position' ? 0.0125 : 2, length = Math.hypot(...vector);
                    if (length > maximum) vector = vector.map(value => value * maximum / length);
                }
                targets[key][property] = vector;
            }
        }
        return { time, targets, morphs: Object.fromEntries(faceNames.map(key => [key,
            gesture.expression === '平静' ? 0 : Math.round(strength * expressionStrength * amount * 1e6) / 1e6])) };
    };
    const frames = [frame(0, {}, 0)], moments = [0.18, 0.38, 0.62, 0.82], faceAmounts = [0.25, 0.9, 1, 0.25];
    for (let cycle = 0; cycle < count; cycle++) {
        sequence.forEach((pose, index) => frames.push(frame((cycle + moments[index]) * duration / count, pose, faceAmounts[index])));
        frames.push(frame((cycle + 1) * duration / count, {}, 0));
    }
    // 短时长或多次重复时主动缩幅，校验的是实际smoothstep峰值，不能用模板原时长掩盖超速。
    const speedScales = { position: 1, rotation: 1 };
    for (let index = 1; index < frames.length; index++) for (const [key, properties] of channels) {
        for (const property of properties) {
            const a = frames[index - 1], b = frames[index];
            const speed = Math.hypot(...b.targets[key][property].map((value, axis) => value - a.targets[key][property][axis])) * 1.5 / (b.time - a.time);
            speedScales[property] = Math.min(speedScales[property], (property === 'position' ? 2 : 360) / Math.max(speed, 1e-9));
        }
    }
    for (const value of frames) for (const [key, properties] of channels) for (const property of properties) {
        // 保留微米级位移精度并压缩重复JSON；给量化留0.1%速度余量，短动作也不因舍入超速。
        value.targets[key][property] = value.targets[key][property].map(amount => Math.round(amount * speedScales[property]
            * (speedScales[property] < 1 ? 0.999 : 1) * 1e6) / 1e6);
    }
    if (Object.values(speedScales).some(value => value < 0.999)) warnings.push('动作较短或重复较多，已按IK目标速度限制缩小幅度');
    return { plan: normalizeIKPlan({ format: 'ik-targets', version: 1, duration, frames }, {
        ikTargets: [...channels.keys()], morphs: model.morphs }), warnings };
}

export function createBuiltinIKSampler(options, model) {
    const { plan, warnings } = createBuiltinIKPlan(options, model);
    const source = JSON.stringify(plan), sampler = createIKSampler(source, model);
    return { ...sampler, source, warnings };
}
