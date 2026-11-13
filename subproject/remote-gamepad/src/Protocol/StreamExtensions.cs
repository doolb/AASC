namespace RemoteGamepad;

public static class StreamExtensions
{
    public static async Task ReadFrameExactlyAsync(this Stream stream, Memory<byte> buffer, CancellationToken cancellationToken)
    {
        while (!buffer.IsEmpty)
        {
            int count = await stream.ReadAsync(buffer, cancellationToken);
            if (count == 0) throw new EndOfStreamException("Connection closed before the full frame arrived.");
            buffer = buffer[count..];
        }
    }
}
