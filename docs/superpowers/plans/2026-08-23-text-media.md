# Text Media Pagination and TTS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Add `.txt` and `.md` media playback with display-side pagination and sentence splitting, one server TTS request per sentence, text-specific controls, and support for mixed text items in existing playlists.

**Architecture:** A shared UMD sentence splitter preserves the existing `chat.splitIntoSentences()` behavior for server and browser use. The display owns text decoding, safe Markdown/plain-text rendering, viewport-aware pagination, sentence sequencing, stale-response invalidation, and playlist handoff; the server only synthesizes one sentence per request and forwards tagged audio. The control UI sends text style and page controls through the existing display control channel and reuses playlist progress for mixed lists.

**Tech Stack:** Node.js CommonJS/UMD utilities, Express + WebSocket (`ws`), native HTML/CSS/JavaScript, existing safe `chat-markdown.js`, Node built-in test runner, existing Puppeteer/static UI tests.

**Spec:** `docs/spec/text-media.md`

## Global Constraints

- Use `const`/`let`, `async/await`, `try/catch`, Chinese detailed comments, and no new long `if/else if` chains.
- Preserve existing user changes in the dirty master worktree; do not reset, checkout, or create a worktree.
- Keep existing image, GIF, video, audio, HTML, playlist, TTS, sleep, and reconnect behavior compatible.
- Text defaults are background `#FFF4B8`, foreground `#333333`, responsive font size, normal line height, and normal page margin.
- Text TTS requests are serialized per display and tagged by `playbackId`, `pageIndex`, and `sentenceIndex`; stale responses must be ignored.
- Temporary playlist data continues to use the existing WebSocket payload limit and must not be persisted as base64.

---

### Task 1: Extract and verify the shared sentence splitter

**Files:**
- Create: `src/core/utils/sentence-splitter.js`
- Modify: `src/external/llm/llm-service.js:708-735`
- Create: `tests/sentence-splitter.test.js`
- Modify: `src/apps/server/boot/server-app.js` to expose the same UMD source at `/js/sentence-splitter.js`

**Interfaces:**
- Produces `splitIntoSentences(text): string[]`, available through CommonJS and `window.AASCSentenceSplitter`.
- Existing `chat.splitIntoSentences` continues to export the same function behavior through the extracted utility.

- [ ] **Step 1: Write the failing tests**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { splitIntoSentences } = require('../src/core/utils/sentence-splitter');

test('splitIntoSentences keeps Chinese and English sentence boundaries', () => {
    assert.deepEqual(
        splitIntoSentences('第一句。第二句! Third sentence. Next sentence.'),
        ['第一句。', '第二句!', 'Third sentence.', 'Next sentence.']
    );
});

