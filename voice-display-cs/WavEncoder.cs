using System.Runtime.InteropServices;

namespace VoiceDisplayCs;

[StructLayout(LayoutKind.Sequential)]
public struct WaveHeader
{
    public int ChunkID;
    public int ChunkSize;
    public int Format;
    public int SubChunk1ID;
    public int SubChunk1Size;
    public short AudioFormat;
    public short NumChannels;
    public int SampleRate;
    public int ByteRate;
    public short BlockAlign;
    public short BitsPerSample;
    public int SubChunk2ID;
    public int SubChunk2Size;

    public bool Validate()
    {
        if (ChunkID != 0x46464952) return false;
        if (Format != 0x45564157) return false;
        if (SubChunk1ID != 0x20746d66) return false;
        if (SubChunk1Size != 16) return false;
        if (AudioFormat != 1) return false;
        if (NumChannels != 1) return false;
        if (ByteRate != (SampleRate * NumChannels * BitsPerSample / 8)) return false;
        if (BlockAlign != (NumChannels * BitsPerSample / 8)) return false;
        if (BitsPerSample != 16) return false;
        return true;
    }
}

public class WaveReader
{
    private WaveHeader _header;
    private readonly float[] _samples;

    public WaveReader(string fileName)
    {
        if (!File.Exists(fileName))
        {
            throw new ApplicationException($"{fileName} 不存在!");
        }

        using var stream = File.Open(fileName, FileMode.Open);
        using var reader = new BinaryReader(stream);

        _header = ReadHeader(reader);

        if (!_header.Validate())
        {
            throw new ApplicationException($"无效的 WAV 文件: {fileName}");
        }

        SkipMetaData(reader);

        var buffer = reader.ReadBytes(_header.SubChunk2Size);
        var samplesInt16 = new short[_header.SubChunk2Size / 2];
        Buffer.BlockCopy(buffer, 0, samplesInt16, 0, buffer.Length);

        _samples = new float[samplesInt16.Length];

        for (var i = 0; i < samplesInt16.Length; ++i)
        {
            _samples[i] = samplesInt16[i] / 32768.0F;
        }
    }

    private static WaveHeader ReadHeader(BinaryReader reader)
    {
        var bytes = reader.ReadBytes(Marshal.SizeOf<WaveHeader>());

        var handle = GCHandle.Alloc(bytes, GCHandleType.Pinned);
        var header = Marshal.PtrToStructure<WaveHeader>(handle.AddrOfPinnedObject());
        handle.Free();

        return header;
    }

    private void SkipMetaData(BinaryReader reader)
    {
        var bs = reader.BaseStream;

        var subChunk2ID = _header.SubChunk2ID;
        var subChunk2Size = _header.SubChunk2Size;

        while (bs.Position != bs.Length && subChunk2ID != 0x61746164)
        {
            bs.Seek(subChunk2Size, SeekOrigin.Current);
            subChunk2ID = reader.ReadInt32();
            subChunk2Size = reader.ReadInt32();
        }
        _header.SubChunk2ID = subChunk2ID;
        _header.SubChunk2Size = subChunk2Size;
    }

    public int SampleRate => _header.SampleRate;

    public float[] Samples => _samples;
}

public static class WavEncoder
{
    public static byte[] Encode(short[] samples, int sampleRate)
    {
        const int numChannels = 1;
        const int bitsPerSample = 16;
        var byteRate = sampleRate * numChannels * bitsPerSample / 8;
        var blockAlign = numChannels * bitsPerSample / 8;
        var dataSize = samples.Length * 2;

        var buf = new byte[44 + dataSize];

        System.Text.Encoding.ASCII.GetBytes("RIFF").CopyTo(buf, 0);
        WriteUInt32LE(buf, 4, (uint)(36 + dataSize));
        System.Text.Encoding.ASCII.GetBytes("WAVE").CopyTo(buf, 8);

        System.Text.Encoding.ASCII.GetBytes("fmt ").CopyTo(buf, 12);
        WriteUInt32LE(buf, 16, 16);
        WriteUInt16LE(buf, 20, 1);
        WriteUInt16LE(buf, 22, (ushort)numChannels);
        WriteUInt32LE(buf, 24, (uint)sampleRate);
        WriteUInt32LE(buf, 28, (uint)byteRate);
        WriteUInt16LE(buf, 32, (ushort)blockAlign);
        WriteUInt16LE(buf, 34, (ushort)bitsPerSample);

        System.Text.Encoding.ASCII.GetBytes("data").CopyTo(buf, 36);
        WriteUInt32LE(buf, 40, (uint)dataSize);

        for (var i = 0; i < samples.Length; i++)
        {
            WriteInt16LE(buf, 44 + i * 2, samples[i]);
        }

        return buf;
    }

    public static byte[] EncodeFloat(float[] samples, int sampleRate)
    {
        var int16Samples = new short[samples.Length];
        for (var i = 0; i < samples.Length; i++)
        {
            int16Samples[i] = (short)(Math.Clamp(samples[i], -1.0f, 1.0f) * 32767);
        }
        return Encode(int16Samples, sampleRate);
    }

    public static double ComputeRms(short[] samples)
    {
        if (samples.Length == 0) return 0;

        double sumSquares = 0;
        for (var i = 0; i < samples.Length; i++)
        {
            var v = samples[i] / 32768.0;
            sumSquares += v * v;
        }

        return Math.Sqrt(sumSquares / samples.Length);
    }

    private static void WriteUInt32LE(byte[] buf, int offset, uint value)
    {
        buf[offset] = (byte)(value & 0xFF);
        buf[offset + 1] = (byte)((value >> 8) & 0xFF);
        buf[offset + 2] = (byte)((value >> 16) & 0xFF);
        buf[offset + 3] = (byte)((value >> 24) & 0xFF);
    }

    private static void WriteUInt16LE(byte[] buf, int offset, ushort value)
    {
        buf[offset] = (byte)(value & 0xFF);
        buf[offset + 1] = (byte)((value >> 8) & 0xFF);
    }

    private static void WriteInt16LE(byte[] buf, int offset, short value)
    {
        buf[offset] = (byte)(value & 0xFF);
        buf[offset + 1] = (byte)((value >> 8) & 0xFF);
    }
}
