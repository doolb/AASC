import { normalizeRenderSettings } from './mmd-render-settings.mjs';
import { createTemporalAA } from './mmd-temporal-aa.mjs';
import { createScreenLighting } from './mmd-screen-lighting.mjs';
import { compositeChunk } from './mmd-screen-lighting-shader.mjs';
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

// 原 AO 和半分辨率缺失样本补算共用角度权重；只改变遮蔽判定，不修改重建法线。
// facing 是采样方向在法线上的投影，即采样方向高出切平面角度的正弦。
const AO_ANGLE_WEIGHT = `
uniform vec2 aoFacingThreshold;
float aoAngleWeight(float facing) {
    return smoothstep(aoFacingThreshold.x, aoFacingThreshold.y, facing);
}
`;

const AO_FRAGMENT = `
uniform highp sampler2D tDepth;
uniform vec2 fullResolution;
uniform vec2 aoResolution;
uniform mat4 inverseProjection;
uniform mat4 projection;
uniform float radius;
uniform int sampleCount;
uniform bool testNormalPreview;
varying vec2 vUv;

${AO_ANGLE_WEIGHT}

vec3 viewPosition(vec2 uv, float depth) {
    vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = inverseProjection * clip;
    return view.xyz / view.w;
}


ivec2 depthPixel(vec2 uv) {
    ivec2 size = textureSize(tDepth, 0);
    return clamp(ivec2(floor(uv * vec2(size))), ivec2(0), size - ivec2(1));
}

vec2 depthPixelUv(ivec2 pixel) {
    return (vec2(pixel) + 0.5) / vec2(textureSize(tDepth, 0));
}


uniform bool testEdgeCorrection;
ivec2 edgeSourcePixel(ivec2 pixel) {
    ivec2 size = textureSize(tDepth, 0);
    ivec2 grid = ivec2(aoResolution);
    pixel = clamp(pixel, ivec2(0), grid - 1);
    return ((pixel * 2 + 1) * size) / (grid * 2);
}
ivec2 edgePixel(vec2 uv) {
    ivec2 size = textureSize(tDepth, 0);
    return clamp(ivec2(floor(uv * vec2(size))), ivec2(0), size - 1);
}
vec2 edgeUv(ivec2 pixel) {
    return (vec2(pixel) + 0.5) / vec2(textureSize(tDepth, 0));
}
vec3 edgePosition(vec2 uv, float depth) {
    vec4 view = inverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return view.xyz / view.w;
}
float edgeDistance(ivec2 pixel, float depth) {
    return -edgePosition(edgeUv(pixel), depth).z;
}
float edgeSlope(ivec2 pixel, ivec2 offset, float centerZ) {
    ivec2 last = textureSize(tDepth, 0) - 1;
    ivec2 plus = clamp(pixel + offset, ivec2(0), last);
    ivec2 minus = clamp(pixel - offset, ivec2(0), last);
    float dp = texelFetch(tDepth, plus, 0).r;
    float dm = texelFetch(tDepth, minus, 0).r;
    bool validPlus = any(notEqual(plus, pixel)) && dp < 0.99999;
    bool validMinus = any(notEqual(minus, pixel)) && dm < 0.99999;
    float forward = edgeDistance(plus, dp) - centerZ;
    float backward = centerZ - edgeDistance(minus, dm);
    if (!validPlus && !validMinus) return 0.0;
    if (!validPlus) return backward;
    if (!validMinus) return forward;
    return abs(forward) < abs(backward) ? forward : backward;
}
vec3 edgeSurface(ivec2 pixel, float depth) {
    vec2 uv = edgeUv(pixel);
    vec3 position = edgePosition(uv, depth);
    vec2 stepUv = 1.0 / vec2(textureSize(tDepth, 0));
    float footprint = max(length(edgePosition(uv + vec2(stepUv.x, 0.0), depth) - position),
        length(edgePosition(uv + vec2(0.0, stepUv.y), depth) - position));
    // 同时考虑 D24 和 highp 浮点读数的一阶量化误差，避免近平面/远平面使用固定世界单位。
    float quantization = max(
        abs(edgeDistance(pixel, min(depth + 1.1920929e-7, 0.99999994)) + position.z),
        abs(edgeDistance(pixel, max(depth - 1.1920929e-7, 0.0)) + position.z));
    float tolerance = max(max(footprint * 0.25, quantization * 8.0), 1e-6 * max(1.0, abs(position.z)));
    return vec3(edgeSlope(pixel, ivec2(1, 0), -position.z),
        edgeSlope(pixel, ivec2(0, 1), -position.z), tolerance);
}
bool edgeMatches(ivec2 pixel, float centerZ, vec3 surface, ivec2 samplePixel) {
    float depth = texelFetch(tDepth, samplePixel, 0).r;
    if (depth >= 0.99999) return false;
    float predicted = centerZ + dot(surface.xy, vec2(samplePixel - pixel));
    return abs(edgeDistance(samplePixel, depth) - predicted) <= surface.z;
}

void main() {
    ivec2 centerPixel = edgeSourcePixel(ivec2(gl_FragCoord.xy));
    vec2 centerUv = depthPixelUv(centerPixel);
    float centerDepth = texelFetch(tDepth, centerPixel, 0).r;
    if (centerDepth >= 0.99999) {
        gl_FragColor = testNormalPreview ? vec4(0.0) : vec4(1.0);
        return;
    }

    vec3 center = viewPosition(centerUv, centerDepth);
    ivec2 lastPixel = textureSize(tDepth, 0) - ivec2(1);
    ivec2 rightPixel = min(centerPixel + ivec2(1, 0), lastPixel);
    ivec2 leftPixel = max(centerPixel - ivec2(1, 0), ivec2(0));
    ivec2 topPixel = min(centerPixel + ivec2(0, 1), lastPixel);
    ivec2 bottomPixel = max(centerPixel - ivec2(0, 1), ivec2(0));
    float rightDepth = texelFetch(tDepth, rightPixel, 0).r;
    float leftDepth = texelFetch(tDepth, leftPixel, 0).r;
    float topDepth = texelFetch(tDepth, topPixel, 0).r;
    float bottomDepth = texelFetch(tDepth, bottomPixel, 0).r;
    bool useRight = centerPixel.x == 0 || (centerPixel.x < lastPixel.x
        && abs(rightDepth - centerDepth) < abs(leftDepth - centerDepth));
    bool useTop = centerPixel.y == 0 || (centerPixel.y < lastPixel.y
        && abs(topDepth - centerDepth) < abs(bottomDepth - centerDepth));
    vec3 tangentX = useRight
        ? viewPosition(depthPixelUv(rightPixel), rightDepth) - center
        : center - viewPosition(depthPixelUv(leftPixel), leftDepth);
    vec3 tangentY = useTop
        ? viewPosition(depthPixelUv(topPixel), topDepth) - center
        : center - viewPosition(depthPixelUv(bottomPixel), bottomDepth);
    vec3 crossNormal = cross(tangentX, tangentY);
    float normalLengthSquared = dot(crossNormal, crossNormal);
    vec3 normal = normalLengthSquared > 1e-20
        ? crossNormal * inversesqrt(normalLengthSquared) : vec3(0.0, 0.0, 1.0);
    if (normal.z < 0.0) normal = -normal;
    if (testNormalPreview) {
        gl_FragColor = vec4(normal * 0.5 + 0.5, 1.0);
        return;
    }

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
        ivec2 samplePixel = depthPixel(centerUv + offset);
        vec2 sampleUv = depthPixelUv(samplePixel);
        float sampleDepth = texelFetch(tDepth, samplePixel, 0).r;
        if (sampleDepth >= 0.99999) continue;
        vec3 delta = viewPosition(sampleUv, sampleDepth) - center;
        float distanceToSample = length(delta);
        float facing = dot(normal, delta) / max(distanceToSample, 0.0001);
        float rangeWeight = 1.0 - smoothstep(0.0, radius, distanceToSample);
        occlusion += aoAngleWeight(facing) * rangeWeight;
    }
    float visibility = 1.0 - min(0.6, occlusion * (8.0 / float(sampleCount)));
    gl_FragColor = vec4(vec3(visibility), 1.0);
}`;