test('splitIntoSentences avoids decimal points and flushes after four commas', () => {
    assert.deepEqual(
        splitIntoSentences('版本 1.2 可用，第一项，第二项，第三项，第四项，后续。'),
        ['版本 1.2 可用，第一项，第二项，第三项，第四项，', '后续。']
    );
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/sentence-splitter.test.js`

Expected: FAIL because `src/core/utils/sentence-splitter.js` does not exist yet.

- [ ] **Step 3: Implement the minimal UMD utility**

Move the current `isSentenceEnd`, `findLastSentenceBoundary`-independent sentence loop, and `splitIntoSentences` logic into the new utility. Export the function in CommonJS and attach it to `window.AASCSentenceSplitter` in browser execution. Replace the local implementation in `llm-service.js` with the imported function while preserving its public export.

- [ ] **Step 4: Serve the same source to the display**

Add a narrow Express route before the public static middleware:

```javascript
app.get('/js/sentence-splitter.js', (req, res) => {
    res.type('application/javascript').sendFile(
        path.join(PROJECT_ROOT, 'src', 'core', 'utils', 'sentence-splitter.js')
    );
});
```

- [ ] **Step 5: Run the tests and syntax checks**

Run: `node --test tests/sentence-splitter.test.js && node --check src/core/utils/sentence-splitter.js`

Expected: PASS with all splitter cases green.

- [ ] **Step 6: Commit only this task’s files**

```bash
git add src/core/utils/sentence-splitter.js src/external/llm/llm-service.js src/apps/server/boot/server-app.js tests/sentence-splitter.test.js
git commit -m "feat: share sentence splitting between server and display"
```

### Task 2: Add text media metadata to library, uploads, and playlists

**Files:**
- Modify: `src/apps/web-mediacenter/modules/media/media-library-app-service.js`
- Modify: `src/apps/web-mediacenter/modules/media/playlist-app-service.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/upload.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/media-library.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/websocket.js`
- Modify: `src/apps/web-mediacenter/ui/public/upload.html`
- Modify: `src/apps/web-mediacenter/ui/public/js/crop.js` only where preview type dispatch requires a text placeholder
- Modify: `tests/media-library-app-service.test.js`, `tests/playlist-app-service.test.js`, and `tests/audio-media-ui.test.js`
- Create: `tests/text-media-metadata.test.js`

**Interfaces:**
- `detectMediaType('.txt/.md')` returns `text`.
- `detectTextFormat(name)` returns `plain` or `markdown`.
- Playlist entries contain `format` for text items and preserve existing fields for all other types.
- `WebSocketManager.getMediaRatio()` returns `1` for text.

- [ ] **Step 1: Add failing metadata tests**

```javascript
test('detects txt and md as text with the correct format', () => {
    assert.equal(provider.detectMediaType('note.txt'), 'text');
    assert.equal(provider.detectTextFormat('note.txt'), 'plain');
    assert.equal(provider.detectMediaType('guide.MD'), 'text');
    assert.equal(provider.detectTextFormat('guide.MD'), 'markdown');
});

test('library playlist keeps text format metadata', async () => {
    const playlist = await new PlaylistManager(fakeManager).buildFromLibrary('local', '/');
    assert.deepEqual(playlist[0], {
        url: '/media/1/guide.md', fileName: 'guide.md', mediaType: 'text', format: 'markdown'
    });
});
```

- [ ] **Step 2: Run tests and verify the new assertions fail**

Run: `node --test tests/text-media-metadata.test.js tests/playlist-app-service.test.js`

Expected: FAIL because the production type detector and playlist mapper do not return `text/format`.

- [ ] **Step 3: Implement media type and format mapping**

Add `.txt/.md` detection in the provider and browser upload detector, add `text` to `MEDIA_TYPES`, and include `format` in library/temp playlist entries. Add `.txt,.md` to the relevant file inputs. Text previews use a safe yellow/dark-gray placeholder rather than trying to load text as an image.

- [ ] **Step 4: Add single and temporary text sends**

Update `MediaLibrary.playMedia`, `Upload.uploadFile`, `Upload.sendTempFile`, and temporary batch preparation to pass `mediaType: 'text'`, `format`, filename, and MIME metadata. Keep text media ratio `1` and preserve the existing HTML/audio branches.

- [ ] **Step 5: Run focused metadata and UI tests**

Run: `node --test tests/text-media-metadata.test.js tests/media-library-app-service.test.js tests/playlist-app-service.test.js tests/audio-media-ui.test.js`

Expected: PASS with existing audio/HTML assertions unchanged.

- [ ] **Step 6: Commit the metadata task**

```bash
git add src/apps/web-mediacenter/modules/media/media-library-app-service.js src/apps/web-mediacenter/modules/media/playlist-app-service.js src/apps/web-mediacenter/ui/public/js/upload.js src/apps/web-mediacenter/ui/public/js/media-library.js src/apps/web-mediacenter/ui/public/js/websocket.js src/apps/web-mediacenter/ui/public/upload.html src/apps/web-mediacenter/ui/public/js/crop.js tests/media-library-app-service.test.js tests/playlist-app-service.test.js tests/audio-media-ui.test.js tests/text-media-metadata.test.js
git commit -m "feat: recognize text media and preserve document format"
```

### Task 3: Add serialized single-sentence TTS service and WebSocket protocol

**Files:**
- Create: `src/apps/server/modules/media/text-media-tts-service.js`
- Create: `tests/text-media-tts-service.test.js`
- Modify: `src/apps/server/boot/server-app.js` around the display WebSocket message handler and display-state creation
- Modify: `docs/spec/text-media.md` only if the tested protocol names require clarification

**Interfaces:**
- `createTextMediaTtsService({ generateTTS, sendToDisplay, logError })` produces `handleSentenceRequest(displayId, data)` and `cancel(displayId, playbackId)`.
- Request: `{ type: 'textSentenceTts', playbackId, pageIndex, sentenceIndex, text }`.
- Success: `{ type: 'tts', action: 'playAudio', textPlayback: true, playbackId, pageIndex, sentenceIndex, audioUrl, text }`.
- Failure: `{ type: 'textSentenceTtsError', playbackId, pageIndex, sentenceIndex, message }`.

- [ ] **Step 1: Write failing service tests**

```javascript
test('synthesizes one requested sentence and returns tagged audio', async () => {
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: async (text) => `/tmp/${text}.wav`,
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {}
    });

    await service.handleSentenceRequest('display-1', {
        playbackId: 'p1', pageIndex: 2, sentenceIndex: 1, text: '第二句。'
    });

    assert.deepEqual(messages[0], {
        displayId: 'display-1',
        message: {
            type: 'tts', action: 'playAudio', textPlayback: true,
            playbackId: 'p1', pageIndex: 2, sentenceIndex: 1,
            audioUrl: '/uploads/tts/第二句。.wav', text: '第二句。'
        }
    });
});

