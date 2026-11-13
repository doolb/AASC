const isFrame = (value) => (
  value && typeof value === 'object' && value.buffer !== undefined
    && Number.isFinite(value.observedAt) && typeof value.source === 'string'
);

/**
 * A frame source is deliberately supplied by the host. Recognition can consume
 * device, browser, replay, or test frames without knowing how they arrived.
 */
export class FrameSource {
  constructor(next) {
    if (typeof next !== 'function') throw new Error('FrameSource requires a next function');
    this.nextFrame = next;
  }

  async next() {
    const frame = await this.nextFrame();
    if (!isFrame(frame)) {
      throw new Error('FrameSource.next() must return { buffer, observedAt, source }');
    }
    return frame;
  }
}

export const createFrameSource = (next) => new FrameSource(next);

/** Frame source backed by one explicitly configured ADB client. */
export class AdbFrameSource extends FrameSource {
  constructor(options = {}) {
    const client = options.client;
    if (!client?.screenshot || typeof client.serial !== 'string' || !client.serial.trim()) {
      throw new Error('explicit ADB client serial and screenshot method are required');
    }
    let verified = false;
    super(async () => {
      if (options.verifyConnection !== false && !verified) {
        if (typeof client.assertConnected !== 'function') throw new Error('ADB client connection verification is required');
        await client.assertConnected();
        verified = true;
      }
      return {
        buffer: await client.screenshot(),
        observedAt: Number(options.now?.() ?? Date.now()),
        source: `adb:${client.serial.trim()}`,
      };
    });
  }
}
