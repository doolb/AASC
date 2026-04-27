using PortAudioSharp;
using System.Runtime.InteropServices;

namespace VoiceDisplayCs;

public class AudioPlayer : IDisposable
{
    private bool _isPlaying;
    private bool _stopRequested;
    private readonly Queue<QueueItem> _playQueue = new();
    private readonly object _queueLock = new();
    private bool _isProcessingQueue;
    private bool _disposed;
    private bool _portAudioInitialized;

    private record QueueItem(string Type, string? Url = null, byte[]? Data = null);

    public AudioPlayer()
    {
        PortAudio.Initialize();
        _portAudioInitialized = true;
    }

    public void QueueURL(string url)
    {
        lock (_queueLock)
        {
            _stopRequested = false;
            _playQueue.Enqueue(new QueueItem("url", Url: url));
            Console.WriteLine($"[音频队列] 加入队列，当前队列长度: {_playQueue.Count}");
        }

        ThreadPool.QueueUserWorkItem(_ => ProcessQueue());
    }

    public void QueueData(byte[] data)
    {
        lock (_queueLock)
        {
            _stopRequested = false;
            _playQueue.Enqueue(new QueueItem("data", Data: data));
            Console.WriteLine($"[音频队列] 加入队列，当前队列长度: {_playQueue.Count}");
        }

        ThreadPool.QueueUserWorkItem(_ => ProcessQueue());
    }

