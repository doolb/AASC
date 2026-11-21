#!/usr/bin/env python3
"""用 EWMH 激活已核对标题的 X11 猪游戏窗口，不发送鼠标输入。"""
import ctypes
import re
import subprocess
import sys
import time


def main(display, window):
    if not re.fullmatch(r':[0-9]+(?:\.[0-9]+)?', display) or not re.fullmatch(r'0x[0-9a-fA-F]+', window):
        raise ValueError('无效 X11 参数')
    title = subprocess.run(['xprop', '-display', display, '-id', window, '_NET_WM_NAME'], check=True, capture_output=True, text=True, timeout=5).stdout
    if not re.search(r'=\s*"猪了个猪"\s*$', title):
        raise ValueError('窗口标题不匹配，拒绝激活')
    x = ctypes.CDLL('libX11.so.6')
    pointer, ulong = ctypes.c_void_p, ctypes.c_ulong
    x.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x.XOpenDisplay.restype = pointer
    x.XDefaultRootWindow.argtypes = [pointer]
    x.XDefaultRootWindow.restype = ulong
    x.XInternAtom.argtypes = [pointer, ctypes.c_char_p, ctypes.c_int]
    x.XInternAtom.restype = ulong
    x.XSendEvent.argtypes = [pointer, ulong, ctypes.c_int, ctypes.c_long, pointer]
    x.XFlush.argtypes = [pointer]
    x.XCloseDisplay.argtypes = [pointer]
    connection = x.XOpenDisplay(display.encode())
    if not connection:
        raise RuntimeError('无法连接 X11')
    class ClientMessage(ctypes.Structure):
        _fields_ = [('type', ctypes.c_int), ('serial', ulong), ('send_event', ctypes.c_int), ('display', pointer),
                    ('window', ulong), ('message_type', ulong), ('format', ctypes.c_int), ('data', ctypes.c_long * 5)]
    class Event(ctypes.Union):
        _fields_ = [('client', ClientMessage), ('padding', ctypes.c_long * 24)]
    try:
        root = x.XDefaultRootWindow(connection)
        atom = x.XInternAtom(connection, b'_NET_ACTIVE_WINDOW', 0)
        event = Event()
        event.client.type = 33
        event.client.window = int(window, 16)
        event.client.message_type = atom
        event.client.format = 32
        event.client.data[0] = 1
        if not x.XSendEvent(connection, root, 0, (1 << 20) | (1 << 19), ctypes.byref(event)):
            raise RuntimeError('X11 激活请求失败')
        x.XFlush(connection)
    finally:
        x.XCloseDisplay(connection)
    for _ in range(20):
        active = subprocess.run(['xprop', '-display', display, '-root', '_NET_ACTIVE_WINDOW'], check=True, capture_output=True, text=True, timeout=5).stdout
        ids = re.findall(r'0x[0-9a-fA-F]+', active)
        if ids and int(ids[-1], 16) == int(window, 16):
            return
        time.sleep(0.1)
    raise RuntimeError('游戏窗口未能激活')


if __name__ == '__main__':
    try:
        main(*sys.argv[1:])
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError, TypeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
