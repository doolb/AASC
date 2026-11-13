package com.aasc.game;

import android.content.Context;
import java.util.Collections;
import java.util.Map;

/** 原生房间注册入口；默认五子棋以兼容现有 APK 启动和已保存棋局。 */
final class RoomServer implements NativeRoom {
    private interface Factory { NativeRoom create(Context context, int port); }
    private static final Map<String, Factory> GAMES = Collections.singletonMap("gomoku:1", GomokuRoomServer::new);
    private final NativeRoom game;

    RoomServer(Context context, int port) { this(context, port, "gomoku", 1); }
    RoomServer(Context context, int port, String gameId, int version) {
        Factory factory = GAMES.get(gameId + ":" + version);
        if (factory == null) throw new IllegalArgumentException("原生房主不支持该游戏或协议版本");
        game = factory.create(context, port);
    }
    public void start() throws Exception { game.start(); }
    public int port() { return game.port(); }
    public String hostKey() { return game.hostKey(); }
    public void close() { game.close(); }
}
