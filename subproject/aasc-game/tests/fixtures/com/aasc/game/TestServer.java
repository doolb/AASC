package com.aasc.game;
import android.content.Context;
public class TestServer {
    public static void main(String[] args) throws Exception {
        Context context = new Context();
        try { new RoomServer(context, 0, "unknown", 1); throw new AssertionError("未知原生游戏应被拒绝"); }
        catch (IllegalArgumentException expected) { }
        try { new RoomServer(context, 0, "gomoku", 2); throw new AssertionError("不兼容的原生协议应被拒绝"); }
        catch (IllegalArgumentException expected) { }
        RoomServer server = new RoomServer(context, 0);
        server.start();
        System.out.println(server.port() + " " + server.hostKey());
        System.out.flush();
        while (System.in.read() == 'r') {
            server.close();
            server = new RoomServer(context, 0);
            server.start();
            System.out.println(server.port() + " " + server.hostKey());
            System.out.flush();
        }
        server.close();
    }
}
