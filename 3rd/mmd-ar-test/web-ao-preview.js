'use strict';

// 只修改测试网页的生成副本。使用原 AO 法线计算，避免预览另一套算法而掩盖横条。
function addAoNormalPreview(source) {
  const replaceOnce = (anchor, replacement) => {
    if (source.split(anchor).length !== 2) throw new Error(`AO 法线预览锚点缺失或重复：${anchor}`);
    source = source.replace(anchor, replacement);
  };
  replaceOnce('uniform int sampleCount;', 'uniform int sampleCount;\nuniform bool testNormalPreview;');
  replaceOnce('if (normal.z < 0.0) normal = -normal;', `if (normal.z < 0.0) normal = -normal;
    if (testNormalPreview) {
        gl_FragColor = vec4(normal * 0.5 + 0.5, 1.0);
        return;
    }`);
  replaceOnce('uniform vec3 aoColor;', 'uniform vec3 aoColor;\nuniform bool testNormalPreview;');
  replaceOnce('vec4 color = texture2D(tColor, vUv);', `vec4 color = texture2D(tColor, vUv);
    if (testNormalPreview) {
        gl_FragColor = vec4(texture2D(tAo, vUv).rgb, color.a);
        return;
    }`);
  replaceOnce('sampleCount: { value: sampleCount }', 'sampleCount: { value: sampleCount },\n                testNormalPreview: { value: false }');
  replaceOnce('aoColor: { value: aoColor },', 'aoColor: { value: aoColor },\n                testNormalPreview: { value: false },');
  replaceOnce('if (!enabled || !supported) {', `const normalPreview = window.MmdArTestNormalPreview === true;
        if ((!enabled && !normalPreview) || !supported) {`);
  replaceOnce('const previousTarget = renderer.getRenderTarget();', `resources.aoMaterial.uniforms.testNormalPreview.value = normalPreview;
        resources.compositeMaterial.uniforms.testNormalPreview.value = normalPreview;
        const previousTarget = renderer.getRenderTarget();`);
  replaceOnce('if (blurPassCount > 0) {', 'if (!normalPreview && blurPassCount > 0) {');
  return source;
}

module.exports = { addAoNormalPreview };
