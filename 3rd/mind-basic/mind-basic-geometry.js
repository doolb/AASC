/* Mind Basic 的矩形裁剪几何与旧版四角定位图兼容逻辑。 */
(function exposeMindBasicGeometry(root) {
  'use strict';

  const MIN_LEGACY_RECT_AREA = 0.03;

  function isValidCropRect(rect) {
    if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)
      || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return false;
    if (rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0) return false;
    if (rect.x + rect.width > 1 || rect.y + rect.height > 1) return false;
    return true;
  }

  function isValidLegacyQuad(points) {
    if (!Array.isArray(points) || points.length !== 4) return false;
    if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)
      || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) return false;
    let areaTwice = 0;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      areaTwice += current.x * next.y - next.x * current.y;
    }
    if (Math.abs(areaTwice) / 2 < MIN_LEGACY_RECT_AREA) return false;
    const turns = points.map((point, index) => {
      const previous = points[(index + 3) % 4];
      const next = points[(index + 1) % 4];
      return (point.x - previous.x) * (next.y - point.y)
        - (point.y - previous.y) * (next.x - point.x);
    });
    return turns.every((value) => value > 0) || turns.every((value) => value < 0);
  }

  function cropRectFromLegacyQuad(points) {
    if (!isValidLegacyQuad(points)) return null;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const right = Math.max(...xs);
    const bottom = Math.max(...ys);
    const rect = { x: left, y: top, width: right - left, height: bottom - top };
    return isValidCropRect(rect) ? rect : null;
  }

  function getCropRect(target) {
    if (isValidCropRect(target?.cropRect)) return { ...target.cropRect };
    return cropRectFromLegacyQuad(target?.selectedQuad);
  }

  function getPixelCropBounds(sourceWidth, sourceHeight, rect) {
    if (!Number.isInteger(sourceWidth) || sourceWidth < 1
      || !Number.isInteger(sourceHeight) || sourceHeight < 1
      || !isValidCropRect(rect)) return null;
    const left = Math.max(0, Math.min(sourceWidth - 1, Math.floor(rect.x * sourceWidth)));
    const top = Math.max(0, Math.min(sourceHeight - 1, Math.floor(rect.y * sourceHeight)));
    const right = Math.max(left + 1, Math.min(sourceWidth, Math.ceil((rect.x + rect.width) * sourceWidth)));
    const bottom = Math.max(top + 1, Math.min(sourceHeight, Math.ceil((rect.y + rect.height) * sourceHeight)));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function moveCropRect(rect, deltaX, deltaY) {
    if (!isValidCropRect(rect) || !Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return null;
    const maximumX = 1 - rect.width;
    const maximumY = 1 - rect.height;
    const x = Math.max(0, Math.min(maximumX, rect.x + deltaX));
    const y = Math.max(0, Math.min(maximumY, rect.y + deltaY));
    return { x, y, width: rect.width, height: rect.height };
  }

  function resizeCropRect(rect, handle, deltaX, deltaY, minimumWidth = 0.001, minimumHeight = 0.001) {
    const validHandles = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
    if (!isValidCropRect(rect) || !validHandles.includes(handle)
      || !Number.isFinite(deltaX) || !Number.isFinite(deltaY)
      || !Number.isFinite(minimumWidth) || !Number.isFinite(minimumHeight)
      || minimumWidth <= 0 || minimumHeight <= 0) return null;

    let left = rect.x;
    let top = rect.y;
    let right = rect.x + rect.width;
    let bottom = rect.y + rect.height;

    if (handle.includes('w')) left = Math.max(0, Math.min(right - minimumWidth, left + deltaX));
    if (handle.includes('e')) right = Math.min(1, Math.max(left + minimumWidth, right + deltaX));
    if (handle.includes('n')) top = Math.max(0, Math.min(bottom - minimumHeight, top + deltaY));
    if (handle.includes('s')) bottom = Math.min(1, Math.max(top + minimumHeight, bottom + deltaY));

    const resized = { x: left, y: top, width: right - left, height: bottom - top };
    return isValidCropRect(resized) ? resized : null;
  }

  const api = Object.freeze({
    isValidCropRect,
    cropRectFromLegacyQuad,
    getCropRect,
    getPixelCropBounds,
    moveCropRect,
    resizeCropRect
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MindBasicGeometry = api;
})(typeof window !== 'undefined' ? window : globalThis);
