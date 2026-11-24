// WebAudio 程序音乐与音效系统：四季五声音阶田园旋律、天气环境声与全交互音效。
const MUSIC_KEY = 'pig3d.music';
const SFX_KEY = 'pig3d.sfx';

// 四季调式音阶（MIDI 音高）：春 C 大调五声、夏 D 大调五声、秋 A 小调五声、冬 E 小调五声。
const SEASON_MUSIC = {
    spring: { bpm: 112, scale: [60, 62, 64, 67, 69, 72, 74, 76, 79], root: 48, chords: [[0, 2, 4], [5, 7, 9], [3, 5, 7], [4, 6, 8]] },
    summer: { bpm: 120, scale: [62, 64, 66, 69, 71, 74, 76, 78, 81], root: 50, chords: [[0, 2, 4], [4, 6, 8], [3, 5, 7], [0, 2, 4]] },
    autumn: { bpm: 90, scale: [57, 60, 62, 64, 67, 69, 72, 74, 76], root: 45, chords: [[0, 2, 4], [3, 5, 7], [2, 4, 6], [4, 6, 8]] },
    winter: { bpm: 76, scale: [64, 67, 69, 71, 74, 76, 79, 81, 83], root: 52, chords: [[0, 2, 4], [2, 4, 6], [3, 5, 7], [0, 2, 4]] }
};

function readBool(key, fallback) {
    try {
        const val = localStorage.getItem(key);
        return val === null ? fallback : val !== '0';
    } catch (_) { return fallback; }
}

function saveBool(key, value) {
    try { localStorage.setItem(key, value ? '1' : '0'); } catch (_) {}
}

function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

