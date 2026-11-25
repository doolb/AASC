// 动态环境：手绘天空穹顶、飘动积云、三层远山、太阳与半球光、指数雾、昼夜缓慢流逝与天气闪电。
import * as THREE from '../vendor/three.module.min.js';
import { buildPreset, seededRandom } from './presets.mjs?v=20261125d';
import { blobSphere } from './geometry.mjs?v=20261125d';

export const TIME_SLOTS = ['morning', 'noon', 'evening', 'night'];
export const TIME_LABELS = { morning: '早', noon: '中', evening: '晚', night: '夜' };
const TIME_SLOT_PHASE = { morning: 0.0, noon: 0.25, evening: 0.5, night: 0.75 };
const TIME_CYCLE_SECONDS = 90;

// 现实 24 小时日光光谱关键帧（0.00 日出 06:00 -> 0.25 正午 12:00 -> 0.50 日落 18:00 -> 0.75 午夜 00:00）
const SOLAR_24H_STOPS = [
    { phase: 0.00, sun: '#ffb36b', horizon: '#f2ead0', zenith: '#7ea4c8', tint: '#ffe8ce', night: 0.05 },
    { phase: 0.12, sun: '#fff1d4', horizon: '#e8f4ff', zenith: '#6ab4f0', tint: '#fff9ef', night: 0.00 },
    { phase: 0.25, sun: '#fffdf6', horizon: '#e6f6ff', zenith: '#56aef5', tint: '#ffffff', night: 0.00 },
    { phase: 0.40, sun: '#ffd594', horizon: '#ffdfbc', zenith: '#5a99db', tint: '#fff1d8', night: 0.00 },
    { phase: 0.50, sun: '#ff7d3e', horizon: '#ff925c', zenith: '#4a4e96', tint: '#ffbd8a', night: 0.16 },
    { phase: 0.58, sun: '#7f96d8', horizon: '#4f5d96', zenith: '#2b346b', tint: '#6273ad', night: 0.68 },
    { phase: 0.75, sun: '#9ec2ff', horizon: '#243875', zenith: '#0f1c47', tint: '#233466', night: 1.00 },
    { phase: 0.90, sun: '#7285c4', horizon: '#4e598c', zenith: '#2b3366', tint: '#5d6ca3', night: 0.65 },
    { phase: 1.00, sun: '#ffb36b', horizon: '#f2ead0', zenith: '#7ea4c8', tint: '#ffe8ce', night: 0.05 }
];
const solarSample = {
    sun: new THREE.Color('#fffdf6'),
    horizon: new THREE.Color('#e6f6ff'),
    zenith: new THREE.Color('#56aef5'),
    tint: new THREE.Color('#ffffff'),
    night: 0
};
const sTmp = new THREE.Color();