// 每轮在 AO 图上做水平/垂直保边模糊；每轮半径独立，深度差越大权重越低，
// 避免衣袖、发丝轮廓和背后的身体被同一团 AO 污染。
const BLUR_FRAGMENT = `
uniform sampler2D tAo;
uniform highp sampler2D tDepth;
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


uniform bool testEdgeCorrection;
ivec2 edgeSourcePixel(ivec2 pixel) {
    ivec2 size = textureSize(tDepth, 0);
    ivec2 grid = ivec2(aoResolution);
    pixel = clamp(pixel, ivec2(0), grid - 1);
    return ((pixel * 2 + 1) * size) / (grid * 2);
}
ivec2 edgePixel(vec2 uv) {
    ivec2 size = textureSize(tDepth, 0);
    return clamp(ivec2(floor(uv * vec2(size))), ivec2(0), size - 1);
}
vec2 edgeUv(ivec2 pixel) {
    return (vec2(pixel) + 0.5) / vec2(textureSize(tDepth, 0));
}
vec3 edgePosition(vec2 uv, float depth) {
    vec4 view = inverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return view.xyz / view.w;
}
float edgeDistance(ivec2 pixel, float depth) {
    return -edgePosition(edgeUv(pixel), depth).z;
}
float edgeSlope(ivec2 pixel, ivec2 offset, float centerZ) {
    ivec2 last = textureSize(tDepth, 0) - 1;
    ivec2 plus = clamp(pixel + offset, ivec2(0), last);
    ivec2 minus = clamp(pixel - offset, ivec2(0), last);
    float dp = texelFetch(tDepth, plus, 0).r;
    float dm = texelFetch(tDepth, minus, 0).r;
    bool validPlus = any(notEqual(plus, pixel)) && dp < 0.99999;
    bool validMinus = any(notEqual(minus, pixel)) && dm < 0.99999;
    float forward = edgeDistance(plus, dp) - centerZ;
    float backward = centerZ - edgeDistance(minus, dm);
    if (!validPlus && !validMinus) return 0.0;
    if (!validPlus) return backward;
    if (!validMinus) return forward;
    return abs(forward) < abs(backward) ? forward : backward;
}
vec3 edgeSurface(ivec2 pixel, float depth) {
    vec2 uv = edgeUv(pixel);
    vec3 position = edgePosition(uv, depth);
    vec2 stepUv = 1.0 / vec2(textureSize(tDepth, 0));
    float footprint = max(length(edgePosition(uv + vec2(stepUv.x, 0.0), depth) - position),
        length(edgePosition(uv + vec2(0.0, stepUv.y), depth) - position));
    // 同时考虑 D24 和 highp 浮点读数的一阶量化误差，避免近平面/远平面使用固定世界单位。
    float quantization = max(
        abs(edgeDistance(pixel, min(depth + 1.1920929e-7, 0.99999994)) + position.z),
        abs(edgeDistance(pixel, max(depth - 1.1920929e-7, 0.0)) + position.z));
    float tolerance = max(max(footprint * 0.25, quantization * 8.0), 1e-6 * max(1.0, abs(position.z)));
    return vec3(edgeSlope(pixel, ivec2(1, 0), -position.z),
        edgeSlope(pixel, ivec2(0, 1), -position.z), tolerance);
}
bool edgeMatches(ivec2 pixel, float centerZ, vec3 surface, ivec2 samplePixel) {
    float depth = texelFetch(tDepth, samplePixel, 0).r;
    if (depth >= 0.99999) return false;
    float predicted = centerZ + dot(surface.xy, vec2(samplePixel - pixel));
    return abs(edgeDistance(samplePixel, depth) - predicted) <= surface.z;
}

void edgeBlur() {
    ivec2 centerAo = ivec2(gl_FragCoord.xy);
    ivec2 pixel = edgeSourcePixel(centerAo);
    float depth = texelFetch(tDepth, pixel, 0).r;
    if (depth >= 0.99999) { gl_FragColor = vec4(1.0); return; }
    float centerZ = edgeDistance(pixel, depth);
    vec3 surface = edgeSurface(pixel, depth);
    float sum = texelFetch(tAo, centerAo, 0).r * 0.2;
    float weight = 0.2;
    for (int i = 1; i <= 5; i++) {
        if (i > blurRadiusPixels) break;
        float w = i == 1 ? 0.16 : (i == 2 ? 0.11 : (i == 3 ? 0.06 : (i == 4 ? 0.03 : 0.015)));
        for (int side = -1; side <= 1; side += 2) {
            ivec2 sampleAo = clamp(centerAo + ivec2(direction) * i * side, ivec2(0), ivec2(aoResolution) - 1);
            ivec2 samplePixel = edgeSourcePixel(sampleAo);
            if (!edgeMatches(pixel, centerZ, surface, samplePixel)) continue;
            float sampleDepth = texelFetch(tDepth, samplePixel, 0).r;
            float gap = abs(edgeDistance(samplePixel, sampleDepth) - centerZ);
            float sampleWeight = w * exp(-pow(gap / max(radius * 0.2, 0.005), 2.0));
            sum += texelFetch(tAo, sampleAo, 0).r * sampleWeight;
            weight += sampleWeight;
        }
    }
    gl_FragColor = vec4(vec3(sum / weight), 1.0);
}

void main() {
    if (testEdgeCorrection) { edgeBlur(); return; }
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
uniform highp sampler2D tDepth;
uniform sampler2D tAo;
uniform vec2 aoResolution;
uniform mat4 inverseProjection;
uniform float radius;
uniform vec3 aoColor;
uniform vec2 fullResolution;
uniform mat4 projection;
uniform int sampleCount;
uniform bool testNormalPreview;
uniform float intensity;
varying vec2 vUv;

${AO_ANGLE_WEIGHT}

float viewDistance(vec2 uv, float depth) {
    vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = inverseProjection * clip;
    return -view.z / view.w;
}

vec3 viewPosition(vec2 uv, float depth) {
    vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = inverseProjection * clip;
    return view.xyz / view.w;
}


ivec2 depthPixel(vec2 uv) {
    ivec2 size = textureSize(tDepth, 0);
    return clamp(ivec2(floor(uv * vec2(size))), ivec2(0), size - ivec2(1));
}

vec2 depthPixelUv(ivec2 pixel) {
    return (vec2(pixel) + 0.5) / vec2(textureSize(tDepth, 0));
}


vec4 previewNormalAtDepth(vec2 uv) {
    ivec2 centerPixel = depthPixel(uv);
    vec2 centerUv = depthPixelUv(centerPixel);
    float centerDepth = texelFetch(tDepth, centerPixel, 0).r;
    if (centerDepth >= 0.99999) {
        return vec4(0.0);
    }

    vec3 center = viewPosition(centerUv, centerDepth);
    ivec2 lastPixel = textureSize(tDepth, 0) - ivec2(1);
    ivec2 rightPixel = min(centerPixel + ivec2(1, 0), lastPixel);
    ivec2 leftPixel = max(centerPixel - ivec2(1, 0), ivec2(0));
    ivec2 topPixel = min(centerPixel + ivec2(0, 1), lastPixel);
    ivec2 bottomPixel = max(centerPixel - ivec2(0, 1), ivec2(0));
    float rightDepth = texelFetch(tDepth, rightPixel, 0).r;
    float leftDepth = texelFetch(tDepth, leftPixel, 0).r;
    float topDepth = texelFetch(tDepth, topPixel, 0).r;
    float bottomDepth = texelFetch(tDepth, bottomPixel, 0).r;
    bool useRight = centerPixel.x == 0 || (centerPixel.x < lastPixel.x
        && abs(rightDepth - centerDepth) < abs(leftDepth - centerDepth));
    bool useTop = centerPixel.y == 0 || (centerPixel.y < lastPixel.y
        && abs(topDepth - centerDepth) < abs(bottomDepth - centerDepth));
    vec3 tangentX = useRight
        ? viewPosition(depthPixelUv(rightPixel), rightDepth) - center
        : center - viewPosition(depthPixelUv(leftPixel), leftDepth);
    vec3 tangentY = useTop
        ? viewPosition(depthPixelUv(topPixel), topDepth) - center
        : center - viewPosition(depthPixelUv(bottomPixel), bottomDepth);
    vec3 crossNormal = cross(tangentX, tangentY);
    float normalLengthSquared = dot(crossNormal, crossNormal);
    vec3 normal = normalLengthSquared > 1e-20
        ? crossNormal * inversesqrt(normalLengthSquared) : vec3(0.0, 0.0, 1.0);
    if (normal.z < 0.0) normal = -normal;
    return vec4(normal * 0.5 + 0.5, 1.0);
}

uniform bool testEdgeCorrection;
ivec2 edgeSourcePixel(ivec2 pixel) {
    ivec2 size = textureSize(tDepth, 0);
    ivec2 grid = ivec2(aoResolution);
    pixel = clamp(pixel, ivec2(0), grid - 1);
    return ((pixel * 2 + 1) * size) / (grid * 2);
}
ivec2 edgePixel(vec2 uv) {
    ivec2 size = textureSize(tDepth, 0);
    return clamp(ivec2(floor(uv * vec2(size))), ivec2(0), size - 1);
}
vec2 edgeUv(ivec2 pixel) {
    return (vec2(pixel) + 0.5) / vec2(textureSize(tDepth, 0));
}
vec3 edgePosition(vec2 uv, float depth) {
    vec4 view = inverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return view.xyz / view.w;
}
float edgeDistance(ivec2 pixel, float depth) {
    return -edgePosition(edgeUv(pixel), depth).z;
}
float edgeSlope(ivec2 pixel, ivec2 offset, float centerZ) {
    ivec2 last = textureSize(tDepth, 0) - 1;
    ivec2 plus = clamp(pixel + offset, ivec2(0), last);
    ivec2 minus = clamp(pixel - offset, ivec2(0), last);
    float dp = texelFetch(tDepth, plus, 0).r;
    float dm = texelFetch(tDepth, minus, 0).r;
    bool validPlus = any(notEqual(plus, pixel)) && dp < 0.99999;
    bool validMinus = any(notEqual(minus, pixel)) && dm < 0.99999;
    float forward = edgeDistance(plus, dp) - centerZ;
    float backward = centerZ - edgeDistance(minus, dm);
    if (!validPlus && !validMinus) return 0.0;
    if (!validPlus) return backward;
    if (!validMinus) return forward;
    return abs(forward) < abs(backward) ? forward : backward;
}
vec3 edgeSurface(ivec2 pixel, float depth) {
    vec2 uv = edgeUv(pixel);
    vec3 position = edgePosition(uv, depth);
    vec2 stepUv = 1.0 / vec2(textureSize(tDepth, 0));
    float footprint = max(length(edgePosition(uv + vec2(stepUv.x, 0.0), depth) - position),
        length(edgePosition(uv + vec2(0.0, stepUv.y), depth) - position));
    // 同时考虑 D24 和 highp 浮点读数的一阶量化误差，避免近平面/远平面使用固定世界单位。
    float quantization = max(
        abs(edgeDistance(pixel, min(depth + 1.1920929e-7, 0.99999994)) + position.z),
        abs(edgeDistance(pixel, max(depth - 1.1920929e-7, 0.0)) + position.z));
    float tolerance = max(max(footprint * 0.25, quantization * 8.0), 1e-6 * max(1.0, abs(position.z)));
    return vec3(edgeSlope(pixel, ivec2(1, 0), -position.z),
        edgeSlope(pixel, ivec2(0, 1), -position.z), tolerance);
}
bool edgeMatches(ivec2 pixel, float centerZ, vec3 surface, ivec2 samplePixel) {
    float depth = texelFetch(tDepth, samplePixel, 0).r;
    if (depth >= 0.99999) return false;
    float predicted = centerZ + dot(surface.xy, vec2(samplePixel - pixel));
    return abs(edgeDistance(samplePixel, depth) - predicted) <= surface.z;
}

float edgeFallbackAo(ivec2 pixel, float depth) {
    vec2 centerUv = edgeUv(pixel);
    vec3 center = edgePosition(centerUv, depth);
    vec3 normal = previewNormalAtDepth(centerUv).rgb * 2.0 - 1.0;
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
        ivec2 samplePixel = depthPixel(centerUv + offset);
        vec2 sampleUv = depthPixelUv(samplePixel);
        float sampleDepth = texelFetch(tDepth, samplePixel, 0).r;
        if (sampleDepth >= 0.99999) continue;
        vec3 delta = viewPosition(sampleUv, sampleDepth) - center;
        float distanceToSample = length(delta);
        float facing = dot(normal, delta) / max(distanceToSample, 0.0001);
        float rangeWeight = 1.0 - smoothstep(0.0, radius, distanceToSample);
        occlusion += aoAngleWeight(facing) * rangeWeight;
    }
    float visibility = 1.0 - min(0.6, occlusion * (8.0 / float(sampleCount)));

    return visibility;
}
vec4 edgeResolve(vec2 uv, bool normalMode) {
    ivec2 pixel = edgePixel(uv);
    float depth = texelFetch(tDepth, pixel, 0).r;
    float centerZ = edgeDistance(pixel, depth);
    vec3 surface = edgeSurface(pixel, depth);
    vec2 gridPosition = uv * aoResolution - 0.5;
    ivec2 base = ivec2(floor(gridPosition));
    vec2 blend = fract(gridPosition);
    vec3 sum = vec3(0.0);
    float weight = 0.0;
    for (int y = 0; y < 2; y++) {
        for (int x = 0; x < 2; x++) {
            ivec2 candidate = clamp(base + ivec2(x, y), ivec2(0), ivec2(aoResolution) - 1);
            ivec2 samplePixel = edgeSourcePixel(candidate);
            if (!edgeMatches(pixel, centerZ, surface, samplePixel)) continue;
            vec4 sampleValue = texelFetch(tAo, candidate, 0);
            if (normalMode && sampleValue.a < 0.5) continue;
            float w = (x == 0 ? 1.0 - blend.x : blend.x) * (y == 0 ? 1.0 - blend.y : blend.y);
            sum += sampleValue.rgb * w;
            weight += w;
        }
    }
    if (weight > 1e-6) {
        vec3 value = sum / weight;
        if (normalMode) {
            vec3 n = value * 2.0 - 1.0;
            if (dot(n, n) > 1e-12) value = normalize(n) * 0.5 + 0.5;
        }
        return vec4(value, 1.0);
    }
    if (normalMode) return previewNormalAtDepth(edgeUv(pixel));
    return vec4(vec3(edgeFallbackAo(pixel, depth)), 1.0);
}

${compositeChunk}
void main() {
    vec4 color = texture2D(tColor, vUv);
    if (testNormalPreview) {
        float actualDepth = texelFetch(tDepth, depthPixel(vUv), 0).r;
        if (color.a <= 0.001 || actualDepth >= 0.99999) {
            gl_FragColor = color;
            return;
        }
        vec4 preview = testEdgeCorrection ? edgeResolve(vUv, true) : texture2D(tAo, vUv);
        if (preview.a < 0.5) preview = previewNormalAtDepth(vUv);
        gl_FragColor = vec4(preview.rgb, color.a);
        return;
    }
    float depth = texture2D(tDepth, vUv).r;
    if (color.a <= 0.001 || depth >= 0.99999) {
        gl_FragColor = color;
    } else {
        if (screenLightingEnabled) {
            vec4 effect = resolveScreenLighting(vUv, depth);
            color.rgb = color.rgb * (1.0 - effect.a) + effect.rgb;
        }
        float visibility;
        if (testEdgeCorrection) visibility = edgeResolve(vUv, false).r;
        else {
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
        visibility = weight > 0.0 ? sum / weight : 1.0;
        }
        float amount = clamp((1.0 - visibility) * intensity * screenAoEnabled, 0.0, 1.0);
        gl_FragColor = vec4(color.rgb * mix(vec3(1.0), aoColor, amount), color.a);
    }
    gl_FragColor.rgb = gl_FragColor.a > 1e-6 ? gl_FragColor.rgb / gl_FragColor.a : vec3(0.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb *= gl_FragColor.a;
}`;

