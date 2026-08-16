// GPU compute 桥封装：对齐 threejs WebGPU compute 风格
// 底层调 window.NativeDisplay.compute（APK 离屏 EGL 3.1），结果回传
(function () {
  'use strict';

  class NativeCompute {
    // params: { shader, workgroupSize=[64], count, dispatchSize, buffers, images }
    constructor(params) {
      this.shader = params.shader;
      this.workgroupSize = params.workgroupSize || [64];
      this.count = params.count;
      this.dispatchSize = params.dispatchSize;
      this.buffers = params.buffers || [];
      this.images = params.images || [];
      this.available = !!(window.NativeDisplay && window.NativeDisplay.compute);
    }

    // 执行计算，返回 Promise<{buffers, images, ms, error}>
    async dispatch() {
      if (!this.available) throw new Error('compute 桥不可用');
      if (this.count != null && this.dispatchSize != null) {
        throw new Error('count 与 dispatchSize 互斥');
      }
      const request = {
        shader: this.shader,
        workgroupSize: this.workgroupSize,
        buffers: this.buffers,
        images: this.images
      };
      if (this.count != null) request.count = this.count;
      if (this.dispatchSize != null) request.dispatchSize = this.dispatchSize;

      const raw = window.NativeDisplay.compute(JSON.stringify(request));
      const result = JSON.parse(raw);
      if (result.error) throw new Error(result.error);
      return result;
    }
  }

  window.NativeCompute = NativeCompute;
})();