    private void ProcessQueue()
    {
        lock (_queueLock)
        {
            if (_isProcessingQueue) return;
            _isProcessingQueue = true;
        }

        try
        {
            while (true)
            {
                QueueItem? item;
                lock (_queueLock)
                {
                    if (_stopRequested || _playQueue.Count == 0)
                    {
                        _playQueue.Clear();
                        _isProcessingQueue = false;
                        return;
                    }
                    item = _playQueue.Dequeue();
                }

                try
                {
                    if (item.Type == "url" && item.Url != null)
                    {
                        PlayFromURLAsync(item.Url).GetAwaiter().GetResult();
                    }
                    else if (item.Type == "data" && item.Data != null)
                    {
                        PlayDataAsync(item.Data).GetAwaiter().GetResult();
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[音频队列] 播放失败: {ex.Message}");
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[音频队列] 队列处理异常: {ex.Message}");
            lock (_queueLock)
            {
                _isProcessingQueue = false;
            }
        }
    }

    public void ClearQueue()
    {
        lock (_queueLock)
        {
            _playQueue.Clear();
        }
        Console.WriteLine("[音频队列] 已清空");
    }

    public async Task PlayFromURLAsync(string url)
    {
        if (_stopRequested)
        {
            Console.WriteLine("[音频] 跳过播放（已停止）");
            return;
        }

        _isPlaying = true;
        try
        {
            Console.WriteLine($"[音频] 正在下载: {url}");

            using var handler = new HttpClientHandler();
            handler.ServerCertificateCustomValidationCallback =
                HttpClientHandler.DangerousAcceptAnyServerCertificateValidator;
            using var client = new HttpClient(handler);

            var data = await client.GetByteArrayAsync(url);
            Console.WriteLine($"[音频] 下载完成 ({data.Length} bytes)");

            var tempFile = Path.Combine(Path.GetTempPath(), $"audio_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.wav");
            await File.WriteAllBytesAsync(tempFile, data);

            try
            {
                await PlayWavFileAsync(tempFile);
            }
            finally
            {
                try { File.Delete(tempFile); } catch { }
            }
        }
        catch (Exception ex)
        {
            _isPlaying = false;
            Console.WriteLine($"[音频] 播放URL失败: {ex.Message}");
            throw;
        }
    }

    private async Task PlayDataAsync(byte[] data)
    {
        if (_stopRequested)
        {
            Console.WriteLine("[音频] 跳过播放（已停止）");
            return;
        }

        var tempFile = Path.Combine(Path.GetTempPath(), $"audio_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.wav");
        await File.WriteAllBytesAsync(tempFile, data);

        try
        {
            await PlayWavFileAsync(tempFile);
        }
        finally
        {
            try { File.Delete(tempFile); } catch { }
        }
    }

    private Task PlayWavFileAsync(string filePath)
    {
        if (_stopRequested)
        {
            _isPlaying = false;
            return Task.CompletedTask;
        }

        var tcs = new TaskCompletionSource();

        try
        {
            var waveReader = new WaveReader(filePath);
            var samples = waveReader.Samples;
            var sampleRate = waveReader.SampleRate;

            Console.WriteLine($"[音频] 使用 PortAudio 播放: {filePath}, 采样率: {sampleRate}, 样本数: {samples.Length}");

            int deviceIndex = PortAudio.DefaultOutputDevice;
            if (deviceIndex == PortAudio.NoDevice)
            {
                Console.WriteLine("[音频] 未找到默认输出设备");
                _isPlaying = false;
                tcs.TrySetResult();
                return tcs.Task;
            }

            var info = PortAudio.GetDeviceInfo(deviceIndex);
            Console.WriteLine($"[音频] 使用输出设备 {deviceIndex} ({info.name})");

            var param = new StreamParameters();
            param.device = deviceIndex;
            param.channelCount = 1;
            param.sampleFormat = SampleFormat.Float32;
            param.suggestedLatency = info.defaultLowOutputLatency;
            param.hostApiSpecificStreamInfo = IntPtr.Zero;

            float[]? remainingSamples = samples;
            int currentOffset = 0;

            PortAudioSharp.Stream.Callback playCallback = (IntPtr input, IntPtr output,
                UInt32 frameCount,
                ref StreamCallbackTimeInfo timeInfo,
                StreamCallbackFlags statusFlags,
                IntPtr userData) =>
            {
                if (_stopRequested || remainingSamples == null)
                {
                    return StreamCallbackResult.Complete;
                }

                int needed = (int)frameCount;
                int available = remainingSamples.Length - currentOffset;

                if (available <= 0)
                {
                    int sizeInBytes = needed * sizeof(float);
                    Marshal.Copy(new byte[sizeInBytes], 0, output, sizeInBytes);
                    return StreamCallbackResult.Complete;
                }

                int toWrite = Math.Min(needed, available);
                Marshal.Copy(remainingSamples, currentOffset, output, toWrite);
                currentOffset += toWrite;

                if (toWrite < needed)
                {
                    int zerosBytes = (needed - toWrite) * sizeof(float);
                    Marshal.Copy(new byte[zerosBytes], 0, IntPtr.Add(output, toWrite * sizeof(float)), zerosBytes);
                }

                if (currentOffset >= remainingSamples.Length)
                {
                    return StreamCallbackResult.Complete;
                }

                return StreamCallbackResult.Continue;
            };

            var stream = new PortAudioSharp.Stream(
                inParams: null,
                outParams: param,
                sampleRate: sampleRate,
                framesPerBuffer: 0,
                streamFlags: StreamFlags.ClipOff,
                callback: playCallback,
                userData: IntPtr.Zero
            );

            stream.Start();

            var monitorThread = new Thread(() =>
            {
                while (!_stopRequested)
                {
                    Thread.Sleep(50);
                    if (currentOffset >= remainingSamples.Length)
                    {
                        break;
                    }
                }

                try
                {
                    stream.Stop();
                    stream.Dispose();
                }
                catch { }

                _isPlaying = false;

                if (_stopRequested)
                {
                    Console.WriteLine("[音频] 播放已停止");
                }
                else
                {
                    Console.WriteLine("[音频] 播放完成");
                }

                tcs.TrySetResult();
            })
            {
                IsBackground = true
            };

            monitorThread.Start();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[音频] 播放失败: {ex.Message}");
            _isPlaying = false;
            tcs.TrySetResult();
        }

        return tcs.Task;
    }

    public void Stop()
    {
        _stopRequested = true;
        _isProcessingQueue = false;
        _isPlaying = false;
        Console.WriteLine("[音频] 已停止播放");
    }

    public bool IsCurrentlyPlaying => _isPlaying;

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Stop();
        ClearQueue();
        if (_portAudioInitialized)
        {
            try
            {
                PortAudio.Terminate();
            }
            catch { }
            _portAudioInitialized = false;
        }
    }
}