export function createAudioSystem() {
    let ctx = null;
    let masterGain = null;
    let musicGain = null;
    let ambientGain = null;
    let sfxGain = null;
    let windFilter = null;
    let windGain = null;
    let rainGain = null;
    let noiseBuffer = null;

    let musicEnabled = readBool(MUSIC_KEY, true);
    let sfxEnabled = readBool(SFX_KEY, true);
    let season = 'spring';
    let weather = 'sunny';
    let unlocked = false;
    let paused = false;
    let schedulerTimer = null;
    let nextNoteTime = 0;
    let stepIndex = 0;
    let birdTimer = 2.5;

    function ensureContext() {
        if (ctx) return true;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return false;
        try {
            ctx = new AudioCtx();
            const comp = ctx.createDynamicsCompressor();
            masterGain = ctx.createGain();
            masterGain.gain.value = 0.72;
            comp.connect(masterGain);
            masterGain.connect(ctx.destination);

            musicGain = ctx.createGain();
            musicGain.gain.value = musicEnabled ? 0.34 : 0;
            musicGain.connect(comp);

            ambientGain = ctx.createGain();
            ambientGain.gain.value = musicEnabled ? 0.25 : 0;
            ambientGain.connect(comp);

            sfxGain = ctx.createGain();
            sfxGain.gain.value = sfxEnabled ? 0.52 : 0;
            sfxGain.connect(comp);

            // 预生成 2 秒循环噪声缓冲（风声、雨声、刷声共用）
            const len = ctx.sampleRate * 2;
            noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
            const data = noiseBuffer.getChannelData(0);
            let b0 = 0, b1 = 0, b2 = 0;
            for (let i = 0; i < len; i++) {
                const white = Math.random() * 2 - 1;
                b0 = 0.997 * b0 + white * 0.029;
                b1 = 0.985 * b1 + white * 0.032;
                b2 = 0.950 * b2 + white * 0.048;
                data[i] = (b0 + b1 + b2 + white * 0.18) * 0.4;
            }

            // 持续环境风声
            const windSrc = ctx.createBufferSource();
            windSrc.buffer = noiseBuffer;
            windSrc.loop = true;
            windFilter = ctx.createBiquadFilter();
            windFilter.type = 'bandpass';
            windFilter.frequency.value = 420;
            windFilter.Q.value = 1.6;
            windGain = ctx.createGain();
            windGain.gain.value = 0.12;
            windSrc.connect(windFilter);
            windFilter.connect(windGain);
            windGain.connect(ambientGain);
            windSrc.start();

            // 持续环境雨声
            const rainSrc = ctx.createBufferSource();
            rainSrc.buffer = noiseBuffer;
            rainSrc.loop = true;
            const rainFilter = ctx.createBiquadFilter();
            rainFilter.type = 'highpass';
            rainFilter.frequency.value = 1400;
            rainGain = ctx.createGain();
            rainGain.gain.value = 0;
            rainSrc.connect(rainFilter);
            rainFilter.connect(rainGain);
            rainGain.connect(ambientGain);
            rainSrc.start();

            nextNoteTime = ctx.currentTime + 0.08;
            schedulerTimer = setInterval(scheduleTick, 40);
            applyEnvironmentAudio();
            return true;
        } catch (_) {
            return false;
        }
    }

    function unlock() {
        if (!ensureContext()) return;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        unlocked = true;
    }

    function isSnowing() {
        return weather === 'snow' || (season === 'winter' && weather === 'rain');
    }

    function applyEnvironmentAudio() {
        if (!ctx) return;
        const now = ctx.currentTime;
        const snowing = isSnowing();
        const windMap = { sunny: 0.08, cloudy: 0.22, rain: snowing ? 0.14 : 0.34, snow: 0.14 };
        windGain?.gain.setTargetAtTime(windMap[weather] ?? 0.1, now, 0.5);
        windFilter?.frequency.setTargetAtTime(weather === 'rain' && !snowing ? 620 : 380, now, 0.5);
        rainGain?.gain.setTargetAtTime(weather === 'rain' && !snowing ? 0.45 : 0, now, 0.6);
    }

    // 钢片琴 FM 合成单音
    function playCelesta(time, freq, dur = 0.55, vol = 0.24) {
        const osc = ctx.createOscillator();
        const mod = ctx.createOscillator();
        const modGain = ctx.createGain();
        const env = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, time);
        mod.type = 'sine';
        mod.frequency.setValueAtTime(freq * 2, time);
        modGain.gain.setValueAtTime(freq * 0.4, time);
        modGain.gain.exponentialRampToValueAtTime(1, time + 0.12);
        env.gain.setValueAtTime(0.0001, time);
        env.gain.linearRampToValueAtTime(vol, time + 0.015);
        env.gain.exponentialRampToValueAtTime(0.0001, time + dur);
        mod.connect(modGain);
        modGain.connect(osc.frequency);
        osc.connect(env);
        env.connect(musicGain);
        osc.start(time); mod.start(time);
        osc.stop(time + dur + 0.02); mod.stop(time + dur + 0.02);
    }

    // 柔和低通和弦 Pad
    function playPad(time, freqs, dur = 2.4, vol = 0.08) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = weather === 'rain' && !isSnowing() ? 620 : 980;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, time);
        env.gain.linearRampToValueAtTime(vol, time + 0.45);
        env.gain.exponentialRampToValueAtTime(0.0001, time + dur);
        filter.connect(env);
        env.connect(musicGain);
        for (const f of freqs) {
            const osc = ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(f, time);
            osc.connect(filter);
            osc.start(time);
            osc.stop(time + dur + 0.05);
        }
    }

    // 晴朗天气偶发 FM 鸟鸣
    function playBird(time) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        const base = 1800 + Math.random() * 1400;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(base, time);
        osc.frequency.exponentialRampToValueAtTime(base * 1.45, time + 0.07);
        osc.frequency.exponentialRampToValueAtTime(base * 0.9, time + 0.16);
        env.gain.setValueAtTime(0.0001, time);
        env.gain.linearRampToValueAtTime(0.08, time + 0.02);
        env.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
        osc.connect(env);
        env.connect(ambientGain);
        osc.start(time);
        osc.stop(time + 0.2);
    }

    function scheduleTick() {
        if (!ctx || paused || !musicEnabled || ctx.state !== 'running') return;
        const cfg = SEASON_MUSIC[season] || SEASON_MUSIC.spring;
        const stepDur = 60 / cfg.bpm / 2; // 八分音符步进
        while (nextNoteTime < ctx.currentTime + 0.14) {
            const density = isSnowing() ? 0.35 : weather === 'rain' ? 0.48 : 0.72;
            if (stepIndex % 8 === 0) {
                const chordIdx = Math.floor(stepIndex / 8) % cfg.chords.length;
                const chordNotes = cfg.chords[chordIdx].map(idx => midiToFreq(cfg.scale[idx % cfg.scale.length] - 12));
                playPad(nextNoteTime, chordNotes, stepDur * 8, 0.07);
                playCelesta(nextNoteTime, midiToFreq(cfg.root), stepDur * 3, 0.15);
            }
            if (Math.random() < density) {
                const motif = [0, 2, 4, 5, 4, 2, 3, 1];
                const pick = (motif[stepIndex % motif.length] + (Math.random() < 0.3 ? Math.floor(Math.random() * 3) : 0)) % cfg.scale.length;
                playCelesta(nextNoteTime, midiToFreq(cfg.scale[pick]), stepDur * 2.2, 0.19);
            }
            nextNoteTime += stepDur;
            stepIndex = (stepIndex + 1) % 64;
        }
        if (weather === 'sunny' && (season === 'spring' || season === 'summer')) {
            birdTimer -= 0.04;
            if (birdTimer <= 0) {
                playBird(ctx.currentTime + 0.02);
                birdTimer = 3.5 + Math.random() * 5;
            }
        }
    }

    // 程序音效表（无长 if-else 链）
    const SFX_TABLE = {
        oink(t) {
            const osc = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(210, t);
            osc.frequency.exponentialRampToValueAtTime(340, t + 0.06);
            osc.frequency.exponentialRampToValueAtTime(190, t + 0.14);
            f.type = 'bandpass'; f.frequency.value = 820; f.Q.value = 3;
            g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(0.28, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
            osc.connect(f); f.connect(g); g.connect(sfxGain);
            osc.start(t); osc.stop(t + 0.18);
        },
        slide(t) {
            const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
            src.buffer = noiseBuffer; f.type = 'bandpass';
            f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(1400, t + 0.18);
            g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(0.22, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
            src.connect(f); f.connect(g); g.connect(sfxGain);
            src.start(t); src.stop(t + 0.24);
        },
        exit(t) {
            [523, 659, 784].forEach((hz, i) => {
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.type = 'triangle'; o.frequency.setValueAtTime(hz, t + i * 0.06);
                g.gain.setValueAtTime(0.001, t + i * 0.06); g.gain.linearRampToValueAtTime(0.18, t + i * 0.06 + 0.015); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.16);
                o.connect(g); g.connect(sfxGain); o.start(t + i * 0.06); o.stop(t + i * 0.06 + 0.18);
            });
        },
        blocked(t) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.14);
            g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
            o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.18);
        },
        spring(t) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = 'sine'; o.frequency.setValueAtTime(190, t);
            o.frequency.exponentialRampToValueAtTime(480, t + 0.12);
            o.frequency.exponentialRampToValueAtTime(280, t + 0.26);
            g.gain.setValueAtTime(0.28, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
            o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.3);
        },
        unlock(t) {
            [880, 1175].forEach((hz, i) => {
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.type = 'sine'; o.frequency.setValueAtTime(hz, t + i * 0.07);
                g.gain.setValueAtTime(0.22, t + i * 0.07); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.24);
                o.connect(g); g.connect(sfxGain); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.26);
            });
        },
        scissors(t) {
            [0, 0.07].forEach(d => {
                const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
                src.buffer = noiseBuffer; f.type = 'highpass'; f.frequency.value = 3200;
                g.gain.setValueAtTime(0.26, t + d); g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.05);
                src.connect(f); f.connect(g); g.connect(sfxGain); src.start(t + d); src.stop(t + d + 0.06);
            });
        },
        cage(t) {
            [330, 440, 660].forEach((hz, i) => {
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.type = 'square'; o.frequency.setValueAtTime(hz, t + i * 0.05);
                g.gain.setValueAtTime(0.08, t + i * 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.05 + 0.22);
                o.connect(g); g.connect(sfxGain); o.start(t + i * 0.05); o.stop(t + i * 0.05 + 0.24);
            });
        },
        tick(t) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = 'triangle'; o.frequency.setValueAtTime(980, t);
            g.gain.setValueAtTime(0.16, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
            o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.05);
        },
        boom(t) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.55);
            g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
            o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.7);
            const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), ng = ctx.createGain();
            src.buffer = noiseBuffer; f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(120, t + 0.6);
            ng.gain.setValueAtTime(0.5, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
            src.connect(f); f.connect(ng); ng.connect(sfxGain); src.start(t); src.stop(t + 0.7);
        },
        win(t) {
            [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((hz, i) => {
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.type = 'triangle'; o.frequency.setValueAtTime(hz, t + i * 0.09);
                g.gain.setValueAtTime(0.24, t + i * 0.09); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.45);
                o.connect(g); g.connect(sfxGain); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.48);
            });
        },
        holo(t) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = 'sine'; o.frequency.setValueAtTime(1180, t); o.frequency.exponentialRampToValueAtTime(1480, t + 0.045);
            g.gain.setValueAtTime(0.11, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
            o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.07);
        },
        rustle(t) {
            const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
            src.buffer = noiseBuffer; f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 2;
            g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
            src.connect(f); f.connect(g); g.connect(sfxGain); src.start(t); src.stop(t + 0.16);
        },
        thunder(t) {
            const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
            src.buffer = noiseBuffer; f.type = 'lowpass'; f.frequency.value = 210;
            g.gain.setValueAtTime(0.001, t + 0.25); g.gain.linearRampToValueAtTime(0.32, t + 0.45); g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
            src.connect(f); f.connect(g); g.connect(ambientGain); src.start(t + 0.2); src.stop(t + 1.9);
        }
    };

    function playSfx(name) {
        if (!sfxEnabled) return;
        unlock();
        if (!ctx || ctx.state !== 'running') return;
        const fn = SFX_TABLE[name];
        if (fn) {
            try { fn(ctx.currentTime); } catch (_) {}
        }
    }

    return {
        unlock,
        playSfx,
        setEnvironment(nextSeason, nextWeather) {
            season = nextSeason;
            weather = nextWeather;
            applyEnvironmentAudio();
        },
        setMusicEnabled(enabled) {
            musicEnabled = Boolean(enabled);
            saveBool(MUSIC_KEY, musicEnabled);
            if (ctx) {
                const now = ctx.currentTime;
                musicGain?.gain.setTargetAtTime(musicEnabled ? 0.34 : 0, now, 0.15);
                ambientGain?.gain.setTargetAtTime(musicEnabled ? 0.25 : 0, now, 0.15);
                if (musicEnabled) nextNoteTime = now + 0.05;
            }
        },
        setSfxEnabled(enabled) {
            sfxEnabled = Boolean(enabled);
            saveBool(SFX_KEY, sfxEnabled);
            if (ctx) sfxGain?.gain.setTargetAtTime(sfxEnabled ? 0.52 : 0, ctx.currentTime, 0.08);
        },
        isMusicEnabled: () => musicEnabled,
        isSfxEnabled: () => sfxEnabled,
        setPaused(isPaused) {
            paused = isPaused;
            if (!ctx) return;
            if (isPaused && ctx.state === 'running') ctx.suspend().catch(() => {});
            else if (!isPaused && unlocked && ctx.state === 'suspended') {
                ctx.resume().catch(() => {});
                nextNoteTime = ctx.currentTime + 0.05;
            }
        },
        dispose() {
            if (schedulerTimer) clearInterval(schedulerTimer);
            if (ctx) ctx.close().catch(() => {});
        }
    };
}
