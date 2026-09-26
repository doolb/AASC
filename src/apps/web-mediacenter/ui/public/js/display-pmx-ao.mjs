/*
 * PMX 的屏幕空间环境遮蔽。保留原场景的 RGBA 色彩，在低分辨率深度采样后
 * 只调暗已绘制像素的 RGB；透明舞台的 alpha 由原场景直接传到最终画布。
 */
import { calculatePmxAoSize } from './display-pmx-ao-size.mjs';

const FULLSCREEN_VERTEX = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const AO_FRAGMENT = `
uniform sampler2D tDepth;
uniform vec2 fullResolution;
uniform mat4 inverseProjection;
uniform mat4 projection;
uniform float radius;
uniform int sampleCount;
varying vec2 vUv;

vec3 viewPosition(vec2 uv, float depth) {
    vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = inverseProjection * clip;
    return view.xyz / view.w;
}

void main() {
    float centerDepth = texture2D(tDepth, vUv).r;
    if (centerDepth >= 0.99999) {
        gl_FragColor = vec4(1.0);
        return;
    }

    vec3 center = viewPosition(vUv, centerDepth);
    vec2 onePixel = 1.0 / fullResolution;
    float rightDepth = texture2D(tDepth, vUv + vec2(onePixel.x, 0.0)).r;
    float leftDepth = texture2D(tDepth, vUv - vec2(onePixel.x, 0.0)).r;
    float topDepth = texture2D(tDepth, vUv + vec2(0.0, onePixel.y)).r;
    float bottomDepth = texture2D(tDepth, vUv - vec2(0.0, onePixel.y)).r;
    vec3 tangentX = abs(rightDepth - centerDepth) < abs(leftDepth - centerDepth)
        ? viewPosition(vUv + vec2(onePixel.x, 0.0), rightDepth) - center
        : center - viewPosition(vUv - vec2(onePixel.x, 0.0), leftDepth);
    vec3 tangentY = abs(topDepth - centerDepth) < abs(bottomDepth - centerDepth)
        ? viewPosition(vUv + vec2(0.0, onePixel.y), topDepth) - center
        : center - viewPosition(vUv - vec2(0.0, onePixel.y), bottomDepth);
    vec3 normal = normalize(cross(tangentX, tangentY));
    if (normal.z < 0.0) normal = -normal;

    float radiusPixels = clamp(radius * projection[1][1] * fullResolution.y
        / max(-center.z * 2.0, 0.01), 2.0, 48.0);
    float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float occlusion = 0.0;
    for (int i = 0; i < 32; i++) {
        if (i >= sampleCount) break;
        float sampleIndex = float(i);
        float angle = noise * 6.2831853 + sampleIndex * 2.3999632;
        float sampleRadius = sqrt((sampleIndex + 0.5) / float(sampleCount));
        vec2 offset = vec2(cos(angle), sin(angle)) * sampleRadius * radiusPixels / fullResolution;
        vec2 sampleUv = clamp(vUv + offset, vec2(0.001), vec2(0.999));
        float sampleDepth = texture2D(tDepth, sampleUv).r;
        if (sampleDepth >= 0.99999) continue;
        vec3 delta = viewPosition(sampleUv, sampleDepth) - center;
        float distanceToSample = length(delta);
        float facing = dot(normal, delta) / max(distanceToSample, 0.0001);
        float rangeWeight = 1.0 - smoothstep(0.0, radius, distanceToSample);
        occlusion += smoothstep(0.08, 0.3, facing) * rangeWeight;
    }
    float visibility = 1.0 - min(0.6, occlusion * (8.0 / float(sampleCount)));
    gl_FragColor = vec4(vec3(visibility), 1.0);
}`;

// 每轮在 AO 图上做水平/垂直保边模糊；每轮半径独立，深度差越大权重越低，
// 避免衣袖、发丝轮廓和背后的身体被同一团 AO 污染。
const BLUR_FRAGMENT = `
uniform sampler2D tAo;
uniform sampler2D tDepth;
uniform vec2 aoResolution;
uniform vec2 direction;
uniform mat4 inverseProjection;
uniform float radius;
uniform int blurRadiusPixels;
varying vec2 vUv;

float viewDistance(vec2 uv, float depth) {
    vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = inverseProjection * clip;
    return -view.z / view.w;
}

void main() {
    float centerDepth = texture2D(tDepth, vUv).r;
    if (centerDepth >= 0.99999) {
        gl_FragColor = vec4(1.0);
        return;
    }
    float centerDistance = viewDistance(vUv, centerDepth);
    float sum = texture2D(tAo, vUv).r * 0.2;
    float weight = 0.2;
    vec2 texel = direction / aoResolution;
    for (int i = 1; i <= 5; i++) {
        if (i > blurRadiusPixels) break;
        float spatialWeight = i == 1 ? 0.16 : (i == 2 ? 0.11 : (i == 3 ? 0.06 : (i == 4 ? 0.03 : 0.015)));
        for (int side = -1; side <= 1; side += 2) {
            vec2 sampleUv = clamp(vUv + texel * float(i * side), vec2(0.001), vec2(0.999));
            float sampleDepth = texture2D(tDepth, sampleUv).r;
            if (sampleDepth >= 0.99999) continue;
            float distanceGap = abs(viewDistance(sampleUv, sampleDepth) - centerDistance);
            float edgeScale = max(radius * 0.2, 0.005);
            float edgeWeight = exp(-pow(distanceGap / edgeScale, 2.0));
            float sampleWeight = spatialWeight * edgeWeight;
            sum += texture2D(tAo, sampleUv).r * sampleWeight;
            weight += sampleWeight;
        }
    }
    gl_FragColor = vec4(vec3(sum / weight), 1.0);
}`;

