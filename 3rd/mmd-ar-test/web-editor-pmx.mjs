import { validateDocument } from './web-editor-document.mjs';

const LIMIT = 256 * 1024 * 1024;
const BODY_FIELDS = ['name','englishName','boneIndex','groupIndex','groupTarget','shapeType','width','height','depth','position','rotation','weight','positionDamping','rotationDamping','restitution','friction','type'];
const JOINT_FIELDS = ['name','englishName','type','rigidBodyIndex1','rigidBodyIndex2','position','rotation','translationLimitation1','translationLimitation2','rotationLimitation1','rotationLimitation2','springPosition','springRotation'];

// 独立扫描原文件，避免渲染加载器把SDEF或原始坐标转换后再丢失信息。
class Reader {
    constructor(bytes) { this.bytes=bytes;this.view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);this.at=0; }
    skip(size) { if(!Number.isSafeInteger(size)||size<0||this.at+size>this.bytes.length)throw new Error('PMX文件截断或数据长度无效');this.at+=size; }
    number(size,method) { const offset=this.at;this.skip(size);return this.view[method](offset,true); }
    u8() { return this.number(1,'getUint8'); }
    u16() { return this.number(2,'getUint16'); }
    i32() { return this.number(4,'getInt32'); }
    f32() { return this.number(4,'getFloat32'); }
    index(size,unsigned=false) { return this.number(size,`${unsigned?'getUint':'getInt'}${size*8}`); }
    vector() { return [this.f32(),this.f32(),this.f32()]; }
    count() { const n=this.i32();if(n<0||n>this.bytes.length)throw new Error('PMX记录数量无效');return n; }
    text() { const length=this.count(),offset=this.at;this.skip(length);return new TextDecoder(this.encoding===0?'utf-16le':'utf-8').decode(this.bytes.subarray(offset,this.at)); }
    skipText() { this.skip(this.count()); }
}

