// 碰撞体线框只用于WEB_MODE诊断：颜色按物理有效质量映射，不使用骨骼type三色。
// 胶囊按统一半径缩放，圆柱段按长径比生成，不能沿Y拉伸球形端帽。
export function describeRigidBodyShape(params) {
    const { shapeType, width, height, depth, type } = params || {};
    if (![0, 1, 2].includes(type) || !Number.isFinite(width) || width <= 0) return null;
    const rules = {
        0: () => ({ key: 'sphere', scale: [width, width, width] }),
        1: () => Number.isFinite(height) && height > 0 && Number.isFinite(depth) && depth > 0
            ? { key: 'box', scale: [2 * width, 2 * height, 2 * depth] } : null,
        2: () => Number.isFinite(height) && height >= 0 && Number.isFinite(height / width)
            ? { key: `capsule:${height / width}`, ratio: height / width, scale: [width, width, width] } : null
    };
    return rules[shapeType]?.() || null;
}

// 有效质量与引擎构造一致：type0恒为0（运动学），其余取weight；非法weight按0处理。
export function rigidBodyEffectiveMass(params) {
    const weight = Number(params?.weight);
    return params?.type === 0 || !Number.isFinite(weight) || weight <= 0 ? 0 : weight;
}

// 质量色带：蓝→青→绿→黄→红按对数插值；有效质量0（跟随骨骼）固定浅灰。
export const RIGID_BODY_MASS_RAMP = Object.freeze([0x3b82f6, 0x22d3ee, 0x34d399, 0xfacc15, 0xff5a5a]);
export const RIGID_BODY_ZERO_MASS_COLOR = 0xd1d5db;

