using System.Buffers.Binary;
using System.Net.Sockets;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using RemoteGamepad;

internal static class AudioClient
{
    public static async Task RunAsync(string host, int port, CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            try { await PlaySession(host, port, stop); }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
            catch (Exception ex) { SenderLog.WriteLine($"音频连接中断: {ex.Message}；2 秒后重试。"); }
            try { await Task.Delay(2000, stop); } catch (OperationCanceledException) { break; }
        }
    }

    private static async Task PlaySession(string host, int port, CancellationToken stop)
    {
        using var client = new TcpClient { NoDelay = true };
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        await client.ConnectAsync(host, port, timeout.Token);
        using var stream = client.GetStream();
        await stream.WriteAsync("VGA1"u8.ToArray(), timeout.Token);
        var number = new byte[4];
        await stream.ReadFrameExactlyAsync(number, timeout.Token);
        int formatSize = BinaryPrimitives.ReadInt32LittleEndian(number);
        if (formatSize is < 18 or > 128) throw new InvalidDataException("无效的音频格式长度");
        var formatBytes = new byte[formatSize];
        await stream.ReadFrameExactlyAsync(formatBytes, timeout.Token);
        using var reader = new BinaryReader(new MemoryStream(formatBytes));
        var format = WaveFormat.FromFormatChunk(reader, formatSize);
        if (format.Channels is < 1 or > 8 || format.SampleRate is < 8000 or > 192000 ||
            format.BitsPerSample is not (16 or 24 or 32) || format.BlockAlign != format.Channels * (format.BitsPerSample / 8) ||
            format.AverageBytesPerSecond != format.SampleRate * format.BlockAlign ||
            format.Encoding is not (WaveFormatEncoding.Pcm or WaveFormatEncoding.IeeeFloat or WaveFormatEncoding.Extensible))
            throw new InvalidDataException("不支持的音频格式");
        var buffered = new BufferedWaveProvider(format) { BufferDuration = TimeSpan.FromMilliseconds(300), DiscardOnBufferOverflow = true };
        using var output = new WasapiOut(AudioClientShareMode.Shared, 100);
        output.Init(buffered);
        output.Play();
        SenderLog.WriteLine($"音频播放已连接：{format}");
        while (true)
        {
            await stream.ReadFrameExactlyAsync(number, stop);
            int length = BinaryPrimitives.ReadInt32LittleEndian(number);
            if (length <= 0 || length > 1048576 || length % format.BlockAlign != 0) throw new InvalidDataException("无效的音频帧");
            var data = new byte[length];
            await stream.ReadFrameExactlyAsync(data, stop);
            if (buffered.BufferedDuration > TimeSpan.FromMilliseconds(200)) buffered.ClearBuffer();
            buffered.AddSamples(data, 0, data.Length);
        }
    }
}
