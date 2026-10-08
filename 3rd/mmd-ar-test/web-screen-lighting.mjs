import { vertexShader, fragmentShader, filterShader } from './web-screen-lighting-shader.mjs';
export function createScreenLighting({ THREE, renderer, camera, keyLight }) {
    let resources = null;
    const direction = new THREE.Vector3(), target = new THREE.Vector3();
    const settings = () => window.MmdArScreenLighting || {};
    const active = () => settings().contactEnabled === true || settings().giEnabled === true;
    const dispose = () => {
        if (!resources) return;
        for (const target of resources.targets) target.dispose();
        resources.filterMaterial.dispose(); resources.material.dispose(); resources.geometry.dispose(); resources = null;
    };
    const create = () => {
        if (resources) return;
        // 手动按几何边界插值，禁止硬件先混入轮廓外像素；可用时避免8位量化色阶。
        const type = renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
        const targets = Array.from({ length: 3 }, () => new THREE.WebGLRenderTarget(1, 1, {
            depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type
        }));
        const uniforms = {
            tDepth: { value: null }, tColor: { value: null }, inverseProjection: { value: camera.projectionMatrixInverse }, projection: { value: camera.projectionMatrix },
            fullSize: { value: new THREE.Vector2() }, lightDirection: { value: direction },
            contactEnabled: { value: false }, giEnabled: { value: false }, contactStrength: { value: .5 }, contactDistance: { value: .3 },
            giStrength: { value: 1 }, giRadius: { value: 2 }, lightWeight: { value: 1 }, rayCount: { value: 4 }, stepCount: { value: 12 }
        };
        const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false });
        const geometry = new THREE.PlaneGeometry(2, 2), scene = new THREE.Scene();
        const quad = new THREE.Mesh(geometry, material); scene.add(quad);
        const filterMaterial = new THREE.ShaderMaterial({ vertexShader, fragmentShader: filterShader,
            uniforms: { tInput: { value: null }, tDepth: uniforms.tDepth, inverseProjection: uniforms.inverseProjection,
                fullSize: uniforms.fullSize, effectSize: { value: new THREE.Vector2() }, filterAxis: { value: new THREE.Vector2() } },
            depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false });
        resources = { targets, material, filterMaterial, quad, geometry, scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
    };
    const prepare = (ao, width, height, normalPreview, aoEnabled) => {
        const composite = ao.compositeMaterial.uniforms;
        composite.screenAoEnabled.value = aoEnabled ? 1 : 0;
        composite.screenLightingEnabled.value = active() && !normalPreview;
        if (!composite.screenLightingEnabled.value) { composite.screenLightingTexture.value = ao.colorTarget.texture; dispose(); return; }
        create();
        const config = settings(), quality = ['low', 'medium', 'high'].includes(config.quality) ? config.quality : 'low';
        const maxSize = { low: 384, medium: 512, high: 640 }[quality];
        const scale = Math.min(.5, maxSize / Math.max(width, height));
        const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
        for (const target of resources.targets) if (target.width !== w || target.height !== h) target.setSize(w, h);
        const u = resources.material.uniforms;
        u.tDepth.value = ao.depthTexture; u.tColor.value = ao.colorTarget.texture; u.fullSize.value.set(width, height);
        for (const name of ['contactEnabled', 'giEnabled']) u[name].value = config[name] === true;
        const ranges = { contactStrength: [0, 1, .5], contactDistance: [.02, 3, .3], giStrength: [0, 4, 1], giRadius: [.1, 10, 2] };
        for (const [name, [min, max, fallback]] of Object.entries(ranges)) {
            const value = Number(config[name]); u[name].value = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
        }
        u.rayCount.value = { low: 4, medium: 6, high: 8 }[quality];
        u.stepCount.value = { low: 12, medium: 20, high: 32 }[quality];
        u.lightWeight.value = keyLight?.visible && keyLight.intensity > 0 ? Math.min(1, keyLight.intensity / (keyLight.intensity + 1)) : 0;
        if (keyLight) {
            keyLight.getWorldPosition(direction); keyLight.target.getWorldPosition(target);
            direction.sub(target).normalize().transformDirection(camera.matrixWorldInverse);
        }
        const previous = renderer.getRenderTarget();
        try {
            resources.quad.material = resources.material;
            renderer.setRenderTarget(resources.targets[0]); renderer.clear(); renderer.render(resources.scene, resources.camera);
            const filter = resources.filterMaterial.uniforms; filter.effectSize.value.set(w, h);
            resources.quad.material = resources.filterMaterial;
            for (let pass = 0; pass < 2; pass++) {
                filter.tInput.value = resources.targets[pass].texture;
                filter.filterAxis.value.set(pass === 0 ? 1 : 0, pass === 0 ? 0 : 1);
                renderer.setRenderTarget(resources.targets[pass + 1]); renderer.clear(); renderer.render(resources.scene, resources.camera);
            }
        }
        finally { renderer.setRenderTarget(previous); }
        composite.screenLightingTexture.value = resources.targets[2].texture;
        composite.screenLightingSize.value.set(w, h);
        composite.screenLightingFullSize.value.set(width, height);
    };
    return { active, prepare, dispose };
}
