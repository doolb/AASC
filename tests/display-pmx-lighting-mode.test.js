const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PUBLIC_DIR = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');

test('PMX 材质普通光照对主光和补光统一使用非负法线点积且可即时切换', async () => {
    const modeUrl = pathToFileURL(path.join(PUBLIC_DIR, 'js/display-pmx-lighting-mode.mjs')).href;
    const [{ MMDToonShader }, { preparePmxLightingMaterial, setPmxLightingMode }, THREE] = await Promise.all([
        import('three/addons/shaders/MMDToonShader.js'), import(modeUrl), import('three')
    ]);
    const material = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(MMDToonShader.uniforms),
        vertexShader: MMDToonShader.vertexShader,
        fragmentShader: MMDToonShader.fragmentShader,
        lights: true
    });
    material.isMMDToonMaterial = true;
    const originalShader = material.fragmentShader;
    preparePmxLightingMaterial(material, true);
    assert.equal(material.uniforms.pmxStandardLighting.value, 0);
    assert.match(material.fragmentShader, /max\(\s*dot\(\s*geometryNormal,\s*directLight\.direction\s*\),\s*0\.0\s*\)/u);
    assert.match(material.fragmentShader, /mix\(\s*toonIrradiance,\s*standardIrradiance,\s*pmxStandardLighting\s*\)/u);
    assert.equal(MMDToonShader.fragmentShader, originalShader);
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
    root.add(mesh);
    setPmxLightingMode(root, false);
    assert.equal(material.uniforms.pmxStandardLighting.value, 1);
    setPmxLightingMode(root, true);
    assert.equal(material.uniforms.pmxStandardLighting.value, 0);
    assert.equal(material.fragmentShader.includes('pmxStandardLighting'), true);
});

test('PMX 两组边缘光只更新各自材质参数，关闭时强度为零', async () => {
    const modeUrl = pathToFileURL(path.join(PUBLIC_DIR, 'js/display-pmx-lighting-mode.mjs')).href;
    const [{ MMDToonShader }, { preparePmxLightingMaterial, setPmxRimLights }, THREE] = await Promise.all([
        import('three/addons/shaders/MMDToonShader.js'), import(modeUrl), import('three')
    ]);
    const material = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(MMDToonShader.uniforms),
        vertexShader: MMDToonShader.vertexShader,
        fragmentShader: MMDToonShader.fragmentShader,
        lights: true
    });
    material.isMMDToonMaterial = true;
    preparePmxLightingMaterial(material, false);
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.PlaneGeometry(), material));
    setPmxRimLights(root, [
        { enabled: true, color: '#ff0000', intensity: 2, direction: { longitude: -90, latitude: 0 } },
        { enabled: false, color: '#0000ff', intensity: 3, direction: { longitude: 90, latitude: 0 } }
    ]);
    assert.equal(material.uniforms.pmxRimIntensity1.value, 2);
    assert.equal(material.uniforms.pmxRimIntensity2.value, 0);
    assert.equal(material.uniforms.pmxRimColor1.value.getHexString(), 'ff0000');
    assert.ok(material.uniforms.pmxRimDirection1.value.x < -0.99);
    setPmxRimLights(root, [
        { enabled: false, color: '#ff0000', intensity: 2, direction: { longitude: -90, latitude: 0 } },
        { enabled: true, color: '#0000ff', intensity: 3, direction: { longitude: 90, latitude: 0 } }
    ]);
    assert.equal(material.uniforms.pmxRimIntensity1.value, 0);
    assert.equal(material.uniforms.pmxRimIntensity2.value, 3);
    assert.equal(material.uniforms.pmxRimColor2.value.getHexString(), '0000ff');
});
