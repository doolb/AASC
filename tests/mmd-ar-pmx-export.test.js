const test=require('node:test');
const assert=require('node:assert/strict');
const modules=Promise.all([import('../3rd/mmd-ar-test/web-editor-pmx.mjs'),import('../3rd/mmd-ar-test/web-editor-document.mjs')]);

// 手工构造不同版本/编码的二进制，独立于生产写入器，并包含渲染加载器不完整支持的段。
function fixture({version=2,encoding=1,rigidWidth=1}={}) {
    const chunks=[];let size=0;
    const bytes=b=>{chunks.push(b);size+=b.length;};
    const n=(value,length,method)=>{const b=new Uint8Array(length);new DataView(b.buffer)[method](0,value,true);bytes(b);};
    const u8=v=>n(v,1,'setUint8'),i32=v=>n(v,4,'setInt32'),f=v=>n(v,4,'setFloat32');
    const idx=v=>n(v,rigidWidth,`setInt${rigidWidth*8}`);
    const text=s=>{let b;if(encoding===1)b=new TextEncoder().encode(s);else{b=new Uint8Array(s.length*2);const view=new DataView(b.buffer);for(let i=0;i<s.length;i++)view.setUint16(i*2,s.charCodeAt(i),true);}i32(b.length);bytes(b);};
    const vec=v=>v.forEach(f);
    bytes(new TextEncoder().encode('PMX '));f(version);u8(8);bytes(Uint8Array.of(encoding,1,1,1,1,1,1,rigidWidth));
    for(const s of ['模型😀','Model','注释','Comment'])text(s);
    i32(1);vec([1,2,3]);vec([0,1,0]);vec([.25,.5]);vec([9,8,7,6]);
    if(version===2){u8(3);u8(0);u8(1);f(.25);vec([1,2,3]);vec([4,5,6]);vec([7,8,9]);}
    else {u8(4);bytes(Uint8Array.of(0,1,0,1));vec([.25,.25,.25,.25]);}
    f(1);i32(3);bytes(Uint8Array.of(0,0,0));i32(1);text('tex\\衣.png');
    i32(1);text('皮肤');text('Skin');for(let i=0;i<11;i++)f(.5);u8(31);vec([.1,.2,.3,.4]);f(.7);u8(0);u8(255);u8(0);u8(1);u8(0);text('材质注释');i32(3);
    i32(2);
    for(let i=0;i<2;i++){text('骨'+i);text('Bone'+i);vec([1+i,2+i,3+i]);u8(i===0?255:0);i32(0);n(0,2,'setUint16');vec([0,1,0]);}
    i32(version===2?0:2);
    if(version!==2){text('冲量');text('Impulse');u8(4);u8(10);i32(2);for(let i=0;i<2;i++){idx(i);u8(1);vec([10+i,20,30]);vec([40,50,60]);}text('额外UV');text('UV');u8(4);u8(4);i32(1);u8(0);vec([1,2,3,4]);}
    i32(1);text('显示框');text('Frame');u8(0);i32(1);u8(0);u8(0);
    const bodyStart=size;i32(2);
    for(let i=0;i<2;i++){
        text('刚体'+i);text('Body'+i);u8(i);u8(1);n(65535,2,'setUint16');u8(2);vec([1,2,3]);vec([10+i,20,30]);vec([.1,.2,.3]);vec([4,.1,.2,.3,.4]);u8(2);
    }
    i32(1);text('关节');text('Joint');u8(0);idx(0);idx(1);vec([2,3,4]);vec([.1,.2,.3]);vec([-1,-2,-3]);vec([4,5,6]);vec([-1,-2,-3]);vec([4,5,6]);vec([7,8,9]);vec([10,11,12]);
    const bodyEnd=size;
    if(version!==2){i32(1);text('软体');text('Soft');bytes(new Uint8Array(26+100));i32(2);for(let i=0;i<2;i++){idx(i);u8(0);u8(1);}i32(1);u8(0);}
    bytes(Uint8Array.of(66,77,88));const result=new Uint8Array(size);let at=0;for(const b of chunks){result.set(b,at);at+=b.length;}
    return {bytes:result,bodyStart,bodyEnd};
}

const clone=v=>JSON.parse(JSON.stringify(v));
function documentFor(source,mark) {
    const rigidBodies=source.bodies.map(({data:b})=>{
        const item=clone(b),origin=source.bones[b.boneIndex].position;
        item.position=b.position.map((n,i)=>(n-origin[i])*(i===2?-1:1));item.rotation=b.rotation.map((n,i)=>n*(i<2?-1:1));return item;
    });
    const constraints=source.joints.map(({data:j})=>{
        const item=clone(j);item.position[2]*=-1;item.rotation[0]*=-1;item.rotation[1]*=-1;
        for(const [prefix,axes]of [['translation',[2]],['rotation',[0,1]]])for(const axis of axes){item[prefix+'Limitation1'][axis]=-j[prefix+'Limitation2'][axis];item[prefix+'Limitation2'][axis]=-j[prefix+'Limitation1'][axis];}
        return item;
    });
    const doc={rigidBodies,constraints};mark(doc);return doc;
}

