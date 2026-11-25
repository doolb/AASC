import { describe, expect, it } from 'vitest';
import { OcrClient } from '../../src/recognition/ocr-client.js';

describe('OcrClient', () => {
  it('uses a 60 second default and respects explicitly configured timeouts', async () => {
    const timeouts = [];
    const request = async (url, body, options) => {
      timeouts.push(options.timeoutMs);
      return { statusCode: 200, body: JSON.stringify({ status: 'success', boxes: [] }) };
    };
    const client = new OcrClient({ request });
    await client.read(Buffer.from('screen'));
    await client.read(Buffer.from('screen'), { timeoutMs: 7000 });
    await new OcrClient({ request, timeoutMs: 9000 }).read(Buffer.from('screen'));
    expect(timeouts).toEqual([60000, 7000, 9000]);
  });
  it('sends image bytes and parses external OCR boxes', async () => {
    let requestUrl;
    let requestBody;
    const client = new OcrClient({
      baseUrl: 'http://127.0.0.1:8081',
      shortSide: 720,
      request: async (url, body) => {
        requestUrl = url;
        requestBody = body;
        return {
          statusCode: 200,
          body: JSON.stringify({
            status: 'success',
            imageWidth: 720,
            imageHeight: 1480,
            boxes: [{ text: '确认：放弃福利', score: 0.98, points: [[10, 20], { x: 110, y: 20 }] }],
          }),
        };
      },
    });

    await expect(client.read(Buffer.from('screen'))).resolves.toEqual({
      boxes: [{
        text: '确认：放弃福利',
        score: 0.98,
        points: [{ x: 10, y: 20 }, { x: 110, y: 20 }],
      }],
      imageWidth: 720,
      imageHeight: 1480,
    });
    expect(requestUrl).toBe('http://127.0.0.1:8081/api/vision/ocr');
    expect(JSON.parse(requestBody)).toEqual({
      imageBase64: Buffer.from('screen').toString('base64'),
      shortSide: 720,
    });
  });

  it('surfaces an external OCR error without requiring a running service', async () => {
    const client = new OcrClient({
      baseUrl: 'http://127.0.0.1:8081',
      request: async () => ({
        statusCode: 503,
        body: JSON.stringify({ status: 'error', message: 'no OCR display' }),
      }),
    });

    await expect(client.read(Buffer.from('screen'))).rejects.toThrow('no OCR display');
  });
});
