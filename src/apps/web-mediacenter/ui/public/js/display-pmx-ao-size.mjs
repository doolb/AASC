/*
 * PMX 环境遮蔽的绘制尺寸由真实绘制缓冲区决定。
 * 限制短边与长边的像素预算，避免高 DPI Android 显示端重复采样过多深度像素。
 */
export function calculatePmxAoSize(drawingWidth, drawingHeight, resolutionMode = 'half') {
    const width = Math.max(1, Math.floor(Number(drawingWidth) || 1));
    const height = Math.max(1, Math.floor(Number(drawingHeight) || 1));
    if (resolutionMode === 'full') return { width, height };
    const scale = Math.min(0.5, 1280 / width, 720 / height);
    return {
        width: Math.max(1, Math.floor(width * scale)),
        height: Math.max(1, Math.floor(height * scale))
    };
}
