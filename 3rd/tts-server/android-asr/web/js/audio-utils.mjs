// 浏览器音频统一转换工具：文件和麦克风最终都提供给 Sherpa 16 kHz 单声道 Float32 PCM。
export function resampleMono(samples, sourceRate, targetRate = 16000) {
  if (!(samples instanceof Float32Array) || samples.length === 0) {
    throw new Error('音频数据为空');
  }
  if (!Number.isFinite(sourceRate) || sourceRate <= 0) {
    throw new Error('音频采样率无效');
  }
  if (sourceRate === targetRate) return samples.slice();

  const outputLength = Math.max(1, Math.round(samples.length * targetRate / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.min(Math.floor(position), samples.length - 1);
    const right = Math.min(left + 1, samples.length - 1);
    const weight = position - left;
    output[index] = samples[left] * (1 - weight) + samples[right] * weight;
  }
  return output;
}

export function downmixAudioBuffer(audioBuffer, targetRate = 16000) {
  if (!audioBuffer || audioBuffer.numberOfChannels < 1 || audioBuffer.length < 1) {
    throw new Error('音频解码结果为空');
  }
  const mono = new Float32Array(audioBuffer.length);
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const channelData = audioBuffer.getChannelData(channel);
    for (let index = 0; index < mono.length; index += 1) {
      mono[index] += channelData[index] / audioBuffer.numberOfChannels;
    }
  }
  return resampleMono(mono, audioBuffer.sampleRate, targetRate);
}

export function mergeFloatChunks(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

export function encodePcm16Wav(samples, sampleRate = 16000) {
  if (!(samples instanceof Float32Array) || samples.length === 0) {
    throw new Error('没有可保存的音频');
  }
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  const writeText = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);
  for (let index = 0; index < samples.length; index += 1) {
    const clipped = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * bytesPerSample, clipped < 0 ? clipped * 32768 : clipped * 32767, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function validateSamples(samples, sampleRate = 16000, maxSeconds = 60) {
  if (!(samples instanceof Float32Array) || samples.length === 0) {
    throw new Error('没有可识别的音频');
  }
  if (samples.length > sampleRate * maxSeconds) {
    throw new Error(`音频长度不能超过 ${maxSeconds} 秒`);
  }
  for (const value of samples) {
    if (!Number.isFinite(value)) throw new Error('音频包含无效采样值');
  }
  return true;
}

export function sliceAudio(samples, startSeconds, endSeconds, sampleRate = 16000) {
  const start = Math.max(0, Math.floor(startSeconds * sampleRate));
  const end = Math.min(samples.length, Math.ceil(endSeconds * sampleRate));
  if (end <= start) throw new Error('声纹分段没有有效音频');
  return samples.slice(start, end);
}
