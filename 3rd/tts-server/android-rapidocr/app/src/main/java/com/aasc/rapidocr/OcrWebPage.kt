package com.aasc.rapidocr

/**
 * APK 内置的单文件测试网页。页面不依赖 CDN 或其它网络资源，打开后可直接选择图片并调用同一 APK 的接口。
 */
object OcrWebPage {
    val HTML: String = """
        <!doctype html>
        <html lang="zh-CN">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>RapidOCR 图片测试</title>
          <style>
            :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
            body { max-width: 980px; margin: 0 auto; padding: 20px; }
            section { margin: 16px 0; padding: 16px; border: 1px solid #8885; border-radius: 12px; }
            button, input { font: inherit; margin: 4px 0; }
            button { padding: 8px 14px; cursor: pointer; }
            #previewBox { position: relative; max-width: 100%; overflow: auto; }
            #imagePreview { display: block; max-width: 100%; height: auto; }
            #boxesOverlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
            pre { white-space: pre-wrap; word-break: break-word; }
            .muted { opacity: .75; }
            .error { color: #d33; }
          </style>
        </head>
        <body>
          <h1>RapidOCR 图片测试</h1>
          <p class="muted">选择 JPG、PNG 或 WebP 图片，图片字节会直接发送给 APK 的本地 HTTP 接口。</p>
          <section>
            <label for="imageInput">测试图片：</label>
            <input id="imageInput" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp">
            <button id="recognizeButton" type="button" disabled>开始识别</button>
            <span id="healthText" class="muted">正在检查服务...</span>
          </section>
          <section id="previewBox">
            <img id="imagePreview" alt="待识别图片预览" hidden>
            <canvas id="boxesOverlay"></canvas>
            <p id="previewHint" class="muted">尚未选择图片</p>
          </section>
          <section>
            <h2>识别结果</h2>
            <p id="elapsedText">耗时：-</p>
            <pre id="resultText">结果会显示在这里</pre>
            <pre id="boxesText"></pre>
            <p id="errorText" class="error"></p>
          </section>
          <script>
            (() => {
              const imageInput = document.getElementById('imageInput');
              const imagePreview = document.getElementById('imagePreview');
              const recognizeButton = document.getElementById('recognizeButton');
              const boxesOverlay = document.getElementById('boxesOverlay');
              const previewHint = document.getElementById('previewHint');
              const resultText = document.getElementById('resultText');
              const boxesText = document.getElementById('boxesText');
              const elapsedText = document.getElementById('elapsedText');
              const errorText = document.getElementById('errorText');
              const healthText = document.getElementById('healthText');
              let selectedFile = null;
              let objectUrl = null;

              const mimeForFile = (file) => {
                if (file.type) return file.type;
                const name = file.name.toLowerCase();
                if (name.endsWith('.png')) return 'image/png';
                if (name.endsWith('.webp')) return 'image/webp';
                return 'image/jpeg';
              };

              const clearError = () => { errorText.textContent = ''; };
              const clearBoxes = () => {
                const context = boxesOverlay.getContext('2d');
                context.clearRect(0, 0, boxesOverlay.width, boxesOverlay.height);
              };
              const drawBoxes = (data) => {
                clearBoxes();
                if (!data || !data.boxes || !imagePreview.naturalWidth) return;
                const scaleX = imagePreview.clientWidth / imagePreview.naturalWidth;
                const scaleY = imagePreview.clientHeight / imagePreview.naturalHeight;
                boxesOverlay.width = imagePreview.clientWidth;
                boxesOverlay.height = imagePreview.clientHeight;
                const context = boxesOverlay.getContext('2d');
                context.lineWidth = 2;
                data.boxes.forEach((box) => {
                  if (!box.points || box.points.length < 4) return;
                  context.beginPath();
                  box.points.forEach((point, index) => {
                    const x = point[0] * scaleX;
                    const y = point[1] * scaleY;
                    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
                  });
                  context.closePath();
                  context.strokeStyle = '#20b46b';
                  context.stroke();
                });
              };
              const refreshHealth = async () => {
                try {
                  const response = await fetch('/health');
                  const data = await response.json();
                  healthText.textContent = data.modelReady ? '模型已就绪' : '模型未就绪，请在 APK 中启动模型';
                } catch (error) {
                  healthText.textContent = '无法连接到 HTTP 服务';
                }
              };

              imageInput.addEventListener('change', () => {
                clearError();
                clearBoxes();
                selectedFile = imageInput.files && imageInput.files[0] ? imageInput.files[0] : null;
                recognizeButton.disabled = !selectedFile;
                if (objectUrl) URL.revokeObjectURL(objectUrl);
                if (!selectedFile) {
                  imagePreview.hidden = true;
                  previewHint.hidden = false;
                  return;
                }
                objectUrl = URL.createObjectURL(selectedFile);
                imagePreview.src = objectUrl;
                imagePreview.hidden = false;
                previewHint.hidden = true;
                imagePreview.onload = () => drawBoxes({ boxes: [] });
              });

              recognizeButton.addEventListener('click', async () => {
                if (!selectedFile) return;
                recognizeButton.disabled = true;
                clearError();
                resultText.textContent = '识别中...';
                boxesText.textContent = '';
                try {
                  const response = await fetch('/api/ocr', {
                    method: 'POST',
                    headers: { 'Content-Type': mimeForFile(selectedFile) },
                    // 浏览器将文件读取为 ArrayBuffer 后原样发送。
                    body: await selectedFile.arrayBuffer()
                  });
                  const data = await response.json();
                  if (!response.ok || !data.success) throw new Error(data.error || ('HTTP ' + response.status));
                  resultText.textContent = data.text || '(未识别到文字)';
                  elapsedText.textContent = '耗时：' + data.elapsedMs + ' ms，图片：' + data.imageWidth + ' × ' + data.imageHeight + '，CPU：' + (data.affinityStatus || '未返回');
                  const boxSummary = (data.boxes || []).map((box, index) => {
                    return '#' + (index + 1) + ' 置信度：' + Number(box.score || 0).toFixed(4) + '，坐标：' + JSON.stringify(box.points || []);
                  }).join('\n');
                  boxesText.textContent = boxSummary || '未检测到文字框';
                  drawBoxes(data);
                } catch (error) {
                  resultText.textContent = '识别失败';
                  errorText.textContent = error.message || String(error);
                } finally {
                  recognizeButton.disabled = !selectedFile;
                }
              });

              refreshHealth();
            })();
          </script>
        </body>
        </html>
    """.trimIndent()
}
