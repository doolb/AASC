const os = require('os');
const path = require('path');

// 私人运行数据统一存放目录(home 目录,脱离 git 跟踪与项目分享面)
const USER_CONFIG_DIR = path.join(os.homedir(), '.config', 'aasc-user');

module.exports = { USER_CONFIG_DIR };
