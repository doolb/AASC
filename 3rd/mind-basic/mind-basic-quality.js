/* MindAR 1.2.5 跟踪质量观测：复用已有点对，绝不改写原始跟踪结果。 */
(function exposeMindBasicQuality(root) {
  'use strict';

  function finiteMatrix(value, rows, columns) {
    return Array.isArray(value) && value.length === rows
      && value.every((row) => Array.isArray(row) && row.length === columns && row.every(Number.isFinite));
  }

  function measure({ features, transform, projection, totalPoints, dimensions, inputWidth, inputHeight }) {
    const world = features?.worldCoords;
    const screen = features?.screenCoords;
    if (!Array.isArray(world) || !Array.isArray(screen) || world.length !== screen.length
      || !Number.isFinite(totalPoints) || totalPoints <= 0 || world.length > totalPoints) return null;
    const points = world.length;
    const ratio = points / totalPoints;
    const base = { points, totalPoints, ratio, coverage: null, rmse: null, score: 0, tracking: false };
    if (!transform || points < 4) return base;
    if (!finiteMatrix(transform, 3, 4) || !finiteMatrix(projection, 3, 3)
      || !Array.isArray(dimensions) || dimensions.length !== 2
      || !dimensions.every((value) => Number.isFinite(value) && value > 0)
      || ![inputWidth, inputHeight].every((value) => Number.isFinite(value) && value > 0)) return null;
    let squaredError = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let index = 0; index < points; index += 1) {
      const point = world[index], pixel = screen[index];
      if (!point || !pixel || ![point.x, point.y, point.z, pixel.x, pixel.y].every(Number.isFinite)) return null;
      const camera = transform.map((row) => row[0] * point.x + row[1] * point.y + row[2] * point.z + row[3]);
      const projected = projection.map((row) => row.reduce((sum, value, axis) => sum + value * camera[axis], 0));
      if (!projected.every(Number.isFinite) || projected[2] <= 1e-9) return null;
      squaredError += (projected[0] / projected[2] - pixel.x) ** 2
        + (projected[1] / projected[2] - pixel.y) ** 2;
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
    }
    const rmse = Math.sqrt(squaredError / points);
    if (!Number.isFinite(rmse)) return null;
    const coverage = Math.min(1, (maxX - minX) * (maxY - minY) / (dimensions[0] * dimensions[1]));
    // 此分数为启发式质量指标。拟合残差不是位姿真值误差，100 分也不代表完全准确。
    const normalizedError = rmse * 640 / Math.max(inputWidth, inputHeight);
    const score = Math.round(100 * Math.min(1, points / 12) * Math.sqrt(ratio)
      * Math.sqrt(Math.min(1, coverage / 0.25)) * Math.exp(-normalizedError / 3));
    return { ...base, coverage, rmse, score, tracking: true };
  }

  function attach(controller, onSample, now = () => performance.now()) {
    const tracker = controller?.tracker;
    if (typeof tracker?.track !== 'function' || typeof controller?._trackAndUpdate !== 'function') return null;
    const originalTrack = tracker.track;
    const originalUpdate = controller._trackAndUpdate;
    const captures = new Map();
    let active = true;
    function track(...args) {
      const features = originalTrack.apply(this, args);
      if (active) captures.set(args[2], { features, timestamp: now() });
      return features;
    }
    async function update(...args) {
      const targetIndex = args[2];
      captures.delete(targetIndex);
      // 原算法异常继续原样向调用方传播，诊断代码不接管识别生命周期。
      const transform = await originalUpdate.apply(this, args);
      const capture = captures.get(targetIndex);
      captures.delete(targetIndex);
      if (active && capture) {
        try {
          const metrics = measure({
            features: capture.features, transform, projection: controller.projectionTransform,
            totalPoints: tracker.trackingKeyframeList?.[targetIndex]?.points?.length,
            dimensions: controller.markerDimensions?.[targetIndex],
            inputWidth: controller.inputWidth, inputHeight: controller.inputHeight
          });
          onSample({ targetIndex, timestamp: capture.timestamp, metrics });
        } catch (error) {
          // 面板统计失败不得阻断 MindAR 的位姿输出。
          console.warn('[Mind Basic] 读取定位质量失败:', error);
        }
      }
      return transform;
    }
    tracker.track = track;
    controller._trackAndUpdate = update;
    return () => {
      active = false;
      captures.clear();
      if (tracker.track === track) tracker.track = originalTrack;
      if (controller._trackAndUpdate === update) controller._trackAndUpdate = originalUpdate;
    };
  }

  const api = Object.freeze({ measure, attach });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MindBasicQuality = api;
})(typeof window !== 'undefined' ? window : globalThis);
