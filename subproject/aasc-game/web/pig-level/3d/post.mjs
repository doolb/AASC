// 轻量屏幕后期与性能分档管理器：暗角 + 暖色调分级 + 柔光，自动监测帧率降档。
import * as THREE from '../vendor/three.module.min.js';

export const TIERS = ['high', 'medium', 'low'];

// 检测是否为软件光栅 WebGL（如无头测试 SwiftShader / llvmpipe）。
export function isSoftwareWebGL(renderer = null) {
    try {
        const gl = renderer?.getContext?.();
        if (!gl) return false;
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const name = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
        return /SwiftShader|llvmpipe|Software|Mesa OffScreen/i.test(name);
    } catch (_) { return false; }
}

// 根据设备硬件、URL 参数与渲染器（软光栅降级为 low；高分手机保持 medium 不按像素强降 low）初判画质档位。
export function detectInitialTier(renderer = null) {
    try {
        const param = new URLSearchParams(location.search).get('tier');
        if (TIERS.includes(param)) return param;
        if (isSoftwareWebGL(renderer)) return 'low';
    } catch (_) {}
    const cores = navigator.hardwareConcurrency || 4;
    const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '');
    // 非 HTTPS 局域网环境浏览器会隐藏 navigator.deviceMemory，对多核桌面端按 8GB 处理以免误降 medium
    const mem = navigator.deviceMemory || (!isMobile && cores > 4 ? 8 : 4);
    if (mem <= 2 || (isMobile && cores <= 2)) return 'low';
    if (isMobile || cores <= 4 || mem <= 4) return 'medium';
    return 'high';
}

// 依据当前画质档位计算清晰的像素比，保留手机端高分屏（2x/3x DPR）清晰度而不退化为 1x 糊屏。
function computePixelRatio(tier, isSoftware) {
    if (isSoftware) return 0.6;
    const deviceDpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const maxDpr = tier === 'high' ? 2.5 : tier === 'medium' ? 2.0 : 1.75;
    return Math.min(deviceDpr, maxDpr);
}

export function createPostPipeline(renderer, initialTier = 'high', onTierChange = null, isSoftware = false) {
    let mode = 'auto';
    let tier = TIERS.includes(initialTier) ? initialTier : 'high';
    let target = null;
    let width = 1;
    let height = 1;
    let pixelRatio = 1;

    const postScene = new THREE.Scene();
    const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadGeo = new THREE.PlaneGeometry(2, 2);
    const uniforms = {
        uTex: { value: null },
        uBloom: { value: tier === 'high' ? 0.16 : 0.0 },
        uVignette: { value: 0.24 },
        uResolution: { value: new THREE.Vector2(1, 1) }
    };
    const quadMat = new THREE.ShaderMaterial({
        uniforms,
        depthTest: false,
        depthWrite: false,
        vertexShader: /* glsl */`
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position.xy, 0.0, 1.0);
            }
        `,
        fragmentShader: /* glsl */`
            uniform sampler2D uTex;
            uniform float uBloom;
            uniform float uVignette;
            uniform vec2 uResolution;
            varying vec2 vUv;
            void main() {
                vec4 col = texture2D(uTex, vUv);
                if (uBloom > 0.001) {
                    vec2 px = 2.5 / uResolution;
                    vec3 acc = vec3(0.0);
                    acc += texture2D(uTex, vUv + vec2(px.x, 0.0)).rgb;
                    acc += texture2D(uTex, vUv - vec2(px.x, 0.0)).rgb;
                    acc += texture2D(uTex, vUv + vec2(0.0, px.y)).rgb;
                    acc += texture2D(uTex, vUv - vec2(0.0, px.y)).rgb;
                    acc *= 0.25;
                    float luma = dot(acc, vec3(0.299, 0.587, 0.114));
                    col.rgb += max(acc - vec3(0.72), vec3(0.0)) * smoothstep(0.65, 1.0, luma) * uBloom;
                }
                // 轻微暗角 + 温和对比度微调，并执行 ACESFilmic 色调映射与线性→sRGB 输出转换，保持与 low 档一致的柔和色彩
                float dist = length(vUv - 0.5);
                col.rgb *= 1.0 - smoothstep(0.48, 0.92, dist) * (uVignette * 0.45);
                float luma2 = dot(col.rgb, vec3(0.299, 0.587, 0.114));
                col.rgb = mix(vec3(luma2), col.rgb, 1.0);
                col.rgb = mix(col.rgb, smoothstep(0.0, 1.0, col.rgb), 0.08);
                gl_FragColor = col;
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `
    });
    postScene.add(new THREE.Mesh(quadGeo, quadMat));

    function ensureTarget() {
        const w = Math.max(1, Math.round(width * pixelRatio));
        const h = Math.max(1, Math.round(height * pixelRatio));
        uniforms.uResolution.value.set(w, h);
        if (tier === 'low') {
            if (target) { target.dispose(); target = null; }
            return;
        }
        if (!target || target.width !== w || target.height !== h) {
            if (target) target.dispose();
            target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
            uniforms.uTex.value = target.texture;
        }
    }

    function applyTier(nextTier) {
        if (!TIERS.includes(nextTier) || nextTier === tier) return;
        tier = nextTier;
        pixelRatio = computePixelRatio(tier, isSoftware);
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(width, height, false);
        renderer.shadowMap.enabled = tier !== 'low';
        uniforms.uBloom.value = tier === 'high' ? 0.16 : 0;
        ensureTarget();
        onTierChange?.(tier);
    }

    function resize(w, h) {
        width = Math.max(1, w);
        height = Math.max(1, h);
        pixelRatio = computePixelRatio(tier, isSoftware);
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(width, height, false);
        ensureTarget();
    }

    // 帧率监测（自动模式每 2.5 秒统计一次，连续 2 个周期低于 38fps 且非刚切回窗口时才降一档，防止切换/加载抖动误降）
    let frames = 0;
    let elapsed = 0;
    let lastFps = 60;
    let lowFpsStreak = 0;
    let skipWindow = true; // 跳过首轮着色器编译期窗口

    function resetFpsMonitor() {
        frames = 0;
        elapsed = 0;
        lowFpsStreak = 0;
        skipWindow = true;
    }

    function recordFrame(dt) {
        frames += 1;
        elapsed += dt;
        if (elapsed >= 2.5) {
            lastFps = Math.round(frames / elapsed);
            frames = 0;
            elapsed = 0;
            if (skipWindow) {
                skipWindow = false;
                return;
            }
            if (mode === 'auto') {
                if (lastFps < 38) {
                    lowFpsStreak += 1;
                    if (lowFpsStreak >= 2) {
                        lowFpsStreak = 0;
                        if (tier === 'high') applyTier('medium');
                        else if (tier === 'medium') applyTier('low');
                    }
                } else if (lastFps >= 44) {
                    lowFpsStreak = 0;
                }
            }
        }
    }

    function renderScene(scene, camera) {
        if (tier === 'low' || !target) {
            renderer.setRenderTarget(null);
            renderer.clear();
            renderer.render(scene, camera);
            return;
        }
        renderer.setRenderTarget(target);
        renderer.clear();
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        renderer.render(postScene, postCam);
    }

    return {
        resize,
        renderScene,
        recordFrame,
        resetFpsMonitor,
        setQualityMode(nextMode) {
            mode = nextMode;
            if (TIERS.includes(nextMode)) applyTier(nextMode);
        },
        getQualityMode: () => mode,
        getTier: () => tier,
        getFps: () => lastFps,
        dispose() {
            if (target) target.dispose();
            quadGeo.dispose();
            quadMat.dispose();
        }
    };
}
