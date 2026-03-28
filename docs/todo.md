- 修复90度和270度时，上下拖动裁剪框，显示端是左右方向的问题
 - 控制端移动裁剪框是正确的
 - 0度和180度正确的
- 拆分代码，分为核心代码，和业务代码
 - 核心代码负责处理显示端和控制端的通信
 - 业务代码负责处理业务逻辑，如裁剪、播放视频等

- 控制端查看显示端信息
 - 显示端参考showinfo.html上传自己的浏览器信息，可以在控制端查看
 
- 显示端支持通过
tts.js
生成语音功能，用于显示端播放语音
播放媒体时，显示端会自动播放语音，语音内容是当前媒体的名称

- ✅ 已完成~~合并播放和暂停按钮~~
  - upload.html:59-63 将两个按钮合并为一个切换按钮 `<button id="playPauseBtn" onclick="togglePlayPause()">`
  - controls.js `togglePlayPause()` 切换播放/暂停状态，自动更新按钮文字和背景颜色
  - controls.js `setPlayingState(playing)` 供外部设置播放状态
  - upload.css `.playing` 绿色渐变, `.paused` 橙红色渐变
  - server.js:43 `createDisplayState()` 添加 `isPlaying` 状态字段
  - server.js:415-417 处理 `play` action 时保存播放状态
  - websocket.js:57-59 收到 `displayState` 时更新播放按钮状态

- ✅ 已完成~~画面填充和旋转按钮选中状态背景颜色切换~~
  - upload.html 画面填充按钮添加 `data-fit` 属性，旋转按钮添加 `data-rotation` 属性
  - controls.js `sendFitMode()` 点击时更新按钮选中状态
  - controls.js `setFitMode()` 供外部设置填充模式状态
  - crop.js `applyRotation()` 点击时更新按钮选中状态
  - crop.js `setRotation()` 供外部设置旋转状态
  - websocket.js:50-52 收到 `displayState` 时更新填充模式按钮状态
  - upload.css `.active` 蓝色渐变背景
- 新加一个本地配置表，
 - 保存端口配置，保存语音服务地址，语音服务端口
 - 保存媒体库配置，保存媒体库文件夹路径，多个媒体库
- 现在控制端看不到预览图，点播放也没有显示到显示端,控制端媒体列表看不到预览图
- 控制端需要看到媒体列表，图片，gif，视频的预览图，有一部分显示端的画面没有正常显示


- 新增保存显示端当前播放列表，画面填充设置，服务端重启后，可以恢复到上次播放的状态，
 - 需要区分不同的显示端，用ip地址区分
 - 音量状态也要保留，控制端的语音滑动框也需要同步恢复
- 新增媒体库功能，用户可以在控制端查看和管理已上传的媒体
 - 支持视频和图片上传
 - 支持删除已上传的媒体
 - 支持预览已上传的媒体
 - 支持配置媒体库文件夹路径，多个媒体库
 - 支持文件夹中的媒体管理
 - 支持上传文件夹
 - 支持删除文件夹
 - 支持http协议的媒体库

- ✅ 已完成~~显示端navigator.userAgent，用于判断显示端的浏览器类型，然后可以在控制端查看内容,参考showinfo.html~~ 
- ✅ 已完成~~控制端显示列表新增详情按钮，点击可查看显示端的功能支持（Feature Support）~~ 
  - 上传 display.html:sendFeatureSupport


- 使用smb2库 支持smb协议的媒体库
const SMB2 = require('smb2'); // 如果安装的是 @marsaud/smb2，则 require('@marsaud/smb2')

// 配置连接参数
const smb2Client = new SMB2({
  share: '\\\\192.168.1.100\\sharedFolder', // SMB共享地址，注意双反斜杠转义
  domain: 'WORKGROUP',    // 域名，通常默认 WORKGROUP
  username: 'yourUsername',
  password: 'yourPassword',
  debug: true // 开启调试模式，查看通信日志（可选）
});

// 示例1：读取文件内容
smb2Client.readFile('folder/test.txt', (err, data) => {
  if (err) {
    console.error('读取失败:', err);
    return;
  }
  console.log('文件内容:', data.toString());
  
  // 操作完成后建议关闭连接以释放资源
  smb2Client.close();
});

// 示例2：读取目录列表
smb2Client.readdir('folder', (err, files) => {
  if (err) throw err;
  console.log('目录下的文件:', files);
});

// 示例3：写入文件
const content = Buffer.from('Hello SMB Server');
smb2Client.writeFile('folder/newFile.txt', content, (err) => {
  if (err) throw err;
  console.log('文件写入成功');
});

- 服务器重启后，状态恢复功能，需要从本地配置表中读取上次播放的状态，
 - 播放列表
 - 画面填充设置
 - 音量状态
 - 语音滑动框位置

- ✅ 已完成~~upload.html 拆分代码，每个文件负责一个功能模块~~
 - upload.html 负责上传文件
 - js
  - websocket.js 负责处理与服务端的websocket通信
  - media-list.js 负责处理媒体上传的业务逻辑 显示媒体列表
  - display-list.js 负责处理显示端的业务逻辑
  - crop.js 负责处理裁剪功能
  - tts.js 负责处理语音播报功能
  - controls.js 负责处理进度/音量控制
  - toast.js 负责处理提示消息
  - upload.js 负责处理文件上传
  - main.js 主入口和初始化
 - css
  - upload.css 负责上传文件的样式