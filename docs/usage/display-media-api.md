# 显示端与媒体播放 API

本文供其他客户端接入现有服务器，覆盖设备列表、单媒体、播放控制、背景媒体和批量播放。基于当前源码核对：`server-app.js`、`websocket.js`、`playlist-app-service.js` 和 `display.html`。这是现有控制端协议，不是新增接口；升级服务端后应重新验证字段和客户端兼容性。

## 连接与约定

假设服务器地址为 `https://192.168.1.10:8081`。HTTP 请求使用同一地址；WebSocket 使用 `wss://192.168.1.10:8081/control`，若服务器使用 HTTP 则对应 `ws://…/control`。`/control` 的 WebSocket 连接建立后即为控制端，不需要先发送注册消息。服务器会主动发送多条初始化消息，其中 `displayList` 是设备列表，后续也会广播更新。不要把 `https://…/control` 网页请求和 WebSocket 连接混淆。

生产客户端应验证 TLS 证书。自签名证书需安装并信任对应 CA。控制连接具备控制设备的能力，应部署在可信网络或由已有网关限制访问。显示端必须能够访问所提供的媒体 URL；客户端能打开不代表显示端也能打开。

### 只读连接示例（Node.js）

项目根目录已依赖 `ws`，以下示例连接、等待设备列表并查询第一台设备的当前状态；不发送播放指令。将地址替换为实际服务器；使用可信证书，或按照客户端环境配置 CA。

```bash
AASC_WS='wss://192.168.1.10:8081/control' node <<'NODE'
const WebSocket = require('ws');
const ws = new WebSocket(process.env.AASC_WS);
let requested = false;
ws.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'displayList') {
        console.log('在线设备:', message.list.map(({ id, ip }) => ({ id, ip })));
        if (!requested && message.list.length) {
            requested = true;
            ws.send(JSON.stringify({ type: 'getState', displayId: message.list[0].id }));
        }
    }
    if (message.type === 'displayState') {
        console.log('设备状态:', message.displayId, message.state);
        ws.close();
    }
});
ws.on('error', error => console.error('连接失败:', error.message));
setTimeout(() => ws.close(), 10000).unref();
NODE
```

以下 JSON 都是通过已连接的 WebSocket 发送。`DISPLAY_ID` 必须替换为 `displayList.list[].id`；`LIBRARY_ID` 从媒体库列表获取。示例地址、文件名和 ID 均为占位符。

## 设备与状态

连接后接收的消息示意：

```json
{"type":"displayList","list":[{"id":"DISPLAY_ID","ip":"192.168.1.20","canvasSize":{"width":1920,"height":1080}}]}
```

设备对象还可能包含 `capabilities`、`browserInfo`、`rotation` 等信息，实际字段以服务端返回为准。空列表表示当前没有在线显示端。查询某台设备：

```json
{"type":"getState","displayId":"DISPLAY_ID"}
```

返回 `{"type":"displayState","displayId":"DISPLAY_ID","state":{...}}`，状态可能包含 `currentMedia`、`currentPlaylist`、`fit`、`volume`、`isPlaying`、`backgroundMedia` 等。离线设备的该请求可能没有回包，客户端应设置超时并以最新 `displayList` 判断在线状态。状态和媒体进度是异步数据，不能视为操作一定已完成。

## 播放单个媒体

向一台或多台在线显示端发送 URL：

```json
{"type":"mediaBatch","displayIds":["DISPLAY_ID"],"media":{"type":"url","url":"https://example.com/demo.mp4","mediaType":"video","fileName":"demo.mp4"}}
```

`mediaType` 按内容明确指定 `image`、`gif`、`video`、`audio`、`html` 或 `text`；文本可增加 `format: "plain"` 或 `"markdown"`。发送新媒体会结束目标设备的现有播放列表。空地址可能返回 `mediaError`；离线 ID 会被跳过，发送动作本身没有统一的成功回执。`displayIds` 可包含多台设备；如需判断实际播放，结合设备状态及下述进度事件。

也可向单台设备发送 `{"type":"media","displayId":"DISPLAY_ID","media":{"type":"url","url":"https://example.com/demo.mp4","mediaType":"video"}}`。临时内容可使用媒体对象 `{"type":"base64","data":"不含 data: 前缀的 Base64","fileName":"photo.jpg","mediaType":"image","mimeType":"image/jpeg","temp":true}`；大文件宜使用媒体库或 URL，避免 Base64 增加内存和传输开销。

### 上传本地文件并发送

`POST /upload-file` 使用 `multipart/form-data`，字段为 `file` 和 `displayId`：

```bash
curl --fail-with-body -F 'displayId=DISPLAY_ID' -F 'file=@./photo.jpg' \
  'https://192.168.1.10:8081/upload-file'
```

返回成功形如 `{"status":"success","message":"媒体已发送到显示端"}`。当前实现即使设备已离线，也可能保存文件并返回成功，因此先确认在线，并用设备状态或进度核对。服务器生成的文件地址使用其本机 IP，需确保显示端能访问。`GET /media-list` 列出该上传目录。

## 常用单设备控制

所有动作均使用 `type: "control"` 和目标 `displayId`：

