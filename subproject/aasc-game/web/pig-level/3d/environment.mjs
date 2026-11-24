// 动态环境：手绘天空穹顶、飘动积云、三层远山、太阳与半球光、指数雾、昼夜缓慢流逝与天气闪电。
import * as THREE from '../vendor/three.module.min.js';
import { buildPreset, seededRandom } from './presets.mjs?v=20261124e';
import { blobSphere } from './geometry.mjs?v=20261124e';

export const TIME_SLOTS = ['morning', 'noon', 'evening', 'night'];
export const TIME_LABELS = { morning: '早', noon: '中', evening: '晚', night: '夜' };
const TIME_SLOT_PHASE = { morning: 0.0, noon: 0.25, evening: 0.5, night: 0.75 };
const TIME_CYCLE_SECONDS = 90;

function phaseToSlot(phase) {
    const norm = ((phase % 1) + 1) % 1;
    const idx = Math.floor(((norm + 0.125) % 1) * 4) % 4;
    return TIME_SLOTS[idx];
}

export function createEnvironment(scene, textures, tier = 'high', onThunder = null) {
    const group = new THREE.Group();
    scene.add(group);
    const disposables = [];

    // 1. 手绘感天空穹顶（渐变 + 太阳光晕 + 夜间月亮与银白月晕 + 水粉笔触 + 星点）
    const skyUniforms = {
        uZenith: { value: new THREE.Color('#64b5f6') },
        uHorizon: { value: new THREE.Color('#dff3ff') },
        uSunDir: { value: new THREE.Vector3(0.4, 0.7, -0.5).normalize() },
        uSunColor: { value: new THREE.Color('#fff1d6') },
        uMoonDir: { value: new THREE.Vector3(-0.34, 0.32, -0.88).normalize() },
        uTime: { value: 0 },
        uDusk: { value: 0 },
        uFlash: { value: 0 },
        uNoiseMap: { value: textures.noiseMap() }
    };
    const skyGeo = new THREE.SphereGeometry(140, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
        uniforms: skyUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: /* glsl */`
            varying vec3 vDir;
            void main() {
                vDir = normalize(position);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */`
            uniform vec3 uZenith;
            uniform vec3 uHorizon;
            uniform vec3 uSunDir;
            uniform vec3 uSunColor;
            uniform vec3 uMoonDir;
            uniform float uTime;
            uniform float uDusk;
            uniform float uFlash;
            uniform sampler2D uNoiseMap;
            varying vec3 vDir;
            void main() {
                vec3 dir = normalize(vDir);
                float h = clamp(dir.y, 0.0, 1.0);
                vec3 col = mix(uHorizon, uZenith, pow(h, 0.56));
                // 手绘横向笔触感
                vec2 brushUv = vec2(atan(dir.z, dir.x) * 0.6, h * 1.8) + vec2(uTime * 0.002, 0.0);
                float brush = texture2D(uNoiseMap, brushUv).r;
                col *= 0.96 + brush * 0.08;
                // 太阳光晕（白天为主）
                float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
                col += uSunColor * (pow(sunDot, 12.0) * 0.25 + pow(sunDot, 140.0) * 0.75) * (1.0 - uDusk * 0.45);
                // 夜晚/黄昏月亮圆盘、环形山细节与银蓝月光晕
                if (uDusk > 0.04) {
                    vec3 mDir = normalize(uMoonDir);
                    float moonDot = max(dot(dir, mDir), 0.0);
                    float moonDisc = smoothstep(0.9968, 0.9977, moonDot);
                    float moonCrater = texture2D(uNoiseMap, dir.xy * 18.0).r;
                    vec3 moonFace = mix(vec3(0.86, 0.91, 1.0), vec3(1.0, 0.98, 0.92), 0.55 + moonCrater * 0.45);
                    float moonHalo = pow(moonDot, 18.0) * 0.34 + pow(moonDot, 6.0) * 0.14;
                    float moonAlpha = smoothstep(0.04, 0.45, uDusk);
                    col += vec3(0.76, 0.87, 1.0) * moonHalo * moonAlpha;
                    col = mix(col, moonFace * 1.15, moonDisc * moonAlpha);
                }
                // 黄昏/铁笼夜空闪烁星点
                if (uDusk > 0.1 && h > 0.14) {
                    float starN = texture2D(uNoiseMap, dir.xz * 6.5).a;
                    float twinkle = 0.65 + 0.35 * sin(uTime * 3.0 + starN * 20.0);
                    if (starN > 0.86) col += vec3(0.95, 0.97, 1.0) * uDusk * twinkle * 0.75;
                }
                col = mix(col, vec3(0.96, 0.98, 1.0), uFlash);
                gl_FragColor = vec4(col, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `
    });
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    group.add(skyMesh);
    disposables.push(skyGeo, skyMat);

    // 2. 三层远山剪影环（近、中、远）
    const mountainMeshes = [];
    const mountainConfigs = [
        { r: 88, h: 24, y: 7.5, tintMix: 0.78, rot: 0.2 },
        { r: 72, h: 20, y: 5.5, tintMix: 0.55, rot: 1.5 },
        { r: 58, h: 15, y: 3.5, tintMix: 0.32, rot: 2.7 }
    ];
    mountainConfigs.forEach((cfg, idx) => {
        const mGeo = new THREE.CylinderGeometry(cfg.r, cfg.r, cfg.h, 48, 1, true);
        const mTex = textures.mountain(idx);
        const mMat = new THREE.MeshBasicMaterial({
            map: mTex,
            color: '#8fb3d9',
            transparent: true,
            side: THREE.BackSide,
            depthWrite: false
        });
        const mMesh = new THREE.Mesh(mGeo, mMat);
        mMesh.position.y = cfg.y;
        mMesh.rotation.y = cfg.rot;
        group.add(mMesh);
        mountainMeshes.push({ mesh: mMesh, mat: mMat, tintMix: cfg.tintMix });
        disposables.push(mGeo, mMat);
    });

    // 3. 大朵积云（由多颗噪声球簇组合，顶部暖白、底部偏蓝灰）
    const cloudCount = tier === 'high' ? 18 : tier === 'medium' ? 12 : 8;
    const cloudMat = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: textures.gradient3() });
    const cloudBottomMat = new THREE.MeshToonMaterial({ color: '#c3d3ea', gradientMap: textures.gradient3() });
    const cloudBlobGeo = blobSphere(1.0, 5, 0.2, 1, 0.76);
    const clouds = [];
    const rand = seededRandom(88);
    for (let i = 0; i < cloudCount; i++) {
        const cGroup = new THREE.Group();
        const puffs = 5 + Math.floor(rand() * 5);
        for (let p = 0; p < puffs; p++) {
            const isTop = p % 2 === 0;
            const puff = new THREE.Mesh(cloudBlobGeo, isTop ? cloudMat : cloudBottomMat);
            const s = 1.4 + rand() * 1.9;
            puff.scale.set(s * 1.3, s * 0.85, s);
            puff.position.set((rand() - 0.5) * 4.5, isTop ? rand() * 0.8 : -0.35, (rand() - 0.5) * 2.5);
            cGroup.add(puff);
        }
        cGroup.position.set((rand() - 0.5) * 110, 22 + rand() * 12, -25 - rand() * 55);
        cGroup.userData.baseY = cGroup.position.y;
        cGroup.userData.speed = 0.35 + rand() * 0.45;
        cGroup.userData.baseScale = 0.85 + rand() * 0.65;
        cGroup.scale.setScalar(cGroup.userData.baseScale);
        group.add(cGroup);
        clouds.push(cGroup);
    }
    disposables.push(cloudMat, cloudBottomMat, cloudBlobGeo);

    // 4. 太阳主光 + 半球补光 + 指数雾
    const sunLight = new THREE.DirectionalLight('#fff1d6', 2.4);
    sunLight.position.set(16, 26, 14);
    sunLight.castShadow = tier !== 'low';
    sunLight.shadow.mapSize.setScalar(tier === 'high' ? 2048 : 1024);
    sunLight.shadow.camera.near = 2;
    sunLight.shadow.camera.far = 70;
    const camBound = 22;
    sunLight.shadow.camera.left = -camBound;
    sunLight.shadow.camera.right = camBound;
    sunLight.shadow.camera.top = camBound;
    sunLight.shadow.camera.bottom = -camBound;
    sunLight.shadow.bias = -0.0006;

    const hemiLight = new THREE.HemisphereLight('#cde6ff', '#5a7d3e', 1.3);
    // 夜晚/黄昏银蓝月光补光方向光
    const moonLight = new THREE.DirectionalLight('#cbe0ff', 0.0);
    moonLight.position.set(-14, 22, -28);
    const fog = new THREE.FogExp2('#dff3ff', 0.0068);
    scene.fog = fog;
    scene.add(sunLight, hemiLight, moonLight);

    let current = buildPreset('spring', 'sunny');
    let target = buildPreset('spring', 'sunny');
    let transProgress = 1;
    let timeCycleEnabled = true;
    let dayPhase = 0.16; // 从清晨偏上午起步，90 秒完整流转 早 -> 中 -> 晚 -> 夜
    let lastTime = 0;
    let lightningTimer = 9;
    let flashVal = 0;

    const cA = new THREE.Color();
    const cB = new THREE.Color();
    const lerpHex = (a, b, t) => {
        cA.set(a); cB.set(b);
        cA.lerp(cB, t);
        return `#${cA.getHexString()}`;
    };

    function applyColors(p, time) {
        // 24h 昼夜连续弧线（早 0.0 东侧晨光 -> 中 0.25 顶正高光 -> 晚 0.5 西侧夕照 -> 夜 0.75 月夜星辰）
        const arc = dayPhase * Math.PI * 2;
        const daySin = Math.sin(arc);
        const dayCos = Math.cos(arc);
        const nightBlend = Math.pow(Math.max(0, -daySin), 1.15);
        const sunsetBlend = Math.max(0, -dayCos) * (1 - nightBlend * 0.55);
        const dawnBlend = Math.max(0, dayCos) * 0.38 * (1 - nightBlend);
        const duskMix = Math.min(1, Math.max(p.dusk, (nightBlend * 0.96 + sunsetBlend * 0.45) * (1 - p.dusk) + p.dusk));

        skyUniforms.uTime.value = time;
        skyUniforms.uZenith.value.set(p.skyZenith)
            .lerp(cB.set('#4e60b2'), sunsetBlend * 0.52 * (1 - p.dusk))
            .lerp(cB.set('#1f2c66'), nightBlend * 0.85);
        skyUniforms.uHorizon.value.set(p.skyHorizon)
            .lerp(cB.set('#ffe4cb'), dawnBlend * 0.45 * (1 - p.dusk))
            .lerp(cB.set('#ffad82'), sunsetBlend * 0.52 * (1 - p.dusk))
            .lerp(cB.set('#425294'), nightBlend * 0.82);
        skyUniforms.uSunColor.value.set(p.sunColor)
            .lerp(cB.set('#ffd9b3'), dawnBlend * 0.45)
            .lerp(cB.set('#ff9c63'), sunsetBlend * 0.65)
            .lerp(cB.set('#b8d4ff'), nightBlend * 0.85);
        skyUniforms.uDusk.value = duskMix;
        skyUniforms.uFlash.value = flashVal;

        // 主平行光位置跟随 24h 时间连续摆动与升降（早东偏前 -> 中高正前 -> 晚西偏前 -> 夜月高斜照）
        const lightX = dayCos * 28 - nightBlend * 10;
        const lightY = THREE.MathUtils.lerp(13, Math.max(24, Math.tan(THREE.MathUtils.degToRad(p.sunElevation)) * 16), Math.max(0, daySin)) * (1 - nightBlend)
            + 24 * nightBlend;
        const lightZ = 16 - nightBlend * 8;
        sunLight.position.set(lightX, THREE.MathUtils.clamp(lightY, 12, 34), lightZ);
        skyUniforms.uSunDir.value.copy(sunLight.position).normalize();
        skyUniforms.uMoonDir.value.set(-0.34 + dayCos * 0.28, 0.26 + nightBlend * 0.22, -0.88).normalize();

        sunLight.color.copy(skyUniforms.uSunColor.value).lerp(cB.set('#ffdba6'), 0.25 * (1 - nightBlend));
        sunLight.intensity = p.sunIntensity * (1 - sunsetBlend * 0.14 - nightBlend * 0.42) + flashVal * 3.5;
        // 夜晚/黄昏开启银蓝月光方向光，搭配可读半球环境光保证夜间动物立体清晰
        moonLight.position.set(-14 + dayCos * 12, 22 + nightBlend * 8, -26);
        moonLight.intensity = duskMix * 1.5;
        hemiLight.intensity = Math.max(0.75, p.hemiIntensity * (1 - nightBlend * 0.22) + duskMix * 0.16);
        hemiLight.color.set('#fff7e8').lerp(cB.set('#a8c4fa'), duskMix * 0.72);
        hemiLight.groundColor.set('#5a7d3e').lerp(cB.set('#3d4b75'), duskMix * 0.62);

        fog.color.copy(skyUniforms.uHorizon.value);
        fog.density = p.fogDensity;

        cloudMat.color.set(p.cloudTop).lerp(cB.set('#ffd1b8'), sunsetBlend * 0.32).lerp(cB.set('#b9c6f0'), nightBlend * 0.58);
        cloudBottomMat.color.set(p.cloudBottom).lerp(cB.set('#756eb8'), duskMix * 0.45);

        mountainMeshes.forEach(m => {
            cA.set(p.mountainTint);
            cA.lerp(fog.color, m.tintMix * 0.65);
            m.mat.color.copy(cA);
        });
    }

    function setPreset(season, weather, options = {}, immediate = false) {
        target = buildPreset(season, weather, options);
        if (immediate) {
            current = { ...target };
            transProgress = 1;
        } else {
            transProgress = 0;
        }
    }

    function setShadowTier(nextTier) {
        sunLight.castShadow = nextTier !== 'low';
        if (sunLight.shadow.map) {
            sunLight.shadow.map.dispose();
            sunLight.shadow.map = null;
        }
        sunLight.shadow.mapSize.setScalar(nextTier === 'high' ? 2048 : 1024);
    }

    function update(dt, time) {
        lastTime = time;
        if (timeCycleEnabled) {
            dayPhase = (dayPhase + dt / TIME_CYCLE_SECONDS) % 1;
        }
        if (transProgress < 1) {
            transProgress = Math.min(1, transProgress + dt / 2.0);
            const t = transProgress;
            const numKeys = ['sunIntensity', 'hemiIntensity', 'sunElevation', 'fogDensity', 'wind', 'cloudCover', 'wetness', 'snowCover', 'flowerDensity', 'dusk'];
            for (const k of numKeys) current[k] = THREE.MathUtils.lerp(current[k], target[k], Math.min(1, dt * 2.5));
            const hexKeys = ['grassRoot', 'grassTip', 'lawn', 'ground', 'hillColor', 'mountainTint', 'skyZenith', 'skyHorizon', 'cloudTop', 'cloudBottom', 'sunColor'];
            for (const k of hexKeys) current[k] = lerpHex(current[k], target[k], Math.min(1, dt * 2.5));
            if (t >= 0.5) {
                current.season = target.season;
                current.weather = target.weather;
                current.foliage = target.foliage;
                current.treeType = target.treeType;
                current.flowers = target.flowers;
                current.precip = target.precip;
                current.precipCount = target.precipCount;
                current.lightning = target.lightning;
                current.seasonParticle = target.seasonParticle;
                current.ambientLife = target.ambientLife;
                current.props = target.props;
            }
        }

        // 雨天随机闪电
        if (current.lightning) {
            lightningTimer -= dt;
            if (lightningTimer <= 0) {
                flashVal = 0.85;
                lightningTimer = 9 + Math.random() * 11;
                onThunder?.();
            }
        }
        flashVal = Math.max(0, flashVal - dt * 3.8);

        // 积云漂移与厚度变化
        const cloudTotal = clouds.length;
        const activeClouds = Math.max(2, Math.round(cloudTotal * current.cloudCover));
        for (let i = 0; i < cloudTotal; i++) {
            const c = clouds[i];
            c.visible = i < activeClouds;
            if (!c.visible) continue;
            c.position.x += dt * c.userData.speed * (0.4 + current.wind * 1.1);
            if (c.position.x > 58) c.position.x = -58;
            c.position.y = c.userData.baseY - current.cloudCover * 3.2 + Math.sin(time * 0.4 + i) * 0.25;
            c.scale.setScalar(c.userData.baseScale * (0.85 + current.cloudCover * 0.38));
        }

        applyColors(current, time);
        return current;
    }

    return {
        setPreset,
        setTimeCycle(enabled) { timeCycleEnabled = Boolean(enabled); },
        isTimeCycleEnabled: () => timeCycleEnabled,
        setTimeSlot(slot) {
            if (Object.prototype.hasOwnProperty.call(TIME_SLOT_PHASE, slot)) {
                dayPhase = TIME_SLOT_PHASE[slot];
                applyColors(current, lastTime);
            }
        },
        getTimeSlot: () => phaseToSlot(dayPhase),
        getDayPhase: () => dayPhase,
        getSunPosition: () => ({ x: sunLight.position.x, y: sunLight.position.y, z: sunLight.position.z }),
        setShadowTier,
        getShadowData: () => ({
            enabled: sunLight.castShadow && Boolean(sunLight.shadow.map),
            map: sunLight.shadow.map ? sunLight.shadow.map.texture : null,
            matrix: sunLight.shadow.matrix,
            texel: 1 / Math.max(1, sunLight.shadow.mapSize.x),
            strength: THREE.MathUtils.clamp((current.sunIntensity - 0.6) * 0.48, 0.25, 1.0)
        }),
        getCurrent: () => current,
        getHorizonColor: () => fog.color,
        update,
        dispose() {
            scene.remove(group, sunLight, hemiLight);
            scene.fog = null;
            for (const d of disposables) d?.dispose?.();
        }
    };
}
