import importlib.util
import json
import socket
import struct
import tempfile
import threading
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[2] / "tools" / "capture-frame.py"
spec = importlib.util.spec_from_file_location("capture_frame", MODULE)
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


def packet(value):
    data = json.dumps(value).encode()
    return struct.pack("<I", len(data)) + data


class CaptureTests(unittest.TestCase):
    def run_server(self, handler):
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = listener.getsockname()[1]
        errors = []
        def run():
            try:
                with listener, listener.accept()[0] as conn:
                    handler(conn)
            except Exception as exc:
                errors.append(exc)
        thread = threading.Thread(target=run)
        thread.start()
        return port, thread, errors

    def test_snapshot_fragmented(self):
        jpeg = b"\xff\xd8sample\xff\xd9"
        def server(conn):
            self.assertEqual(client.receive_exact(conn, 4), b"VDF1")
            caps = packet({"type": "capabilities", "version": 1, "encoders": ["cpu"]})
            for byte in caps:
                conn.sendall(bytes([byte]))
            request = client.receive_metadata(conn)
            self.assertEqual(request, {"type": "snapshot", "quality": 42, "encoder": "cpu"})
            conn.sendall(packet({"type": "frame", "format": "jpeg", "encoder": "cpu", "length": len(jpeg), "width": 10, "height": 8}) + jpeg)
        port, thread, errors = self.run_server(server)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "frame.jpg"
            metadata = client.capture("127.0.0.1", port, 42, "cpu", output)
            self.assertEqual(output.read_bytes(), jpeg)
            self.assertEqual(metadata["width"], 10)
        thread.join(3)
        self.assertFalse(errors)

    def test_rejects_unavailable_gpu(self):
        def server(conn):
            self.assertEqual(client.receive_exact(conn, 4), b"VDF1")
            conn.sendall(packet({"type": "capabilities", "version": 1, "encoders": ["cpu"], "gpu": False}))
        port, thread, errors = self.run_server(server)
        with self.assertRaisesRegex(ValueError, "不支持编码器"):
            client.capture("127.0.0.1", port, 85, "gpu", "/tmp/unused.jpg")
        thread.join(3)
        self.assertFalse(errors)

    def test_truncated_data_rejected(self):
        def server(conn):
            client.receive_exact(conn, 4)
            conn.sendall(packet({"type": "capabilities", "version": 1, "encoders": ["cpu"]}))
            client.receive_metadata(conn)
            conn.sendall(packet({"type": "frame", "format": "jpeg", "length": 10}) + b"\xff\xd8")
        port, thread, errors = self.run_server(server)
        with self.assertRaises(ConnectionError):
            client.capture("127.0.0.1", port, 85, "cpu", "/tmp/unused.jpg")
        thread.join(3)
        self.assertFalse(errors)


if __name__ == "__main__":
    unittest.main()
