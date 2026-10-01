import { SKELETON_COLORS } from './web-skeleton-debug.mjs';

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

/**
 * 每个PMX刚体一个实例；物理开启读取实际COM，不用骨骼回写结果冒充刚体姿态。
 * 只保留索引/配置，不保存Ammo引用；换VMD/重建物理后自动读取当前physics。
 */
export function createRigidBodyOverlay({ THREE, renderer, camera }) {
    const scene = new THREE.Scene();
    scene.name = 'mmd-ar-rigid-body-overlay';
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
    const geometryCache = new Map();
    const materials = new Map();
    let groups = [];
    let entries = [];
    let model = null;
    let enabled = false;
    let disposed = false;
    let generation = 0;
    let releasedGroups = 0;
    let updateCount = 0;
    let drawCount = 0;
    let actualCount = 0;
    let poseMode = 'none';
    let samples = [];

    const release = () => {
        for (const group of groups) {
            scene.remove(group.mesh);
            group.mesh.dispose();
            releasedGroups += 1;
        }
        groups = [];
        for (const material of materials.values()) material.dispose();
        for (const geometry of geometryCache.values()) geometry.dispose();
        materials.clear();
        geometryCache.clear();
        samples = [];
    };

    const setModel = (mesh) => {
        release();
        model = disposed ? null : mesh;
        entries = [];
        actualCount = 0;
        poseMode = 'none';
        if (!model) return;
        generation += 1;
        const bodies = model.geometry?.userData?.MMD?.rigidBodies;
        for (const [bodyIndex, params] of (Array.isArray(bodies) ? bodies : []).entries()) {
            const shape = describeRigidBodyShape(params);
            const vectors = [params?.position, params?.rotation];
            if (!shape || vectors.some(value => !Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite))) continue;
            const offset = new THREE.Matrix4().compose(new THREE.Vector3(...params.position),
                new THREE.Quaternion().setFromEuler(euler.set(...params.rotation)), unitScale);
            entries.push({ bodyIndex, type: params.type, shape, boneIndex: params.boneIndex, offset });
        }
    };

    const createResources = () => {
        if (groups.length) return;
        const grouped = new Map();
        for (const entry of entries) {
            const key = `${entry.type}:${entry.shape.key}`;
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key).push(entry);
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
            if (!materials.has(first.type)) materials.set(first.type, new THREE.MeshBasicMaterial({
                color: SKELETON_COLORS[first.type], wireframe: true, depthTest: false,
                depthWrite: false, toneMapped: false, transparent: true, opacity: 0.65
            }));
            const mesh = new THREE.InstancedMesh(geometryCache.get(first.shape.key), materials.get(first.type), groupEntries.length);
            mesh.name = `mmd-ar-rigid-body-${first.type}-${first.shape.key}`;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.frustumCulled = false;
            scene.add(mesh);
            groups.push({ entries: groupEntries, mesh });
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

    const updateEntry = (entry, physics, nativeRotation) => {
        const body = physics?.bodies?.[entry.bodyIndex]?.body;
        if (body && nativeRotation) {
            // COM、origin、basis均为借用引用，不能destroy；旋转输出借用manager池对象。
            const transform = body.getCenterOfMassTransform();
            const origin = transform.getOrigin();
            transform.getBasis().getRotation(nativeRotation);
            position.set(origin.x(), origin.y(), origin.z());
            rotation.set(nativeRotation.x(), nativeRotation.y(), nativeRotation.z(), nativeRotation.w());
            bodyMatrix.compose(position, rotation, unitScale);
            matrix.copy(spaceMatrix).multiply(bodyMatrix);
            actualCount += 1;
        } else {
            const bone = model.skeleton?.bones?.[entry.boneIndex];
            // 无物理时只是配置位置预览，骨骼/模型变换与PMX局部偏移共同确定姿态。
            boneMatrix.copy(bone?.matrixWorld || model.matrixWorld);
            matrix.copy(boneMatrix).multiply(entry.offset);
        }
        matrix.scale(scale.set(...entry.shape.scale));
    };

    const render = (modelVisible = true, physics = null) => {
        if (disposed || !enabled || !model || !model.visible || !modelVisible || !entries.length) return false;
        createResources();
        updateSpace();
        actualCount = 0;
        samples = [];
        const manager = physics?.manager;
        let nativeRotation = null;
        try {
            if (manager && physics.bodies?.length) nativeRotation = manager.allocQuaternion();
            for (const group of groups) {
                for (let index = 0; index < group.entries.length; index += 1) {
                    const entry = group.entries[index];
                    updateEntry(entry, physics, nativeRotation);
                    group.mesh.setMatrixAt(index, matrix);
                    if (index === 0) samples.push({ bodyIndex: entry.bodyIndex, type: entry.type,
                        shape: entry.shape.key, color: group.mesh.material.color.getHex(), matrix: matrix.toArray() });
                }
                group.mesh.instanceMatrix.needsUpdate = true;
            }
        } finally {
            if (nativeRotation) manager.freeQuaternion(nativeRotation);
        }
        poseMode = actualCount === entries.length ? 'physics' : actualCount ? 'mixed' : 'preview';
        updateCount += 1;
        const autoClear = renderer.autoClear;
        try {
            renderer.autoClear = false;
            renderer.render(scene, camera);
            drawCount += 1;
        } finally { renderer.autoClear = autoClear; }
        return true;
    };

    return Object.freeze({
        setModel, render,
        setVisible: value => { enabled = value === true; },
        getState: () => ({ enabled, bodyCount: entries.length, generation, releasedGroups, updateCount, drawCount,
            resourceGroups: groups.length, geometries: geometryCache.size, actualCount, poseMode,
            counts: Object.fromEntries([0, 2, 1].map(type => [type, entries.filter(entry => entry.type === type).length])),
            samples: samples.map(sample => ({ ...sample, matrix: [...sample.matrix] })) }),
        dispose: () => { disposed = true; setModel(null); }
    });
}
