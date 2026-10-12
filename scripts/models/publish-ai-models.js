'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const common = require('./ai-model-common');
const execute = promisify(execFile);
const DEFAULT_HOST = 'as@120.79.245.103';
const DEFAULT_REMOTE_ROOT = '/home/as/a/aimodel';

// 远端使用Python执行文件事务；所有文件先校验，再替换，失败时恢复本次备份。
// 脚本只接收本地规范化清单，不读取HTTP页面给出的任意shell命令。
const REMOTE_SCRIPT = String.raw`import base64,hashlib,json,os,shutil,sys,tempfile
from pathlib import Path
p=json.loads(base64.b64decode(sys.argv[1]))
root=Path(p['root'])
m=p['manifest']
raw=base64.b64decode(p['manifestBytes'])
assert json.loads(raw)==m
def parents(file):
    for item in [file,*file.parents]:
        assert not item.is_symlink(),'远端路径不允许符号链接: '+str(item)
        if item!=file and item.exists(): assert item.is_dir()
def digest(file):
    h=hashlib.sha256()
    with file.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()
def matches(file,row):
    parents(file)
    return file.is_file() and file.stat().st_size==row['size'] and digest(file)==row['sha256']
for row in m['files']:
    parts=row['path'].split('/')
    assert len(parts)==2 and parts[0] in ['yolo11','sensevoice','streaming-zipformer','voiceprint','speech-enhancement']
    assert all(part not in ['', '.', '..'] and '\\' not in part for part in parts)
parents(root)
root.mkdir(parents=True,exist_ok=True)
assert root.is_dir()
index=root/'manifest.json'
parents(index)
def verify():
    import urllib.request,http.client,socket,ssl
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args): return None
    class LocalHTTPSConnection(http.client.HTTPSConnection):
        def connect(self):
            self._create_connection=lambda address,timeout=90,source_address=None: socket.create_connection(('127.0.0.1',address[1]),timeout,source_address)
            super().connect()
    class LocalHTTPSHandler(urllib.request.HTTPSHandler):
        def https_open(self,request):
            return self.do_open(LocalHTTPSConnection,request,context=ssl.create_default_context())
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect,LocalHTTPSHandler)
    source=p['source']
    def request(name):
        return opener.open(urllib.request.Request(source+name,headers={'Accept-Encoding':'identity','Cache-Control':'no-cache'}),timeout=90)
    with request('manifest.json') as response:
        assert response.status==200
        data=response.read(2*1024*1024+1)
        assert len(data)<=2*1024*1024 and json.loads(data)==m,'HTTPS清单不一致'
    verified=[]
    for row in m['files']:
        h=hashlib.sha256()
        size=0
        with request(row['path']) as response:
            assert response.status==200
            for block in iter(lambda:response.read(1024*1024),b''):
                size+=len(block)
                assert size<=row['size']
                h.update(block)
        assert size==row['size'] and h.hexdigest()==row['sha256'],'HTTPS文件校验失败: '+row['path']
        verified.append(row['path'])
    print(json.dumps({'verified':verified,'bytes':m['totalBytes']}))
def probe():
    matched=[row['path'] for row in m['files'] if matches(root/row['path'],row)]
    manifestMatches=index.is_file() and index.read_bytes()==raw
    stage=None
    if len(matched)!=len(m['files']) or not manifestMatches:
        stage=tempfile.mkdtemp(prefix='.aimodel-publish-',dir=str(root.parent))
    print(json.dumps({'matched':matched,'manifestMatches':manifestMatches,'stage':stage}))
def commit():
    stage=Path(p['stage'])
    parents(stage)
    assert stage.is_dir() and stage.parent==root.parent and stage.name.startswith('.aimodel-publish-')
    changed=set(p['changed'])
    assert changed.issubset({row['path'] for row in m['files']})
    for row in m['files']:
        source=(stage if row['path'] in changed else root)/row['path']
        assert matches(source,row),'上传前大小/SHA-256校验失败: '+row['path']
    backup=stage/'backup'
    backup.mkdir()
    for name in changed:
        dest=root/name
        parents(dest)
        assert not dest.exists() or dest.is_file()
        if dest.exists():
            old=backup/name
            old.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(dest,old)
    oldIndex=backup/'manifest.json'
    hadIndex=index.is_file()
    if hadIndex: shutil.copy2(index,oldIndex)
    pending=stage/'manifest.json'
    pending.write_bytes(raw)
    done=[]
    committedIndex=False
    try:
        for name in sorted(changed):
            dest=root/name
            dest.parent.mkdir(parents=True,exist_ok=True)
            source=stage/name
            os.chmod(source,0o644)
            os.replace(source,dest)
            done.append(name)
        os.chmod(pending,0o644)
        os.replace(pending,index)
        committedIndex=True
        for row in m['files']: assert matches(root/row['path'],row),row['path']
        assert index.read_bytes()==raw
    except BaseException:
        if committedIndex:
            if hadIndex: os.replace(oldIndex,index)
            else: os.replace(index,pending)
        for name in reversed(done):
            dest=root/name
            old=backup/name
            if old.exists(): os.replace(old,dest)
            else: os.replace(dest,stage/name)
        raise
    print(json.dumps({'files':len(m['files']),'bytes':m['totalBytes'],'backup':str(backup),
                      'manifestSha256':hashlib.sha256(raw).hexdigest()}))
handlers={'probe':probe,'commit':commit,'verify':verify}
assert p['operation'] in handlers
handlers[p['operation']]()

`;