const COMPOSITE_FRAGMENT = `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tAo;
uniform vec2 aoResolution;
uniform mat4 inverseProjection;
uniform float radius;
uniform vec3 aoColor;
uniform float intensity;
varying vec2 vUv;

float viewDistance(vec2 uv, float depth) {
    vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = inverseProjection * clip;
    return -view.z / view.w;
}

void main() {
    vec4 color = texture2D(tColor, vUv);
    float depth = texture2D(tDepth, vUv).r;
    if (color.a <= 0.001 || depth >= 0.99999) {
        gl_FragColor = color;
    } else {
        float centerDistance = viewDistance(vUv, depth);
        vec2 texel = 1.0 / aoResolution;
        float sum = 0.0;
        float weight = 0.0;
        for (int i = 0; i < 5; i++) {
            vec2 offset = vec2(0.0);
            if (i == 1) offset = vec2(texel.x, 0.0);
            if (i == 2) offset = vec2(-texel.x, 0.0);
            if (i == 3) offset = vec2(0.0, texel.y);
            if (i == 4) offset = vec2(0.0, -texel.y);
            vec2 sampleUv = clamp(vUv + offset, vec2(0.001), vec2(0.999));
            float sampleDepth = texture2D(tDepth, sampleUv).r;
            if (sampleDepth >= 0.99999) continue;
            float distanceGap = abs(viewDistance(sampleUv, sampleDepth) - centerDistance);
            float sampleWeight = 1.0 - smoothstep(radius * 0.2, radius * 0.8, distanceGap);
            sum += texture2D(tAo, sampleUv).r * sampleWeight;
            weight += sampleWeight;
        }
        float visibility = weight > 0.0 ? sum / weight : 1.0;
        float amount = clamp((1.0 - visibility) * intensity, 0.0, 1.0);
        gl_FragColor = vec4(color.rgb * mix(vec3(1.0), aoColor, amount), color.a);
    }
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;

export function createPmxAmbientOcclusion({ THREE, renderer, scene, camera }) {
    const supported = renderer.capabilities.isWebGL2 === true;
    let enabled = true;
    let resolutionMode = 'half';
    let radius = 0.1;
    let sampleCount = 24;
    let blurPassCount = 1;
    let blurRadii = [3, 3, 3];
    let intensity = 1;
    const aoColor = new THREE.Color(0x000000);
    let fullWidth = 1;
    let fullHeight = 1;
    let resources = null;

    const createResources = () => {
        if (resources || !supported) return;
        const depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
        depthTexture.format = THREE.DepthFormat;
        const colorTarget = new THREE.WebGLRenderTarget(1, 1, {
            depthBuffer: true,
            depthTexture,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter
        });
        const aoTarget = new THREE.WebGLRenderTarget(1, 1, {
            depthBuffer: false,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter
        });
        const blurTarget = aoTarget.clone();
        const aoMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tDepth: { value: depthTexture },
                fullResolution: { value: new THREE.Vector2() },
                inverseProjection: { value: camera.projectionMatrixInverse },
                projection: { value: camera.projectionMatrix },
                radius: { value: radius },
                sampleCount: { value: sampleCount }
            },
            vertexShader: FULLSCREEN_VERTEX,
            fragmentShader: AO_FRAGMENT,
            depthTest: false,
            depthWrite: false,
            blending: THREE.NoBlending,
            toneMapped: false
        });
        const blurMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tAo: { value: aoTarget.texture },
                tDepth: { value: depthTexture },
                aoResolution: { value: new THREE.Vector2() },
                direction: { value: new THREE.Vector2(1, 0) },
                inverseProjection: { value: camera.projectionMatrixInverse },
                radius: { value: radius },
                blurRadiusPixels: { value: 3 }
            },
            vertexShader: FULLSCREEN_VERTEX,
            fragmentShader: BLUR_FRAGMENT,
            depthTest: false,
            depthWrite: false,
            blending: THREE.NoBlending,
            toneMapped: false
        });
        const compositeMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tColor: { value: colorTarget.texture },
                tDepth: { value: depthTexture },
                tAo: { value: aoTarget.texture },
                aoResolution: { value: new THREE.Vector2() },
                inverseProjection: { value: camera.projectionMatrixInverse },
                radius: { value: radius },
                aoColor: { value: aoColor },
                intensity: { value: intensity }
            },
            vertexShader: FULLSCREEN_VERTEX,
            fragmentShader: COMPOSITE_FRAGMENT,
            depthTest: false,
            depthWrite: false,
            blending: THREE.NoBlending,
            toneMapped: true
        });
        const geometry = new THREE.PlaneGeometry(2, 2);
        const quad = new THREE.Mesh(geometry, aoMaterial);
        const passScene = new THREE.Scene();
        passScene.add(quad);
        const passCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        resources = { depthTexture, colorTarget, aoTarget, blurTarget, aoMaterial, blurMaterial, compositeMaterial,
            geometry, quad, passScene, passCamera };
        resize(fullWidth, fullHeight);
    };

    const resize = (width, height) => {
        fullWidth = Math.max(1, Math.floor(Number(width) || 1));
        fullHeight = Math.max(1, Math.floor(Number(height) || 1));
        if (!resources) return;
        const aoSize = calculatePmxAoSize(fullWidth, fullHeight, resolutionMode);
        resources.colorTarget.setSize(fullWidth, fullHeight);
        resources.aoTarget.setSize(aoSize.width, aoSize.height);
        resources.blurTarget.setSize(aoSize.width, aoSize.height);
        resources.aoMaterial.uniforms.fullResolution.value.set(fullWidth, fullHeight);
        resources.blurMaterial.uniforms.aoResolution.value.set(aoSize.width, aoSize.height);
        resources.compositeMaterial.uniforms.aoResolution.value.set(aoSize.width, aoSize.height);
    };

    const render = () => {
        if (!enabled || !supported) {
            renderer.render(scene, camera);
            return;
        }
        createResources();
        const previousTarget = renderer.getRenderTarget();
        try {
            resources.aoMaterial.uniforms.radius.value = radius;
            resources.aoMaterial.uniforms.sampleCount.value = sampleCount;
            resources.blurMaterial.uniforms.radius.value = radius;
            resources.compositeMaterial.uniforms.radius.value = radius;
            resources.compositeMaterial.uniforms.intensity.value = intensity;
            renderer.setRenderTarget(resources.colorTarget);
            renderer.clear();
            renderer.render(scene, camera);
            resources.quad.material = resources.aoMaterial;
            renderer.setRenderTarget(resources.aoTarget);
            renderer.clear();
            renderer.render(resources.passScene, resources.passCamera);
            if (blurPassCount > 0) {
                resources.quad.material = resources.blurMaterial;
                for (let passIndex = 0; passIndex < blurPassCount; passIndex++) {
                    resources.blurMaterial.uniforms.blurRadiusPixels.value = blurRadii[passIndex];
                    resources.blurMaterial.uniforms.tAo.value = resources.aoTarget.texture;
                    resources.blurMaterial.uniforms.direction.value.set(1, 0);
                    renderer.setRenderTarget(resources.blurTarget);
                    renderer.clear();
                    renderer.render(resources.passScene, resources.passCamera);
                    resources.blurMaterial.uniforms.tAo.value = resources.blurTarget.texture;
                    resources.blurMaterial.uniforms.direction.value.set(0, 1);
                    renderer.setRenderTarget(resources.aoTarget);
                    renderer.clear();
                    renderer.render(resources.passScene, resources.passCamera);
                }
            }
            resources.quad.material = resources.compositeMaterial;
            renderer.setRenderTarget(previousTarget);
            renderer.clear();
            renderer.render(resources.passScene, resources.passCamera);
        } finally {
            renderer.setRenderTarget(previousTarget);
        }
    };

    const setEnabled = (value) => { enabled = value === true; };
    const setResolution = (value) => {
        const nextMode = value === 'full' ? 'full' : 'half';
        if (nextMode === resolutionMode) return;
        resolutionMode = nextMode;
        // 色彩/深度目标维持原画布尺寸，只重设 AO 与模糊目标的采样尺寸。
        resize(fullWidth, fullHeight);
    };
    const setColor = (value) => { aoColor.set(value); };
    const setIntensity = (value) => {
        if (Number.isFinite(value)) intensity = Math.min(2, Math.max(0, value));
    };
    const setRadius = (value) => {
        if (Number.isFinite(value) && value > 0) radius = value;
    };
    const setSampleCount = (value) => {
        if ([12, 24, 32].includes(value)) sampleCount = value;
    };
    const setBlurPasses = (count, radii) => {
        if (!Number.isInteger(count) || count < 0 || count > 3 || !Array.isArray(radii)) return;
        blurPassCount = count;
        blurRadii = [0, 1, 2].map((index) => {
            const value = radii[index];
            return Number.isInteger(value) ? Math.min(5, Math.max(1, value)) : 3;
        });
    };
    const dispose = () => {
        if (!resources) return;
        resources.colorTarget.dispose();
        resources.aoTarget.dispose();
        resources.blurTarget.dispose();
        resources.depthTexture.dispose();
        resources.aoMaterial.dispose();
        resources.blurMaterial.dispose();
        resources.compositeMaterial.dispose();
        resources.geometry.dispose();
        resources = null;
    };

    return Object.freeze({ supported, resize, render, setEnabled, setResolution,
        setColor, setIntensity, setRadius, setSampleCount, setBlurPasses, dispose });
}