// 写出原文件编码及索引宽度；所有固定宽度字段在进入写入器前先验证。
class Writer {
    constructor(encoding) { this.encoding=encoding;this.chunks=[];this.size=0; }
    bytes(bytes) { this.chunks.push(bytes);this.size+=bytes.length;if(this.size>LIMIT)throw new Error('导出PMX超过256MiB'); }
    number(size,method,value) { const bytes=new Uint8Array(size);new DataView(bytes.buffer)[method](0,value,true);this.bytes(bytes); }
    u8(n) { this.number(1,'setUint8',n); }
    u16(n) { this.number(2,'setUint16',n); }
    i32(n) { this.number(4,'setInt32',n); }
    f32(n) { if(!Number.isFinite(n))throw new Error('PMX数值必须有限');this.number(4,'setFloat32',n); }
    index(size,n) {
        if(!Number.isInteger(n)||n < -1||n > 2**(size*8-1)-1)throw new Error('PMX索引超出编码范围');
        this.number(size,`setInt${size*8}`,n);
    }
    vector(v) { for(const n of v)this.f32(n); }
    text(value='') {
        const text=String(value);let bytes;
        if(this.encoding===1)bytes=new TextEncoder().encode(text);
        else { bytes=new Uint8Array(text.length*2);const view=new DataView(bytes.buffer);for(let i=0;i<text.length;i++)view.setUint16(i*2,text.charCodeAt(i),true); }
        this.i32(bytes.length);this.bytes(bytes);
    }
    finish() { const bytes=new Uint8Array(this.size);let at=0;for(const chunk of this.chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes; }
}

function scanVertices(r,h) {
    const layouts={0:h.bone,1:2*h.bone+4,2:4*h.bone+16,3:2*h.bone+40,4:4*h.bone+16};
    const count=r.count();
    for(let i=0;i<count;i++) {
        r.skip(32+16*h.uv);const type=r.u8();
        if(layouts[type]===undefined||(type===4&&h.version<2.05))throw new Error(`不支持的PMX权重类型：${type}`);
        r.skip(layouts[type]+4);
    }
    r.skip(r.count()*h.vertex);
}

function scanMaterials(r,h) {
    let count=r.count();for(let i=0;i<count;i++)r.skipText();
    count=r.count();
    for(let i=0;i<count;i++) {
        r.skipText();r.skipText();r.skip(65+2*h.texture+1);
        const toon=r.u8();if(toon>1)throw new Error('PMX Toon类型无效');
        r.skip(toon===0?h.texture:1);r.skipText();r.skip(4);
    }
}

function scanBones(r,h) {
    const bones=[],count=r.count();
    for(let i=0;i<count;i++) {
        r.skipText();r.skipText();const position=r.vector(),parent=r.index(h.bone);r.skip(4);const flags=r.u16();
        r.skip(flags&1?h.bone:12);
        if(flags&0x300)r.skip(h.bone+4);
        if(flags&0x400)r.skip(12);
        if(flags&0x800)r.skip(24);
        if(flags&0x2000)r.skip(4);
        if(flags&0x20) {
            r.skip(h.bone+8);const links=r.count();
            for(let j=0;j<links;j++){r.skip(h.bone);const limited=r.u8();if(limited>1)throw new Error('PMX IK限位标志无效');if(limited)r.skip(24);}
        }
        bones.push({position,parent});
    }
    return bones;
}

function referenceGroup(r,size,after) {
    const countOffset=r.at,count=r.count(),entries=[];
    for(let i=0;i<count;i++){const start=r.at,index=r.index(size);r.skip(after);entries.push({start,end:r.at,index});}
    return {countOffset,end:r.at,entries};
}

function scanMorphs(r,h,references) {
    const sizes={0:h.morph+4,1:h.vertex+12,2:h.bone+28,3:h.vertex+16,4:h.vertex+16,5:h.vertex+16,6:h.vertex+16,7:h.vertex+16,8:h.material+113,9:h.morph+4};
    const count=r.count();
    for(let i=0;i<count;i++) {
        r.skipText();r.skipText();r.skip(1);const type=r.u8();
        if(type===10){references.push(referenceGroup(r,h.rigid,25));continue;}
        if(sizes[type]===undefined)throw new Error(`不支持的PMX表情类型：${type}`);
        r.skip(r.count()*sizes[type]);
    }
    const frames=r.count();
    for(let i=0;i<frames;i++) {
        r.skipText();r.skipText();r.skip(1);const entries=r.count();
        for(let j=0;j<entries;j++){const type=r.u8();if(type>1)throw new Error('PMX显示框引用无效');r.skip(type===0?h.bone:h.morph);}
    }
}

function scanBody(r,h) {
    const start=r.at,name=r.text(),englishName=r.text(),boneIndex=r.index(h.bone),groupIndex=r.u8(),groupTarget=r.u16(),shapeType=r.u8();
    const width=r.f32(),height=r.f32(),depth=r.f32(),position=r.vector(),rotation=r.vector();
    const weight=r.f32(),positionDamping=r.f32(),rotationDamping=r.f32(),restitution=r.f32(),friction=r.f32(),type=r.u8();
    if(boneIndex < -1||boneIndex>=h.boneCount||shapeType>2||type>2||groupIndex>15)throw new Error('PMX刚体引用或类型无效');
    return {start,end:r.at,data:{name,englishName,boneIndex,groupIndex,groupTarget,shapeType,width,height,depth,position,rotation,weight,positionDamping,rotationDamping,restitution,friction,type}};
}

function scanJoint(r,h) {
    const start=r.at,data={name:r.text(),englishName:r.text(),type:r.u8(),rigidBodyIndex1:r.index(h.rigid),rigidBodyIndex2:r.index(h.rigid)};
    if(data.type>(h.version<2.05?0:5))throw new Error('PMX关节类型无效');
    for(const key of JOINT_FIELDS.slice(5))data[key]=r.vector();
    for(const index of [data.rigidBodyIndex1,data.rigidBodyIndex2])if(index < -1||index>=h.bodyCount)throw new Error('PMX关节引用无效');
    return {start,end:r.at,data};
}

function scanSoftBodies(r,h,references) {
    const count=r.count();
    for(let i=0;i<count;i++) {
        r.skipText();r.skipText();r.skip(25+h.material+100);
        references.push(referenceGroup(r,h.rigid,h.vertex+1));
        r.skip(r.count()*h.vertex);
    }
}

export function inspectPmxPhysics(input) {
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
    if(bytes.length>LIMIT)throw new Error('源PMX超过256MiB');
    const r=new Reader(bytes);
    if(bytes.length<17||String.fromCharCode(...bytes.subarray(0,4))!=='PMX ')throw new Error('不是PMX文件');
    r.skip(4);const version=r.f32();
    if(Math.abs(version-2)>0.00001&&Math.abs(version-2.1)>0.00001)throw new Error('仅支持PMX 2.0/2.1');
    const headerSize=r.u8(),encoding=r.u8(),uv=r.u8();
    if(headerSize<8||![0,1].includes(encoding)||uv>4)throw new Error('PMX头部无效');
    const h={version,encoding,uv,vertex:r.u8(),texture:r.u8(),material:r.u8(),bone:r.u8(),morph:r.u8(),rigid:r.u8()};
    for(const size of [h.vertex,h.texture,h.material,h.bone,h.morph,h.rigid])if(![1,2,4].includes(size))throw new Error('PMX索引宽度无效');
    r.encoding=encoding;r.skip(headerSize-8);for(let i=0;i<4;i++)r.skipText();
    scanVertices(r,h);scanMaterials(r,h);const bones=scanBones(r,h);h.boneCount=bones.length;
    const references=[];scanMorphs(r,h,references);
    const start=r.at,bodies=[],bodyCount=r.count();h.bodyCount=bodyCount;
    for(let i=0;i<bodyCount;i++)bodies.push(scanBody(r,h));
    const joints=[],jointCount=r.count();for(let i=0;i<jointCount;i++)joints.push(scanJoint(r,h));
    const end=r.at;if(version>2.05)scanSoftBodies(r,h,references);
    for(const group of references)for(const entry of group.entries)if(entry.index<0||entry.index>=bodyCount)throw new Error('PMX表情/软体刚体引用无效');
    return {bytes,header:h,bones,bodies,joints,references,start,end,parsedEnd:r.at};
}

const vector=v=>[v[0],v[1],-v[2]];
const rotation=v=>[-v[0],-v[1],v[2]];
function limits(low,high,axes) { const a=[...low],b=[...high];for(const i of axes){a[i]=-high[i];b[i]=-low[i];}return [a,b]; }
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)?a.length===b.length&&a.every((n,i)=>n===b[i]):a===b;
const copy=data=>JSON.parse(JSON.stringify(data));