function validateDestination(host, root) {
    if (typeof host !== 'string' || !/^(?:[A-Za-z0-9_.-]+@)?[A-Za-z0-9][A-Za-z0-9.-]*$/u.test(host)) {
        throw new Error('SSH目标无效');
    }
    if (typeof root !== 'string' || !/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/u.test(root)
        || root.split('/').some(part => part === '..' || part === '.') || root === '/') throw new Error('远端模型根目录无效');
}
const quote = value => `'${value.replaceAll("'", "'\"'\"'")}'`;

async function remoteCommand(host, payload, runner = execute) {
    const script = Buffer.from(REMOTE_SCRIPT).toString('base64');
    const argument = Buffer.from(JSON.stringify(payload)).toString('base64');
    const loader = `import base64;exec(base64.b64decode("${script}"))`;
    const command = `python3 -c ${quote(loader)} ${quote(argument)}`;
    const result = await runner('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', host,
        '/bin/sh', '-c', quote(command)], { maxBuffer: 4 * 1024 * 1024, timeout: 20 * 60 * 1000 });
    return JSON.parse(result.stdout);
}

// 新检出工作区可能缺少被Git忽略的SenseVoice和YOLO，不能误将不完整目录发布为全量清单。
function assertRequiredModels(manifest) {
    const required = ['sensevoice/model.int8.onnx', 'sensevoice/tokens.txt',
        'streaming-zipformer/encoder.int8.onnx', 'streaming-zipformer/decoder.int8.onnx',
        'streaming-zipformer/joiner.int8.onnx', 'streaming-zipformer/tokens.txt',
        'voiceprint/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx',
        'voiceprint/pyannote_segmentation_3_0_int8.onnx', 'speech-enhancement/gtcrn_simple.onnx',
        'yolo11/yolo11n.onnx', 'yolo11/yolo11n.classes.json'];
    const names = new Set(manifest.files.map(item => item.path));
    const missing = required.filter(name => !names.has(name));
    if (missing.length) throw new Error(`本地模型集不完整，请先下载或准备：${missing.join(', ')}`);
}

