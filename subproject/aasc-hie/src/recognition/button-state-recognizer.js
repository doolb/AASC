const roiFeature = (image, bounds, columns = 8, rows = 6) => {
  const values = new Uint8Array(columns * rows * 3);
  let offset = 0;
  for (let row = 0; row < rows; row += 1) {
    const y = Math.min(image.height - 1, Math.floor(bounds.y + (row + 0.5) * bounds.height / rows));
    for (let column = 0; column < columns; column += 1) {
      const x = Math.min(image.width - 1, Math.floor(bounds.x + (column + 0.5) * bounds.width / columns));
      const source = (y * image.width + x) * 4;
      values[offset++] = image.data[source];
      values[offset++] = image.data[source + 1];
      values[offset++] = image.data[source + 2];
    }
  }
  return values;
};

/** Compare a button's current pixels to reviewed state-specific ROI samples. */
export class ButtonStateRecognizer {
  constructor(profiles = []) {
    this.profiles = new Map(profiles.map((profile) => [profile.buttonId, profile]));
  }

  recognize(image, buttonId) {
    const profile = this.profiles.get(buttonId);
    if (!profile || !Array.isArray(profile.states) || profile.states.length < 2) return undefined;
    const current = roiFeature(image, profile.bounds, profile.columns ?? 8, profile.rows ?? 6);
    const ranked = profile.states.map((sample) => {
      const feature = sample.feature instanceof Uint8Array
        ? sample.feature : new Uint8Array(Buffer.from(sample.featureBase64 ?? '', 'base64'));
      if (feature.length !== current.length) return { state: sample.state, distance: 1 };
      let total = 0;
      for (let index = 0; index < current.length; index += 1) total += Math.abs(current[index] - feature[index]);
      return { state: sample.state, distance: total / (current.length * 255) };
    }).sort((left, right) => left.distance - right.distance);
    const best = ranked[0];
    const margin = ranked[1].distance - best.distance;
    if (best.distance > Number(profile.maxDistance ?? 0.04)
      || margin < Number(profile.minMargin ?? 0.015)) return undefined;
    return {
      state: best.state,
      confidence: Math.max(0, Math.min(1, 1 - best.distance)),
      method: 'button-roi-reference',
      distance: Number(best.distance.toFixed(5)),
      margin: Number(margin.toFixed(5)),
    };
  }
}
