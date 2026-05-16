const tasks = {
  'image.resize': require('./image-resize'),
  'model.inference': require('./model-inference'),
  'time.announce': require('./time-announce')
};

module.exports = {
  getTask(id) {
    return tasks[id] || null;
  },
  listTasks() {
    return Object.values(tasks).map(t => ({
      id: t.id, name: t.name, description: t.description,
      target: t.target || 'server',
      mode: t.mode || 'one-shot',
      params: t.params || [],
      widget: t.widget || null
    }));
  },
  async run(id, context) {
    const task = tasks[id];
    if (!task) throw new Error('内置任务不存在: ' + id);
    return task.run(context);
  }
};
