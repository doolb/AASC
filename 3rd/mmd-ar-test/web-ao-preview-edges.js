'use strict';

// 仅修复法线诊断图的上采样轮廓。内部仍显示原半分辨率结果，轮廓缺失样本才重建。
function fixAoNormalPreviewEdges(source) {
  const aoStart = source.indexOf('const AO_FRAGMENT = `');
  const blurStart = source.indexOf('const BLUR_FRAGMENT = `');
  const ao = source.slice(aoStart, blurStart);
  const helperStart = ao.indexOf('vec3 viewPosition(');
  const bodyStart = ao.indexOf('void main() {');
  const normalEndAnchor = '    if (normal.z < 0.0) normal = -normal;';
  const normalEnd = ao.indexOf(normalEndAnchor);
  if (aoStart < 0 || blurStart <= aoStart || helperStart < 0 || bodyStart <= helperStart
    || normalEnd <= bodyStart || !ao.includes('ivec2 centerPixel = depthPixel(vUv);')) {
    throw new Error('法线轮廓预览需要完整的整数像素重建代码');
  }
  const background = 'gl_FragColor = vec4(1.0);\n        return;';
  const normalBody = ao.slice(bodyStart + 'void main() {'.length, normalEnd + normalEndAnchor.length);
  if (normalBody.split(background).length !== 2) throw new Error('法线预览缺少唯一背景分支');
  // 从实际 AO shader 提取同一套函数及法线重建公式，避免维护两份不一致的算法。
  const helper = ao.slice(helperStart, bodyStart) + '\nvec4 previewNormalAtDepth(vec2 uv) {'
    + normalBody.replaceAll('vUv', 'uv').replace(background, 'return vec4(0.0);')
    + '\n    return vec4(normal * 0.5 + 0.5, 1.0);\n}\n';
  const patchedAo = ao.replace(background,
    'gl_FragColor = testNormalPreview ? vec4(0.0) : vec4(1.0);\n        return;');
  source = source.slice(0, aoStart) + patchedAo + source.slice(blurStart);
  const main = 'void main() {\n    vec4 color = texture2D(tColor, vUv);';
  if (source.split(main).length !== 2) throw new Error('未找到唯一的法线预览合成入口');
  source = source.replace(main, helper + main);
  const oldPreview = 'gl_FragColor = vec4(texture2D(tAo, vUv).rgb, color.a);';
  if (source.split(oldPreview).length !== 2) throw new Error('未找到唯一的法线预览颜色输出');
  return source.replace(oldPreview, `float actualDepth = texelFetch(tDepth, depthPixel(vUv), 0).r;
        if (color.a <= 0.001 || actualDepth >= 0.99999) {
            gl_FragColor = color;
            return;
        }
        vec4 preview = texture2D(tAo, vUv);
        if (preview.a < 0.5) preview = previewNormalAtDepth(vUv);
        gl_FragColor = vec4(preview.rgb, color.a);`);
}

module.exports = { fixAoNormalPreviewEdges };
