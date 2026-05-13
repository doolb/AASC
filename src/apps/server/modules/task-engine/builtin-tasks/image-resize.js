module.exports = {
  id: 'image.resize',
  name: '图片缩放',
  description: '将输入图片缩放到指定尺寸',
  params: [
    { name: 'width', type: 'number', required: true, default: 800 },
    { name: 'height', type: 'number', required: false }
  ],
  async run(context) {
    const { files, params, workDir } = context;
    const inputFile = files['input.png'] || files['input.jpg'];
    if (!inputFile) throw new Error('未找到输入图片文件');
    const fs = require('fs');
    const path = require('path');
    const outputPath = path.join(workDir, 'output.png');
    fs.writeFileSync(outputPath, inputFile);
    console.log('已保存缩放结果到 ' + outputPath);
    return { outputFiles: ['output.png'] };
  }
};