function lerpHexColor(from, to, ratio) {
    const mix = (shift) => Math.round(((from >> shift) & 0xff)
        + (((to >> shift) & 0xff) - ((from >> shift) & 0xff)) * ratio);
    return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

function rampColor(ratio) {
    const clamped = Math.min(1, Math.max(0, ratio));
    const scaled = clamped * (RIGID_BODY_MASS_RAMP.length - 1);
    const index = Math.min(RIGID_BODY_MASS_RAMP.length - 2, Math.floor(scaled));
    return lerpHexColor(RIGID_BODY_MASS_RAMP[index], RIGID_BODY_MASS_RAMP[index + 1], scaled - index);
}

// 色阶范围固定为模型全部刚体的有效质量分布；过滤只决定显示范围，颜色不随过滤漂移。
export function rigidBodyMassColor(effectiveMass, massScale) {
    const mass = Number(effectiveMass);
    const min = Number(massScale?.min);
    const max = Number(massScale?.max);
    if (!(mass > 0) || !(min > 0) || !(max > 0) || max < min) return RIGID_BODY_ZERO_MASS_COLOR;
    if (max - min < min * 1e-4) return rampColor(0.5);
    return rampColor((Math.log(mass) - Math.log(min)) / (Math.log(max) - Math.log(min)));
}

// 实体模式的深色描边：背面扩张外壳，按形状尺寸统一放大固定比例。
export const RIGID_BODY_OUTLINE_COLOR = 0x141821;
export const RIGID_BODY_OUTLINE_EXPANSION = 0.04;

/**
 * 每个PMX刚体一个实例；物理开启读取实际COM，不用骨骼回写结果冒充刚体姿态。
 * 只保留索引/配置，不保存Ammo引用；换VMD/重建物理后自动读取当前physics。
 * 线框颜色按物理有效质量映射，不使用type三色；颜色随模型提交只算一次。
 */
export function createRigidBodyOverlay({ THREE, renderer, camera }) {
    const scene = new THREE.Scene();
    scene.name = 'mmd-ar-rigid-body-overlay';
    // 诊断着色光只服务本叠加层（不联动真实场景灯光）：顶光略偏前，便于区分不同朝向的面；
    // 环境光保留下限，避免背光面掩盖质量色含义。
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    const topLight = new THREE.DirectionalLight(0xffffff, 0.9);
    topLight.position.set(0.35, 1, 0.5);
    scene.add(ambientLight, topLight);
    const matrix = new THREE.Matrix4();
    const bodyMatrix = new THREE.Matrix4();
    const spaceMatrix = new THREE.Matrix4();
    const physicalSpace = new THREE.Matrix4();
    const boneMatrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const unitScale = new THREE.Vector3(1, 1, 1);
    const euler = new THREE.Euler();
    const instanceColor = new THREE.Color();
    const geometryCache = new Map();
    let wireframeMaterial = null;
    let fillMaterial = null;
    let outlineMaterial = null;
    let groups = [];
    let entries = [];
    let model = null;
    let enabled = false;
    let disposed = false;
    let displayMode = 'solid';
    let characterHidden = false;
    let generation = 0;
    let releasedGroups = 0;
    let updateCount = 0;
    let drawCount = 0;
    let actualCount = 0;
    let poseMode = 'none';
    let samples = [];
    let massScale = null;
    let bodyFilter = null;
    let visibleBodyCount = 0;

    const disposeMaterials = () => {
        for (const material of [wireframeMaterial, fillMaterial, outlineMaterial]) material?.dispose();
        wireframeMaterial = null;
        fillMaterial = null;
        outlineMaterial = null;
    };

    // releasedGroups按形状组计数；实体模式下每组同时释放填充与描边两个实例网格。
    const release = () => {
        for (const group of groups) {
            scene.remove(group.mesh);
            group.mesh.dispose();
            if (group.outlineMesh) {
                scene.remove(group.outlineMesh);
                group.outlineMesh.dispose();
            }
            releasedGroups += 1;
        }
        groups = [];
        disposeMaterials();
        for (const geometry of geometryCache.values()) geometry.dispose();
        geometryCache.clear();
        samples = [];
    };

    const setModel = (mesh) => {
        release();
        model = disposed ? null : mesh;
        entries = [];
        actualCount = 0;
        bodyFilter = null;
        visibleBodyCount = 0;
        poseMode = 'none';
        massScale = null;
        if (!model) return;
        // 隐藏角色只关网格绘制；物理、动画与叠加不受影响，换模型后重新应用。
        if (characterHidden) model.visible = false;
        generation += 1;
        const bodies = model.geometry?.userData?.MMD?.rigidBodies;
        for (const [bodyIndex, params] of (Array.isArray(bodies) ? bodies : []).entries()) {
            const shape = describeRigidBodyShape(params);
            const vectors = [params?.position, params?.rotation];
            if (!shape || vectors.some(value => !Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite))) continue;
            const offset = new THREE.Matrix4().compose(new THREE.Vector3(...params.position),
                new THREE.Quaternion().setFromEuler(euler.set(...params.rotation)), unitScale);
            entries.push({ bodyIndex, type: params.type, shape, boneIndex: params.boneIndex, offset,
                effectiveMass: rigidBodyEffectiveMass(params) });
        }
        // 色阶范围取全部正质量刚体；退化（只有一个值）时用色带中点单色。
        let minimum = Infinity;
        let maximum = 0;
        for (const entry of entries) {
            if (entry.effectiveMass <= 0) continue;
            if (entry.effectiveMass < minimum) minimum = entry.effectiveMass;
            if (entry.effectiveMass > maximum) maximum = entry.effectiveMass;
        }
        if (maximum > 0) massScale = { min: minimum, max: maximum };
        for (const entry of entries) entry.color = rigidBodyMassColor(entry.effectiveMass, massScale);
    };

    const createResources = () => {
        if (groups.length) return;
        const solid = displayMode === 'solid';
        if (solid) {
            if (!fillMaterial) fillMaterial = new THREE.MeshLambertMaterial({
                color: 0xffffff, toneMapped: false, transparent: false, depthTest: true, depthWrite: true
            });
            if (!outlineMaterial) outlineMaterial = new THREE.MeshBasicMaterial({
                color: RIGID_BODY_OUTLINE_COLOR, side: THREE.BackSide, toneMapped: false,
                transparent: false, depthTest: true, depthWrite: true
            });
        } else if (!wireframeMaterial) {
            wireframeMaterial = new THREE.MeshBasicMaterial({
                color: 0xffffff, wireframe: true, depthTest: false,
                depthWrite: false, toneMapped: false, transparent: true, opacity: 0.65
            });
        }
        const grouped = new Map();
        for (const entry of entries) {
            if (!grouped.has(entry.shape.key)) grouped.set(entry.shape.key, []);
            grouped.get(entry.shape.key).push(entry);
        }
        for (const groupEntries of grouped.values()) {
            const first = groupEntries[0];
            if (!geometryCache.has(first.shape.key)) {
                const constructors = {
                    sphere: () => new THREE.SphereGeometry(1, 12, 8),
                    box: () => new THREE.BoxGeometry(1, 1, 1),
                    capsule: () => new THREE.CapsuleGeometry(1, first.shape.ratio, 4, 12)
                };
                geometryCache.set(first.shape.key, constructors[first.shape.key.split(':')[0]]());
            }
            const geometry = geometryCache.get(first.shape.key);
            // 描边外壳先入场景、填充后入；两者均写深度，实体模式与角色逐像素互相遮挡。
            const outlineMesh = solid ? new THREE.InstancedMesh(geometry, outlineMaterial, groupEntries.length) : null;
            if (outlineMesh) {
                outlineMesh.name = `mmd-ar-rigid-body-outline-${first.shape.key}`;
                outlineMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                outlineMesh.frustumCulled = false;
                scene.add(outlineMesh);
            }
            const mesh = new THREE.InstancedMesh(geometry, solid ? fillMaterial : wireframeMaterial, groupEntries.length);
            mesh.name = `mmd-ar-rigid-body-${first.shape.key}`;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.frustumCulled = false;
            scene.add(mesh);
            groups.push({ entries: groupEntries, mesh, outlineMesh });
        }
    };

    const updateSpace = () => {
        model.updateWorldMatrix(true, true);
        model.matrixWorld.decompose(position, rotation, scale);
        const nonUnit = Math.abs(scale.x - 1) > 0.001 || Math.abs(scale.y - 1) > 0.001 || Math.abs(scale.z - 1) > 0.001;
        // 对齐MMDPhysics.update：非单位缩放时暂时脱离父级，以模型本地P/Q、单位尺度模拟。
        if (nonUnit) physicalSpace.compose(model.position, model.quaternion, unitScale);
        else physicalSpace.compose(position, rotation, unitScale);
        spaceMatrix.copy(model.matrixWorld).multiply(physicalSpace.invert());
    };

    // expansion用于实体描边外壳：只放大形状尺寸，不改变刚体姿态或物理读取。
    // 返回是否读取了实际物理姿态；计数由填充绘制负责，描边二次调用不重复累计。
    const updateEntry = (entry, physics, nativeRotation, expansion = 0) => {
        const body = physics?.bodies?.[entry.bodyIndex]?.body;
        const xpbdPose = ['xpbd', 'three-xpbd'].includes(physics?.engine) && physics.getBodyPose(entry.bodyIndex, position, rotation);
        const usedPhysics = Boolean(xpbdPose || (body && nativeRotation));
        if (xpbdPose) {
            bodyMatrix.compose(position, rotation, unitScale);
            matrix.copy(spaceMatrix).multiply(bodyMatrix);
        } else if (usedPhysics) {
            // COM、origin、basis均为借用引用，不能destroy；旋转输出借用manager池对象。
            const transform = body.getCenterOfMassTransform();
            const origin = transform.getOrigin();
            transform.getBasis().getRotation(nativeRotation);
            position.set(origin.x(), origin.y(), origin.z());
            rotation.set(nativeRotation.x(), nativeRotation.y(), nativeRotation.z(), nativeRotation.w());
            bodyMatrix.compose(position, rotation, unitScale);
            matrix.copy(spaceMatrix).multiply(bodyMatrix);
        } else {
            const bone = model.skeleton?.bones?.[entry.boneIndex];
            // 无物理时只是配置位置预览，骨骼/模型变换与PMX局部偏移共同确定姿态。
            boneMatrix.copy(bone?.matrixWorld || model.matrixWorld);
            matrix.copy(boneMatrix).multiply(entry.offset);
        }
        const factor = 1 + expansion;
        matrix.scale(scale.set(entry.shape.scale[0] * factor, entry.shape.scale[1] * factor,
            entry.shape.scale[2] * factor));
        return usedPhysics;
    };

    const render = (modelVisible = true, physics = null) => {
        // 不再要求mesh.visible：隐藏角色时叠加仍显示；AR/首帧门控仍由modelVisible参数控制。
        if (disposed || !enabled || !model || !modelVisible || !entries.length) return false;
        createResources();
        updateSpace();
        actualCount = 0;
        visibleBodyCount = 0;
        samples = [];
        // 选中骨骼过滤时通常要看模型内部刚体：过滤出的实例关闭深度测试保持穿透。
        const seeThrough = bodyFilter !== null;
        if (fillMaterial) fillMaterial.depthTest = !seeThrough;
        if (outlineMaterial) outlineMaterial.depthTest = !seeThrough;
        const manager = physics?.manager;
        let nativeRotation = null;
        try {
            if (manager && physics.bodies?.length) nativeRotation = manager.allocQuaternion();
            for (const group of groups) {
                let count = 0;
                for (let index = 0; index < group.entries.length; index += 1) {
                    const entry = group.entries[index];
                    if (bodyFilter && !bodyFilter.has(entry.bodyIndex)) continue;
                    if (updateEntry(entry, physics, nativeRotation)) actualCount += 1;
                    group.mesh.setMatrixAt(count, matrix);
                    // 逐实例颜色与打包序号同步（过滤会压缩count）；颜色只取决于刚体本身。
                    instanceColor.setHex(entry.color);
                    group.mesh.setColorAt(count, instanceColor);
                    if (count === 0) samples.push({ bodyIndex: entry.bodyIndex, type: entry.type,
                        shape: entry.shape.key, effectiveMass: entry.effectiveMass,
                        color: entry.color, matrix: matrix.toArray() });
                    if (group.outlineMesh) {
                        updateEntry(entry, physics, nativeRotation, RIGID_BODY_OUTLINE_EXPANSION);
                        group.outlineMesh.setMatrixAt(count, matrix);
                    }
                    count += 1;
                }
                group.mesh.count = count;
                group.mesh.visible = count > 0;
                group.mesh.instanceMatrix.needsUpdate = true;
                if (group.mesh.instanceColor) group.mesh.instanceColor.needsUpdate = true;
                if (group.outlineMesh) {
                    group.outlineMesh.count = count;
                    group.outlineMesh.visible = count > 0;
                    group.outlineMesh.instanceMatrix.needsUpdate = true;
                }
                visibleBodyCount += count;
            }
        } finally {
            if (nativeRotation) manager.freeQuaternion(nativeRotation);
        }
        poseMode = !visibleBodyCount ? 'none' : actualCount === visibleBodyCount ? 'physics' : actualCount ? 'mixed' : 'preview';
        updateCount += 1;
        const autoClear = renderer.autoClear;
        try {
            renderer.autoClear = false;
            renderer.render(scene, camera);
            drawCount += 1;
        } finally { renderer.autoClear = autoClear; }
        return true;
    };

    // 样式只影响材质与实例组构成：释放后由下一帧按新样式重建，物理与质量色不变。
    const setDisplayMode = (value) => {
        const next = value === 'wireframe' ? 'wireframe' : 'solid';
        if (next === displayMode) return displayMode;
        displayMode = next;
        release();
        return displayMode;
    };

    // 隐藏角色只关网格绘制，物理/动画/叠加继续；换模型后由setModel重新应用。
    const setCharacterHidden = (value) => {
        characterHidden = value === true;
        if (model) model.visible = !characterHidden;
        return characterHidden;
    };

    return Object.freeze({
        setModel, render,
        setBodyFilter: value => { bodyFilter = value instanceof Set ? value : null; },
        setVisible: value => { enabled = value === true; },
        setStyle: setDisplayMode,
        setCharacterHidden,
        // 实体+全量+角色可见才需要场景深度；线框、选中过滤或角色隐藏时都不需要。
        needsSceneDepth: (modelVisible = true) => enabled && !disposed && Boolean(model) && model.visible === true
            && modelVisible === true && displayMode === 'solid' && bodyFilter === null && entries.length > 0,
        getState: () => ({ enabled, bodyCount: entries.length, generation, releasedGroups, updateCount, drawCount,
            resourceGroups: groups.length, geometries: geometryCache.size, actualCount, poseMode,
            filtered: bodyFilter !== null, visibleBodyCount, displayMode, characterHidden,
            massScale: massScale ? { ...massScale } : null,
            massRamp: [...RIGID_BODY_MASS_RAMP],
            massBodies: entries.map(({ bodyIndex, type, effectiveMass, color }) =>
                ({ bodyIndex, type, effectiveMass, color })),
            counts: Object.fromEntries([0, 2, 1].map(type => [type, entries.filter(entry => entry.type === type).length])),
            samples: samples.map(sample => ({ ...sample, matrix: [...sample.matrix] })) }),
        dispose: () => { disposed = true; setModel(null); }
    });
}
