package com.aasc.yolo

/** 内嵌网页，不依赖外部脚本和样式，直接通过 HTTP 接口测试手机端检测。 */
object YoloWebPage {
    val HTML: String = """
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>YOLO11 Android 测试</title>
          <style>
            body { font-family: sans-serif; max-width: 1100px; margin: auto; padding: 16px; color: #202124; }
            .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
            select, button, input { font-size: 16px; padding: 7px; }
            button { cursor: pointer; }
            #previewWrap { position: relative; display: inline-block; max-width: 100%; margin-top: 12px; }
            #preview { max-width: 100%; display: block; }
            #overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
            #status { white-space: pre-wrap; margin-top: 12px; }
            table { border-collapse: collapse; width: 100%; margin-top: 12px; }
            th, td { border: 1px solid #ccc; padding: 6px; text-align: right; }
            th:first-child, td:first-child { text-align: left; }
            .error { color: #b00020; }
          </style>
        </head>
        <body>
          <h2>YOLO11 Android HTTP 测试</h2>
          <div class="toolbar">
            <input id="fileInput" type="file" accept="image/jpeg,image/png,image/webp">
            <label>模型 <select id="modelSelect"></select></label>
            <button id="detectButton" disabled>检测</button>
            <button id="benchmarkButton" disabled>五模型测速</button>
          </div>
          <div id="previewWrap"><img id="preview" alt="图片预览"><canvas id="overlay"></canvas></div>
          <div id="status">正在读取模型列表…</div>
          <div id="benchmarkResult"></div>
          <script>
            const fileInput = document.getElementById('fileInput');
            const modelSelect = document.getElementById('modelSelect');
            const detectButton = document.getElementById('detectButton');
            const benchmarkButton = document.getElementById('benchmarkButton');
            const preview = document.getElementById('preview');
            const overlay = document.getElementById('overlay');
            const status = document.getElementById('status');
            const benchmarkResult = document.getElementById('benchmarkResult');
            let selectedFile = null;

            function showError(error) {
              status.className = 'error';
              status.textContent = error instanceof Error ? error.message : String(error);
            }

            async function readJson(response) {
              const data = await response.json();
              if (!response.ok || data.success === false) {
                throw new Error(data.error || ('HTTP ' + response.status));
              }
              return data;
            }

            function clearOverlay() {
              overlay.width = preview.naturalWidth || preview.clientWidth;
              overlay.height = preview.naturalHeight || preview.clientHeight;
              overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
            }

            function drawDetections(detections) {
              overlay.width = preview.naturalWidth;
              overlay.height = preview.naturalHeight;
              const context = overlay.getContext('2d');
              const scaleX = overlay.width / preview.clientWidth;
              const scaleY = overlay.height / preview.clientHeight;
              context.lineWidth = Math.max(2, 2 * scaleX);
              context.font = Math.max(14, 14 * scaleX) + 'px sans-serif';
              detections.forEach((item) => {
                const left = item.left * scaleX;
                const top = item.top * scaleY;
                const width = (item.right - item.left) * scaleX;
                const height = (item.bottom - item.top) * scaleY;
                context.strokeStyle = '#00d084';
                context.fillStyle = '#00d084';
                context.strokeRect(left, top, width, height);
                context.fillText(item.classId + ' ' + item.confidence.toFixed(3), left, Math.max(14, top - 4));
              });
            }

            function renderBenchmark(data) {
              const rows = data.items.map((item) => '<tr>' +
                '<td>' + item.displayName + '</td>' +
                '<td>' + item.loadModelMs + '</td>' +
                '<td>' + item.averageInferenceMs.toFixed(2) + '</td>' +
                '<td>' + item.averageTotalMs.toFixed(2) + '</td>' +
                '<td>' + item.p50TotalMs.toFixed(2) + '</td>' +
                '<td>' + item.p95TotalMs.toFixed(2) + '</td>' +
                '<td>' + item.fps.toFixed(2) + '</td>' +
                '</tr>').join('');
              benchmarkResult.innerHTML = '<table><thead><tr><th>模型</th><th>加载 ms</th><th>推理 ms</th>' +
                '<th>总耗时 ms</th><th>P50 ms</th><th>P95 ms</th><th>FPS</th></tr></thead><tbody>' + rows + '</tbody></table>';
            }

            async function loadModels() {
              try {
                const data = await readJson(await fetch('/api/models'));
                modelSelect.innerHTML = data.models.map((model) => '<option value="' + model.id + '">' + model.displayName + '</option>').join('');
                status.className = '';
                status.textContent = '请选择图片后开始检测；测速默认预热 2 次、正式运行 10 次。';
              } catch (error) {
                showError(error);
              }
            }

            fileInput.addEventListener('change', () => {
              selectedFile = fileInput.files[0] || null;
              const hasFile = Boolean(selectedFile);
              detectButton.disabled = !hasFile;
              benchmarkButton.disabled = !hasFile;
              benchmarkResult.innerHTML = '';
              if (!hasFile) {
                preview.removeAttribute('src');
                clearOverlay();
                return;
              }
              preview.src = URL.createObjectURL(selectedFile);
              preview.onload = clearOverlay;
              status.className = '';
              status.textContent = '图片已选择：' + selectedFile.name;
            });

            detectButton.addEventListener('click', async () => {
              if (!selectedFile) return;
              detectButton.disabled = true;
              benchmarkButton.disabled = true;
              try {
                const query = '/api/yolo?model=' + encodeURIComponent(modelSelect.value);
                const data = await readJson(await fetch(query, { method: 'POST', headers: { 'Content-Type': selectedFile.type }, body: selectedFile }));
                drawDetections(data.detections);
                status.className = '';
                status.textContent = data.model + '：检测 ' + data.detections.length + ' 个目标，总耗时 ' + data.elapsedMs + ' ms\n' + JSON.stringify(data, null, 2);
              } catch (error) {
                showError(error);
              } finally {
                detectButton.disabled = false;
                benchmarkButton.disabled = false;
              }
            });

            benchmarkButton.addEventListener('click', async () => {
              if (!selectedFile) return;
              detectButton.disabled = true;
              benchmarkButton.disabled = true;
              try {
                const data = await readJson(await fetch('/api/benchmark?models=all&warmup=2&runs=10', {
                  method: 'POST', headers: { 'Content-Type': selectedFile.type }, body: selectedFile
                }));
                renderBenchmark(data);
                status.className = '';
                status.textContent = '五模型测速完成：预热 ' + data.warmup + ' 次，正式运行 ' + data.runs + ' 次。';
              } catch (error) {
                showError(error);
              } finally {
                detectButton.disabled = false;
                benchmarkButton.disabled = false;
              }
            });

            loadModels();
          </script>
        </body>
        </html>
    """.trimIndent()
}
