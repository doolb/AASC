import { describe, expect, it } from 'vitest';
import { OcrClient } from '../../src/vision/ocr-client.js';
describe('OcrClient', () => {
    it('sends the screenshot and parses OCR boxes', async () => {
        let requestUrl = '';
        let requestBody = '';
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
                        boxes: [{
                                text: '确认：放弃福利',
                                score: 0.98,
                                points: [[10, 20], { x: 110, y: 20 }, [110, 80], { x: 10, y: 80 }],
                            }],
                    }),
                };
            },
        });
        const result = await client.recognize(Buffer.from('screen'));
        expect(requestUrl).toBe('http://127.0.0.1:8081/api/vision/ocr');
        expect(JSON.parse(requestBody)).toEqual({
            imageBase64: Buffer.from('screen').toString('base64'),
            shortSide: 720,
        });
        expect(result.boxes[0]).toEqual({
            text: '确认：放弃福利',
            score: 0.98,
            points: [
                { x: 10, y: 20 },
                { x: 110, y: 20 },
                { x: 110, y: 80 },
                { x: 10, y: 80 },
            ],
        });
    });
    it('raises the API error message for an unsuccessful response', async () => {
        const client = new OcrClient({
            baseUrl: 'http://127.0.0.1:8081',
            request: async () => ({
                statusCode: 503,
                body: JSON.stringify({ status: 'error', message: 'no OCR display' }),
            }),
        });
        await expect(client.recognize(Buffer.from('screen'))).rejects.toThrow('no OCR display');
    });
});
