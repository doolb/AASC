// 默认打开保留的HMR报告，并保留自选/粘贴图所需的本机POST推理接口。
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./hmr2-sam3d/custom-report-server.cjs');

async function startReport() {
    const service = await start();
    const report = `${service.url}/_depth/hmr2-sam3d/report.html?image=seated`;
    fs.writeFileSync(path.join(__dirname, 'server-url.json'), JSON.stringify({ url: service.url, report }));
    console.log(report);
    return { ...service, report };
}

module.exports = { startReport };
if (require.main === module) {
    startReport().catch((error) => { console.error(error); process.exitCode = 1; });
}