function uiBody(raw,bones) {
    const result=copy(raw),origin=bones[raw.boneIndex]?.position||[0,0,0];
    result.position=vector(raw.position.map((n,i)=>n-origin[i]));result.rotation=rotation(raw.rotation);return result;
}
function uiJoint(raw) {
    const result=copy(raw);result.position=vector(raw.position);result.rotation=rotation(raw.rotation);
    [result.translationLimitation1,result.translationLimitation2]=limits(raw.translationLimitation1,raw.translationLimitation2,[2]);
    [result.rotationLimitation1,result.rotationLimitation2]=limits(raw.rotationLimitation1,raw.rotationLimitation2,[0,1]);return result;
}

// 老工程仅在记录数量和名称顺序完全匹配时恢复来源；不猜测增删后的身份。
function restoreLegacySources(doc,source) {
    const result=copy(doc),bodies=source.bodies.map(row=>uiBody(row.data,source.bones));
    for(const {data:j} of source.joints) {
        const a=bodies[j.rigidBodyIndex1],b=bodies[j.rigidBodyIndex2];
        if(a&&b&&a.type!==0&&b.type===2&&a.boneIndex!==-1&&b.boneIndex!==-1&&source.bones[b.boneIndex]?.parent===a.boneIndex)b.type=1;
    }
    for(const [key,records,baselines]of [['rigidBodies',source.bodies,bodies],['constraints',source.joints,source.joints.map(row=>uiJoint(row.data))]]) {
        if(result[key].every(item=>Object.hasOwn(item,'_pmxSourceIndex')))continue;
        if(result[key].length!==records.length||result[key].some((item,i)=>item.name!==records[i].data.name))
            throw new Error('旧工程缺少可靠的PMX来源信息，请重新加载原PMX后编辑再导出');
        result[key].forEach((item,i)=>{item._pmxSourceIndex=i;item._pmxSource=baselines[i];});
    }
    return result;
}

function editedRecord(item,original,fields,converted) {
    if(!original)return converted;
    if(!item._pmxSource)throw new Error('PMX编辑记录缺少源参数');
    const result=copy(original),changed=key=>!same(item[key],item._pmxSource[key]);
    for(const key of fields)if(changed(key))result[key]=converted[key];
    return {result,changed};
}

function bodyRecord(item,source) {
    const original=source.bodies[item._pmxSourceIndex]?.data;
    const converted=copy(item),origin=source.bones[item.boneIndex]?.position||[0,0,0];
    converted.position=vector(item.position).map((n,i)=>n+origin[i]);converted.rotation=rotation(item.rotation);
    if(!original)return converted;
    const {result,changed}=editedRecord(item,original,BODY_FIELDS,converted);
    if(changed('boneIndex')||changed('position'))result.position=converted.position;
    return result;
}