test('a cancelled playback does not send a late audio response', async () => {
    let resolveAudio;
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: () => new Promise((resolve) => { resolveAudio = resolve; }),
        sendToDisplay: (_, message) => messages.push(message),
        logError: () => {}
    });
    const pending = service.handleSentenceRequest('display-1', {
        playbackId: 'old', pageIndex: 0, sentenceIndex: 0, text: '旧句。'
    });
    service.cancel('display-1', 'old');
    resolveAudio('/tmp/old.wav');
    await pending;
    assert.equal(messages.length, 0);
});
```

- [ ] **Step 2: Run the service test and verify it fails**

Run: `node --test tests/text-media-tts-service.test.js`

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement serialized request tracking**

Validate non-empty text and required numeric indexes, derive `/uploads/tts/<basename>`, track the active playback per display, await `generateTTS`, and suppress a response when `cancel()` invalidates its token. Log failures without throwing into the WebSocket loop.

- [ ] **Step 4: Wire display WebSocket handling**

Register `textSentenceTts` in the display message type list. Route it to the service with the connected display ID. Route `textPlayback` control values to the display. Persist `textStyle` and text progress fields through the existing `persistDisplayState` path, without persisting temporary playlist base64.

- [ ] **Step 5: Run protocol tests and existing TTS tests**

Run: `node --test tests/text-media-tts-service.test.js tests/agent-chat-tts.test.js tests/tts*.test.js`

Expected: PASS; existing generic TTS behavior remains unchanged.

- [ ] **Step 6: Commit the protocol task**

```bash
git add src/apps/server/modules/media/text-media-tts-service.js src/apps/server/boot/server-app.js tests/text-media-tts-service.test.js
git commit -m "feat: add single sentence text media tts protocol"
```

### Task 4: Build the display-side text renderer and page player

**Files:**
- Create: `src/apps/web-mediacenter/ui/public/js/text-media-player.js`
- Modify: `src/apps/web-mediacenter/ui/public/display.html`
- Modify: `src/apps/web-mediacenter/ui/public/css/display.css`
- Create: `tests/text-media-player.test.js`
- Modify: `tests/display-playback-resume.test.js` with text restore assertions

**Interfaces:**
- `window.TextMediaPlayer` exposes `load(data, options)`, `handleControl(action)`, `handleTtsAudio(data)`, `handleTtsError(data)`, `applyStyle(style)`, `attachPlaylist(context)`, `getProgress()` and `stop()`.
- It sends `textSentenceTts` through the injected WebSocket and emits `textProgress` through the existing display socket.

- [ ] **Step 1: Write failing pure-player tests**

```javascript
test('plain text pagination creates full-screen pages without dropping lines', () => {
    const player = createTextPlayerForTest({ width: 800, height: 600, fontSize: 40, lineHeight: 1.6 });
    player.loadText('第一行\n第二行\n第三行', 'plain');
    assert.equal(player.getProgress().pageTotal, 1);
    assert.match(player.getPageText(0), /第一行/);
});

