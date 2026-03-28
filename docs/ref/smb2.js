
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