test('PMX2.0/2.1与UTF8/UTF16未编辑往返字节完全一致，保留SDEF/QDEF/软体及加载器原始type',async()=>{
    const [{inspectPmxPhysics,writePmxPhysics},{markPmxEditorSources}]=await modules;
    for(const version of [2,2.1])for(const encoding of [0,1]){
        const {bytes}=fixture({version,encoding}),source=inspectPmxPhysics(bytes),doc=documentFor(source,markPmxEditorSources);
        doc.rigidBodies[1].type=1;doc.rigidBodies[1]._pmxSource.type=1;
        assert.deepEqual(writePmxPhysics(bytes,doc),bytes);
    }
});

test('刚体骨骼相对位置/旋转与关节上下限正确还原；其他原始段保持一致',async()=>{
    const [{inspectPmxPhysics,writePmxPhysics},{markPmxEditorSources}]=await modules;
    const {bytes,bodyStart,bodyEnd}=fixture({encoding:0}),source=inspectPmxPhysics(bytes),doc=documentFor(source,markPmxEditorSources);
    Object.assign(doc.rigidBodies[0],{boneIndex:1,position:[4,5,6],rotation:[1,2,3],weight:12.5,name:'改名😀'});
    const j=doc.constraints[0];Object.assign(j,{position:[3,4,5],rotation:[2,3,4],translationLimitation1:[-2,-3,-7],translationLimitation2:[8,9,10],rotationLimitation1:[-3,-4,-5],rotationLimitation2:[6,7,8]});
    const out=writePmxPhysics(bytes,doc),check=inspectPmxPhysics(out),b=check.bodies[0].data,joint=check.joints[0].data;
    assert.deepEqual(b.position,[6,8,-2]);assert.deepEqual(b.rotation,[-1,-2,3]);assert.equal(b.weight,12.5);assert.equal(b.englishName,'Body0');
    assert.deepEqual(joint.position,[3,4,-5]);assert.deepEqual(joint.rotation,[-2,-3,4]);
    assert.deepEqual(joint.translationLimitation1,[-2,-3,-10]);assert.deepEqual(joint.translationLimitation2,[8,9,7]);
    assert.deepEqual(joint.rotationLimitation1,[-6,-7,-5]);assert.deepEqual(joint.rotationLimitation2,[3,4,8]);
    assert.deepEqual(out.subarray(0,bodyStart),bytes.subarray(0,bodyStart));assert.deepEqual(out.subarray(check.end),bytes.subarray(bodyEnd));
    const {MMDParser}=await import('three/addons/libs/mmdparser.module.js');
    const parsed=new MMDParser.Parser().parsePmx(out.buffer,true);assert.equal(parsed.rigidBodies[0].name,'改名😀');assert.deepEqual(parsed.rigidBodies[0].position,[6,8,2]);
});

test('删除与重排同步冲量表情和软体锚点，仅删除被删除源刚体引用',async()=>{
    const [{inspectPmxPhysics,writePmxPhysics},{markPmxEditorSources}]=await modules;
    const {bytes}=fixture({version:2.1}),source=inspectPmxPhysics(bytes),doc=documentFor(source,markPmxEditorSources);
    doc.rigidBodies.shift();doc.constraints=[];
    const out=writePmxPhysics(bytes,doc),check=inspectPmxPhysics(out);
    assert.equal(check.bodies[0].data.name,'刚体1');assert.equal(check.references.length,2);
    for(let i=0;i<2;i++){
        const original=source.references[i].entries[1],entry=check.references[i].entries[0];
        assert.equal(check.references[i].entries.length,1);assert.equal(entry.index,0);
        assert.deepEqual(out.subarray(entry.start+1,entry.end),bytes.subarray(original.start+1,original.end));
    }
    assert.deepEqual(out.subarray(-8),bytes.subarray(-8));
});

