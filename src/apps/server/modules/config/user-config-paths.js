const os = require('os');
const path = require('path');
const {
  resolveReleaseRuntimeContext,
  validateReleaseRuntimeContext
} = require('../../../../core/release-runtime-context');

const projectRoot = path.resolve(process.env.AASC_PROJECT_ROOT || path.resolve(__dirname, '../../../../../'));
const runtimeContext = resolveReleaseRuntimeContext({
  projectRoot,
  homeDir: os.homedir(),
  argv: process.argv,
  environment: process.env
});
validateReleaseRuntimeContext(runtimeContext);

// 私人运行数据统一存放目录；release 模式切换到项目内发布用户配置目录。
const USER_CONFIG_DIR = runtimeContext.userConfigDir;

module.exports = { USER_CONFIG_DIR };
