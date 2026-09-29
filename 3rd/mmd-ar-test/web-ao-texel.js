'use strict';

// 仅替换测试网页 AO 通道：低分辨率像素可能落在深度纹理边界，整数邻点保证差分间距一致。
function alignAoDepthTexels(source) {
  const replaceOnce = (anchor, replacement) => {
    if (source.split(anchor).length !== 2) throw new Error(`AO 像素对齐锚点缺失或重复：${anchor}`);
    source = source.replace(anchor, replacement);
  };
  const start = source.indexOf('const AO_FRAGMENT = `');
  const end = source.indexOf('const BLUR_FRAGMENT = `');
  if (start < 0 || end <= start) throw new Error('未找到独立 AO shader 段');
  const prefix = source.slice(0, start);
  const suffix = source.slice(end);
  source = source.slice(start, end);
  replaceOnce('void main() {\n    float centerDepth = texture2D(tDepth, vUv).r;', `
ivec2 depthPixel(vec2 uv) {
    ivec2 size = textureSize(tDepth, 0);
    return clamp(ivec2(floor(uv * vec2(size))), ivec2(0), size - ivec2(1));
}

vec2 depthPixelUv(ivec2 pixel) {
    return (vec2(pixel) + 0.5) / vec2(textureSize(tDepth, 0));
}

void main() {
    ivec2 centerPixel = depthPixel(vUv);
    vec2 centerUv = depthPixelUv(centerPixel);
    float centerDepth = texelFetch(tDepth, centerPixel, 0).r;`);
  const normalStart = source.indexOf('    vec3 center = viewPosition(vUv, centerDepth);');
  const normalEnd = source.indexOf('    if (normal.z < 0.0) normal = -normal;');
  if (normalStart < 0 || normalEnd <= normalStart) throw new Error('未找到 AO 深度差分法线计算');
  source = source.slice(0, normalStart) + `    vec3 center = viewPosition(centerUv, centerDepth);
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
` + source.slice(normalEnd);
  replaceOnce(`vec2 sampleUv = clamp(vUv + offset, vec2(0.001), vec2(0.999));
        float sampleDepth = texture2D(tDepth, sampleUv).r;`, `ivec2 samplePixel = depthPixel(centerUv + offset);
        vec2 sampleUv = depthPixelUv(samplePixel);
        float sampleDepth = texelFetch(tDepth, samplePixel, 0).r;`);
  return prefix + source + suffix;
}

module.exports = { alignAoDepthTexels };
