const isSelectable = (candidate) => (candidate.descriptor.queue >= 0
    && candidate.match.matched
    && candidate.match.rect !== null);
const satisfiesSelectImage = (candidate, allMatches) => {
    const selectedImage = candidate.descriptor.selectImage;
    if (!selectedImage) {
        return true;
    }
    const selectedMatch = allMatches.get(selectedImage);
    return Boolean(selectedMatch?.matched && selectedMatch.rect !== null);
};
/** OCR 条件使用包含关系，适配 OCR 可能返回的前后提示文字。 */
export const satisfiesOcr = (descriptor, ocrResult) => {
    const requiredText = descriptor.ocrText;
    if (!requiredText) {
        return true;
    }
    return Boolean(ocrResult?.boxes.some((box) => box.text.includes(requiredText)));
};
/** 根据图片元数据选择当前 Flow 中唯一的动作。 */
export const selectAction = (candidates, allMatches, ocrResult) => {
    const validCandidates = candidates.filter((candidate) => (isSelectable(candidate)
        && satisfiesSelectImage(candidate, allMatches)
        && satisfiesOcr(candidate.descriptor, ocrResult)));
    const ordinaryCandidates = validCandidates.filter((candidate) => !candidate.descriptor.defaultCandidate);
    const pool = ordinaryCandidates.length > 0
        ? ordinaryCandidates
        : validCandidates.filter((candidate) => candidate.descriptor.defaultCandidate);
    const ranked = [...pool].sort((left, right) => (right.descriptor.queue - left.descriptor.queue
        || right.match.score - left.match.score
        || left.descriptor.name.localeCompare(right.descriptor.name)));
    const selected = ranked[0];
    return selected ? { descriptor: selected.descriptor, match: selected.match } : null;
};
const clamp = (value, minimum, maximum) => (Math.min(Math.max(value, minimum), maximum));
const assertFrameSize = (frameSize) => {
    if (!Number.isInteger(frameSize.width) || !Number.isInteger(frameSize.height)
        || frameSize.width <= 0 || frameSize.height <= 0) {
        throw new Error('invalid frame size');
    }
};
/** 将模板矩形内的归一化点转换为设备像素，并限制在截图范围内。 */
export const resolveClickPoint = (descriptor, rect, frameSize) => {
    assertFrameSize(frameSize);
    if (descriptor.centerClick) {
        return {
            x: Math.floor(frameSize.width / 2),
            y: Math.floor(frameSize.height / 2),
        };
    }
    const x = Math.round(rect.x + (rect.width * descriptor.clickPoint.x));
    const y = Math.round(rect.y + (rect.height * descriptor.clickPoint.y));
    return {
        x: clamp(x, 0, frameSize.width - 1),
        y: clamp(y, 0, frameSize.height - 1),
    };
};
