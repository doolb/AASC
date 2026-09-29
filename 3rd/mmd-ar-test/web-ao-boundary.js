'use strict';

// 仅用于测试网页生成副本。所有阶段共享深度像素归属及表面匹配规则，不创建第二张深度图。
const SURFACE_GLSL = `
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
`;

function addAoBoundaryCorrection(source) {
  const once = (text, anchor, replacement) => {
    if (text.split(anchor).length !== 2) throw new Error(`AO 边界修正锚点缺失或重复：${anchor}`);
    return text.replace(anchor, replacement);
  };
  const getShader = name => {
    const match = source.match(new RegExp('const ' + name + ' = `([\\s\\S]*?)`;'));
    if (!match) throw new Error(`缺少 shader：${name}`);
    return match[1];
  };
  const aoOriginal = getShader('AO_FRAGMENT');
  const blurOriginal = getShader('BLUR_FRAGMENT');
  const compositeOriginal = getShader('COMPOSITE_FRAGMENT');
  // 从实际 AO 通道提取遮蔽计算循环，轮廓补算沿用同样的半径、样本数和公式。
  const loopStart = aoOriginal.indexOf('    float radiusPixels =');
  const loopEnd = aoOriginal.indexOf('    gl_FragColor = vec4(vec3(visibility), 1.0);');
  if (loopStart < 0 || loopEnd <= loopStart) throw new Error('未找到可复用 AO 采样循环');
  const fallback = `
float edgeFallbackAo(ivec2 pixel, float depth) {
    vec2 centerUv = edgeUv(pixel);
    vec3 center = edgePosition(centerUv, depth);
    vec3 normal = previewNormalAtDepth(centerUv).rgb * 2.0 - 1.0;
${aoOriginal.slice(loopStart, loopEnd)}
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
`;
  let ao = once(aoOriginal, 'uniform vec2 fullResolution;', 'uniform vec2 fullResolution;\nuniform vec2 aoResolution;');
  ao = once(ao, 'void main() {', SURFACE_GLSL + '\nvoid main() {');
  ao = once(ao, 'ivec2 centerPixel = depthPixel(vUv);', 'ivec2 centerPixel = edgeSourcePixel(ivec2(gl_FragCoord.xy));');

  const blurEntry = `
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
`;
  let blur = once(blurOriginal, 'void main() {', SURFACE_GLSL + blurEntry
    + '\nvoid main() {\n    if (testEdgeCorrection) { edgeBlur(); return; }');
  let composite = once(compositeOriginal, 'uniform vec3 aoColor;',
    'uniform vec3 aoColor;\nuniform vec2 fullResolution;\nuniform mat4 projection;\nuniform int sampleCount;');
  composite = once(composite, 'void main() {', SURFACE_GLSL + fallback + '\nvoid main() {');
  composite = once(composite, 'vec4 preview = texture2D(tAo, vUv);',
    'vec4 preview = testEdgeCorrection ? edgeResolve(vUv, true) : texture2D(tAo, vUv);');
  const compositeStart = composite.indexOf('        float centerDistance = viewDistance(vUv, depth);');
  const compositeEnd = composite.indexOf('        float amount =');
  if (compositeStart < 0 || compositeEnd <= compositeStart) throw new Error('缺少 AO 合成分支');
  const oldBlend = composite.slice(compositeStart, compositeEnd).replace('float visibility =', 'visibility =');
  composite = composite.slice(0, compositeStart) + `        float visibility;
        if (testEdgeCorrection) visibility = edgeResolve(vUv, false).r;
        else {
${oldBlend}        }
` + composite.slice(compositeEnd);
  source = source.replace(aoOriginal, ao).replace(blurOriginal, blur).replace(compositeOriginal, composite);
  source = once(source, 'resources = { depthTexture,', `// 修正参数只供测试网页使用，不进入正式灯光配置。
        for (const material of [aoMaterial, blurMaterial, compositeMaterial]) {
            material.uniforms.testEdgeCorrection = { value: false };
        }
        aoMaterial.uniforms.aoResolution = { value: new THREE.Vector2() };
        compositeMaterial.uniforms.fullResolution = { value: new THREE.Vector2() };
        compositeMaterial.uniforms.projection = { value: camera.projectionMatrix };
        compositeMaterial.uniforms.sampleCount = { value: sampleCount };
        resources = { depthTexture,`);
  source = once(source, 'resources.aoTarget.setSize(aoSize.width, aoSize.height);', `resources.aoTarget.setSize(aoSize.width, aoSize.height);
        resources.aoMaterial.uniforms.aoResolution.value.set(aoSize.width, aoSize.height);
        resources.compositeMaterial.uniforms.fullResolution.value.set(fullWidth, fullHeight);
        window.dispatchEvent(new CustomEvent('mmd-ar-ao-size', { detail: {
            reduced: aoSize.width < fullWidth || aoSize.height < fullHeight
        } }));`);
  source = once(source, 'resources.aoMaterial.uniforms.radius.value = radius;', `const edgeCorrection = window.MmdArTestEdgeCorrection !== false
                && (resources.aoTarget.width < fullWidth || resources.aoTarget.height < fullHeight);
            resources.blurMaterial.uniforms.testEdgeCorrection.value = edgeCorrection;
            resources.compositeMaterial.uniforms.testEdgeCorrection.value = edgeCorrection;
            resources.compositeMaterial.uniforms.sampleCount.value = sampleCount;
            resources.aoMaterial.uniforms.radius.value = radius;`);
  return source;
}

module.exports = { addAoBoundaryCorrection };
