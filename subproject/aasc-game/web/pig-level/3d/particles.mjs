// 统一粒子系统：草屑、花瓣、落叶、扬尘、雨丝+涟漪、雪花、萤火虫、蝴蝶、烟花、爆炸。
import * as THREE from '../vendor/three.module.min.js';

const KIND = { DOT: 0, PETAL: 1, LEAF: 2, SNOW: 3 };

export function createParticles(scene, textures, tier = 'high') {
    const cap = tier === 'high' ? 6000 : tier === 'medium' ? 3200 : 1400;
    const positions = new Float32Array(cap * 3);
    const colors = new Float32Array(cap * 3);
    const sizes = new Float32Array(cap);
    const kinds = new Float32Array(cap);
    const alphas = new Float32Array(cap);

    const vx = new Float32Array(cap);
    const vy = new Float32Array(cap);
    const vz = new Float32Array(cap);
    const life = new Float32Array(cap);
    const maxLife = new Float32Array(cap);
    const grav = new Float32Array(cap);
    const swayAmp = new Float32Array(cap);
    let cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

    const atlas = textures.particleAtlas();
    const uniforms = { uAtlas: { value: atlas }, uScale: { value: 420 } };

    const material = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        vertexShader: /* glsl */`
            attribute vec3 aColor;
            attribute float aSize;
            attribute float aKind;
            attribute float aAlpha;
            uniform float uScale;
            varying vec3 vColor;
            varying float vKind;
            varying float vAlpha;
            void main() {
                vColor = aColor;
                vKind = aKind;
                vAlpha = aAlpha;
                if (aAlpha <= 0.01) {
                    gl_PointSize = 0.0;
                    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                    return;
                }
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = aSize * (uScale / max(1.0, -mv.z));
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: /* glsl */`
            uniform sampler2D uAtlas;
            varying vec3 vColor;
            varying float vKind;
            varying float vAlpha;
            void main() {
                if (vAlpha <= 0.01) discard;
                float col = mod(floor(vKind + 0.5), 2.0);
                float row = floor((vKind + 0.5) / 2.0);
                // CanvasTexture flipY=true，底部在 v=0，顶行对应 v in [0.5, 1]。
                vec2 uv = gl_PointCoord * 0.5 + vec2(col * 0.5, (1.0 - row) * 0.5);
                vec4 tex = texture2D(uAtlas, uv);
                float a = tex.a * vAlpha;
                if (a <= 0.02) discard;
                gl_FragColor = vec4(vColor * tex.rgb, a);
            }
        `
    });

    const points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    scene.add(points);

    // 地面雨滴涟漪（轻量环实例）
    const rippleCap = tier === 'low' ? 20 : 60;
    const rippleGeo = new THREE.RingGeometry(0.18, 0.24, 16);
    rippleGeo.rotateX(-Math.PI / 2);
    const rippleMat = new THREE.MeshBasicMaterial({ color: '#dbeeff', transparent: true, opacity: 0.45, depthWrite: false });
    const rippleInst = new THREE.InstancedMesh(rippleGeo, rippleMat, rippleCap);
    rippleInst.frustumCulled = false;
    const rippleLife = new Float32Array(rippleCap);
    const ripplePos = new Float32Array(rippleCap * 2);
    let rippleCursor = 0;
    const dummy = new THREE.Object3D();
    scene.add(rippleInst);

    const cTmp = new THREE.Color();
    function emit(x, y, z, velX, velY, velZ, colorHex, size, ttl, kind = KIND.DOT, gravity = -3.5, sway = 0) {
        const i = cursor;
        cursor = (cursor + 1) % cap;
        positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
        vx[i] = velX; vy[i] = velY; vz[i] = velZ;
        cTmp.set(colorHex);
        colors[i * 3] = cTmp.r; colors[i * 3 + 1] = cTmp.g; colors[i * 3 + 2] = cTmp.b;
        sizes[i] = size;
        kinds[i] = kind;
        life[i] = ttl;
        maxLife[i] = ttl;
        grav[i] = gravity;
        swayAmp[i] = sway;
        alphas[i] = 1;
    }

    function spawnRipple(x, z) {
        const i = rippleCursor;
        rippleCursor = (rippleCursor + 1) % rippleCap;
        ripplePos[i * 2] = x;
        ripplePos[i * 2 + 1] = z;
        rippleLife[i] = 0.55;
    }

    function burstGrass(x, z, season = 'spring') {
        const palette = season === 'autumn' ? ['#d98c36', '#e6b84c', '#c95a2b'] : season === 'winter' ? ['#ffffff', '#dcebf7'] : ['#9ad468', '#ffd2e4', '#fff2a6'];
        const kind = season === 'autumn' ? KIND.LEAF : season === 'winter' ? KIND.SNOW : KIND.PETAL;
        for (let i = 0; i < 18; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 0.8 + Math.random() * 1.8;
            emit(x, 0.15, z, Math.cos(a) * sp, 1.4 + Math.random() * 1.6, Math.sin(a) * sp, palette[i % palette.length], 0.42 + Math.random() * 0.3, 0.75 + Math.random() * 0.45, i % 3 === 0 ? kind : KIND.DOT, -4.5, 0.4);
        }
    }

    function burstDust(x, z) {
        for (let i = 0; i < 8; i++) {
            emit(x + (Math.random() - 0.5) * 0.4, 0.12, z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.5, (Math.random() - 0.5) * 0.8, '#e8e0cf', 0.45 + Math.random() * 0.25, 0.45, KIND.DOT, 0.2, 0.1);
        }
    }

    // 冲刺尾迹：离场加速时向反方向喷出白金速度烟尘与闪光。
    function burstDash(x, z, dirX, dirZ) {
        for (let i = 0; i < 6; i++) {
            const spread = (Math.random() - 0.5) * 0.9;
            emit(
                x - dirX * 0.35 + (Math.random() - 0.5) * 0.3,
                0.22 + Math.random() * 0.2,
                z - dirZ * 0.35 + (Math.random() - 0.5) * 0.3,
                -dirX * (1.2 + Math.random() * 1.4) + spread,
                0.5 + Math.random() * 0.7,
                -dirZ * (1.2 + Math.random() * 1.4) + spread,
                i % 2 === 0 ? '#fff6d1' : '#ffffff',
                0.42 + Math.random() * 0.28,
                0.42,
                KIND.DOT,
                0.15,
                0.2
            );
        }
    }

    // 障碍碰撞火花：撞停或受阻撞击时在鼻尖位置溅起漫画感星点与灰尘。
    function burstImpact(x, y, z) {
        const cols = ['#ffd24c', '#ff824d', '#ffffff'];
        for (let i = 0; i < 16; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 1.0 + Math.random() * 2.1;
            emit(x, y, z, Math.cos(a) * sp, 0.9 + Math.random() * 1.6, Math.sin(a) * sp, cols[i % cols.length], 0.38 + Math.random() * 0.24, 0.42 + Math.random() * 0.2, KIND.DOT, -4.0, 0);
        }
    }

    function burstSpark(x, y, z, color = '#ffd95b', count = 24) {
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 1.2 + Math.random() * 2.8;
            emit(x, y, z, Math.cos(a) * sp, 1.0 + Math.random() * 2.5, Math.sin(a) * sp, color, 0.36 + Math.random() * 0.28, 0.65 + Math.random() * 0.4, KIND.DOT, -3.0, 0);
        }
    }

    function burstFireworks() {
        const colorsList = ['#ff6b8b', '#ffd95b', '#5ff2ff', '#9af57a', '#c996ff'];
        for (let b = 0; b < 5; b++) {
            const bx = (Math.random() - 0.5) * 10;
            const by = 4.5 + Math.random() * 3.5;
            const bz = (Math.random() - 0.5) * 8;
            const col = colorsList[b % colorsList.length];
            for (let i = 0; i < 40; i++) {
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);
                const sp = 2.5 + Math.random() * 3.5;
                emit(bx, by, bz, Math.sin(phi) * Math.cos(theta) * sp, Math.cos(phi) * sp + 1.2, Math.sin(phi) * Math.sin(theta) * sp, col, 0.52, 1.3 + Math.random() * 0.6, KIND.DOT, -2.5, 0.15);
            }
        }
    }

    function burstExplosion(x, z) {
        const cols = ['#ff5130', '#ffaa33', '#362d2a', '#ffe382'];
        for (let i = 0; i < 90; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 1.8 + Math.random() * 5.2;
            emit(x, 0.5, z, Math.cos(a) * sp, 2.0 + Math.random() * 4.5, Math.sin(a) * sp, cols[i % cols.length], 0.6 + Math.random() * 0.55, 0.9 + Math.random() * 0.5, KIND.DOT, -5.5, 0);
        }
    }

    let weatherAcc = 0;
    function update(dt, time, preset, viewportHeight = 800) {
        uniforms.uScale.value = viewportHeight * 0.55;
        if (preset) {
            const tierScale = tier === 'high' ? 1 : tier === 'medium' ? 0.55 : 0.25;
            if (preset.precip === 'rain') {
                weatherAcc += dt * 420 * tierScale;
                while (weatherAcc >= 1) {
                    weatherAcc -= 1;
                    const rx = (Math.random() - 0.5) * 32;
                    const rz = (Math.random() - 0.5) * 32;
                    emit(rx, 15, rz, preset.wind * 1.4, -22, 0.5, '#cfe3f7', 0.28, 0.72, KIND.DOT, 0, 0);
                    if (Math.random() < 0.22) spawnRipple(rx, rz);
                }
            } else if (preset.precip === 'snow') {
                weatherAcc += dt * 160 * tierScale;
                while (weatherAcc >= 1) {
                    weatherAcc -= 1;
                    emit((Math.random() - 0.5) * 34, 15, (Math.random() - 0.5) * 34, (Math.random() - 0.5) * 0.7 + preset.wind * 0.4, -2.2 - Math.random() * 1.2, (Math.random() - 0.5) * 0.5, '#ffffff', 0.42 + Math.random() * 0.42, 6.2, KIND.SNOW, 0, 0.9);
                }
            } else if (preset.seasonParticle !== 'none') {
                weatherAcc += dt * 18 * tierScale;
                while (weatherAcc >= 1) {
                    weatherAcc -= 1;
                    const map = {
                        petal: { kind: KIND.PETAL, col: '#ffc9de', size: 0.48 },
                        leaf: { kind: KIND.LEAF, col: Math.random() < 0.5 ? '#e87830' : '#f0b63a', size: 0.55 },
                        pollen: { kind: KIND.DOT, col: preset.ambientLife === 'firefly' ? '#d8ff72' : '#fff8c4', size: 0.34 },
                        sparkle: { kind: KIND.SNOW, col: '#e6f4ff', size: 0.32 }
                    };
                    const cfg = map[preset.seasonParticle] || map.petal;
                    emit((Math.random() - 0.5) * 28, 1.5 + Math.random() * 6, (Math.random() - 0.5) * 28, preset.wind * 0.9 + (Math.random() - 0.5) * 0.4, -0.35 - Math.random() * 0.4, (Math.random() - 0.5) * 0.4, cfg.col, cfg.size, 5.5, cfg.kind, 0, 0.8);
                }
            }
        }

        for (let i = 0; i < cap; i++) {
            if (life[i] <= 0) {
                alphas[i] = 0;
                continue;
            }
            life[i] -= dt;
            if (life[i] <= 0) {
                alphas[i] = 0;
                continue;
            }
            vy[i] += grav[i] * dt;
            const sw = swayAmp[i] ? Math.sin(time * 2.5 + i) * swayAmp[i] * dt : 0;
            positions[i * 3] += vx[i] * dt + sw;
            positions[i * 3 + 1] += vy[i] * dt;
            positions[i * 3 + 2] += vz[i] * dt;
            if (positions[i * 3 + 1] < 0.03) {
                positions[i * 3 + 1] = 0.03;
                vy[i] = Math.abs(vy[i]) * 0.25;
                vx[i] *= 0.6;
                vz[i] *= 0.6;
            }
            alphas[i] = Math.min(1, (life[i] / maxLife[i]) * 2.2);
        }

        geo.attributes.position.needsUpdate = true;
        geo.attributes.aColor.needsUpdate = true;
        geo.attributes.aSize.needsUpdate = true;
        geo.attributes.aKind.needsUpdate = true;
        geo.attributes.aAlpha.needsUpdate = true;

        for (let i = 0; i < rippleCap; i++) {
            if (rippleLife[i] <= 0) {
                dummy.scale.setScalar(0);
            } else {
                rippleLife[i] -= dt;
                const p = 1 - Math.max(0, rippleLife[i]) / 0.55;
                dummy.position.set(ripplePos[i * 2], 0.025, ripplePos[i * 2 + 1]);
                dummy.scale.setScalar(0.3 + p * 1.4);
            }
            dummy.updateMatrix();
            rippleInst.setMatrixAt(i, dummy.matrix);
        }
        rippleInst.instanceMatrix.needsUpdate = true;
    }

    return {
        burstGrass,
        burstDust,
        burstDash,
        burstImpact,
        burstSpark,
        burstFireworks,
        burstExplosion,
        update,
        dispose() {
            scene.remove(points, rippleInst);
            geo.dispose();
            material.dispose();
            rippleGeo.dispose();
            rippleMat.dispose();
        }
    };
}