| 操作 | JSON 示例中的 `action` | `value` |
| --- | --- | --- |
| 播放/暂停 | `play` | `true` / `false` |
| 播放进度 | `seek` | 0–100 的百分比，例如 `50` |
| 音量 | `volume` | 0–100，例如 `50` |
| 画面填充 | `fit` | `contain`、`cover`、`dynamic`、`height`、`width`、`crop` |
| 旋转 | `rotate` | 角度，例如 `90` |
| 清空当前媒体 | `clearMedia` | 不需要 |

```json
{"type":"control","displayId":"DISPLAY_ID","action":"play","value":false}
```

清空示例：`{"type":"control","displayId":"DISPLAY_ID","action":"clearMedia"}`。清空会停止当前媒体和批量列表，服务器回传或广播 `mediaClearResult`，其中 `success` 表示服务器处理结果。`play`、`seek` 等普通控制并非统一请求/响应 API；设备不在线时可能没有错误回包。

## 独立背景媒体

背景与主媒体独立，可在播放文本、图片、视频时同时使用。发送包含 URL 与类型的增量配置：

```json
{"type":"control","displayId":"DISPLAY_ID","action":"backgroundMedia","value":{"url":"https://example.com/music.mp3","mediaType":"audio","playing":true,"loop":true,"volume":50}}
```

`mediaType` 支持 `audio`、`video`、`image`、`gif`；URL 支持 HTTP(S) 或服务器根路径。音量范围为 0–100。后续可单独发送 `value: {"playing":false}` 暂停、`{"playing":true}` 恢复、`{"volume":30}` 调音量，或 `{"url":"","playing":false}` 停止并清除。服务器广播 `backgroundMediaChanged` 权威值，参数无效时返回 `backgroundMediaError`；`backgroundMediaStatus` 反映显示端播放状态，可能报告加载失败或被浏览器阻止。

## 媒体库与批量播放

先获取媒体库和目录：

```bash
curl --fail-with-body 'https://192.168.1.10:8081/api/media-libraries'
curl --fail-with-body --get 'https://192.168.1.10:8081/api/media-libraries/LIBRARY_ID/list' --data-urlencode 'path=/'
```

前者返回 `status`、`libraries` 和 `defaultLibraryId`，后者返回 `status`、`items`；目录路径和库 ID 用真实返回值替换。这里是本服务器媒体库；远程服务器聚合媒体库需使用相应的远程媒体库接口和节点 ID。

向媒体库某个目录发起批量播放：

```json
{"type":"playlistRequest","displayIds":["DISPLAY_ID"],"libraryId":"LIBRARY_ID","path":"/","recursive":false,"interval":5,"mode":"sequence","sortBy":"name","direction":"asc","mediaTypes":["image","video","audio","text","web"],"loop":true,"announceName":false}
```

| 字段 | 含义 |
| --- | --- |
| `recursive` | 是否遍历子文件夹 |
| `interval` | 间隔秒数；图片等按间隔切换，音视频播放结束后再等待间隔 |
| `mode` | `sequence` 顺序或 `random` 随机 |
| `sortBy`、`direction` | 按 `name` 或 `time`，`asc` 正序或 `desc` 倒序；随机模式不使用排序结果 |
| `mediaTypes` | 支持 `image`（含 GIF）、`gif`、`video`、`audio`、`text`、`web`（HTML）；不传或空数组表示全部类型 |
| `loop`、`announceName` | 是否循环、是否播报文件名 |

服务端回复 `playlistStarted`，含 `listId`、`total` 和实际在线的 `displayIds`；失败回复 `playlistError`。该回复表示已生成并下发，不保证设备已成功解码。目标显示端广播 `playlistProgress`，包含设备 ID、列表 ID、索引、总数、状态和当前项信息；进度、播放状态和媒体加载事件可能随后异步到达。

列表控制支持 `pause`、`resume`、`next`、`prev`、`jump`、`stop`：

```json
{"type":"playlistControl","displayIds":["DISPLAY_ID"],"action":"next"}
```

`jump` 需要额外的零基索引，例如 `{"type":"playlistControl","displayIds":["DISPLAY_ID"],"action":"jump","index":0}`。这些控制不会返回统一成功确认；根据 `playlistProgress` 和 `getState` 判断实际状态。

如需临时批量文件，发送 `playlistRequest`，设置 `temp: true` 和 `files` 数组；每项包含 `name`、不带前缀的 Base64 `data`、`mediaType`，可附 `mimeType` 和文本 `format`。临时批量内容不会作为完整 Base64 列表持久化，重连恢复能力与媒体库列表不同。

## 对接时需要注意

- `displayList` 是在线设备列表；断线重连后应等待新列表，再恢复订阅和重新查询状态。
- `playlistStarted.displayIds` 可能为空：列表生成成功不等于目标在线或播放成功。
- 监听 `videoProgress`、`audioProgress`、`playlistProgress`、`playStateReport`、`mediaClearResult`、`backgroundMediaStatus` 等事件时按 `displayId` 过滤；不同媒体和设备上报的字段可能不同。
- 图片、视频和音频格式及自动播放是否可用取决于显示端浏览器或 Android WebView。跨网络 URL、证书及服务端生成的本机地址须在目标设备实际验证。