test('next page invalidates the previous playback id and requests the first sentence of the new page', () => {
    const sent = [];
    const player = createTextPlayerForTest({ send: (message) => sent.push(message), pageTexts: ['第一句。', '第二句。'] });
    player.start();
    const oldPlaybackId = sent[0].playbackId;
    player.handleControl('next');
    assert.notEqual(sent[1].playbackId, oldPlaybackId);
    assert.equal(sent[1].sentenceIndex, 0);
    assert.equal(sent[1].text, '第二句。');
});
```

- [ ] **Step 2: Run the player test and verify it fails**

Run: `node --test tests/text-media-player.test.js`

Expected: FAIL because the player module does not exist.

- [ ] **Step 3: Implement decoding and safe rendering**

Decode URL text with `fetch().text()` and base64 text with `TextDecoder`. Render Markdown through `ChatMarkdown.render`; render plain text through a text node/preformatted block. Keep the existing yellow/dark-gray default style and add normal/small/large font, line-height, and margin presets.

- [ ] **Step 4: Implement viewport-aware pagination**

Measure a hidden clone using the effective page width/height. For rotation `0/180`, use viewport width/height; for `90/270`, use height/width before applying the same rotation transform as the existing media layer. Pack block elements greedily, split an oversized block by measured lines, and preserve the current page’s first text anchor after style/resize changes.

- [ ] **Step 5: Implement sequential sentence playback and controls**

For each page, call the shared splitter, send exactly one sentence request at a time, play only matching tagged responses, advance after `ended`/`error`, and auto-advance pages. `pause` keeps the current audio and page, `play` resumes, `prev/next` invalidate and restart, and `stop` clears audio while retaining the page.

- [ ] **Step 6: Integrate the display DOM and style**

Add `#mediaText` and its page/status children, load `sentence-splitter.js`, load `chat-markdown.js` before the text player, route `mediaType === 'text'` in `showMedia`, route `tts` tagged messages to the player, apply `textStyle`, and restore text style/progress on reconnect. Do not disturb the image/video/audio/html branches.

- [ ] **Step 7: Run focused display checks**

Run: `node --test tests/text-media-player.test.js tests/display-playback-resume.test.js tests/display-sleep-mode.test.js && node --check src/apps/web-mediacenter/ui/public/js/text-media-player.js`

Expected: PASS; sleep and media resume regressions remain green.

- [ ] **Step 8: Commit the display task**

```bash
git add src/apps/web-mediacenter/ui/public/js/text-media-player.js src/apps/web-mediacenter/ui/public/display.html src/apps/web-mediacenter/ui/public/css/display.css tests/text-media-player.test.js tests/display-playback-resume.test.js
git commit -m "feat: play paginated text with sentence tts"
```

