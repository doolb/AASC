import { spawn } from 'node:child_process';

/** Low-latency Android display stream: screenrecord H.264 decoded to RGBA frames. */
export class AdbVideoFrameSource {
  constructor(options = {}) {
    if (typeof options.serial !== 'string' || !options.serial.trim()) throw new Error('ADB serial is required');
    this.serial = options.serial.trim();
    this.width = Number(options.width ?? 1480);
    this.height = Number(options.height ?? 720);
    this.fps = Number(options.fps ?? 2);
    this.bitRate = Number(options.bitRate ?? 3_000_000);
    if (!Number.isInteger(this.width) || this.width < 1 || !Number.isInteger(this.height) || this.height < 1) throw new Error('valid stream dimensions are required');
    if (!Number.isFinite(this.fps) || this.fps <= 0 || this.fps > 10) throw new Error('stream fps must be between 0 and 10');
    this.now = options.now ?? (() => Date.now());
    this.spawn = options.spawn ?? spawn;
    this.queue = [];
    this.waiters = [];
    this.parts = [];
    this.firstPartOffset = 0;
    this.pendingBytes = 0;
    this.lastEmittedAt = 0;
    this.frameBytes = this.width * this.height * 4;
    this.closed = false;
    this.failure = null;
    this.start();
  }

  start() {
    this.adb = this.spawn('adb', ['-s', this.serial, 'exec-out', 'screenrecord', '--output-format=h264', '--bit-rate', String(this.bitRate), '--time-limit', '180', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.decoder = this.spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'h264', '-i', 'pipe:0', '-vf', `fps=${this.fps}`, '-an', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.adb.stdout.pipe(this.decoder.stdin);
    this.decoder.stdout.on('data', (chunk) => this.consume(chunk));
    this.adb.stderr.on('data', () => {});
    this.decoder.stderr.on('data', () => {});
    this.decoder.stdin.on('error', (error) => { if (!this.closed) this.fail(error); });
    this.adb.once('error', (error) => this.fail(error));
    this.decoder.once('error', (error) => this.fail(error));
    this.adb.once('close', (code) => { if (!this.closed && code !== 0) this.fail(new Error(`ADB screenrecord exited (${code})`)); });
    this.decoder.once('close', (code) => { if (!this.closed) this.fail(new Error(`screen stream ended (ffmpeg ${code})`)); });
  }

  consume(chunk) {
    this.parts.push(chunk);
    this.pendingBytes += chunk.length;
    while (this.pendingBytes >= this.frameBytes) {
      const raw = Buffer.allocUnsafe(this.frameBytes);
      let written = 0;
      while (written < this.frameBytes) {
        const part = this.parts[0];
        const available = part.length - this.firstPartOffset;
        const copied = Math.min(available, this.frameBytes - written);
        part.copy(raw, written, this.firstPartOffset, this.firstPartOffset + copied);
        written += copied;
        this.firstPartOffset += copied;
        if (this.firstPartOffset === part.length) {
          this.parts.shift();
          this.firstPartOffset = 0;
        }
      }
      this.pendingBytes -= this.frameBytes;
      const observedAt = this.now();
      if (this.lastEmittedAt && observedAt - this.lastEmittedAt < 1000 / this.fps) continue;
      this.lastEmittedAt = observedAt;
      const frame = {
        buffer: Buffer.alloc(0),
        image: { width: this.width, height: this.height, data: new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) },
        observedAt,
        source: `adb-screenrecord:${this.serial}`,
      };
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(frame); else this.queue.push(frame);
      if (this.queue.length > 2) this.queue.shift();
    }
  }

  fail(error) {
    if (this.failure || this.closed) return;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  async next() {
    if (this.closed) throw new Error('ADB video frame source is closed');
    if (this.failure) throw this.failure;
    if (this.queue.length) return this.queue.shift();
    return await new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.adb?.kill('SIGTERM');
    this.decoder?.kill('SIGTERM');
    for (const waiter of this.waiters.splice(0)) waiter.reject(new Error('ADB video frame source is closed'));
  }
}
