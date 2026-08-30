'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('src/apps/server/boot/server-app.js', 'utf8');
const display = fs.readFileSync('src/apps/web-mediacenter/ui/public/display.html', 'utf8');
const textPlayer = fs.readFileSync('src/apps/web-mediacenter/ui/public/js/text-media-player.js', 'utf8');
const nodeDisplay = fs.readFileSync('src/apps/voice-display-node/main.js', 'utf8');
const timeAnnounce = fs.readFileSync('src/apps/server/modules/task-engine/builtin-tasks/time-announce.js', 'utf8');

assert.match(server, /voiceTtsPlaybackFinished/, '服务端应接收显示端 TTS 播放完成回报');
assert.match(server, /voiceTtsPlaybackState/, '服务端应向录音显示端广播 TTS 状态');
assert.match(server, /voiceTtsPlaybackId/, 'TTS 音频应携带跨显示端播放 ID');
assert.match(server, /VOICE_TTS_PLAYBACK_TIMEOUT_MS/, '服务端应定义 TTS 状态超时');
assert.match(server, /setTimeout\(/, '服务端应为旧客户端保留 TTS 状态超时清理');
assert.match(server, /voiceTtsPlaybackRepeatCount/, '服务端应识别重复 TTS 播放组');
assert.match(server, /completedCount|completedCompletions|remainingCompletions/, '服务端应等待重复播放组全部完成');

assert.match(timeAnnounce, /voiceTtsPlaybackRepeatCount/, '重复报时应携带重复总数');

assert.match(display, /data\.type === 'voiceTtsPlaybackState'/, 'Web 显示端应处理跨显示端 TTS 状态');
assert.match(display, /remoteTtsPlaybackIds/, 'Web 显示端应维护远程活动播放 ID');
assert.match(display, /type: 'voiceTtsPlaybackFinished'/, 'Web 显示端应回报 TTS 播放完成');
assert.match(display, /pauseVoiceRecordingForTts\(\)/, 'Web 显示端收到跨端播报时应复用录音暂停逻辑');

assert.match(textPlayer, /notifyAudioPlaybackEnd\([^)]*playbackId/, '文本 TTS 完成回调应透传播放 ID');
assert.match(nodeDisplay, /case 'voiceTtsPlaybackState'/, 'Node 子显示端应处理跨显示端 TTS 状态');
assert.match(nodeDisplay, /voiceTtsPlaybackFinished/, 'Node 子显示端应回报 TTS 播放完成');
assert.match(nodeDisplay, /completedCount/, 'Node 子显示端应回报重复播放组的完成数量');
assert.match(nodeDisplay, /recorder\.pause\(\)/, 'Node 子显示端应复用已有录音暂停能力');

console.log('display-voice-global-tts-mute.test.js: contract checks passed');
