// 本地文件只保存在当前 ESM 实例中；每次加载独立映射，不修改 Three.js 全局管理器。
const PREFIX = './mmd/__local__/';
const contexts = new Map();
let nextId = 0;

export function normalizeLocalPath(value) {
    const source = String(value).replaceAll('\\', '/').normalize('NFC');
    if (/^(?:\/|[a-z]+:)/iu.test(source)) throw new Error(`不支持绝对资源路径：${value}`);
    const parts = [];
    for (const part of source.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') {
            if (!parts.length) throw new Error(`资源路径超出所选目录：${value}`);
            parts.pop();
        } else {
            parts.push(part);
        }
    }
    return parts.join('/');
}

export const localFilePath = (file) => normalizeLocalPath(file.webkitRelativePath || file.name);
export const listLocalModels = (files) => Array.from(files).filter((file) => /\.pmx$/iu.test(file.name));

function createContext(files, selectedFile) {
    const id = String(++nextId);
    const base = `${PREFIX}${id}/`;
    const entries = new Map();
    const urls = new Map();
    let released = false;
    const flat = Array.from(files).every((file) => !file.webkitRelativePath);
    for (const file of files) {
        const filePath = localFilePath(file);
        if (entries.has(filePath)) throw new Error(`重复文件路径：${filePath}`);
        entries.set(filePath, file);
    }
    const path = localFilePath(selectedFile);
    if (!entries.has(path)) throw new Error('目标文件不在当前选择中');
    const selectedUrl = base + path.split('/').map(encodeURIComponent).join('/');
    const find = (resourcePath) => {
        const normalized = normalizeLocalPath(resourcePath);
        if (entries.has(normalized)) return entries.get(normalized);
        // Windows 模型常忽略文件名大小写；只有一个候选时才匹配，绝不任意选择。
        let matches = [...entries].filter(([key]) => key.toLowerCase() === normalized.toLowerCase());
        if (!matches.length && flat) {
            const name = normalized.split('/').at(-1).toLowerCase();
            matches = [...entries].filter(([key]) => key.split('/').at(-1).toLowerCase() === name);
        }
        if (matches.length > 1) throw new Error(`贴图路径存在歧义：${resourcePath}`);
        if (!matches.length) throw new Error(`缺少贴图：${resourcePath}；请连同 PMX 一起选择贴图或整个模型目录`);
        return matches[0][1];
    };
    const toObjectUrl = (file) => {
        if (!urls.has(file)) urls.set(file, URL.createObjectURL(file));
        return urls.get(file);
    };
    const context = {
        base, selectedUrl, selectedFile, path, find,
        resolve(url) {
            if (released) throw new Error('本地文件选择已经释放，请重新选择');
            // 默认 toon 来自 MMDLoader 内置 data URI；其他地址必须属于本次已选文件。
            if (url.startsWith('data:')) return url;
            if (!url.startsWith(base)) throw new Error(`未选择的本地资源：${url}`);
            if (url === selectedUrl) return toObjectUrl(selectedFile);
            const suffix = url.slice(base.length);
            let decoded = suffix;
            try { decoded = decodeURIComponent(suffix); } catch (error) { /* PMX 允许文件名包含字面百分号。 */ }
            return toObjectUrl(find(decoded));
        },
        release() {
            released = true;
            contexts.delete(id);
            for (const url of urls.values()) URL.revokeObjectURL(url);
            urls.clear();
        }
    };
    contexts.set(id, context);
    return context;
}

function getContext(url) {
    if (typeof url !== 'string' || !url.startsWith(PREFIX)) return null;
    const id = url.slice(PREFIX.length).split('/')[0];
    const context = contexts.get(id);
    if (!context) throw new Error('本地文件选择已经释放，请重新选择');
    return context;
}

// 只接受注册表中的目标File，不能只按虚拟路径前缀放行任意资源。
export function isRegisteredLocalAsset(url, extension) {
    const context = getContext(url);
    return Boolean(context && url === context.selectedUrl
        && context.selectedFile.name.toLowerCase().endsWith(extension));
}

export function createLocalModelSelection(files, selectedFile = listLocalModels(files)[0]) {
    if (!selectedFile || !/\.pmx$/iu.test(selectedFile.name)) throw new Error('请选择 PMX 模型及配套贴图');
    const context = createContext(Array.from(files), selectedFile);
    return {
        profile: { modelType: 'pmx', modelUrl: context.selectedUrl, resourceId: `local:${context.base}`,
            motionResourceId: '', motionUrl: '', playMode: 'loop' },
        release: () => context.release()
    };
}

export function createLocalMotionSelection(file) {
    if (!file || !/\.vmd$/iu.test(file.name)) throw new Error('请选择 VMD 动作文件');
    const context = createContext([file], file);
    return { motionUrl: context.selectedUrl, motionResourceId: `local:${context.base}`,
        release: () => context.release() };
}

export function configureLocalLoader(loader, url) {
    const context = getContext(url);
    if (context) loader.manager.setURLModifier((resourceUrl) => context.resolve(resourceUrl));
}

export async function validateLocalModel(loader, url, onValidate = () => {}) {
    const context = getContext(url);
    if (!context) return;
    const buffer = await context.selectedFile.arrayBuffer();
    onValidate();
    const data = loader._getParser().parsePmx(buffer, true);
    const directory = context.path.split('/').slice(0, -1).join('/');
    const used = new Set();
    for (const material of data.materials) {
        for (const index of [material.textureIndex,
            [1, 2].includes(material.envFlag) ? material.envTextureIndex : -1,
            material.toonFlag === 0 ? material.toonIndex : -1]) {
            if (Number.isInteger(index) && index >= 0) used.add(index);
        }
    }
    for (const index of used) {
        const texture = data.textures[index];
        if (typeof texture !== 'string') throw new Error(`PMX 引用了不存在的贴图编号：${index}`);
        context.find(`${directory ? `${directory}/` : ''}${texture}`);
    }
}
