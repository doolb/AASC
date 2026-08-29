const assert = require('assert');
const fs = require('fs');

const displayHtml = fs.readFileSync(
    'src/apps/web-mediacenter/ui/public/display.html',
    'utf8'
);
const serverJs = fs.readFileSync(
    'src/apps/server/boot/server-app.js',
    'utf8'
);

assert.match(displayHtml, /let voiceListeningEnabled = true/);
assert.match(displayHtml, /type: 'voiceConversationTtsFinished'/);
assert.match(displayHtml, /voiceListeningEnabled = data\.capabilities\.voiceRecording === true/);
assert.match(displayHtml, /function sendRecognizedVoiceInput\(text, extra = \{\}\)/);
assert.match(serverJs, /display-voice-conversation/);
assert.match(serverJs, /isDisplayVoiceListeningEnabled\(displayData\)/);
assert.match(serverJs, /voiceConversationTtsFinished/);
assert.match(serverJs, /voiceprintEnabledNow = config\.get\('voiceprint\.enabled', true\)/);

console.log('display-voice-listening.test.js: 8/8 passed');