### Task 5: Integrate text items into mixed playlist playback and persistence

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/display.html` playlist functions around `stopPlaylist`, `sendPlaylistProgress`, `playCurrentItem`, and `handlePlaylistControl`
- Modify: `src/apps/server/boot/server-app.js` playlist progress/persistence and restore payloads
- Modify: `src/apps/web-mediacenter/ui/public/js/websocket.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/media-library.js`
- Create: `tests/text-media-playlist.test.js`
- Modify: `tests/playlist-app-service.test.js`

**Interfaces:**
- Text playlist items use `format` and route through `TextMediaPlayer.attachPlaylist`.
- Progress carries `pageIndex`, `pageTotal`, `sentenceIndex`, `sentenceTotal`, and `format`.
- Existing `playlistControl` actions remain unchanged.

- [ ] **Step 1: Write failing mixed-playlist tests**

```javascript
test('text item advances the playlist only after its final page completes', () => {
    const player = createPlaylistHarness([
        { fileName: 'guide.md', mediaType: 'text', format: 'markdown' },
        { fileName: 'next.jpg', mediaType: 'image' }
    ]);
    player.completeTextPage(0);
    assert.equal(player.currentIndex(), 0);
    player.completeTextPage(1);
    assert.equal(player.currentIndex(), 1);
});

test('playlist progress includes text page fields without removing media fields', () => {
    const progress = buildPlaylistProgress({ index: 0, fileName: 'guide.md', mediaType: 'text', pageIndex: 2, pageTotal: 8 });
    assert.deepEqual(progress, { index: 0, fileName: 'guide.md', mediaType: 'text', pageIndex: 2, pageTotal: 8 });
});
```

- [ ] **Step 2: Run the playlist test and verify it fails**

Run: `node --test tests/text-media-playlist.test.js`

Expected: FAIL because playlist text branching and page progress fields are absent.

- [ ] **Step 3: Add the text branch to display playlist lifecycle**

Stop the prior text player when switching items, pass URL/base64 `format`, attach playlist context, and call `playlistNext()` only when the text player reports the final page. Pause/resume/prev/next/stop must clear stale sentence playback before applying the playlist action.

- [ ] **Step 4: Extend progress and persistence**

Add text page/sentence fields to display progress, update server `currentPlaylist` state, persist non-temporary progress, restore `resumeIndex`, `currentTextPage`, and paused state, and keep temporary base64 out of persisted state.

- [ ] **Step 5: Update control-side progress rendering**

Render mixed playlist text entries with document and page progress, preserve existing crop placeholder behavior, and clear stale text status when switching displays.

- [ ] **Step 6: Run playlist and reconnect regressions**

Run: `node --test tests/text-media-playlist.test.js tests/playlist-app-service.test.js tests/display-playback-resume.test.js tests/display-sleep-mode.test.js`

Expected: PASS for mixed image/video/audio/html/text playlists and existing resume/sleep behavior.

- [ ] **Step 7: Commit the playlist task**

```bash
git add src/apps/web-mediacenter/ui/public/display.html src/apps/server/boot/server-app.js src/apps/web-mediacenter/ui/public/js/websocket.js src/apps/web-mediacenter/ui/public/js/media-library.js tests/text-media-playlist.test.js tests/playlist-app-service.test.js
git commit -m "feat: support text documents in mixed playlists"
```

### Task 6: Add control-side text mode settings and page actions

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/controls.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/floating-control.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/websocket.js`
- Modify: `src/apps/web-mediacenter/ui/public/upload.html`
- Modify: `src/apps/web-mediacenter/ui/public/css/upload.css`
- Create: `tests/text-media-controls.test.js`

**Interfaces:**
- `Controls.showTextModePanel()` sends `textStyle` with `{background, color, fontSize, lineHeight, pageMargin}`.
- `Controls.sendTextPlayback(action)` sends `textPlayback` with `{action: play|pause|prev|next|stop}`.
- `WebSocketManager` updates text status only for `window.currentDisplayId`.

- [ ] **Step 1: Write failing control UI tests**

