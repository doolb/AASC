// 独立网页诊断：选择、名称和接触读取只观察当前骨骼/物理，不写求解参数。
export function normalizeSkeletonSize(value) {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.round(Math.max(0.2, Math.min(3, value)) * 10) / 10 : 1;
}

export function createSkeletonSelection({ THREE, renderer, camera, scene }) {
    const sourceCanvas = renderer.domElement;
    const position = new THREE.Vector3();
    const viewPosition = new THREE.Vector3();
    const projected = new THREE.Vector3();
    const viewportSize = { width: 1, height: 1 };
    const screenPoint = { x: 0, y: 0, depth: 0, radius: 0, normalizedX: 0, normalizedY: 0 };
    const axesDirections = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    let model = null;
    let enabled = false;
    let modelVisible = false;
    let namesVisible = false;
    let selectedBoneIndex = -1;
    let worldRadius = 0.0035;
    let physics = null;
    let attachedPhysics = null;
    let axes = null;
    let canvas = null;
    let context = null;
    let labelCount = 0;
    let labelDrawCount = 0;
    let contactScanCount = 0;
    let contactError = '';
    const ownBodies = new Set();
    const contacts = new Set();
    const visibleBodies = new Set();
    const pointerToIndex = new Map();

    const viewport = () => {
        viewportSize.width = sourceCanvas?.clientWidth || 1;
        viewportSize.height = sourceCanvas?.clientHeight || 1;
        return viewportSize;
    };

    const clearLabels = () => {
        labelCount = 0;
        if (canvas && !canvas.hidden) {
            context?.clearRect(0, 0, canvas.width, canvas.height);
            canvas.hidden = true;
        }
    };

    // 相机后方和近/远裁剪面外都跳过。返回CSS像素，字号不随球倍率变化。
    const project = (worldPosition) => {
        viewPosition.copy(worldPosition).applyMatrix4(camera.matrixWorldInverse);
        if (viewPosition.z >= 0) return null;
        projected.copy(worldPosition).project(camera);
        if (!Number.isFinite(projected.x + projected.y + projected.z)
            || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || Math.abs(projected.z) > 1) return null;
        const { width, height } = viewportSize;
        const radius = worldRadius * Math.abs(camera.projectionMatrix.elements[5]) * height / 2
            / (camera.isPerspectiveCamera ? -viewPosition.z : 1);
        screenPoint.x = (projected.x + 1) * width / 2;
        screenPoint.y = (1 - projected.y) * height / 2;
        screenPoint.depth = -viewPosition.z;
        screenPoint.radius = radius;
        screenPoint.normalizedX = projected.x;
        screenPoint.normalizedY = projected.y;
        return screenPoint;
    };

    const prepareCanvas = () => {
        if (!canvas && sourceCanvas?.ownerDocument && sourceCanvas.parentElement) {
            canvas = sourceCanvas.ownerDocument.createElement('canvas');
            canvas.className = 'mmd-ar-bone-names';
            canvas.setAttribute('aria-hidden', 'true');
            canvas.style.cssText = 'position:absolute;pointer-events:none;z-index:1;';
            context = canvas.getContext('2d');
            if (!context) { canvas = null; return false; }
            sourceCanvas.after(canvas);
        }
        if (!context) return false;
        const { width, height } = viewport();
        const ratio = Math.min(2, Math.max(1, sourceCanvas.ownerDocument.defaultView?.devicePixelRatio || 1));
        const pixelWidth = Math.max(1, Math.round(width * ratio));
        const pixelHeight = Math.max(1, Math.round(height * ratio));
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
        }
        canvas.style.left = `${sourceCanvas.offsetLeft || 0}px`;
        canvas.style.top = `${sourceCanvas.offsetTop || 0}px`;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.hidden = false;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        context.font = '12px system-ui, sans-serif';
        context.textBaseline = 'middle';
        context.lineJoin = 'round';
        context.lineWidth = 3;
        context.strokeStyle = '#101218';
        return true;
    };

    const rebuildFilter = () => {
        visibleBodies.clear();
        for (const index of ownBodies) visibleBodies.add(index);
        for (const index of contacts) visibleBodies.add(index);
    };

    const detach = () => {
        if (attachedPhysics?.onDiagnosticSubstep === capture) attachedPhysics.onDiagnosticSubstep = null;
        attachedPhysics = null;
        pointerToIndex.clear();
    };

    const clearContacts = () => { contacts.clear(); contactError = ''; rebuildFilter(); };

    // 每个子步末读取借用manifold/point，仅保存PMX索引；绝不destroy借用对象。
    const capture = () => {
        if (!enabled || selectedBoneIndex < 0 || !ownBodies.size || !attachedPhysics) return;
        try {
            const dispatcher = attachedPhysics.world.getDispatcher();
            const ammo = globalThis.Ammo;
            for (let i = 0, count = dispatcher.getNumManifolds(); i < count; i += 1) {
                const manifold = dispatcher.getManifoldByIndexInternal(i);
                const a = pointerToIndex.get(ammo.getPointer(manifold.getBody0()));
                const b = pointerToIndex.get(ammo.getPointer(manifold.getBody1()));
                if (a === undefined || b === undefined || (!ownBodies.has(a) && !ownBodies.has(b))) continue;
                let touching = false;
                for (let j = 0, count = manifold.getNumContacts(); j < count; j += 1) {
                    if (manifold.getContactPoint(j).getDistance() <= 0) { touching = true; break; }
                }
                if (!touching) continue;
                if (ownBodies.has(a) && !ownBodies.has(b)) contacts.add(b);
                if (ownBodies.has(b) && !ownBodies.has(a)) contacts.add(a);
            }
            rebuildFilter();
            contactScanCount += 1;
        } catch (error) {
            // 诊断失败不能中断物理子步或改变模型状态，面板提供可查询错误。
            contactError = error.message || String(error);
        }
    };

    const attach = () => {
        detach();
        if (!enabled || selectedBoneIndex < 0 || !ownBodies.size || !physics || !globalThis.Ammo?.getPointer) return;
        for (const [index, entry] of physics.bodies.entries()) {
            if (entry.body) pointerToIndex.set(globalThis.Ammo.getPointer(entry.body), index);
        }
        attachedPhysics = physics;
        physics.onDiagnosticSubstep = capture;
    };

    const select = (index) => {
        const next = Number.isInteger(index) && model?.skeleton?.bones[index] ? index : -1;
        if (next === selectedBoneIndex) return;
        selectedBoneIndex = next;
        ownBodies.clear();
        const bodies = model?.geometry?.userData?.MMD?.rigidBodies || [];
        for (const [bodyIndex, params] of bodies.entries()) {
            if (next >= 0 && params?.boneIndex === next) ownBodies.add(bodyIndex);
        }
        clearContacts();
        attach();
        if (axes) axes.visible = false;
        clearLabels();
        // 选中时读取当前仍存在的有效接触，之后每子步累计。
        capture();
    };

    const observePhysics = (next) => {
        if (physics === next) return;
        detach();
        physics = next;
        clearContacts();
        attach();
    };

    const update = (radius, axisLength = radius * 12) => {
        worldRadius = radius;
        modelVisible = enabled && !!model?.visible;
        if (!modelVisible) { clearLabels(); if (axes) axes.visible = false; return; }
        camera.updateWorldMatrix(true, false);
        viewport();
        const bone = model.skeleton?.bones[selectedBoneIndex];
        if (bone) {
            if (!axes) {
                axes = new THREE.AxesHelper(1);
                axes.name = 'mmd-ar-selected-bone-axes';
                axes.material.depthTest = false;
                axes.material.depthWrite = false;
                axes.material.toneMapped = false;
                axes.setColors(0xff3333, 0x33e066, 0x3388ff);
                axes.frustumCulled = false;
                scene.add(axes);
            }
            axes.visible = true;
            axes.position.setFromMatrixPosition(bone.matrixWorld);
            bone.getWorldQuaternion(axes.quaternion);
            // 轴长度由模型基准尺寸决定，缩小小球时仍能辨认三轴。
            axes.scale.setScalar(axisLength);
        } else if (axes) axes.visible = false;
        if (!namesVisible && !bone) { clearLabels(); return; }
        if (!prepareCanvas()) return;
        labelCount = 0;
        // 全部名称关闭时只处理选中骨骼；不额外遍历每个名称。
        const indices = namesVisible ? model.skeleton.bones.keys() : [selectedBoneIndex];
        for (const index of indices) {
            const item = model.skeleton.bones[index];
            const point = project(position.setFromMatrixPosition(item.matrixWorld));
            if (!point) continue;
            const selected = index === selectedBoneIndex;
            if (selected) {
                context.beginPath();
                context.arc(point.x, point.y, Math.max(5, point.radius) + 3, 0, Math.PI * 2);
                context.strokeStyle = '#ffffff'; context.lineWidth = 2; context.stroke();
            }
            const name = item.name?.trim();
            if (!name) continue;
            context.strokeStyle = '#101218'; context.lineWidth = 3;
            context.fillStyle = selected ? '#fff2a8' : '#ffffff';
            const x = point.x + point.radius + 5;
            context.strokeText(name, x, point.y);
            context.fillText(name, x, point.y);
            labelCount += 1;
        }
        if (axes?.visible) {
            const colors = ['#ff3333', '#33e066', '#3388ff'];
            for (let i = 0; i < axesDirections.length; i += 1) {
                position.set(...axesDirections[i]).multiplyScalar(axisLength).applyQuaternion(axes.quaternion).add(axes.position);
                const point = project(position);
                if (!point) continue;
                context.strokeStyle = '#101218'; context.lineWidth = 3; context.fillStyle = colors[i];
                context.strokeText('XYZ'[i], point.x + 3, point.y - 3);
                context.fillText('XYZ'[i], point.x + 3, point.y - 3);
            }
        }
        labelDrawCount += 1;
    };

    const pick = (point) => {
        if (!enabled || !modelVisible || !model?.visible) return false;
        const { width, height } = viewport();
        const x = (point.normalizedX + 1) * width / 2;
        const y = (1 - point.normalizedY) * height / 2;
        let hit = -1;
        let bestDistance = Infinity;
        let bestDepth = Infinity;
        camera.updateWorldMatrix(true, false);
        for (const [index, bone] of model.skeleton.bones.entries()) {
            const target = project(position.setFromMatrixPosition(bone.matrixWorld));
            if (!target) continue;
            const distance = Math.hypot(target.x - x, target.y - y);
            if (distance > Math.max(8, target.radius)) continue;
            if (distance < bestDistance - 0.01 || (Math.abs(distance - bestDistance) <= 0.01 && target.depth < bestDepth)) {
                hit = index; bestDistance = distance; bestDepth = target.depth;
            }
        }
        select(hit);
        return true;
    };

    return Object.freeze({
        update, pick, select, observePhysics, clearContacts,
        setNamesVisible: value => { namesVisible = value === true; clearLabels(); },
        setVisible: value => { enabled = value === true; if (!enabled) select(-1); },
        hide: () => { modelVisible = false; clearLabels(); if (axes) axes.visible = false; },
        getBodyFilter: () => selectedBoneIndex < 0 ? null : visibleBodies,
        getScreenPoint: index => {
            viewport();
            const point = model?.skeleton?.bones[index]
                ? project(position.setFromMatrixPosition(model.skeleton.bones[index].matrixWorld)) : null;
            return point ? { ...point } : null;
        },
        getState: () => ({ namesVisible, labelCount, labelDrawCount, selectedBoneIndex,
            selectedBoneName: model?.skeleton?.bones[selectedBoneIndex]?.name || '',
            ownBodyIndices: [...ownBodies], contactBodyIndices: [...contacts], contactScanCount, contactError,
            contactActive: !!attachedPhysics, axesVisible: axes?.visible === true,
            axes: axes?.visible ? { origin: axes.position.toArray(), directions: axesDirections.map(values =>
                position.set(...values).applyQuaternion(axes.quaternion).toArray()) } : null }),
        setModel: next => {
            select(-1); observePhysics(null); clearLabels(); model = next; modelVisible = false;
            if (axes) { scene.remove(axes); axes.geometry.dispose(); axes.material.dispose(); axes = null; }
        },
        dispose: () => {
            select(-1); observePhysics(null); model = null; enabled = false; modelVisible = false;
            if (axes) { scene.remove(axes); axes.geometry.dispose(); axes.material.dispose(); axes = null; }
            canvas?.remove(); canvas = null; context = null;
        }
    });
}
