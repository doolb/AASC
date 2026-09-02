// 下载 LFM2.5-VL-1.6B ONNX 模型文件到 res/models/lfm-vl/
// 用法: node scripts/models/download-lfm-vl-model.js [--source modelscope|huggingface]
const https = require('https');
const fs = require('fs');
const path = require('path');

const MODEL_DIR = path.resolve(__dirname, '../../res/models/lfm-vl');

const SOURCES = {
  modelscope: {
    base: 'https://www.modelscope.cn/models/LiquidAI/LFM2.5-VL-1.6B-ONNX/resolve',
    files: ['onnx/embed_images_fp16.onnx', 'onnx/decoder_q4.onnx']
  },
  huggingface: {
    base: 'https://huggingface.co/liquid-ai/LFM-2.5-VL-1.6B-ONNX/resolve/main',
    files: ['onnx/embed_images_fp16.onnx', 'onnx/decoder_q4.onnx']
  }
};

function downloadFile(url, dest) {
  return new Promise(function(resolve, reject) {
    var file = fs.createWriteStream(dest);
    https.get(url, function(response) {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        // Follow redirect
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error('HTTP ' + response.statusCode + ' for ' + url));
        return;
      }
      var totalBytes = parseInt(response.headers['content-length'] || '0');
      var downloaded = 0;
      response.on('data', function(chunk) {
        downloaded += chunk.length;
        if (totalBytes > 0) {
          var pct = Math.round(downloaded / totalBytes * 100);
          process.stdout.write('\r  ' + path.basename(dest) + ': ' + pct + '% (' + (downloaded / 1024 / 1024).toFixed(1) + 'MB)');
        }
      });
      response.pipe(file);
      file.on('finish', function() {
        file.close();
        process.stdout.write('\n');
        resolve();
      });
    }).on('error', function(err) {
      file.close();
      try { fs.unlinkSync(dest); } catch(e) {}
      reject(err);
    });
  });
}

async function main() {
  var sourceName = 'modelscope';
  for (var i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--source' && process.argv[i + 1]) {
      sourceName = process.argv[i + 1];
      break;
    }
  }

  var config = SOURCES[sourceName];
  if (!config) {
    console.error('未知下载源: ' + sourceName + '，可选: modelscope, huggingface');
    process.exit(1);
  }

  fs.mkdirSync(MODEL_DIR, { recursive: true });
  console.log('下载源: ' + sourceName);

  for (var i = 0; i < config.files.length; i++) {
    var filePath = config.files[i];
    var url = config.base + '/' + filePath;
    var dest = path.join(MODEL_DIR, path.basename(filePath));
    console.log('下载 ' + path.basename(filePath) + ' ...');
    await downloadFile(url, dest);
    console.log('  ✓ 已保存到 ' + dest);
  }
  console.log('所有模型文件下载完成');
}

main().catch(function(err) {
  console.error('下载失败:', err.message);
  process.exit(1);
});
