import { decodeImage } from './image-decoder.js';
import { measureColorBarRatio } from './script-recognition.js';
import { normalizeObservation } from './observation-normalizer.js';

/** A configured HUD probe. Entity detection is injected and remains observation-only. */
export class BattleHudRecognizer {
  constructor(options = {}) {
    this.uiId = options.uiId;
    this.width = Number(options.width);
    this.height = Number(options.height);
    this.healthBar = options.healthBar;
    this.manaBar = options.manaBar;
    this.minGreenRatio = Number(options.minGreenRatio ?? 0.03);
    this.entityDetector = options.entityDetector;
    if (!this.uiId || !this.healthBar || !Number.isInteger(this.width) || !Number.isInteger(this.height)) {
      throw new Error('battle HUD id, dimensions, and health bar ROI are required');
    }
  }

  async observe(frame) {
    const image = frame.image?.data
      ? frame.image : decodeImage(frame.buffer, 'battle-frame.png');
    const dimensionsMatch = image.width === this.width && image.height === this.height;
    const healthRatio = dimensionsMatch
      ? measureColorBarRatio(image, this.healthBar, { color: 'green' }) : 0;
    const battleConfirmed = dimensionsMatch && healthRatio >= this.minGreenRatio;
    const entities = battleConfirmed && this.entityDetector?.detect
      ? await this.entityDetector.detect(frame, image) : [];
    const manaRatio = dimensionsMatch && this.manaBar
      ? measureColorBarRatio(image, this.manaBar, { color: 'blue' }) : undefined;
    return normalizeObservation({
      observedAt: frame.observedAt,
      source: frame.source,
      ui: battleConfirmed ? [{ id: this.uiId, confidence: healthRatio }] : [],
      values: battleConfirmed ? {
        healthRatio: { value: healthRatio, confidence: Math.min(1, Math.max(0.3, healthRatio)) },
        ...(manaRatio === undefined ? {} : { manaRatio: { value: manaRatio, confidence: Math.min(1, Math.max(0.3, manaRatio)) } }),
      } : {},
      entities: Array.isArray(entities) ? entities : [],
      confidence: battleConfirmed ? Math.min(1, healthRatio) : 0,
    });
  }
}
