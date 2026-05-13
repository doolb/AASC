const tasks = {
  'image.resize': require('./image-resize')
};

module.exports = {
  getTask(id) {
    return tasks[id] || null;
  },
  listTasks() {
    return Object.values(tasks).map(t => ({
      id: t.id, name: t.name, description: t.description,
      params: t.params || []
    }));
  },
  async run(id, context) {
    const task = tasks[id];
    if (!task) throw new Error('内置任务不存在: ' + id);
    return task.run(context);
  }
};
