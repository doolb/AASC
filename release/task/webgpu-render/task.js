async function run(context) {
  const params = context.params || {};
  const width = params.width || 640;
  const height = params.height || 480;

  if (!navigator.gpu) throw new Error('浏览器不支持 WebGPU');
  if (!context.capabilities || !context.capabilities.webgpu) throw new Error('显示端未声明 WebGPU 能力');

  console.log('开始 WebGPU 渲染: ' + width + 'x' + height);

  let adapter = context.gpuAdapter || null;
  if (!adapter) {
    adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { console.log('尝试 high-performance...'); adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); }
    if (!adapter) { console.log('尝试 low-power...'); adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' }); }
    if (!adapter) throw new Error('无法获取 WebGPU 适配器');
  }
  const device = await adapter.requestDevice();

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('webgpu');
  ctx.configure({ device, format: 'bgra8unorm', alphaMode: 'premultiplied' });

  const encoder = device.createCommandEncoder();
  const view = ctx.getCurrentTexture().createView();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view,
      loadOp: 'clear',
      clearValue: { r: 0, g: 0, b: 1, a: 1 },
      storeOp: 'store'
    }]
  });
  pass.end();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  context.files['output.png'] = bytes;

  console.log('渲染完成: ' + width + 'x' + height + ', ' + (bytes.length / 1024).toFixed(1) + 'KB');

  return {
    outputFiles: ['output.png'],
    width: width,
    height: height,
    sizeBytes: bytes.length,
    message: '渲染完成: ' + width + 'x' + height + ', ' + (bytes.length / 1024).toFixed(1) + 'KB'
  };
}

const PARAMS = [
  { name: 'width', type: 'number', required: false, default: 640, min: 1, max: 4096, label: '宽度' },
  { name: 'height', type: 'number', required: false, default: 480, min: 1, max: 4096, label: '高度' }
];

const WIDGET = {
  html: '<div style="display:flex;flex-direction:column;gap:10px">' +
    '<div style="display:flex;gap:6px;align-items:center">' +
      '<span style="font-size:11px;color:rgba(255,255,255,0.4);white-space:nowrap;min-width:50px">宽度</span>' +
      '<input type="number" class="task-widget-field" data-field="width" value="{{width}}" min="1" max="4096"' +
      ' style="width:100px;padding:6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:13px">' +
    '</div>' +
    '<div style="display:flex;gap:6px;align-items:center">' +
      '<span style="font-size:11px;color:rgba(255,255,255,0.4);white-space:nowrap;min-width:50px">高度</span>' +
      '<input type="number" class="task-widget-field" data-field="height" value="{{height}}" min="1" max="4096"' +
      ' style="width:100px;padding:6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:13px">' +
    '</div>' +
  '</div>'
};

module.exports = { run, params: PARAMS, widget: WIDGET };
