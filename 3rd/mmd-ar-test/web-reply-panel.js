'use strict';
// 独立调试入口复用动作面板分类与样式，不向正式HTML加入控件。
function appendPanels(panel) {
    panel.append(`
      <div id="mmdArReplyPanel">
        <label class="display-mmd-lighting-field" for="mmdArReplyText"><span>AI 回复内容</span></label>
        <textarea id="mmdArReplyText" rows="6" maxlength="65536" spellcheck="false"
          style="width:100%;box-sizing:border-box;resize:vertical;background:#171a22;color:#eef2ff;border:1px solid #758bff88;border-radius:6px;padding:8px"></textarea>
        <div class="display-mmd-ar-actions">
          <button type="button" class="display-mmd-ar-action" data-reply="parse">解析标记</button>
          <button type="button" class="display-mmd-ar-action" data-reply="play">播放回复预览</button>
          <button type="button" class="display-mmd-ar-action" data-reply="stop" disabled>停止并恢复</button>
          <button type="button" class="display-mmd-ar-action" data-reply="sample">填入示例</button>
        </div>
        <p class="mind-basic-note">粘贴已有 AI 回复。识别常见 Emoji、（微笑）、*点头*、[表情:开心]、[动作:点头]。参数：时长=2 强度=0.7 次数=1；明确的 mpl 代码块作为低级动作。表情、身体动作、口型并行。无声预览，不调用 LLM 或 TTS，口型文字最多400字符。</p>
        <details><summary>识别结果与口型文字</summary>
          <p class="mind-basic-note" data-reply-speech style="white-space:pre-wrap;overflow-wrap:anywhere"></p>
          <ul class="mind-basic-note" data-reply-tracks style="padding-left:20px;overflow-wrap:anywhere"></ul>
        </details>
        <progress max="1" value="0" style="width:100%" aria-label="回复预览进度"></progress>
        <p class="mind-basic-note" role="status" aria-live="polite" style="white-space:pre-wrap;overflow-wrap:anywhere"></p>
      </div>
      <div id="mmdArAdvancedMotionPanel">
        <label class="mind-basic-field"><span>时长（秒）</span><input data-duration type="number" min="0.2" max="15" step="0.1" value="2"></label>
        <label class="mind-basic-field"><span>强度</span><input data-strength type="number" min="0" max="1" step="0.1" value="0.7"></label>
        <label class="mind-basic-field"><span>次数</span><input data-count type="number" min="1" max="8" step="1" value="1"></label>
        <div class="display-mmd-ar-actions">
          <button type="button" class="display-mmd-ar-action" data-advanced="点头">点头</button>
          <button type="button" class="display-mmd-ar-action" data-advanced="摇头">摇头</button>
          <button type="button" class="display-mmd-ar-action" data-advanced="挥手">挥手</button>
          <button type="button" class="display-mmd-ar-action" data-advanced="鞠躬">鞠躬</button>
          <button type="button" class="display-mmd-ar-action" data-advanced="歪头">歪头</button>
          <button type="button" class="display-mmd-ar-action" data-advanced-stop>停止并恢复</button>
        </div>
        <p class="mind-basic-note">高级动作以名称和参数生成 MPL，单次播放后恢复原动作。与 MPL 低级动作共用身体调度；手动表情和口型可同时播放。</p>
        <p class="mind-basic-note" role="status" aria-live="polite">需要标准 MMD 骨骼的 PMX 模型。</p>
      </div>
    `);
}
module.exports = { appendPanels };
