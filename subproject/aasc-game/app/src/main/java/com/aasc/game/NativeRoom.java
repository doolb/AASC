package com.aasc.game;

/** 原生房间实现的最小生命周期契约；协议与棋局归各游戏实现。 */
interface NativeRoom extends AutoCloseable {
    void start() throws Exception;
    int port();
    String hostKey();
    void close();
}