test('新增129刚体时扩展索引，关节/冲量/软体全部改用2字节；复制记录具有独立身份',async()=>{
    const [{inspectPmxPhysics,writePmxPhysics},{markPmxEditorSources}]=await modules;
    const {bytes}=fixture({version:2.1}),source=inspectPmxPhysics(bytes),doc=documentFor(source,markPmxEditorSources),last=doc.rigidBodies.pop();
    for(let i=0;i<127;i++){const next=clone(doc.rigidBodies[0]);next._pmxSourceIndex=null;delete next._pmxSource;next.name='复制'+i;doc.rigidBodies.push(next);}
    doc.rigidBodies.push(last);doc.constraints[0].rigidBodyIndex2=128;
    const out=writePmxPhysics(bytes,doc),check=inspectPmxPhysics(out);
    assert.equal(out[16],2);assert.equal(check.bodies.length,129);assert.equal(check.joints[0].data.rigidBodyIndex2,128);
    assert.deepEqual(check.bodies[1].data.position,[10,20,30]);
    for(const group of check.references)assert.deepEqual(group.entries.map(entry=>entry.index),[0,128]);
    const prefix=new Uint8Array(bytes.subarray(0,source.references[0].countOffset));prefix[16]=2;assert.deepEqual(out.subarray(0,prefix.length),prefix);
});

test('工程来源元数据通过保存覆盖及重建保留；重复源索引和不明旧工程拒绝导出',async()=>{
    const [{inspectPmxPhysics,writePmxPhysics},{markPmxEditorSources,putDocument,stageEditorDocument}]=await modules;
    const {bytes}=fixture(),source=inspectPmxPhysics(bytes),doc=documentFor(source,markPmxEditorSources);
    const saved=clone(doc);saved.rigidBodies[0].weight=99;putDocument('test.pmx',saved);
    const mesh={skeleton:{bones:[{},{}]},geometry:{userData:{MMD:documentFor(source,markPmxEditorSources)}}};stageEditorDocument(mesh,{modelUrl:'test.pmx'});
    assert.deepEqual(mesh.geometry.userData.MMD.rigidBodies,saved.rigidBodies);
    const check=inspectPmxPhysics(writePmxPhysics(bytes,mesh.geometry.userData.MMD));assert.equal(check.bodies[0].data.weight,99);
    const bad=clone(doc);bad.rigidBodies[1]._pmxSourceIndex=0;assert.throws(()=>writePmxPhysics(bytes,bad),/重复/);
    const old=clone(doc);for(const key of ['rigidBodies','constraints'])for(const item of old[key]){delete item._pmxSourceIndex;delete item._pmxSource;}
    old.rigidBodies[0].weight=8;assert.equal(inspectPmxPhysics(writePmxPhysics(bytes,old)).bodies[0].data.weight,8);
    old.rigidBodies.shift();old.constraints=[];assert.throws(()=>writePmxPhysics(bytes,old),/旧工程/);
});

test('新建无骨骼刚体和关节可序列化，旧记录不变',async()=>{
    const [{inspectPmxPhysics,writePmxPhysics},{markPmxEditorSources}]=await modules;
    const {bytes}=fixture(),source=inspectPmxPhysics(bytes),doc=documentFor(source,markPmxEditorSources);
    const body=clone(doc.rigidBodies[0]);body._pmxSourceIndex=null;delete body._pmxSource;Object.assign(body,{name:'新刚体',englishName:'',boneIndex:-1,position:[2,3,4]});doc.rigidBodies.push(body);
    const joint=clone(doc.constraints[0]);joint._pmxSourceIndex=null;delete joint._pmxSource;Object.assign(joint,{name:'新关节',rigidBodyIndex2:2});doc.constraints.push(joint);
    const check=inspectPmxPhysics(writePmxPhysics(bytes,doc));
    assert.deepEqual(check.bodies[2].data.position,[2,3,-4]);assert.equal(check.bodies[2].data.boneIndex,-1);assert.equal(check.bodies[2].data.englishName,'');
    assert.equal(check.joints[1].data.rigidBodyIndex2,2);assert.deepEqual(check.joints[1].data.rotationLimitation1,source.joints[0].data.rotationLimitation1);
    assert.deepEqual(check.bodies[0].data,source.bodies[0].data);assert.deepEqual(check.joints[0].data,source.joints[0].data);
});

test('截断文件、错误权重类型及非法文档拒绝导出',async()=>{
    const [{inspectPmxPhysics,writePmxPhysics},{markPmxEditorSources}]=await modules;
    const {bytes}=fixture(),source=inspectPmxPhysics(bytes),doc=documentFor(source,markPmxEditorSources);
    assert.throws(()=>writePmxPhysics(bytes.subarray(0,source.end-1),doc),/截断/);
    doc.rigidBodies[0].position[0]=NaN;assert.throws(()=>writePmxPhysics(bytes,doc),/坐标/);
    const invalid=bytes.slice();invalid[16]=3;assert.throws(()=>inspectPmxPhysics(invalid),/宽度/);
});
