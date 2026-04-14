using PortAudioSharp;
using System.Runtime.InteropServices;

namespace VoiceDisplayCs;

public class AudioRecorder : IDisposable
{
    private readonly double _vadThreshold;
    private readonly int _minSpeechDurationMs;
    private readonly int _sampleRate;
    private bool _recording;
    private bool _disposed;
    private PortAudioSharp.Stream? _stream;
    private CancellationTokenSource? _cts;

    public AudioRecorder(double vadThreshold = 0.01, int minSpeechDurationMs = 300, int sampleRate = 16000)
    {
        _vadThreshold = vadThreshold;
        _minSpeechDurationMs = minSpeechDurationMs;
        _sampleRate = sampleRate;
    }

    public bool IsRecording => _recording;

    public void Start(Action<byte[]> onAudioData, CancellationToken cancellationToken)
    {
        if (_recording)
        {
            Console.WriteLine("[录音] 录音已在进行中");
            return;
        }

        _recording = true;
        _cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

        Console.WriteLine("[录音] 开始录音 (PortAudio)...");

        const int frameDurationMs = 20;
        var framesPerBuffer = _sampleRate * frameDurationMs / 1000;
        var silenceFramesNeeded = _minSpeechDurationMs / frameDurationMs;

        var hasSpeech = false;
        var speechSamples = new List<float>();
        var silenceFrameCount = 0;
        var bufferQueue = new Queue<float[]>();
        var bufferLock = new object();
        var dataReadyEvent = new AutoResetEvent(false);

        PortAudio.Initialize();

        int deviceIndex = PortAudio.DefaultInputDevice;
        if (deviceIndex == PortAudio.NoDevice)
        {
            Console.WriteLine("[录音] 未找到默认输入设备");
            _recording = false;
            return;
        }

        var info = PortAudio.GetDeviceInfo(deviceIndex);
        Console.WriteLine($"[录音] 使用输入设备 {deviceIndex} ({info.name})");

        var param = new StreamParameters();
        param.device = deviceIndex;
        param.channelCount = 1;
        param.sampleFormat = SampleFormat.Float32;
        param.suggestedLatency = info.defaultLowInputLatency;
        param.hostApiSpecificStreamInfo = IntPtr.Zero;

        PortAudioSharp.Stream.Callback callback = (IntPtr input, IntPtr output,
            uint frameCount,
            ref StreamCallbackTimeInfo timeInfo,
            StreamCallbackFlags statusFlags,
            IntPtr userData) =>
        {
            if (!_recording || cancellationToken.IsCancellationRequested)
            {
                return StreamCallbackResult.Complete;
            }

            var samples = new float[frameCount];
            Marshal.Copy(input, samples, 0, (int)frameCount);

            lock (bufferLock)
            {
                bufferQueue.Enqueue(samples);
            }
            dataReadyEvent.Set();

            return StreamCallbackResult.Continue;
        };

        _stream = new PortAudioSharp.Stream(
            inParams: param,
            outParams: null,
            sampleRate: _sampleRate,
            framesPerBuffer: 0,
            streamFlags: StreamFlags.ClipOff,
            callback: callback,
            userData: IntPtr.Zero
        );

        _stream.Start();
        Console.WriteLine("[录音] 录音已启动");

        var thread = new Thread(() =>
        {
            while (_recording && !cancellationToken.IsCancellationRequested)
            {
                var waitResult = dataReadyEvent.WaitOne(100);
                if (!_recording || cancellationToken.IsCancellationRequested) break;

                float[]? chunk;
                lock (bufferLock)
                {
                    if (bufferQueue.Count == 0) continue;
                    chunk = bufferQueue.Dequeue();
                }

                var rms = ComputeRms(chunk);

                if (rms >= _vadThreshold)
                {
                    hasSpeech = true;
                    speechSamples.AddRange(chunk);
                    silenceFrameCount = 0;
                }
                else if (hasSpeech)
                {
                    speechSamples.AddRange(chunk);
                    silenceFrameCount++;

                    if (silenceFrameCount >= silenceFramesNeeded)
                    {
                        if (speechSamples.Count >= framesPerBuffer)
                        {
                            var wavData = WavEncoder.EncodeFloat(speechSamples.ToArray(), _sampleRate);
                            try
                            {
                                onAudioData(wavData);
                            }
                            catch (Exception ex)
                            {
                                Console.WriteLine($"[录音] 音频数据回调异常: {ex.Message}");
                            }
                        }
                        speechSamples.Clear();
                        hasSpeech = false;
                        silenceFrameCount = 0;
                    }
                }
            }

            if (hasSpeech && speechSamples.Count >= framesPerBuffer)
            {
                var wavData = WavEncoder.EncodeFloat(speechSamples.ToArray(), _sampleRate);
                try
                {
                    onAudioData(wavData);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[录音] 最后音频数据回调异常: {ex.Message}");
                }
            }

            _recording = false;
            Console.WriteLine("[录音] 已停止录音");
        })
        {
            IsBackground = true
        };

        thread.Start();
    }

    private static double ComputeRms(float[] samples)
    {
        if (samples.Length == 0) return 0;

        double sumSquares = 0;
        for (var i = 0; i < samples.Length; i++)
        {
            sumSquares += (double)samples[i] * samples[i];
        }

        return Math.Sqrt(sumSquares / samples.Length);
    }

    public void Stop()
    {
        if (!_recording) return;

        _recording = false;

        try
        {
            _stream?.Stop();
            _stream?.Dispose();
            _stream = null;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[录音] 停止录音时出错: {ex.Message}");
        }

        _cts?.Cancel();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Stop();
        _cts?.Dispose();
        try
        {
            PortAudio.Terminate();
        }
        catch { }
    }
}