// 按 dayPhase 查找并插值连续 24 小时日光光谱参数
function sampleSolarCycle(phase) {
    const p = ((phase % 1) + 1) % 1;
    let a = SOLAR_24H_STOPS[0];
    let b = SOLAR_24H_STOPS[SOLAR_24H_STOPS.length - 1];
    for (let i = 0; i < SOLAR_24H_STOPS.length - 1; i++) {
        if (p >= SOLAR_24H_STOPS[i].phase && p <= SOLAR_24H_STOPS[i + 1].phase) {
            a = SOLAR_24H_STOPS[i];
            b = SOLAR_24H_STOPS[i + 1];
            break;
        }
    }
    const span = Math.max(1e-5, b.phase - a.phase);
    const t = THREE.MathUtils.clamp((p - a.phase) / span, 0, 1);
    solarSample.sun.set(a.sun).lerp(sTmp.set(b.sun), t);
    solarSample.horizon.set(a.horizon).lerp(sTmp.set(b.horizon), t);
    solarSample.zenith.set(a.zenith).lerp(sTmp.set(b.zenith), t);
    solarSample.tint.set(a.tint).lerp(sTmp.set(b.tint), t);
    solarSample.night = THREE.MathUtils.lerp(a.night, b.night, t);
    return solarSample;
}

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
                // 太阳光晕（仅白天/晨昏可见，入夜彻底隐藏避免夜空出现太阳光斑）
                float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
                float sunVis = clamp(1.0 - smoothstep(0.35, 0.85, uDusk), 0.0, 1.0);
                col += uSunColor * (pow(sunDot, 12.0) * 0.25 + pow(sunDot, 140.0) * 0.75) * sunVis;
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
    // 供草叶、角色与外景共享的实时光照与色温快照
    const lightState = {
        nightBlend: 0,
        sunsetBlend: 0,
        dawnBlend: 0,
        duskMix: 0,
        sunIntensity: 1.5,
        hemiIntensity: 0.7,
        hemiSkyColor: new THREE.Color('#fff7e8'),
        hemiGroundColor: new THREE.Color('#5a7d3e'),
        sunColor: new THREE.Color('#fffdf6'),
        timeTint: new THREE.Color('#ffffff'),
        directTint: new THREE.Color('#ffffff'),
        sunDir: new THREE.Vector3(0.4, 0.85, 0.35).normalize()
    };
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
        const solar = sampleSolarCycle(dayPhase);
        const nightBlend = Math.max(solar.night, p.dusk * 0.65);
        const sunsetBlend = Math.max(0, -dayCos) * (1 - nightBlend * 0.45);
        const dawnBlend = Math.max(0, dayCos) * (1 - nightBlend);
        const duskMix = Math.min(1, Math.max(p.dusk, (nightBlend * 0.96 + sunsetBlend * 0.45) * (1 - p.dusk) + p.dusk));

        skyUniforms.uTime.value = time;
        const skySolarFade = (1 - p.dusk) * (p.season === 'winter' ? 0.48 : 0.85);
        skyUniforms.uZenith.value.set(p.skyZenith)
            .lerp(solar.zenith, (sunsetBlend * 0.65 + dawnBlend * 0.22) * skySolarFade)
            .lerp(solar.zenith, nightBlend * 0.92);
        skyUniforms.uHorizon.value.set(p.skyHorizon)
            .lerp(solar.horizon, (dawnBlend * 0.55 + sunsetBlend * 0.72) * skySolarFade)
            .lerp(solar.horizon, nightBlend * 0.88);
        // 主光色彩跟随现实 24h 日光光谱连续演变，阴雨云层仅柔化饱和度而不遮蔽时变方向
        const solarWeight = 1 - p.cloudCover * 0.38;
        skyUniforms.uSunColor.value.set(p.sunColor).lerp(solar.sun, solarWeight);
        skyUniforms.uDusk.value = duskMix;
        skyUniforms.uFlash.value = flashVal;

        // 主平行光白天随太阳移动；入夜后平滑转向与天空中月亮一致的方位，照射银蓝轮廓光与统一地面月影
        const moonPosX = -14 + dayCos * 10;
        const moonPosY = 22 + nightBlend * 6;
        const moonPosZ = -24;
        const sunPosX = dayCos * 28;
        const sunPosY = THREE.MathUtils.clamp(
            THREE.MathUtils.lerp(13, Math.max(24, Math.tan(THREE.MathUtils.degToRad(p.sunElevation)) * 16), Math.max(0, daySin)),
            12, 34
        );
        const sunPosZ = 16;
        sunLight.position.set(
            THREE.MathUtils.lerp(sunPosX, moonPosX, nightBlend),
            THREE.MathUtils.lerp(sunPosY, moonPosY, nightBlend),
            THREE.MathUtils.lerp(sunPosZ, moonPosZ, nightBlend)
        );
        skyUniforms.uSunDir.value.set(sunPosX, sunPosY, sunPosZ).normalize();
        skyUniforms.uMoonDir.value.set(moonPosX, moonPosY, moonPosZ).normalize();

        sunLight.color.copy(skyUniforms.uSunColor.value);
        const dayLightInt = p.sunIntensity * (1 - sunsetBlend * 0.16);
        sunLight.intensity = THREE.MathUtils.lerp(dayLightInt, Math.min(0.76, Math.max(0.62, p.sunIntensity * 0.34)), nightBlend) + flashVal * 3.5;
        // 夜晚转为柔和前向夜空漫反射补光并明显压低半球环境光，让地面与草叶真正进入月夜暗调
        moonLight.position.set(14, 15, 20);
        moonLight.intensity = duskMix * 0.24;
        const snowMix = THREE.MathUtils.clamp(p.snowCover || 0, 0, 1);
        hemiLight.intensity = Math.max(0.42, THREE.MathUtils.lerp(p.hemiIntensity + sunsetBlend * 0.08, 0.44, nightBlend)) + snowMix * 0.18;
        hemiLight.color.set('#fff7e8').lerp(solar.sun, 0.35).lerp(cB.set('#5d7dc2'), duskMix * 0.82);
        hemiLight.groundColor.set('#5a7d3e').lerp(cB.set('#1c2648'), duskMix * 0.82);
        if (snowMix > 0.01) {
            // 冬季 24 小时雪地高反照率漫反射（早/中/晚跟随日光与地平线，夜晚呈清亮银蓝月光反光）
            cA.copy(skyUniforms.uHorizon.value).lerp(solar.sun, 0.45).lerp(cB.set('#6e8ac4'), nightBlend * 0.65);
            hemiLight.groundColor.lerp(cA, snowMix * 0.85);
        }

        // 同步草地、角色与外景 24h 时变色温、主光方向及 PBR 物理光源参数
        lightState.nightBlend = nightBlend;
        lightState.sunsetBlend = sunsetBlend;
        lightState.dawnBlend = dawnBlend;
        lightState.duskMix = duskMix;
        lightState.sunIntensity = sunLight.intensity;
        lightState.hemiIntensity = hemiLight.intensity;
        lightState.hemiSkyColor.copy(hemiLight.color);
        lightState.hemiGroundColor.copy(hemiLight.groundColor);
        lightState.sunColor.copy(skyUniforms.uSunColor.value);
        lightState.timeTint.copy(solar.tint);
        if (p.dusk > 0) lightState.timeTint.lerp(cB.set('#283a70'), p.dusk * 0.65);
        lightState.directTint.copy(skyUniforms.uSunColor.value);
        lightState.sunDir.copy(sunLight.position).normalize();

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
        getLightState: () => lightState,
        update,
        dispose() {
            scene.remove(group, sunLight, hemiLight);
            scene.fog = null;
            for (const d of disposables) d?.dispose?.();
        }
    };
}