function jointRecord(item,source) {
    const original=source.joints[item._pmxSourceIndex]?.data,converted=copy(item);
    converted.position=vector(item.position);converted.rotation=rotation(item.rotation);
    [converted.translationLimitation1,converted.translationLimitation2]=limits(item.translationLimitation1,item.translationLimitation2,[2]);
    [converted.rotationLimitation1,converted.rotationLimitation2]=limits(item.rotationLimitation1,item.rotationLimitation2,[0,1]);
    if(!original)return converted;
    const {result,changed}=editedRecord(item,original,JOINT_FIELDS,converted);
    for(const prefix of ['translation','rotation'])if(changed(prefix+'Limitation1')||changed(prefix+'Limitation2')) {
        result[prefix+'Limitation1']=converted[prefix+'Limitation1'];result[prefix+'Limitation2']=converted[prefix+'Limitation2'];
    }
    result.rigidBodyIndex1=item.rigidBodyIndex1;result.rigidBodyIndex2=item.rigidBodyIndex2;return result;
}

function writeBody(w,b,h) {
    w.text(b.name);w.text(b.englishName);w.index(h.bone,b.boneIndex);w.u8(b.groupIndex);w.u16(b.groupTarget);w.u8(b.shapeType);
    for(const key of ['width','height','depth'])w.f32(b[key]);w.vector(b.position);w.vector(b.rotation);
    for(const key of ['weight','positionDamping','rotationDamping','restitution','friction'])w.f32(b[key]);w.u8(b.type);
}
function writeJoint(w,j,h,rigidWidth) {
    if(!Number.isInteger(j.type)||j.type<0||j.type>(h.version<2.05?0:5))throw new Error('无法导出该PMX关节类型');
    w.text(j.name);w.text(j.englishName);w.u8(j.type);w.index(rigidWidth,j.rigidBodyIndex1);w.index(rigidWidth,j.rigidBodyIndex2);
    for(const key of JOINT_FIELDS.slice(5))w.vector(j[key]);
}

function sourceRow(item,rows,used) {
    const index=item._pmxSourceIndex;if(index===null)return null;
    if(!Number.isInteger(index)||index<0||index>=rows.length||used.has(index))throw new Error('PMX源索引丢失或重复');
    used.add(index);return rows[index];
}

export function writePmxPhysics(input,document) {
    const source=inspectPmxPhysics(input),doc=restoreLegacySources(document,source);
    validateDocument(doc,source.bones.length);
    const h=source.header,required=doc.rigidBodies.length<=128?1:doc.rigidBodies.length<=32768?2:4;
    const rigidWidth=Math.max(h.rigid,required),mapping=new Map(),usedBodies=new Set(),usedJoints=new Set();
    const w=new Writer(h.encoding);w.i32(doc.rigidBodies.length);
    doc.rigidBodies.forEach((item,index)=>{
        const row=sourceRow(item,source.bodies,usedBodies),data=bodyRecord(item,source);
        if(row)mapping.set(item._pmxSourceIndex,index);
        if(row&&BODY_FIELDS.every(key=>same(row.data[key],data[key])))w.bytes(source.bytes.subarray(row.start,row.end));
        else writeBody(w,data,h);
    });
    w.i32(doc.constraints.length);
    for(const item of doc.constraints) {
        const row=sourceRow(item,source.joints,usedJoints),data=jointRecord(item,source);
        if(row&&rigidWidth===h.rigid&&JOINT_FIELDS.every(key=>same(row.data[key],data[key])))w.bytes(source.bytes.subarray(row.start,row.end));
        else writeJoint(w,data,h,rigidWidth);
    }
    const patches=[{start:source.start,end:source.end,bytes:w.finish()}];
    if(rigidWidth!==h.rigid)patches.push({start:16,end:17,bytes:Uint8Array.of(rigidWidth)});
    // 冲量表情及软体锚点随源刚体身份重排；已删除刚体的元素从所属列表删除。
    for(const group of source.references) {
        const kept=group.entries.filter(entry=>mapping.has(entry.index));
        if(rigidWidth===h.rigid&&kept.length===group.entries.length&&kept.every(entry=>mapping.get(entry.index)===entry.index))continue;
        const out=new Writer(h.encoding);out.i32(kept.length);
        for(const entry of kept){out.index(rigidWidth,mapping.get(entry.index));out.bytes(source.bytes.subarray(entry.start+h.rigid,entry.end));}
        patches.push({start:group.countOffset,end:group.end,bytes:out.finish()});
    }
    patches.sort((a,b)=>a.start-b.start);const out=new Writer(h.encoding);let at=0;
    for(const patch of patches){if(patch.start<at)throw new Error('PMX写入段重叠');out.bytes(source.bytes.subarray(at,patch.start));out.bytes(patch.bytes);at=patch.end;}
    out.bytes(source.bytes.subarray(at));const bytes=out.finish(),check=inspectPmxPhysics(bytes);
    if(check.bodies.length!==doc.rigidBodies.length||check.joints.length!==doc.constraints.length)throw new Error('PMX导出计数校验失败');
    return bytes;
}
