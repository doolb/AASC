import { describe, expect, it } from 'vitest';
import { AdbClient } from '../../src/execution/adb-client.js';

describe('AdbClient', () => {
  it('uses argument arrays and validates inputs before the runner', async () => {
    const calls = [];
    const client = new AdbClient({ serial: 'device-1', runner: async (file, args) => {
      calls.push({ file, args });
      return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
    } });

    await client.tap(100, 200);
    await client.swipe(1, 2, 3, 4, 250);
    expect(calls).toEqual([
      { file: 'adb', args: ['-s', 'device-1', 'shell', 'input', 'tap', '100', '200'] },
      { file: 'adb', args: ['-s', 'device-1', 'shell', 'input', 'swipe', '1', '2', '3', '4', '250'] },
    ]);
    await expect(client.tap(-1, 2)).rejects.toThrow('invalid tap coordinates');
    expect(calls).toHaveLength(2);
  });

  it('requires an explicit serial and only reports the selected device', async () => {
    const client = new AdbClient({ serial: 'device-2', runner: async () => ({ stdout: Buffer.from('List of devices attached\ndevice-1\tdevice\ndevice-2\tdevice\n'), stderr: Buffer.from(''), exitCode: 0 }) });

    await expect(client.listDevices()).resolves.toEqual(['device-1', 'device-2']);
    expect(() => new AdbClient({ runner: async () => ({ stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 }) })).toThrow('ADB serial is required');
    await expect(new AdbClient({ serial: 'device-3', runner: async () => ({ stdout: Buffer.from('List of devices attached\ndevice-1\tdevice\n'), stderr: Buffer.from(''), exitCode: 0 }) }).assertConnected()).rejects.toThrow('device-3');
  });
});
