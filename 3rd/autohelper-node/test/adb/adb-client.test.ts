import { describe, expect, it } from 'vitest';
import { AdbClient } from '../../src/adb/adb-client.js';

describe('AdbClient', () => {
  it('uses the explicit serial for screenshot and tap', async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const client = new AdbClient({
      serial: '192.168.1.6:5555',
      runner: async (file, args) => {
        calls.push({ file, args });
        return { stdout: Buffer.from('png'), stderr: Buffer.alloc(0), exitCode: 0 };
      },
    });

    await expect(client.screenshot()).resolves.toEqual(Buffer.from('png'));
    await client.tap(100, 200);

    expect(calls).toEqual([
      { file: 'adb', args: ['-s', '192.168.1.6:5555', 'exec-out', 'screencap', '-p'] },
      { file: 'adb', args: ['-s', '192.168.1.6:5555', 'shell', 'input', 'tap', '100', '200'] },
    ]);
  });

  it('fails before automation when the selected device is offline', async () => {
    const client = new AdbClient({
      serial: 'offline-device',
      runner: async () => ({
        stdout: Buffer.from('offline-device\toffline\n'),
        stderr: Buffer.alloc(0),
        exitCode: 0,
      }),
    });

    await expect(client.assertConnected()).rejects.toThrow('ADB device is not ready');
  });

  it('rejects invalid tap coordinates before invoking adb', async () => {
    let callCount = 0;
    const client = new AdbClient({
      serial: 'device',
      runner: async () => {
        callCount += 1;
        return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0 };
      },
    });

    await expect(client.tap(-1, 10)).rejects.toThrow('invalid tap coordinates');
    expect(callCount).toBe(0);
  });
});