async function publishModels({ root = common.MODEL_ROOT, host = DEFAULT_HOST, remoteRoot = DEFAULT_REMOTE_ROOT,
    source = common.SOURCE_URL, runner = execute, fetchImpl = fetch,
    verifyFrom = 'client',
    log = message => process.stderr.write(`${message}\n`) } = {}) {
    validateDestination(host, remoteRoot);
    if (!['client', 'server'].includes(verifyFrom)) throw new Error('HTTPS校验位置必须是client或server');
    source = common.normalizeSource(source);
    const manifest = await common.collectModels(root);
    assertRequiredModels(manifest);
    const raw = common.manifestBytes(manifest);
    const payload = { root: remoteRoot, manifest, manifestBytes: raw.toString('base64') };
    const probe = await remoteCommand(host, { ...payload, operation: 'probe' }, runner);
    if (!Array.isArray(probe.matched) || probe.matched.some(name => !manifest.files.some(item => item.path === name))) {
        throw new Error('远端模型比较结果无效');
    }
    const changed = manifest.files.filter(item => !probe.matched.includes(item.path));
    const report = { source, host, remoteRoot, manifest, uploaded: changed.map(item => item.path),
        reused: probe.matched, verified: [], backup: null, verifyFrom };
    if (changed.length || !probe.manifestMatches) {
        const stage = probe.stage;
        if (typeof stage !== 'string' || path.posix.dirname(stage) !== path.posix.dirname(remoteRoot)
            || !/^\.aimodel-publish-[A-Za-z0-9_-]+$/u.test(path.posix.basename(stage))) throw new Error('远端暂存目录无效');
        log(`[远端暂存/备份] ${stage}`);
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-ai-model-publish-'));
        try {
            const list = path.join(temporary, 'files.txt');
            await fs.writeFile(list, changed.map(item => item.path).join('\n') + '\n');
            log(`[上传] ${changed.length}/${manifest.files.length} 文件，${changed.reduce((n, item) => n + item.size, 0)} bytes`);
            if (changed.length) await runner('rsync', ['-rt', '--partial', '--info=progress2', '--chmod=D755,F644',
                '--rsync-path=/bin/sh -c \'exec rsync "$@"\' sh', '-e', 'ssh -o BatchMode=yes -o ConnectTimeout=15',
                `--files-from=${list}`, `${path.resolve(root)}/`, `${host}:${stage}/`],
            { maxBuffer: 20 * 1024 * 1024, timeout: 30 * 60 * 1000 });
            const committed = await remoteCommand(host, { ...payload, operation: 'commit', stage,
                changed: changed.map(item => item.path) }, runner);
            report.backup = committed.backup;
        } finally { await fs.rm(temporary, { recursive: true, force: true }); }
    }
    const remoteManifest = await common.readManifest(source, fetchImpl);
    if (!common.manifestBytes(remoteManifest).equals(raw)) throw new Error('HTTPS模型清单与发布清单不一致');
    if (verifyFrom === 'server') {
        log('[HTTPS校验] 发布服务器本机HTTPS读取全部模型，保留公开Host/SNI与CA证书校验');
        const result = await remoteCommand(host, { ...payload, operation: 'verify', source }, runner);
        if (!Array.isArray(result.verified) || result.verified.length !== manifest.files.length
            || result.verified.some((name, index) => name !== manifest.files[index].path)) throw new Error('远端HTTPS校验结果不完整');
        report.verified = result.verified;
        return report;
    }
    for (const item of manifest.files) {
        log(`[HTTPS校验] ${item.path}`);
        await common.streamRemote(source, item, null, fetchImpl);
        report.verified.push(item.path);
    }
    return report;
}

async function main() {
    const args = common.parseArgs(process.argv.slice(2), ['root', 'host', 'remote-root', 'source', 'report', 'catalog', 'verify-from']);
    if (args.help) {
        process.stdout.write('npm run publish:ai-models -- [--root 模型目录] [--host user@host] [--remote-root 远端目录] [--source HTTPS校验目录] [--report JSON路径] [--catalog 清单快照路径] [--verify-from client|server]\n');
        return;
    }
    const report = await publishModels({ root: args.root, host: args.host, remoteRoot: args['remote-root'], source: args.source,
        verifyFrom: args['verify-from'] });
    await common.saveReport(args.report, report);
    await common.saveReport(args.catalog || path.join(__dirname, 'ai-model-catalog.json'), report.manifest);
    process.stdout.write(JSON.stringify({ files: report.manifest.files.length, bytes: report.manifest.totalBytes,
        uploaded: report.uploaded.length, reused: report.reused.length, httpsVerified: report.verified.length,
        backup: report.backup }, null, 2) + '\n');
}
if (require.main === module) main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
module.exports = { REMOTE_SCRIPT, validateDestination, remoteCommand, assertRequiredModels, publishModels };
