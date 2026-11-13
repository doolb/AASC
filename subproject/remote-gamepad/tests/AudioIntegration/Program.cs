using System.Buffers.Binary;
using System.Diagnostics;
using System.Net.Sockets;
using System.Net;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;
using RemoteGamepad;

// Requires ViGEmBus and a default audio output device; plays a quiet test tone.
if (args.Length != 2) throw new ArgumentException("Arguments: dotnet executable, subproject root");
var info = new ProcessStartInfo(args[0]) { UseShellExecute = false };
info.ArgumentList.Add(Path.Combine(Path.GetFullPath(args[1]), "src/Server/bin/Debug/net6.0/Server.dll"));
info.ArgumentList.Add("127.0.0.1");
info.ArgumentList.Add("29672");
using var server = Process.Start(info) ?? throw new Exception("Failed to start server");
try
{
    using var client = new TcpClient();
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
    for (;;)
    {
        try { await client.ConnectAsync("127.0.0.1", 29673, timeout.Token); break; }
        catch (SocketException) { await Task.Delay(100, timeout.Token); }
    }
    using var stream = client.GetStream();
    await stream.WriteAsync("VGA1"u8.ToArray(), timeout.Token);
    var size = new byte[4];
    await stream.ReadFrameExactlyAsync(size, timeout.Token);
    int formatSize = BinaryPrimitives.ReadInt32LittleEndian(size);
    if (formatSize is < 18 or > 128) throw new Exception("Invalid format size");
    var formatBytes = new byte[formatSize];
    await stream.ReadFrameExactlyAsync(formatBytes, timeout.Token);
    using var reader = new BinaryReader(new MemoryStream(formatBytes));
    var format = WaveFormat.FromFormatChunk(reader, formatSize);
    using var output = new WasapiOut(AudioClientShareMode.Shared, 100);
    var tone = new SignalGenerator(48000, 2) { Frequency = 660, Gain = 0.03 };
    output.Init(tone);
    output.Play();
    bool nonzero = false;
    for (int i = 0; i < 100 && !nonzero; i++)
    {
        await stream.ReadFrameExactlyAsync(size, timeout.Token);
        int count = BinaryPrimitives.ReadInt32LittleEndian(size);
        if (count <= 0 || count > 1048576 || count % format.BlockAlign != 0) throw new Exception("Invalid audio frame");
        var data = new byte[count];
        await stream.ReadFrameExactlyAsync(data, timeout.Token);
        nonzero = data.Any(b => b != 0);
    }
    if (!nonzero) throw new Exception("No audio samples captured");
    Console.WriteLine($"PASS: captured nonzero system audio over TCP ({format})");
    output.Stop();

    var listener = new TcpListener(IPAddress.Loopback, 29677);
    listener.Start();
    var senderInfo = new ProcessStartInfo(args[0]) { UseShellExecute = false };
    senderInfo.ArgumentList.Add(Path.Combine(Path.GetFullPath(args[1]), "src/Sender/bin/Debug/net6.0/Sender.dll"));
    senderInfo.ArgumentList.Add("127.0.0.1");
    senderInfo.ArgumentList.Add("29676");
    using var sender = Process.Start(senderInfo) ?? throw new Exception("Failed to start sender");
    try
    {
        using var peer = await listener.AcceptTcpClientAsync(timeout.Token);
        using var audio = peer.GetStream();
        var magic = new byte[4];
        await audio.ReadFrameExactlyAsync(magic, timeout.Token);
        if (!magic.AsSpan().SequenceEqual("VGA1"u8)) throw new Exception("Invalid client handshake");
        using var serialized = new MemoryStream();
        using (var writer = new BinaryWriter(serialized, System.Text.Encoding.UTF8, true))
            WaveFormat.CreateIeeeFloatWaveFormat(48000, 2).Serialize(writer);
        await audio.WriteAsync(serialized.ToArray(), timeout.Token);
        using var monitor = new WasapiLoopbackCapture();
        int samplesObserved = 0;
        monitor.DataAvailable += (_, e) =>
        {
            for (int i = 0; i < e.BytesRecorded; i++)
                if (e.Buffer[i] != 0) { Interlocked.Increment(ref samplesObserved); break; }
        };
        monitor.StartRecording();
        var frame = new byte[480 * 2 * 4];
        BinaryPrimitives.WriteInt32LittleEndian(size, frame.Length);
        for (int n = 0; n < 100 && Volatile.Read(ref samplesObserved) == 0; n++)
        {
            for (int i = 0; i < 480; i++)
            {
                int sample = BitConverter.SingleToInt32Bits((float)(0.03 * Math.Sin(2 * Math.PI * 660 * (n * 480 + i) / 48000)));
                BinaryPrimitives.WriteInt32LittleEndian(frame.AsSpan(i * 8), sample);
                BinaryPrimitives.WriteInt32LittleEndian(frame.AsSpan(i * 8 + 4), sample);
            }
            await audio.WriteAsync(size, timeout.Token);
            await audio.WriteAsync(frame, timeout.Token);
            await Task.Delay(10, timeout.Token);
        }
        monitor.StopRecording();
        if (Volatile.Read(ref samplesObserved) == 0) throw new Exception("No audio observed from sender playback");
        Console.WriteLine("PASS: sender played received audio through the default output");
    }
    finally
    {
        listener.Stop();
        if (!sender.HasExited) { sender.Kill(true); await sender.WaitForExitAsync(); }
    }
}
finally
{
    if (!server.HasExited) { server.Kill(true); await server.WaitForExitAsync(); }
}
