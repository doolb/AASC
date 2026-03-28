- 修复90度和270度时，上下拖动裁剪框，显示端是左右方向的问题
 - 控制端移动裁剪框是正确的
 - 0度和180度正确的
- 拆分代码，分为核心代码，和业务代码
 - 核心代码负责处理显示端和控制端的通信
 - 业务代码负责处理业务逻辑，如裁剪、播放视频等
- 新增媒体库功能，用户可以在控制端查看和管理已上传的媒体
 - 支持视频和图片上传
 - 支持删除已上传的媒体
 - 支持预览已上传的媒体
 - 支持配置媒体库文件夹路径，多个媒体库
 - 支持文件夹中的媒体管理
 - 支持上传文件夹
 - 支持删除文件夹
 - 支持http协议的媒体库

- 显示端navigator.userAgent，用于判断显示端的浏览器类型，然后可以在控制端查看内容,参考showinfo.html

- 显示端支持通过
// TTS 接口
app.post('/api/tts', async (req, res) => {
  // 获取 speed 参数
  const { text, voice, speed } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'text 不能为空' });
  }

  try {
    const finalVoice = voice || DEFAULT_VOICE;
    console.log(`[TTS] 生成: "${text}" | 语音: ${finalVoice} | 语速: ${speed || 0}`);

    // 传入 speed
    await runBalcon(text, voice, speed, OUTPUT_WAV);

    if (!fs.existsSync(OUTPUT_WAV)) {
      throw new Error('音频文件生成失败');
    }

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    
    const stream = fs.createReadStream(OUTPUT_WAV);
    stream.pipe(res);

  } catch (err) {
    console.error('TTS 错误:', err);
    res.status(500).json({ error: 'TTS 失败', details: err.message });
  }
});
生成语音功能，用于显示端播放语音
播放媒体时，显示端会自动播放语音，语音内容是当前媒体的名称

- 合并播放和暂停按钮，显示端参考showinfo.html上传自己的浏览器信息，可以在控制端查看
- 新加一个本地配置表，
 - 保存端口配置，保存语音服务地址，语音服务端口
 - 保存媒体库配置，保存媒体库文件夹路径，多个媒体库
- 现在控制端看不到预览图，点播放也没有显示到显示端,控制端媒体列表看不到预览图
- 控制端需要看到媒体列表，图片，gif，视频的预览图，有一部分显示端的画面没有正常显示

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
