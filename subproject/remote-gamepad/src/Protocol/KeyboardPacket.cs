namespace RemoteGamepad;

// Keyboard/mouse TCP frames, using little-endian unsigned coordinates.
public readonly record struct KeyboardPacket(byte Operation, byte VirtualKey, byte ScanCode, byte Extended, ushort X = 0, ushort Y = 0)
{
    public const byte Heartbeat = 0, Down = 1, Up = 2, ReleaseAll = 3;
    public const byte MouseMove = 4, MouseDown = 5, MouseUp = 6, MouseWheel = 7, MouseHorizontalWheel = 8, MouseRelative = 9;
    public const int Size = 8;
    public byte[] Encode()
    {
        var bytes = new byte[Size];
        bytes[0] = Operation; bytes[1] = VirtualKey; bytes[2] = ScanCode; bytes[3] = Extended;
        System.Buffers.Binary.BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(4), X);
        System.Buffers.Binary.BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(6), Y);
        return bytes;
    }
    public static KeyboardPacket Decode(ReadOnlySpan<byte> bytes) => new(bytes[0], bytes[1], bytes[2], bytes[3],
        System.Buffers.Binary.BinaryPrimitives.ReadUInt16LittleEndian(bytes[4..]),
        System.Buffers.Binary.BinaryPrimitives.ReadUInt16LittleEndian(bytes[6..]));
}
