import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { decodeImage } from './image-decoder.js';
import { BattleHudRecognizer } from './battle-hud-recognizer.js';
import { SceneFingerprintClassifier } from './scene-fingerprint-classifier.js';
import { ButtonStateRecognizer } from './button-state-recognizer.js';

const stateById = (navigationPackage) => new Map((navigationPackage.states ?? []).map((state) => [state.id, state]));
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

/** Observation-only state description backed by the curated screenshot dataset. */
export class GameStateRecognizer {
  constructor(options = {}) {
    this.package = options.navigationPackage;
    if (!this.package?.stateRecognition || !Array.isArray(this.package.states)) {
      throw new Error('recognition package stateRecognition and states are required');
    }
    this.now = options.now ?? (() => Date.now());
    this.ocrClient = options.ocrClient;
    this.states = stateById(this.package);
    const config = this.package.stateRecognition;
    const packageRoot = options.packageRoot ?? process.cwd();
    const manifestPath = resolve(packageRoot, config.dataset.manifest);
    this.classifier = options.classifier ?? new SceneFingerprintClassifier({
      manifestPath,
      fingerprintPath: config.sceneClassifier.fingerprintIndex
        ? resolve(packageRoot, config.sceneClassifier.fingerprintIndex) : undefined,
      ...config.sceneClassifier,
    });
    this.battleHud = options.battleHudRecognizer ?? new BattleHudRecognizer(this.package.battleRecognition);
    this.uiInventory = config.uiInventory ?? [];
  }

