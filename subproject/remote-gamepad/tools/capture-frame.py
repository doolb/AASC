#!/usr/bin/env python3
"""通过 remote-gamepad 画面端口获取一张 JPEG。"""
import argparse
import json
import socket
import struct
from pathlib import Path

MAX_METADATA = 4096
MAX_IMAGE = 32 * 1024 * 1024


def receive_exact(sock, length):
    data = bytearray()
    while len(data) < length:
        chunk = sock.recv(min(length - len(data), 65536))
        if not chunk:
            raise ConnectionError("连接提前关闭")
        data.extend(chunk)
    return bytes(data)


def receive_metadata(sock):
    length = struct.unpack("<I", receive_exact(sock, 4))[0]
    if not 2 <= length <= MAX_METADATA:
        raise ValueError("响应元数据长度无效")
    return json.loads(receive_exact(sock, length))


def capture(host, port, quality, encoder, output):
    with socket.create_connection((host, port), timeout=15) as sock:
        sock.settimeout(15)
        sock.sendall(b"VDF1")
        caps = receive_metadata(sock)
        if caps.get("type") != "capabilities" or caps.get("version") != 1:
            raise ValueError("服务端能力或协议版本不匹配")
        if encoder not in caps.get("encoders", []):
            raise ValueError(f"服务端不支持编码器 {encoder}；支持：{caps.get('encoders', [])}")
        request = json.dumps({"type": "snapshot", "quality": quality, "encoder": encoder}, separators=(",", ":")).encode()
        sock.sendall(struct.pack("<I", len(request)) + request)
        metadata = receive_metadata(sock)
        if metadata.get("type") == "error":
            raise RuntimeError(metadata.get("message", "服务端截图失败"))
        length = metadata.get("length")
        if metadata.get("type") != "frame" or metadata.get("format") != "jpeg" or not isinstance(length, int) or not 4 <= length <= MAX_IMAGE:
            raise ValueError("响应图片元数据无效")
        image = receive_exact(sock, length)
        if not image.startswith(b"\xff\xd8") or not image.endswith(b"\xff\xd9"):
            raise ValueError("响应不是完整的 JPEG")
        Path(output).write_bytes(image)
        return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("host")
    parser.add_argument("--port", type=int, default=26763)
    parser.add_argument("--quality", type=int, default=85)
    parser.add_argument("--encoder", choices=("cpu", "gpu"), default="cpu")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535 or not 1 <= args.quality <= 100:
        parser.error("端口必须为 1–65535，画质必须为 1–100")
    try:
        result = capture(args.host, args.port, args.quality, args.encoder, args.output)
        print(f"已保存 {args.output}：{result['width']}×{result['height']}，{result['encoder']}，{result['length']} 字节")
    except (OSError, ValueError, RuntimeError, KeyError) as exc:
        parser.exit(1, f"截图失败：{exc}\n")


if __name__ == "__main__":
    main()
