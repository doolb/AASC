const test = require('node:test');
const assert = require('node:assert/strict');
const QRCode = require('qrcode');
const jsQR = require('jsqr');

test('房主局域网地址生成的二维码可被扫码客户端识别', () => {
    const address = 'http://192.168.1.123:8765/';
    const qr = QRCode.create(address, { errorCorrectionLevel: 'M' });
    const scale = 6, margin = 4, width = (qr.modules.size + margin * 2) * scale;
    const pixels = new Uint8ClampedArray(width * width * 4);
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
        const row = Math.floor(y / scale) - margin, col = Math.floor(x / scale) - margin;
        const dark = row >= 0 && col >= 0 && row < qr.modules.size && col < qr.modules.size && qr.modules.get(row, col);
        const offset = (y * width + x) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = dark ? 0 : 255; pixels[offset + 3] = 255;
    }
    assert.equal(jsQR(pixels, width, width).data, address);
});