export function createPmxAmbientOcclusion({ THREE, renderer, scene, camera, keyLight }) {
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
    let temporalContentKey = "";
    const temporalAA = createTemporalAA({ THREE, renderer, camera });
    const screenLighting = createScreenLighting({ THREE, renderer, camera, keyLight });
    window.DisplayMmdScreenLightingSupported = supported;
    window.dispatchEvent(new Event('mmd-ar-screen-lighting-capability'));

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
                sampleCount: { value: sampleCount },
                testNormalPreview: { value: false }
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
                testNormalPreview: { value: false },
                intensity: { value: intensity }
            },
            vertexShader: FULLSCREEN_VERTEX,
            fragmentShader: COMPOSITE_FRAGMENT,
            depthTest: false,
            depthWrite: false,
            blending: THREE.NoBlending,
            toneMapped: true
        });
        Object.assign(compositeMaterial.uniforms, {
            screenLightingTexture: { value: colorTarget.texture }, screenLightingEnabled: { value: false },
            screenLightingSize: { value: new THREE.Vector2(1, 1) }, screenLightingFullSize: { value: new THREE.Vector2(1, 1) }, screenAoEnabled: { value: 1 }
        });
        const geometry = new THREE.PlaneGeometry(2, 2);
        const quad = new THREE.Mesh(geometry, aoMaterial);
        const passScene = new THREE.Scene();
        passScene.add(quad);
        const passCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        // 修正参数只供测试网页使用，不进入正式灯光配置。
        for (const material of [aoMaterial, blurMaterial, compositeMaterial]) {
            material.uniforms.testEdgeCorrection = { value: false };
        }
        // 没有测试页角度设置时仍使用原门限；补算和原 AO 必须持有同样的值。
        for (const material of [aoMaterial, compositeMaterial]) {
            material.uniforms.aoFacingThreshold = { value: new THREE.Vector2(0.08, 0.3) };
        }
        aoMaterial.uniforms.aoResolution = { value: new THREE.Vector2() };
        compositeMaterial.uniforms.fullResolution = { value: new THREE.Vector2() };
        compositeMaterial.uniforms.projection = { value: camera.projectionMatrix };
        compositeMaterial.uniforms.sampleCount = { value: sampleCount };
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
        resources.aoMaterial.uniforms.aoResolution.value.set(aoSize.width, aoSize.height);
        resources.compositeMaterial.uniforms.fullResolution.value.set(fullWidth, fullHeight);
        window.dispatchEvent(new CustomEvent('mmd-ar-ao-size', { detail: {
            reduced: aoSize.width < fullWidth || aoSize.height < fullHeight
        } }));
        resources.blurTarget.setSize(aoSize.width, aoSize.height);
        resources.aoMaterial.uniforms.fullResolution.value.set(fullWidth, fullHeight);
        resources.blurMaterial.uniforms.aoResolution.value.set(aoSize.width, aoSize.height);
        resources.compositeMaterial.uniforms.aoResolution.value.set(aoSize.width, aoSize.height);
    };

    const renderSpatial = () => {
        const normalPreview = window.MmdArTestNormalPreview === true;
        /* aasc-shared:fsr2-internal-size */
        // 只缩小场景输入；历史和输出保持实际Canvas尺寸，旁路绘制恢复完整尺寸。
        const settings = normalizeRenderSettings(window.DisplayMmdRenderSettings);
        const upscale = camera.userData.mmdArTaaUpscaleActive === true && camera.userData.mmdArTaaBypass !== true && !normalPreview && renderer.capabilities.isWebGL2 === true;
        const outputSize = renderer.getDrawingBufferSize(new THREE.Vector2());
        const internalScale = upscale ? settings.fsr2Scale : 1;
        const internalWidth = Math.max(1, Math.floor(outputSize.x * internalScale));
        const internalHeight = Math.max(1, Math.floor(outputSize.y * internalScale));
        if (fullWidth !== internalWidth || fullHeight !== internalHeight) resize(internalWidth, internalHeight);
        if ((!enabled && !normalPreview && !screenLighting.active() && !temporalAA.active()) || !supported) {
            screenLighting.dispose();
            renderer.render(scene, camera);
            return;
        }
        createResources();
        resources.aoMaterial.uniforms.testNormalPreview.value = normalPreview;
        resources.compositeMaterial.uniforms.testNormalPreview.value = normalPreview;
        const previousTarget = renderer.getRenderTarget();
        try {
            // 角度在测试面板独立保存；正式页未提供数值时完整保留原 0.08..0.3 判定。
            // 每帧只换算一次正弦，0..45 度确保平滑上界始终小于 1。
            const concavityAngle = window.DisplayMmdAoConcavityAngle ?? window.MmdArTestAoConcavityAngle;
            const facingLower = Number.isFinite(concavityAngle)
                ? Math.sin(Math.min(45, Math.max(0, concavityAngle)) * Math.PI / 180) : 0.08;
            resources.aoMaterial.uniforms.aoFacingThreshold.value.set(facingLower, facingLower + 0.22);
            resources.compositeMaterial.uniforms.aoFacingThreshold.value.set(facingLower, facingLower + 0.22);
            const edgeCorrection = (window.DisplayMmdAoEdgeCorrection ?? window.MmdArTestEdgeCorrection) !== false
                && (resources.aoTarget.width < fullWidth || resources.aoTarget.height < fullHeight);
            resources.blurMaterial.uniforms.testEdgeCorrection.value = edgeCorrection;
            resources.compositeMaterial.uniforms.testEdgeCorrection.value = edgeCorrection;
            resources.compositeMaterial.uniforms.sampleCount.value = sampleCount;
            resources.aoMaterial.uniforms.radius.value = radius;
            resources.aoMaterial.uniforms.sampleCount.value = sampleCount;
            resources.blurMaterial.uniforms.radius.value = radius;
            resources.compositeMaterial.uniforms.radius.value = radius;
            resources.compositeMaterial.uniforms.intensity.value = intensity;
            renderer.setRenderTarget(resources.colorTarget);
            renderer.clear();
            renderer.render(scene, camera);
            if (enabled || normalPreview) {
            resources.quad.material = resources.aoMaterial;
            renderer.setRenderTarget(resources.aoTarget);
            renderer.clear();
            renderer.render(resources.passScene, resources.passCamera);
            if (!normalPreview && blurPassCount > 0) {
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
            }
            screenLighting.prepare(resources, fullWidth, fullHeight, normalPreview, enabled);
            resources.quad.material = resources.compositeMaterial;
            renderer.setRenderTarget(previousTarget);
            renderer.clear();
            renderer.render(resources.passScene, resources.passCamera);
        } finally {
            renderer.setRenderTarget(previousTarget);
        }
    };

    const render = (options = {}) => temporalAA.render(renderSpatial, () => resources?.depthTexture, {
        bypass: camera.userData.mmdArTaaBypass === true || options.bypassTemporal === true || window.MmdArTestNormalPreview === true || renderer.getRenderTarget() !== null,
        signature: JSON.stringify([enabled, resolutionMode, radius, intensity, sampleCount, blurPassCount, blurRadii,
            temporalContentKey, window.DisplayMmdScreenLighting, scene.children.map(object => object.id)])
    });
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
        temporalAA.dispose();
        screenLighting.dispose();
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
        invalidateTemporal: temporalAA.invalidate, getTemporalState: temporalAA.getState,
        setTemporalContent: (mesh, motion, settings) => { temporalContentKey = JSON.stringify([mesh?.uuid, motion, settings]); },
        setColor, setIntensity, setRadius, setSampleCount, setBlurPasses, dispose });
}

/* aasc-shared:screen-lighting */
/* aasc-shared:render-settings */
