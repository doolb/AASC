// 独立骨骼诊断只读取角色几何：浅克隆共享骨骼/贴图，不重新绑定或修改原模型。
export function normalizeSkeletonOccludedOpacity(value) {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.round(Math.max(0, Math.min(1, value)) * 100) / 100 : 0.5;
}

export function createSkeletonCharacterDepth({ THREE, renderer, camera }) {
    const supported = renderer.capabilities.isWebGL2 === true
        || renderer.extensions?.has('WEBGL_depth_texture') === true;
    const scene = new THREE.Scene();
    const size = new THREE.Vector2();
    const uniforms = {
        skeletonCharacterDepth: { value: null },
        skeletonDepthSize: { value: new THREE.Vector2(1, 1) },
        skeletonCharacterDepthEnabled: { value: 0 },
        skeletonOccludedOpacity: { value: 0.5 }
    };
    let model = null;
    let proxy = null;
    let materials = [];
    let target = null;
    let captures = 0;

    const releaseModel = () => {
        if (proxy) scene.remove(proxy);
        for (const material of materials) material.dispose();
        materials = [];
        model = null;
        proxy = null;
        uniforms.skeletonCharacterDepthEnabled.value = 0;
        // 几何、骨骼和贴图归原模型所有，这里只释放独立捕获资源。
        if (target) {
            target.dispose();
            target = null;
            uniforms.skeletonCharacterDepth.value = null;
        }
    };

    const setModel = (next) => {
        releaseModel();
        model = next;
        if (!model || !supported) return;
        proxy = model.clone(false);
        proxy.name = 'mmd-ar-skeleton-character-depth';
        proxy.matrixAutoUpdate = false;
        proxy.matrixWorldAutoUpdate = false;
        proxy.frustumCulled = false;
        proxy.castShadow = false;
        proxy.receiveShadow = false;
        const sources = Array.isArray(model.material) ? model.material : [model.material];
        materials = sources.map(() => new THREE.MeshDepthMaterial({ colorWrite: false }));
        proxy.material = Array.isArray(model.material) ? materials : materials[0];
        scene.add(proxy);
    };

    const capture = () => {
        uniforms.skeletonCharacterDepthEnabled.value = 0;
        if (!supported || !proxy || !model?.visible || uniforms.skeletonOccludedOpacity.value >= 1) return false;
        renderer.getDrawingBufferSize(size);
        const width = Math.max(1, Math.floor(size.x));
        const height = Math.max(1, Math.floor(size.y));
        if (!target) {
            const depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
            target = new THREE.WebGLRenderTarget(width, height, { depthTexture,
                minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
            uniforms.skeletonCharacterDepth.value = depthTexture;
        }
        if (target.width !== width || target.height !== height) target.setSize(width, height);
        uniforms.skeletonDepthSize.value.set(width, height);
        // 浅克隆没有自己的骨骼子树；共享原骨骼矩阵与实时形变，保留原绑定模式。
        proxy.matrix.copy(model.matrixWorld);
        proxy.matrixWorld.copy(model.matrixWorld);
        proxy.morphTargetInfluences = model.morphTargetInfluences;
        if (model.isSkinnedMesh) {
            proxy.bindMode = model.bindMode;
            proxy.bindMatrix.copy(model.bindMatrix);
            proxy.bindMatrixInverse.copy(model.bindMatrixInverse);
        }
        const sources = Array.isArray(model.material) ? model.material : [model.material];
        for (let index = 0; index < materials.length; index += 1) {
            const source = sources[index];
            const depth = materials[index];
            // 按原材质分组保留可见性、单双面和alpha裁剪，不能把隐藏的材质重新画入深度。
            for (const key of ['side', 'map', 'alphaMap', 'alphaTest']) {
                if (depth[key] === source[key]) continue;
                depth[key] = source[key];
                depth.needsUpdate = true;
            }
            depth.visible = source.visible !== false && source.opacity > 0;
            depth.opacity = source.opacity;
        }
        const previousTarget = renderer.getRenderTarget();
        const previousAutoClear = renderer.autoClear;
        const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
        const previousShadowNeedsUpdate = renderer.shadowMap.needsUpdate;
        try {
            renderer.autoClear = false;
            renderer.shadowMap.autoUpdate = false;
            renderer.shadowMap.needsUpdate = false;
            renderer.setRenderTarget(target);
            renderer.clear(true, true, false);
            renderer.render(scene, camera);
            uniforms.skeletonCharacterDepthEnabled.value = 1;
            captures += 1;
        } finally {
            renderer.setRenderTarget(previousTarget);
            renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
            renderer.shadowMap.needsUpdate = previousShadowNeedsUpdate;
            renderer.autoClear = previousAutoClear;
        }
        return true;
    };

    const prepareMaterial = (material) => {
        // 保留球材质原着色，仅在输出前按球面像素深度设置alpha；外露部分始终为1。
        material.onBeforeCompile = shader => {
            const anchor = '#include <opaque_fragment>';
            if (!shader.fragmentShader.includes(anchor)) throw new Error('骨骼透明度shader输出入口已改变');
            Object.assign(shader.uniforms, uniforms);
            shader.fragmentShader = `uniform highp sampler2D skeletonCharacterDepth;
uniform vec2 skeletonDepthSize;
uniform float skeletonCharacterDepthEnabled;
uniform float skeletonOccludedOpacity;
` + shader.fragmentShader.replace(anchor, `
if ( skeletonCharacterDepthEnabled > 0.5 ) {
    float characterDepth = texture2D( skeletonCharacterDepth, gl_FragCoord.xy / skeletonDepthSize ).r;
    if ( gl_FragCoord.z > characterDepth + 0.000001 ) diffuseColor.a *= skeletonOccludedOpacity;
}
${anchor}`);
        };
        material.customProgramCacheKey = () => 'mmd-ar-skeleton-character-alpha-v1';
    };

    return Object.freeze({ supported, setModel, capture, prepareMaterial,
        setOpacity: value => { uniforms.skeletonOccludedOpacity.value = normalizeSkeletonOccludedOpacity(value); },
        getState: () => ({ characterDepthSupported: supported, characterDepthCaptures: captures }),
        dispose: releaseModel });
}
