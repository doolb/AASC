package com.aasc.game;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

/** 局域网房间服务：串行修改棋局，WebSocket 只接受完整且经过掩码的客户端消息。 */
final class GomokuRoomServer implements NativeRoom {
    private final Context context;
    private final int port;
    private final SharedPreferences prefs;
    private final String hostKey = UUID.randomUUID().toString();
    private final ExecutorService workers = Executors.newCachedThreadPool();
    private final List<Client> clients = new ArrayList<>();
    private final String[] tokens = new String[2];
    private final String[] names = new String[2];
    private final Client[] seats = new Client[2];
    private ServerSocket listener;
    private int size, revision, turn;
    private int[] board;
    private String result = "waiting";

    GomokuRoomServer(Context context, int port) {
        this.context = context.getApplicationContext(); this.port = port;
        prefs = context.getSharedPreferences("game", Context.MODE_PRIVATE);
        size = prefs.getInt("size", 15);
        if (size != 9 && size != 11 && size != 13 && size != 15) size = 15;
        board = new int[size * size];
        restore();
    }
    /** 棋局和座位保存在应用私有配置中；连接对象不跨进程恢复。 */
    private void restore() {
        try {
            JSONObject saved = new JSONObject(prefs.getString("room", "{}"));
            int savedSize = saved.getInt("size"), savedTurn = saved.getInt("turn"), savedRevision = saved.getInt("revision");
            String savedResult = saved.getString("result");
            JSONArray cells = saved.getJSONArray("board"), savedTokens = saved.getJSONArray("tokens"), savedNames = saved.getJSONArray("names");
            if ((savedSize != 9 && savedSize != 11 && savedSize != 13 && savedSize != 15) || cells.length() != savedSize * savedSize || savedTurn < 0 || savedTurn > 1 || savedRevision < 0 || !java.util.Arrays.asList("waiting", "playing", "black", "white", "draw").contains(savedResult)) return;
            int[] restored = new int[cells.length()];
            for (int i = 0; i < restored.length; i++) { restored[i] = cells.getInt(i); if (restored[i] < 0 || restored[i] > 2) return; }
            String[] restoredTokens = new String[2], restoredNames = new String[2];
            for (int i = 0; i < 2; i++) { restoredTokens[i] = savedTokens.optString(i, ""); restoredNames[i] = savedNames.optString(i, ""); }
            size = savedSize; turn = savedTurn; revision = savedRevision; result = savedResult; board = restored;
            for (int i = 0; i < 2; i++) { tokens[i] = restoredTokens[i].isEmpty() ? null : restoredTokens[i]; names[i] = restoredNames[i].isEmpty() ? null : restoredNames[i]; }
        } catch (Exception ignored) { }
    }
    private void persist() {
        try {
            JSONArray cells = new JSONArray(), savedTokens = new JSONArray(), savedNames = new JSONArray();
            for (int cell : board) cells.put(cell);
            for (int i = 0; i < 2; i++) { savedTokens.put(tokens[i] == null ? "" : tokens[i]); savedNames.put(names[i] == null ? "" : names[i]); }
            JSONObject saved = new JSONObject().put("size", size).put("turn", turn).put("revision", revision).put("result", result).put("board", cells).put("tokens", savedTokens).put("names", savedNames);
            if (!prefs.edit().putInt("size", size).putString("room", saved.toString()).commit()) android.util.Log.e("AascGame", "保存棋局失败");
        } catch (Exception error) { android.util.Log.e("AascGame", "保存棋局失败", error); }
    }
    public String hostKey() { return hostKey; }
    public int port() { return listener.getLocalPort(); }
    public void start() throws Exception {
        if (listener != null) return;
        listener = new ServerSocket(port);
        workers.execute(() -> {
            while (!listener.isClosed()) {
                try { Socket socket = listener.accept(); workers.execute(() -> handle(socket)); }
                catch (Exception ignored) { break; }
            }
        });
    }
    private static String line(InputStream in) throws Exception {
        ByteArrayOutputStream data = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') data.write(c);
            if (data.size() > 8192) throw new Exception("请求过长");
        }
        return data.toString("UTF-8");
    }
    private void handle(Socket socket) {
        Client client = null;
        try {
            socket.setSoTimeout(15000);
            InputStream in = socket.getInputStream(); OutputStream out = socket.getOutputStream();
            String request = line(in), key = null, header;
            while (!(header = line(in)).isEmpty()) {
                if (header.toLowerCase().startsWith("sec-websocket-key:")) key = header.substring(header.indexOf(':') + 1).trim();
            }
            if (key == null) { serve(request, out); return; }
            String accept = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1").digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.US_ASCII)));
            out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII)); out.flush();
            socket.setSoTimeout(0); client = new Client(socket, out);
            synchronized (this) { clients.add(client); }
            while (!socket.isClosed()) {
                String message = readFrame(in);
                if (message == null) break;
                dispatch(client, new JSONObject(message));
            }
        } catch (Exception ignored) {
            // 断连或非法帧均结束连接，不改变已经确认的棋局。
        } finally {
            synchronized (this) {
                if (client != null) {
                    clients.remove(client);
                    for (int i = 0; i < 2; i++) if (seats[i] == client) seats[i] = null;
                    broadcast();
                }
            }
            try { socket.close(); } catch (Exception ignored) { }
        }
    }
    private void serve(String request, OutputStream out) throws Exception {
        String path = request.split(" ")[1].split("\\?")[0];
        String file = path.equals("/") ? "index.html" : path.substring(1);
        if (!file.equals("index.html") && !file.equals("app.js") && !file.equals("style.css") && !file.equals("third-party-licenses.txt")) {
            out.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".getBytes(StandardCharsets.US_ASCII)); return;
        }
        byte[] body;
        try (InputStream asset = context.getAssets().open(file); ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[4096]; int count;
            while ((count = asset.read(chunk)) != -1) buffer.write(chunk, 0, count);
            body = buffer.toByteArray();
        }
        String mime = file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".txt") ? "text/plain" : "text/html";
        out.write(("HTTP/1.1 200 OK\r\nContent-Type: " + mime + "; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: " + body.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII)); out.write(body); out.flush();
    }
    private static String readFrame(InputStream in) throws Exception {
        int first = in.read(), second = in.read();
        if (first < 0 || second < 0 || (first & 15) == 8) return null;
        if (first != 0x81 || (second & 128) == 0) throw new Exception("帧格式无效");
        long length = second & 127;
        if (length == 126) length = (in.read() << 8) | in.read();
        if (length > 8192 || length == 127) throw new Exception("帧过长");
        byte[] mask = readBytes(in, 4), data = readBytes(in, (int) length);
        for (int i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
        return new String(data, StandardCharsets.UTF_8);
    }
    private static byte[] readBytes(InputStream in, int count) throws Exception {
        byte[] data = new byte[count]; int at = 0;
        while (at < count) { int n = in.read(data, at, count - at); if (n < 0) throw new Exception("连接中断"); at += n; }
        return data;
    }
    private synchronized void dispatch(Client c, JSONObject message) throws Exception {
        if (!"command".equals(message.optString("type"))) return;
        JSONObject payload = message.optJSONObject("payload");
        if (payload == null) return;
        String topic = message.optString("topic");
        if (topic.equals("game.join")) {
            if (c.seat >= 0) { error(c, "已加入房间"); return; }
            // 原生模式保留历史五子棋协议；缺少字段视作旧版五子棋，不接受其他游戏。
            Object requestedId = payload.has("gameId") ? payload.opt("gameId") : "gomoku";
            Object requestedVersion = payload.has("protocolVersion") ? payload.opt("protocolVersion") : 1;
            if (!"gomoku".equals(requestedId) || !(requestedVersion instanceof Number) || ((Number) requestedVersion).doubleValue() != 1.0) { error(c, "原生房主不支持该游戏或协议版本"); return; }
            String token = payload.optString("token"), name = payload.optString("name").trim();
            if (!token.matches("[a-zA-Z0-9-]{16,80}") || name.isEmpty() || name.length() > 24) { error(c, "身份或昵称无效"); return; }
            boolean host = hostKey.equals(payload.optString("hostKey"));
            int index = host ? 0 : 1;
            if (tokens[index] != null && !tokens[index].equals(token)) { error(c, "座位已被占用"); return; }
            if (seats[index] != null && seats[index] != c) { error(c, "该玩家已在线"); return; }
            tokens[index] = token; names[index] = name; seats[index] = c; c.seat = index; persist(); broadcast(); return;
        }
        if (c.seat < 0 || seats[c.seat] != c) { error(c, "请先加入房间"); return; }
        if (topic.equals("game.config")) {
            int value = payload.optInt("size");
            if (c.seat != 0 || result.equals("playing") || (value != 9 && value != 11 && value != 13 && value != 15)) { error(c, "无法修改尺寸"); return; }
            size = value; board = new int[size * size]; result = "waiting"; revision++; persist(); broadcast(); return;
        }
        if (topic.equals("game.start")) {
            if (c.seat != 0 || seats[1] == null || result.equals("playing")) { error(c, "需要两人在线且当前没有进行中的棋局"); return; }
            board = new int[size * size]; turn = 0; result = "playing"; revision++; persist(); broadcast(); return;
        }
        if (topic.equals("game.move")) {
            int x = payload.optInt("x", -1), y = payload.optInt("y", -1);
            if (!result.equals("playing") || c.seat != turn || payload.optInt("revision", -1) != revision || x < 0 || y < 0 || x >= size || y >= size || board[y * size + x] != 0) { error(c, "落子无效，请检查回合或同步状态"); return; }
            board[y * size + x] = c.seat + 1;
            if (wins(x, y, c.seat + 1)) result = c.seat == 0 ? "black" : "white";
            else { boolean full = true; for (int cell : board) if (cell == 0) full = false; if (full) result = "draw"; else turn = 1 - turn; }
            revision++; persist(); broadcast();
        }
    }
    private boolean wins(int x, int y, int color) {
        int[][] directions = {{1,0},{0,1},{1,1},{1,-1}};
        for (int[] d : directions) {
            int count = 1;
            for (int sign : new int[]{-1, 1}) {
                int nx = x + sign * d[0], ny = y + sign * d[1];
                while (nx >= 0 && ny >= 0 && nx < size && ny < size && board[ny * size + nx] == color) { count++; nx += sign * d[0]; ny += sign * d[1]; }
            }
            if (count >= 5) return true;
        }
        return false;
    }
    private JSONObject envelope(String type, String topic, JSONObject payload) throws Exception {
        JSONObject source = new JSONObject().put("ip", "server").put("role", "server").put("name", "room");
        return new JSONObject().put("id", UUID.randomUUID().toString()).put("version", "1.0").put("type", type).put("timestamp", System.currentTimeMillis()).put("source", source).put("topic", topic).put("payload", payload);
    }
    private void error(Client c, String text) throws Exception { c.send(envelope("response", "game.error", new JSONObject().put("message", text)).toString()); }
    private void broadcast() {
        try {
            JSONArray cells = new JSONArray(); for (int cell : board) cells.put(cell);
            JSONArray players = new JSONArray();
            for (int i = 0; i < 2; i++) players.put(new JSONObject().put("name", names[i] == null ? "" : names[i]).put("online", seats[i] != null));
            for (Client c : new ArrayList<>(clients)) {
                if (c.seat < 0) continue;
                JSONObject state = new JSONObject().put("gameId", "gomoku").put("protocolVersion", 1).put("size", size).put("revision", revision).put("turn", turn).put("result", result).put("board", cells).put("players", players).put("seat", c.seat);
                try { c.send(envelope("event", "game.snapshot", state).toString()); } catch (Exception ignored) { try { c.socket.close(); } catch (Exception ignored2) { } }
            }
        } catch (Exception ignored) { }
    }
    @Override public void close() {
        try { if (listener != null) listener.close(); } catch (Exception ignored) { }
        synchronized (this) { for (Client c : new ArrayList<>(clients)) try { c.socket.close(); } catch (Exception ignored) { } }
        workers.shutdownNow();
    }
    private static final class Client {
        final Socket socket; final OutputStream out; int seat = -1;
        Client(Socket socket, OutputStream out) { this.socket = socket; this.out = out; }
        synchronized void send(String text) throws Exception {
            byte[] bytes = text.getBytes(StandardCharsets.UTF_8); out.write(0x81);
            if (bytes.length < 126) out.write(bytes.length); else { out.write(126); out.write(bytes.length >> 8); out.write(bytes.length & 255); }
            out.write(bytes); out.flush();
        }
    }
}