  async observe(frameValue) {
    const frame = Buffer.isBuffer(frameValue) || frameValue instanceof Uint8Array
      ? { buffer: Buffer.from(frameValue), observedAt: this.now(), source: 'external' }
      : { ...frameValue, observedAt: Number.isFinite(frameValue?.observedAt) ? frameValue.observedAt : this.now() };
    if (!frame || (!frame.image?.data && !frame.buffer)) throw new Error('game-state frame must contain image or buffer');
    const image = frame.image?.data ? frame.image : decodeImage(frame.buffer, 'frame.png');
    const expected = this.package.stateRecognition.frameSize;
    if (image.width !== expected.width || image.height !== expected.height) {
      return this.unknown(frame, 'frame-dimensions-mismatch', { width: image.width, height: image.height });
    }

    const textPromise = this.readText(frame, image);
    await this.classifier.load();
    this.buttonStates ??= new ButtonStateRecognizer(this.classifier.buttonProfiles);
    const [match, battle, textResult] = await Promise.all([
      this.classifier.classify({ ...frame, image }),
      this.battleHud.observe({ ...frame, image }),
      textPromise,
    ]);
    let sceneId = match.matched ? match.sceneId : undefined;
    let sceneMethod = match.matched ? 'dataset-fingerprint' : 'unknown';
    if (battle.ui?.some((entry) => entry.id === this.package.battleRecognition.uiId)) {
      if (!sceneId || !sceneId.startsWith('hok-battle-')) sceneId = this.package.battleRecognition.uiId;
      sceneMethod = sceneId === this.package.battleRecognition.uiId ? 'battle-hud-probe' : sceneMethod;
    }
    if (!sceneId || !this.states.has(sceneId)) return this.unknown(frame, match.reason ?? 'scene-unmatched', {
      fingerprint: { similarity: match.similarity, distance: match.distance, margin: match.margin },
      ...(battle.ui?.length ? { battleHud: true } : {}),
    }, textResult);

    const state = this.states.get(sceneId);
    const confidence = sceneMethod === 'battle-hud-probe' ? clamp01(battle.confidence) : clamp01(match.similarity);
    const uiIds = Array.isArray(state.uis) ? state.uis : [state.topmost];
    const uis = uiIds.filter(Boolean).map((id) => {
      const item = this.uiInventory.find((candidate) => candidate.id === id);
      return { id, labelZh: item?.labelZh ?? this.states.get(id)?.labelZh ?? id, ...(item?.bounds ? { bounds: item.bounds } : {}), confidence };
    });
    const buttonOwners = this.package.stateRecognition.buttonOwnersByState?.[sceneId] ?? uiIds;
    const exactAnnotation = match.matched && match.distance <= Number(this.package.stateRecognition.sampleEchoMaxDistance ?? 0.003)
      ? match.sample : undefined;
    const annotatedButtons = new Map((exactAnnotation?.buttons ?? []).map((button) => [button.id, button]));
    const buttons = this.uiInventory
      .filter((item) => buttonOwners.includes(item.id))
      .flatMap((item) => (item.buttons ?? []).map((button) => {
        const sample = annotatedButtons.get(button.id);
        const useSampleState = sample && ['enabled', 'disabled', 'selected', 'pressed', 'cooldown'].includes(sample.state);
        const detection = this.buttonStates.recognize(image, button.id);
        const detectedState = detection?.state;
        const state = useSampleState ? sample.state : (detectedState ?? button.defaultVisibleState ?? 'unknown');
        const evidence = useSampleState ? 'exact-curated-frame'
          : (detection?.method ?? (button.defaultVisibleState ? 'visible-in-recognized-scene' : 'no-live-button-detector'));
        return {
          id: button.id,
          labelZh: button.labelZh ?? button.id,
          bounds: button.bounds,
          state,
          confidence: useSampleState ? confidence : (detection?.confidence ?? (button.defaultVisibleState ? confidence * 0.85 : 0)),
          evidence,
        };
      }));
    const healthRatio = battle.values?.healthRatio?.value;
    const manaRatio = battle.values?.manaRatio?.value;
    const values = {
      ...(Number.isFinite(healthRatio) ? { healthRatio: { value: healthRatio, confidence: battle.values.healthRatio.confidence } } : {}),
      ...(battle.values?.manaRatio ? { manaRatio: battle.values.manaRatio } : {}),
    };
    const visibleName = state.labelZh ?? match.labelZh ?? sceneId;
    const knownButtonCount = buttons.filter((button) => button.state !== 'unknown').length;
    const buttonSummary = buttons.length ? `按钮状态已确认 ${knownButtonCount}/${buttons.length} 项。` : '';
    const textSummary = textResult.status === 'ok'
      ? `识别到文字 ${textResult.boxes.length} 项。`
      : '未启用文字识别。';
    const summaryZh = Number.isFinite(healthRatio)
      ? `${visibleName}；血量约 ${Math.round(healthRatio * 100)}%${Number.isFinite(manaRatio) ? `，蓝量约 ${Math.round(manaRatio * 100)}%` : ''}。${buttonSummary}${textSummary}`
      : `${visibleName}；识别相似度 ${Math.round(confidence * 100)}%。${buttonSummary}${textSummary}`;
    return {
      observedAt: frame.observedAt,
      frameAgeMs: Math.max(0, this.now() - frame.observedAt),
      source: frame.source ?? 'external',
      scene: { id: sceneId, labelZh: visibleName, confidence, method: sceneMethod },
      topmost: state.topmost,
      uis,
      buttons,
      values,
      visibleTexts: textResult.boxes,
      textReadStatus: textResult.status,
      ...(textResult.error ? { textReadError: textResult.error } : {}),
      unknowns: buttons.filter((button) => button.state === 'unknown').map((button) => `button-state:${button.id}`),
      confidence,
      summaryZh,
    };
  }

  async readText(frame, image) {
    if (!this.ocrClient) return { boxes: [], status: 'not-configured' };
    try {
      const imageBuffer = frame.buffer?.length
        ? frame.buffer
        : PNG.sync.write({ width: image.width, height: image.height, data: Buffer.from(image.data) });
      const result = await this.ocrClient.read(imageBuffer, this.package.stateRecognition.ocr?.options ?? {});
      return { boxes: result.boxes ?? [], status: 'ok' };
    } catch (error) {
      return { boxes: [], status: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  }

  unknown(frame, reason, details = {}, textResult = { boxes: [], status: 'not-configured' }) {
    return {
      observedAt: frame.observedAt,
      frameAgeMs: Math.max(0, this.now() - frame.observedAt),
      source: frame.source ?? 'external',
      scene: { id: 'unknown', labelZh: '未匹配画面', confidence: 0, method: 'unknown' },
      topmost: 'unknown',
      uis: [],
      buttons: [],
      values: {},
      visibleTexts: textResult.boxes,
      textReadStatus: textResult.status,
      ...(textResult.error ? { textReadError: textResult.error } : {}),
      unknowns: [reason],
      confidence: 0,
      summaryZh: '当前画面不在已采样场景内，保留为未知状态。',
      details,
    };
  }
}