```javascript
test('control page contains text mode settings and page actions', () => {
    const html = readPublicFile('upload.html');
    assert.match(html, /文本模式/u);
    assert.match(html, /上一页/u);
    assert.match(html, /下一页/u);
    assert.match(html, /停止/u);
});

test('text mode defaults use the yellow background and dark gray text', () => {
    const controls = readPublicFile('js/controls.js');
    assert.match(controls, /#FFF4B8/u);
    assert.match(controls, /#333333/u);
    assert.match(controls, /textStyle/u);
});
```

- [ ] **Step 2: Run the UI test and verify it fails**

Run: `node --test tests/text-media-controls.test.js`

Expected: FAIL because the text panel and actions are absent.

- [ ] **Step 3: Implement `Controls.showTextModePanel()`**

Follow `showHtmlModePanel()` for dialog creation/removal, radio/select controls, defaults, and apply/cancel behavior. Apply sends `textStyle`; it does not restart TTS directly—the display player reapplies style and preserves the current content anchor.

- [ ] **Step 4: Implement page actions and status**

Add text page buttons to the main media control panel and floating control panel. Update labels and disabled state from `textProgress`/playlist text progress. Keep playlist-level previous/next buttons separate from text page previous/next.

- [ ] **Step 5: Run focused UI tests and static syntax checks**

Run: `node --test tests/text-media-controls.test.js tests/audio-media-ui.test.js tests/chat-markdown.test.js`

Expected: PASS with existing HTML/audio/chat UI tests unchanged.

- [ ] **Step 6: Commit the control task**

```bash
git add src/apps/web-mediacenter/ui/public/js/controls.js src/apps/web-mediacenter/ui/public/js/floating-control.js src/apps/web-mediacenter/ui/public/js/websocket.js src/apps/web-mediacenter/ui/public/upload.html src/apps/web-mediacenter/ui/public/css/upload.css tests/text-media-controls.test.js
git commit -m "feat: add text playback controls and style settings"
```

### Task 7: Complete documentation, self-test, and regression verification

**Files:**
- Modify: `docs/design/text-media.md`
- Modify: `docs/spec/text-media.md`
- Modify: `docs/task/2026-08-23_纯文本分页TTS播放.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`
- Create: `tests/text-media-integration.test.js` if protocol coverage needs a final end-to-end static test

- [ ] **Step 1: Write the failing integration assertions**

```javascript
test('display, server, and control files expose the text media protocol', () => {
    assert.match(readFile('display.html'), /textSentenceTts/u);
    assert.match(readFile('server-app.js'), /textSentenceTts/u);
    assert.match(readFile('controls.js'), /showTextModePanel/u);
});
```

- [ ] **Step 2: Run the integration test and fix only missing protocol/documentation gaps**

Run: `node --test tests/text-media-integration.test.js`

Expected: PASS after all implementation tasks are complete.

- [ ] **Step 3: Run the complete relevant regression suite**

Run: `node --test tests/sentence-splitter.test.js tests/text-media-metadata.test.js tests/text-media-tts-service.test.js tests/text-media-player.test.js tests/text-media-playlist.test.js tests/text-media-controls.test.js tests/text-media-integration.test.js tests/playlist-app-service.test.js tests/display-playback-resume.test.js tests/display-sleep-mode.test.js tests/audio-media-ui.test.js tests/chat-markdown.test.js`

Expected: PASS. Any pre-existing unrelated failure must be recorded with its exact command and reason instead of being hidden.

- [ ] **Step 4: Update project task records**

Move the text task from `docs/todo.md` to a completed entry with start/completion dates and changed files, change the changelog entry from design-only to completed, and ensure design/spec match the final protocol and style values.

- [ ] **Step 5: Run final syntax and status checks**

Run: `node --check src/core/utils/sentence-splitter.js && node --check src/apps/server/modules/media/text-media-tts-service.js && git diff --check && git status --short`

Expected: no syntax errors, no whitespace errors, and only intended files changed in addition to the user’s existing worktree edits.
