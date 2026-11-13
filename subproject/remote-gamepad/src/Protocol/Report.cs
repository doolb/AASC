using System.Buffers.Binary;

namespace RemoteGamepad;

// XInput-compatible report, encoded as little-endian fields.
public readonly record struct Report(ushort Buttons, byte LeftTrigger, byte RightTrigger,
    short LeftX, short LeftY, short RightX, short RightY)
{
    public const int Size = 12;
    public static ReadOnlySpan<byte> Magic => "VGP2"u8;

    public void Write(Span<byte> data)
    {
        BinaryPrimitives.WriteUInt16LittleEndian(data, Buttons);
        data[2] = LeftTrigger;
        data[3] = RightTrigger;
        BinaryPrimitives.WriteInt16LittleEndian(data[4..], LeftX);
        BinaryPrimitives.WriteInt16LittleEndian(data[6..], LeftY);
        BinaryPrimitives.WriteInt16LittleEndian(data[8..], RightX);
        BinaryPrimitives.WriteInt16LittleEndian(data[10..], RightY);
    }

    public static Report Read(ReadOnlySpan<byte> data) => new(
        BinaryPrimitives.ReadUInt16LittleEndian(data), data[2], data[3],
        BinaryPrimitives.ReadInt16LittleEndian(data[4..]),
        BinaryPrimitives.ReadInt16LittleEndian(data[6..]),
        BinaryPrimitives.ReadInt16LittleEndian(data[8..]),
        BinaryPrimitives.ReadInt16LittleEndian(data[10..]));
}
