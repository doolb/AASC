module.exports = {
  id: 'model.inference',
  name: '模型推理',
  description: '在显示端执行 AI 模型推理',
  target: 'display',
  params: [
    { name: 'modelId', type: 'select', required: true, options: ['lfm-vl'], label: '模型' },
    { name: 'image', type: 'file', required: true, label: '图片' },
    { name: 'prompt', type: 'string', required: false, default: '请详细描述这张图片', label: '提示词' },
    { name: 'targetDisplay', type: 'displaySelect', required: true, label: '目标显示端' }
  ],
  async run(context) {
    const imageFile = context.files && context.files['image'];
    if (!imageFile) throw new Error('缺少图片文件');

    const imageDir = `model-inference/${context.instanceId}`;
    const imagePath = `${imageDir}/input.jpg`;
    await context.taskIO.saveTaskFiles(context.taskName, [
      { name: imagePath, data: imageFile.toString('base64') }
    ]);

    return {
      forwardTo: 'display',
      forwardParams: {
        modelId: context.params.modelId || 'lfm-vl',
        prompt: context.params.prompt || '请详细描述这张图片',
        imageUrl: `/res/tasks/${context.taskName}/${imagePath}`
      }
    };
  }
};
