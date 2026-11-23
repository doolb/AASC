const test=require('node:test'),assert=require('node:assert/strict');
test('分开工具从所选材料面的点边寻找已有折痕，支持交点选轴且不修改纸形',async()=>{
  const {sheet,fold}=await import('../web/gami/fold.mjs');
  const {foldCreases,buildTopology}=await import('../web/gami/paper-topology.mjs');
  const {separationPick,sameCreaseAxis}=await import('../web/gami/separate.mjs');
  const creases=foldCreases(sheet(),[[-1,0]],[1,0]),item={faces:fold(sheet(),[[-1,0]],[1,0],180),creases},before=JSON.stringify(item);
  const point={face:1,uv:[0,0]},pick=separationPick(item,point,null,null);
  assert.ok(pick);assert.equal(pick.side,-1);assert.deepEqual(pick.handleUV,[0,0]);
  const boundary={face:1,a:[0,0],b:[0,1],crease:false};
  assert.ok(sameCreaseAxis(separationPick(item,null,boundary,null).edge,pick.edge));
  assert.ok(sameCreaseAxis(pick.edge,{a:[.5,.2],b:[.5,.8]}),'同一折痕的交点分段应匹配');
  assert.equal(sameCreaseAxis(pick.edge,{a:[.6,0],b:[.6,1]}),false);
  assert.equal(separationPick({faces:sheet()},point,null,null),null,'没有折痕不能产生新折线');
  const cross={faces:sheet(),creases:[...creases,[[0,.5],[1,.5]]]},axis={a:[0,.5],b:[.5,.5]};
  const crossing=separationPick(cross,{face:0,uv:[.5,.5]},null,axis);
  // 未实际切分的历史线不会把单个完整面当作可旋转纸瓣。
  assert.equal(crossing,null);
  const splitFaces=[...sheet(-1,-1,1,1),...sheet(0,-1,1,1),...sheet(-1,0,1,1),...sheet(0,0,1,1)];
  // 裁纸 helper 为每片重新映射 UV，此处显式恢复整纸材料坐标以构造交点面。
  const quadrants=splitFaces.map(face=>face.map(p=>[...p.slice(0,3),(p[0]+1)/2,(p[1]+1)/2]));
  const split={faces:quadrants,creases:cross.creases},atIntersection=separationPick(split,{face:0,uv:[.5,.5]},null,axis);
  assert.ok(atIntersection);assert.ok(sameCreaseAxis(atIntersection.edge,axis));assert.ok(atIntersection.side);
  assert.ok(buildTopology(split.faces,split.creases).vertices.some(p=>p[0]===.5&&p[1]===.5));
  assert.equal(JSON.stringify(item),before);
});
test('纸角、整边和四角折保持面积，四角折向中心可继续折叠',async()=>{
  const {fold,sheet,corners}=await import('../web/gami/fold.mjs');
  for(const starts of [[[-1,-1]],[[-1,0]],corners(sheet())]){
    const faces=fold(sheet(),starts,[0,0],180);
    const area=faces.reduce((sum,f)=>sum+Math.abs(f.reduce((s,p,i)=>{const b=f[(i+1)%f.length];return s+p[0]*b[1]-p[1]*b[0]},0))/2,0);
    assert.ok(Math.abs(area-4)<1e-6);assert.ok(fold(faces,[corners(faces)[0]],[0,0],90).length);
  }
});
test('自定义裁切保留母纸 UV 与预算',async()=>{
  const {cut,sheet}=await import('../web/gami/fold.mjs');const pieces=cut(sheet(),2,3);
  assert.equal(pieces.length,6);assert.equal(pieces[5][0][2][3],1);assert.throws(()=>cut(sheet(),9,9));
});
test('角点吸附选最近点，并在越过释放半径时退出',async()=>{
  const {snapIndex}=await import('../web/gami/fold.mjs');
  assert.equal(snapIndex([Infinity,12,9],14,-1),2);
  assert.equal(snapIndex([Infinity,10,19],14,2),2);
  assert.equal(snapIndex([Infinity,25,22],14,2),-1);
  assert.equal(snapIndex([Infinity,22],24,-1),1);
});
test('手工弯纸预览分段抬起，松手平折保留精确坐标和下一折能力',async()=>{
  const {sheet,fold}=await import('../web/gami/fold.mjs');
  for(const sign of [1,-1]){
    const source=sheet(),start=[[-1,-1]],end=[1,1];
    const curled=fold(source,start,end,sign*180,.3);
    const flat=fold(source,start,end,sign*180);
    assert.ok(curled.length>flat.length);
    assert.ok(curled.flat().some(p=>p[2]*sign>.1));
    assert.ok(flat.flat().every(p=>Math.abs(p[2])<1e-8));
    assert.ok(flat.flat().some(p=>p[3]===0&&p[4]===0&&Math.hypot(p[0]-1,p[1]-1)<1e-8));
    assert.deepEqual(source,sheet());
  }
});
test('待压平折形可由原纸恢复、独立保存并精确压平，旧存档兼容',async()=>{
  const {sheet,fold}=await import('../web/gami/fold.mjs');
  const {heldFaces,validHeldFold,flattenHeldFold,adjustedCurl}=await import('../web/gami/held-fold.mjs');
  const heldFold={starts:[[-1,-1]],dest:[.5,.5],angle:180,curl:.3,kind:'corner',index:0};
  const item={faces:sheet(),heldFold},other={faces:sheet()};
  const restored=JSON.parse(JSON.stringify(item));
  assert.equal(validHeldFold(restored),true);assert.equal(validHeldFold(other),true);
  assert.deepEqual(heldFaces(restored),heldFaces(item));assert.deepEqual(other.faces,sheet());
  assert.equal(adjustedCurl(heldFold,heldFold.dest),heldFold.curl);
  assert.ok(adjustedCurl(heldFold,[0,0])<heldFold.curl);
  assert.ok(adjustedCurl(heldFold,[1,1])>heldFold.curl);
  assert.ok(adjustedCurl({...heldFold,curl:0,snapped:true},[.2,.2])>0);
  const expected=fold(item.faces,heldFold.starts,heldFold.dest,heldFold.angle);
  assert.equal(flattenHeldFold(restored),true);assert.deepEqual(restored.faces,expected);
  assert.equal(restored.folded,true);assert.equal(restored.heldFold,undefined);
  assert.ok(restored.faces.flat().every(p=>Math.abs(p[2])<1e-8));
  assert.ok(fold(restored.faces,[[-1,1]],[0,0],180).length);
  for(const invalid of [{...heldFold,index:99},{...heldFold,curl:99},{...heldFold,dest:heldFold.starts[0]},{...heldFold,angle:90}]){
    assert.equal(validHeldFold({faces:sheet(),heldFold:invalid}),false);
  }
});
test('折痕交叉生成材料交点和分段，平折叠层按纸厚分离',async()=>{
  const {sheet,fold}=await import('../web/gami/fold.mjs');
  const {foldCreases,buildTopology,layerOffsets,layerDisplacements,pointOnFace,PAPER_THICKNESS}=await import('../web/gami/paper-topology.mjs');
  const source=sheet(),vertical=foldCreases(source,[[-1,0]],[1,0]),horizontal=foldCreases(source,[[0,-1]],[0,1]);
  const topology=buildTopology(source,[...vertical,...horizontal]);
  assert.ok(topology.vertices.some(p=>Math.hypot(p[0]-.5,p[1]-.5)<1e-8));
  assert.equal(topology.edges.filter(e=>e.crease).length,4);
  assert.deepEqual(pointOnFace(source[0],[.5,.5]),[0,0,0]);
  const flat=fold(source,[[-1,0]],[1,0],180),offsets=layerOffsets(flat);
  assert.equal(offsets.length,2);assert.ok(Math.abs(offsets[1]-offsets[0])>=PAPER_THICKNESS-1e-8);
  const verticalFaces=flat.map(f=>f.map(([x,y,z,u,v])=>[z,y,x,u,v]));
  const displacement=layerDisplacements(verticalFaces);
  assert.ok(Math.abs(displacement[1][0]-displacement[0][0])>=PAPER_THICKNESS-1e-8,'立起的叠层仍须按法向分离');
});
test('折痕和物理层位移可通过 JSON 恢复，旧存档兼容且损坏数据被拒绝',async()=>{
  const {sheet}=await import('../web/gami/fold.mjs');
  const {validPaperTopology,buildTopology}=await import('../web/gami/paper-topology.mjs');
  const item={faces:sheet(),creases:[[[.5,0],[.5,1]],[[0,.5],[1,.5]]],layers:[[0,0,0]]};
  const restored=JSON.parse(JSON.stringify(item));
  assert.equal(validPaperTopology(restored),true);assert.deepEqual(buildTopology(restored.faces,restored.creases),buildTopology(item.faces,item.creases));
  assert.equal(validPaperTopology({faces:sheet()}),true);
  assert.equal(validPaperTopology({...item,layers:[]}),false);
  assert.equal(validPaperTopology({...item,creases:[[[0,0],[0,0]]]}),false);
  assert.equal(validPaperTopology({...item,creases:Array.from({length:129},()=>[[0,0],[1,1]])}),false);
});
test('材料边可裁到弯纸面片，渲染条带不增加材料顶点',async()=>{
  const {sheet,fold}=await import('../web/gami/fold.mjs');
  const {buildTopology,clipMaterialSegment}=await import('../web/gami/paper-topology.mjs');
  const source=sheet(),curled=fold(source,[[-1,-1]],[1,1],180,.3),topology=buildTopology(source);
  assert.equal(topology.vertices.length,4);assert.ok(curled.length>2);
  assert.ok(curled.some(face=>topology.edges.some(edge=>clipMaterialSegment(face,edge.a,edge.b))));
  assert.deepEqual(clipMaterialSegment(sheet()[0],[-1,.5],[2,.5]),[[0,.5],[1,.5]]);
});
test('直接绕保存的折痕旋转纸瓣并展开，原纸坐标和折痕保持',async()=>{
  const {sheet,fold}=await import('../web/gami/fold.mjs');
  const {foldCreases,buildTopology,turnCrease,pointOnFace}=await import('../web/gami/paper-topology.mjs');
  const source=sheet(),creases=foldCreases(source,[[-1,0]],[1,0]);
  const folded=fold(source,[[-1,0]],[1,0],180);
  const edge=buildTopology(folded,creases).edges.find(e=>e.crease);
  assert.ok(edge);
  const face=folded.find(f=>f.some(p=>p[3]<.1)),uv=face.find(p=>p[3]<.1).slice(3);
  const sign=Math.sign((edge.b[0]-edge.a[0])*(uv[1]-edge.a[1])-(edge.b[1]-edge.a[1])*(uv[0]-edge.a[0]));
  const opened=turnCrease(folded,edge,sign,180);
  const position=opened.map(f=>pointOnFace(f,uv)).find(Boolean);
  assert.ok(Math.abs(position[0]+1)<1e-7);assert.ok(Math.abs(position[2])<1e-7);
  assert.ok(buildTopology(opened,creases).edges.some(e=>e.crease));
});
test('有厚度的非相邻纸面发生穿透时阻止继续移动',async()=>{
  const {faceCollision}=await import('../web/gami/paper-contact.mjs');
  const a=[[0,0,0,0,0],[1,0,0,1,0],[0,1,0,0,1]];
  const b=[[.1,.1,.004,2,2],[.8,.1,.004,3,2],[.1,.8,.004,2,3]];
  assert.equal(faceCollision(a,0,b,0,.008),true);
  assert.equal(faceCollision(a,0,b,.02,.008),false);
});
test('快速绕折痕拖动会扫描中间位置并停在碰撞之前',async()=>{
  const {sheet}=await import('../web/gami/fold.mjs');
  const {turnCrease}=await import('../web/gami/paper-topology.mjs');
  const {safeTurnCrease}=await import('../web/gami/paper-contact.mjs');
  const edge={a:[.5,0],b:[.5,1],crease:true};
  const faces=turnCrease(sheet(),edge,-1,0);
  faces.push([[.2,-.8,-.5,-2,-2],[.9,-.8,-.5,-1,-2],[.9,.8,-.5,-1,-1],[.2,.8,-.5,-2,-1]]);
  const safe=safeTurnCrease(faces,edge,-1,0,90);
  assert.equal(safe.blocked,true);assert.ok(safe.angle>0&&safe.angle<90);
});
test('互不阻挡的较早纸角可直接展开，后折的另一角保持原位',async()=>{
  const {sheet,fold}=await import('../web/gami/fold.mjs');
  const {foldCreases,buildTopology,pointOnFace}=await import('../web/gami/paper-topology.mjs');
  const {safeTurnCrease}=await import('../web/gami/paper-contact.mjs');
  const source=sheet(),creases=foldCreases(source,[[-1,-1]],[0,0]);
  let faces=fold(source,[[-1,-1]],[0,0],180);
  creases.push(...foldCreases(faces,[[1,1]],[0,0]));faces=fold(faces,[[1,1]],[0,0],180);
  const edge=buildTopology(faces,creases).edges.find(e=>e.crease&&Math.abs(e.a[0]+e.a[1]-.5)<1e-7&&Math.abs(e.b[0]+e.b[1]-.5)<1e-7);
  const cornerFace=faces.find(f=>pointOnFace(f,[0,0])),uv=cornerFace.reduce((sum,p)=>[sum[0]+p[3]/cornerFace.length,sum[1]+p[4]/cornerFace.length],[0,0]);
  const a=pointOnFace(cornerFace,edge.a),b=pointOnFace(cornerFace,edge.b),center=cornerFace.reduce((sum,p)=>sum.map((v,i)=>v+p[i]/cornerFace.length),[0,0,0]);
  const ax=b.map((n,i)=>n-a[i]),v=center.map((n,i)=>n-a[i]),sign=Math.sign(ax[0]*v[1]-ax[1]*v[0]);
  const side=Math.sign((edge.b[0]-edge.a[0])*(uv[1]-edge.a[1])-(edge.b[1]-edge.a[1])*(uv[0]-edge.a[0]));
  let result,angle=0;
  for(let target=10;target<=180;target+=10){result=safeTurnCrease(faces,edge,side,angle,sign*target);assert.equal(result.blocked,false);angle=result.angle}
  const first=result.faces.map(f=>pointOnFace(f,[0,0])).find(Boolean),last=result.faces.map(f=>pointOnFace(f,[1,1])).find(Boolean);
  assert.ok(Math.hypot(first[0]+1,first[1]+1,first[2])<1e-6);
  assert.ok(Math.hypot(...last)<1e-6);
});

test('每纸厚度独立、旧存档缺省兼容并拒绝损坏厚度',async()=>{
  const {sheet}=await import('../web/gami/fold.mjs');
  const {paperThickness,validPaperTopology}=await import('../web/gami/paper-topology.mjs');
  const old={faces:sheet()},thin={faces:sheet(),thickness:.002},thick={faces:sheet(),thickness:.02};
  assert.equal(paperThickness(old),.008);assert.equal(paperThickness(thin),.002);assert.equal(paperThickness(thick),.02);
  for(const item of [old,thin,thick])assert.equal(validPaperTopology(JSON.parse(JSON.stringify(item))),true);
  for(const thickness of [null,0,-.01,.001,.021,NaN,Infinity,'0.008'])assert.equal(validPaperTopology({...old,thickness}),false);
});
test('厚度调整保持叠层分离及候选独立，穿透或计算超限时保留原纸',async()=>{
  const {sheet,fold}=await import('../web/gami/fold.mjs');
  const {layerDisplacements,layerPitch,LAYER_SPACING_VERSION}=await import('../web/gami/paper-topology.mjs');
  const {resizedPaper,faceCollision}=await import('../web/gami/paper-contact.mjs');
  const item={faces:fold(sheet(),[[-1,0]],[1,0],180),thickness:.008,layerSpacingVersion:LAYER_SPACING_VERSION};
  item.layers=layerDisplacements(item.faces,item.thickness);
  const original=JSON.stringify(item);
  for(const thickness of [.002,.008,.02]){
    const next=resizedPaper(item,thickness);assert.equal(next.thickness,thickness);
    assert.ok(Math.abs(Math.hypot(...next.layers[1])-layerPitch(thickness))<1e-8);
    assert.equal(faceCollision(next.faces[0],next.layers[0],next.faces[1],next.layers[1],thickness),false);
    assert.equal(JSON.stringify(item),original);
  }
  const a=[[0,0,0,0,0],[1,0,0,1,0],[0,1,0,0,1]],b=a.map(([x,y,z,u,v])=>[x,y,.012,u+2,v+2]);
  const separated={faces:[a,b],thickness:.008},before=JSON.stringify(separated);
  assert.throws(()=>resizedPaper(separated,.02),/穿透/);assert.equal(JSON.stringify(separated),before);
  assert.throws(()=>resizedPaper({...item,faces:Array(65).fill(a)},.02),/纸层过多/);
  assert.throws(()=>resizedPaper(item,.001),/厚度/);
  const held={faces:sheet(),thickness:.008,heldFold:{curl:.2}};
  const display=fold(sheet(),[[-1,-1]],[.5,.5],180,.2),changed=resizedPaper(held,.01,display);
  assert.equal(changed.thickness,.01);assert.equal(changed.layers,undefined,'临时弯纸条带不写入材料层位移');
});

test('叠层表面保留四分之一纸厚的间隙，立起和背面仍遵守同一间距',async()=>{
  const {sheet,fold}=await import('../web/gami/fold.mjs');
  const {layerDisplacements}=await import('../web/gami/paper-topology.mjs');
  let faces=fold(sheet(),[[-1,0]],[1,0],180);faces=fold(faces,[[.5,-1]],[.5,1],180);
  for(const thickness of [.002,.008,.02])for(const transform of [([x,y,z,u,v])=>[x,y,z,u,v],([x,y,z,u,v])=>[z,y,x,u,v],([x,y,z,u,v])=>[x,y,-z,u,v]]){
    const actual=faces.map(f=>f.map(transform)),layers=layerDisplacements(actual,thickness);
    const ranks=layers.map(p=>Math.hypot(...p)).sort((a,b)=>a-b);
    assert.equal(ranks.length,4);
    for(let i=1;i<ranks.length;i++)assert.ok(Math.abs(ranks[i]-ranks[i-1]-thickness-thickness*.25)<1e-8);
  }
});
test('旧层位移只迁移一次，非共面层位移可兼容，碰撞时保留原存档',async()=>{
  const {sheet,fold}=await import('../web/gami/fold.mjs');
  const {layerDisplacements,validPaperTopology,buildTopology,foldCreases}=await import('../web/gami/paper-topology.mjs');
  const {migratedLayerSpacing,safeTurnCrease}=await import('../web/gami/paper-contact.mjs');
  const faces=fold(sheet(),[[-1,0]],[1,0],180),layers=layerDisplacements(faces,.008).map(p=>p.map(n=>n/1.25));
  const old={faces,layers,thickness:.008},original=JSON.stringify(old),next=migratedLayerSpacing(old);
  assert.equal(JSON.stringify(old),original);assert.equal(next.layerSpacingVersion,1);assert.ok(Math.abs(next.layers[1][2]-.01)<1e-8);
  for(let i=0;i<3;i++)assert.deepEqual(migratedLayerSpacing(JSON.parse(JSON.stringify(next))),JSON.parse(JSON.stringify(next)));
  assert.equal(validPaperTopology(next),true);assert.equal(validPaperTopology({...next,layerSpacingVersion:2}),false);
  const edge=buildTopology(faces,foldCreases(sheet(),[[-1,0]],[1,0])).edges.find(e=>e.crease);
  const legacyOpened=safeTurnCrease(faces,edge,-1,0,30,.008,layers,0);
  assert.equal(legacyOpened.blocked,false);assert.equal(legacyOpened.angle,30);assert.equal(legacyOpened.layerSpacingVersion,0,'旧纸形先按旧距离展开，不误标记新间距');
  const raised=safeTurnCrease(faces,edge,-1,0,30,.008,layerDisplacements(faces,.008));
  assert.ok(raised.faces.flat().some(p=>Math.abs(p[2])>.1));
  const legacy={faces:raised.faces,thickness:.008,layers:raised.layers.map(p=>p.map(n=>n/1.25))};
  const migrated=migratedLayerSpacing(legacy);assert.ok(migrated.layers.every((p,i)=>p.every((n,k)=>Math.abs(n-raised.layers[i][k])<1e-10)));
  const a=[[0,0,0,0,0],[1,0,0,1,0],[0,1,0,0,1]],b=a.map(([x,y,z,u,v])=>[x,y,.009,u+2,v+2]);
  const trapped={faces:[a,b],layers:[[0,0,0],[0,0,0]],thickness:.008},before=JSON.stringify(trapped);
  assert.throws(()=>migratedLayerSpacing(trapped),/穿透/);assert.equal(JSON.stringify(trapped),before);
});

test('细小真实重叠片仍保留层间隙，共边和数值噪声不产生层高台阶',async()=>{
  const {sheet}=await import('../web/gami/fold.mjs');
  const {layerDisplacements}=await import('../web/gami/paper-topology.mjs');
  const {faceCollision,resizedPaper}=await import('../web/gami/paper-contact.mjs');
  const faces=[sheet()[0],[[.2,.2,0,2,2],[.20012,.2,0,3,2],[.2,.20012,0,2,3]]],layers=layerDisplacements(faces,.008);
  assert.ok(Math.abs(layers[1][2]-.01)<1e-8,'面积 7.2e-9 的重叠片也必须分层');
  assert.equal(faceCollision(faces[0],layers[0],faces[1],layers[1],.01),false);
  assert.equal(resizedPaper({faces,thickness:.008},.01).thickness,.01);
  const neighbors=[sheet(-1,-1,1,2)[0],sheet(0,-1,1,2)[0]];
  for(const noise of [0,-1e-14]){
    const actual=[neighbors[0],neighbors[1].map(p=>[p[0]+noise,...p.slice(1)])];
    assert.ok(layerDisplacements(actual,.008).every(p=>Math.hypot(...p)<1e-12));
  }
});

test('沿已有折痕展开后的微小平面残差不会让下一次平折漏分层',async()=>{
  const {sheet,fold}=await import('../web/gami/fold.mjs');
  const {resizedPaper}=await import('../web/gami/paper-contact.mjs');
  const source=sheet().map(face=>face.map(p=>[p[0],p[1],(1-p[1])*1.2e-8,p[3],p[4]])),before=JSON.stringify(source);
  const faces=fold(source,[[-1,0]],[1,0],180);
  assert.equal(JSON.stringify(source),before,'平面恢复不能改写原存档');
  assert.ok(faces.flat().every(p=>p[2]===0));assert.equal(resizedPaper({faces,thickness:.008},.01).thickness,.01);
  assert.throws(()=>fold(sheet().map(f=>f.map(p=>[p[0],p[1],.01,p[3],p[4]])),[[-1,0]],[1,0],180),/平面/);
});

test('浏览器厚度设置、手工角点吸附、松手保持、刷新、继续调整、压平与撤销', {timeout:600000}, async(t)=>{
  const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
  const chromium=process.env.PUPPETEER_EXECUTABLE_PATH||'/usr/bin/chromium';
  if(!process.env.DISPLAY){t.skip('需要指定图形会话 DISPLAY');return}
  if(!fs.existsSync(chromium)){t.skip('未安装 Chromium');return}
  const puppeteer=require('puppeteer-core'),root=path.resolve(__dirname,'../web/gami');
  const server=http.createServer((req,res)=>{
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '')||'index.html';
    const file=path.resolve(root,name);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
    const type={'.html':'text/html','.mjs':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream';
    fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return}res.writeHead(200,{'Content-Type':type}).end(data)});
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
  const display=process.env.DISPLAY||':0';
  const xauth=process.env.XAUTHORITY||fs.readdirSync('/tmp').filter(name=>name.startsWith('xauth_')).map(name=>path.join('/tmp',name)).find(file=>fs.existsSync(file))||path.join(process.env.HOME||'/home/as','.Xauthority');
  const browser=await puppeteer.launch({executablePath:chromium,headless:false,timeout:120000,env:{...process.env,DISPLAY:display,XAUTHORITY:xauth},args:['--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--no-proxy-server']});
  t.after(()=>browser.close());
  const page=await browser.newPage();await page.setViewport({width:1000,height:720});
  page.setDefaultNavigationTimeout(120000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const {sheet}=await import('../web/gami/fold.mjs');
  const item={id:'paper',front:'#668f99',back:'#f5ead3',seed:1,faces:sheet(),x:0,y:0,rot:0,placed:false,folded:false};
  const desk={version:1,id:'desk',name:'测试桌',items:[item],active:item.id};
  await page.evaluateOnNewDocument(d=>{if(!localStorage.getItem('gami.desks.v1'))localStorage.setItem('gami.desks.v1',JSON.stringify([d]))},desk);
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
  await page.click('#resume');
  const point=async p=>page.evaluate(async([item,p])=>{
    const scene=await import('./scene.mjs');return scene.projectedCorner(item,p);
  },[item,p]);
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('gami.desks.v1'))[0].items[0]);
  const numberThickness=async value=>{
    await page.$eval('#thicknessValue',(el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))},String(value));
  };
  assert.equal(await page.$eval('#thicknessValue',e=>e.value),'0.4','旧存档显示默认厚度');
  await numberThickness(0);assert.equal((await saved()).thickness,undefined);assert.equal(await page.$eval('#undo',e=>e.disabled),true);
  await page.focus('#thickness');await page.keyboard.press('End');await page.keyboard.press('Tab');
  assert.equal((await saved()).thickness,.02);assert.equal(await page.$eval('#thicknessValue',e=>e.value),'1');
  await numberThickness(.333);assert.equal((await saved()).thickness,.333/50);assert.equal(await page.$eval('#thickness',e=>e.value),'0.333');
  await page.click('#undo');assert.equal((await saved()).thickness,.02);
  await page.click('#undo');assert.equal((await saved()).thickness,undefined);
  const start=await point([-1,-1]),end=await point([1,1]);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:8});
  assert.match(await page.$eval('#hint',e=>e.textContent),/已吸附角点/);
  await page.mouse.up();
  const held=await saved();assert.ok(held.heldFold,'有效松手应保存待压平折形');
  assert.deepEqual(held.heldFold.dest,[1,1]);assert.equal(held.heldFold.curl,0);assert.equal(held.heldFold.snapped,true);
  assert.deepEqual(held.heldFold.snapTarget,[1,1],'吸附保存目标材料坐标');
  const {heldFaces}=await import('../web/gami/held-fold.mjs');
  const tip=heldFaces(held).flat().find(p=>p[3]===0&&p[4]===0);
  assert.ok(tip&&Math.hypot(tip[0]-1,tip[1]-1,tip[2])<1e-8,'纸尖须与吸附角点实际重合');
  assert.deepEqual(held.faces,item.faces);assert.equal(await page.$eval('#flatten',e=>e.hidden),false);
  assert.equal(await page.$eval('#foldType',e=>e.disabled),true);
  await new Promise(resolve=>setTimeout(resolve,350));assert.deepEqual((await saved()).heldFold,held.heldFold);
  await page.reload({waitUntil:'domcontentloaded'});await page.click('#resume');
  assert.deepEqual((await saved()).heldFold,held.heldFold);
  const grab=await page.evaluate(async item=>{
    const scene=await import('./scene.mjs'),{heldFaces}=await import('./held-fold.mjs');
    return scene.paperControls(item,heldFaces(item)).points.find(p=>Math.hypot(p.uv[0],p.uv[1])<1e-8).screen;
  },held),move={x:grab.x-35,y:grab.y-15};
  assert.equal(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.id,grab),'view','工具栏不能遮住再次拖动的纸角');
  await page.mouse.move(grab.x,grab.y);await page.mouse.down();await page.mouse.move(move.x,move.y,{steps:5});await page.mouse.up();
  const changed=await saved();assert.notDeepEqual(changed.heldFold.dest,held.heldFold.dest);
  const cancelGrab=await page.evaluate(async item=>{
    const scene=await import('./scene.mjs'),{heldFaces}=await import('./held-fold.mjs');
    return scene.paperControls(item,heldFaces(item)).points.find(p=>Math.hypot(p.uv[0],p.uv[1])<1e-8).screen;
  },changed);
  await page.mouse.move(cancelGrab.x,cancelGrab.y);await page.mouse.down();await page.mouse.move(cancelGrab.x+40,cancelGrab.y,{steps:5});
  await page.$eval('#view',e=>e.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true})));
  await page.mouse.up();assert.deepEqual((await saved()).heldFold,changed.heldFold);
  await page.click('#flatten');const flat=await saved();assert.equal(flat.heldFold,undefined);assert.equal(flat.folded,true);
  assert.ok(flat.creases?.length,'压平应保存折痕');
  await numberThickness(.8);const thickFlat=await saved();assert.equal(thickFlat.thickness,.016);
  assert.ok(thickFlat.layers.some(p=>Math.hypot(...p)>=.016-1e-8));
  await page.click('#undo');assert.deepEqual(await saved(),flat);
  const crease=await page.evaluate(async item=>{
    const {paperControls}=await import('./scene.mjs');
    return paperControls(item).edges.find(edge=>edge.crease&&Math.hypot(edge.screens[1].x-edge.screens[0].x,edge.screens[1].y-edge.screens[0].y)>50);
  },flat);
  assert.ok(crease,'保存的折痕应能通过边拾取');
  const [ca,cb]=crease.screens,cl=Math.hypot(cb.x-ca.x,cb.y-ca.y);
  const cf=flat.faces[crease.face],cc=cf.reduce((sum,p)=>sum.map((v,i)=>v+p[i]/cf.length),[0,0,0]);
  const axis=crease.points[1].map((v,i)=>v-crease.points[0][i]),relative=cc.map((v,i)=>v-crease.points[0][i]);
  const lift=Math.sign(axis[0]*relative[1]-axis[1]*relative[0])||1;
  await page.mouse.move(crease.midScreen.x,crease.midScreen.y);await page.mouse.down();
  await page.mouse.move(crease.midScreen.x-(cb.y-ca.y)/cl*120*lift,crease.midScreen.y+(cb.x-ca.x)/cl*120*lift,{steps:12});
  const creaseHint=await page.$eval('#hint',e=>e.textContent);
  await page.mouse.up();
  const opened=await saved();assert.notDeepEqual(opened.faces,flat.faces,'拖动折痕边应改变纸瓣角度：'+creaseHint);assert.deepEqual(opened.creases,flat.creases);
  assert.ok(opened.faces.flat().every(p=>Math.abs(p[2])<1e-6),'拖动至 180 度应沿折痕展开回平面');
  await page.click('#undo');assert.deepEqual((await saved()).faces,flat.faces);
  await page.click('#undo');assert.deepEqual((await saved()).heldFold,changed.heldFold);
  await page.click('#homeBtn');await page.click('#browse');
  assert.equal(await page.$$('.saveRow canvas').then(rows=>rows.length),1);
  await page.click('.saveRow button');assert.deepEqual((await saved()).heldFold,changed.heldFold);
  const renderer=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2');const ext=gl?.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'未知'});
  t.diagnostic('DISPLAY='+display+'，WebGL 渲染器：'+renderer);
  await page.click('#homeBtn');await page.click('#new');
  await page.$eval('#newThickness',e=>e.value='0.6');await page.click('#startDesk');
  assert.equal((await saved()).thickness,.012);
  await page.click('#add');await page.$eval('#newThickness',e=>e.value='0.1');await page.click('#startDesk');
  const papers=await page.evaluate(()=>JSON.parse(localStorage.getItem('gami.desks.v1'))[0].items);
  assert.deepEqual(papers.map(p=>p.thickness),[.012,.002]);assert.equal(await page.$eval('#thicknessValue',e=>e.value),'0.1');
  await page.click('#undo');assert.equal((await saved()).thickness,.012);assert.equal(await page.$eval('#thicknessValue',e=>e.value),'0.6');
  // 本组交点回归使用默认纸厚，避免改变既有测试所选折痕与安全预算。
  await numberThickness(.4);
  const projectCurrent=p=>page.evaluate(async p=>{
    const item=JSON.parse(localStorage.getItem('gami.desks.v1'))[0].items[0];return (await import('./scene.mjs')).projectedCorner(item,p);
  },p);
  const foldEdge=async(a,b)=>{
    const start=await projectCurrent(a),end=await projectCurrent(b);
    await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:12});await page.mouse.up();
    assert.ok((await saved()).heldFold);await page.click('#flatten');
  };
  const openCrease=async(coordinate,expectBlocked=false)=>{
    const item=await saved();
    const edge=await page.evaluate(async({item,coordinate})=>{
      return (await import('./scene.mjs')).paperControls(item).edges.find(e=>e.crease&&Math.abs(e.a[coordinate]-.5)<1e-7&&Math.abs(e.b[coordinate]-.5)<1e-7&&Math.hypot(e.screens[1].x-e.screens[0].x,e.screens[1].y-e.screens[0].y)>35);
    },{item,coordinate});
    assert.ok(edge,'需要能够拾取指定的旧折痕');
    const face=item.faces[edge.face],center=face.reduce((sum,p)=>sum.map((v,i)=>v+p[i]/face.length),[0,0,0]);
    const axis=edge.points[1].map((v,i)=>v-edge.points[0][i]),v=center.map((n,i)=>n-edge.points[0][i]);
    const sign=Math.sign(axis[0]*v[1]-axis[1]*v[0])||1,[a,b]=edge.screens,len=Math.hypot(b.x-a.x,b.y-a.y);
    await page.mouse.move(edge.midScreen.x,edge.midScreen.y);await page.mouse.down();
    await page.mouse.move(edge.midScreen.x-(b.y-a.y)/len*120*sign,edge.midScreen.y+(b.x-a.x)/len*120*sign,{steps:18});
    const hint=await page.$eval('#hint',e=>e.textContent);await page.mouse.up();
    if(expectBlocked){assert.match(hint,/接触/);assert.deepEqual((await saved()).faces,item.faces);return}
    assert.ok((await saved()).faces.flat().every(p=>Math.abs(p[2])<1e-6));
  };
  await foldEdge([-1,0],[1,0]);
  await foldEdge([.5,-1],[.5,1]);
  // 较早折痕可直接拾取；被外层压住时须由接触约束阻止穿透，再展开外层。
  await openCrease(0,true);await openCrease(1);await openCrease(0);
  const crossed=await saved();
  const intersection=await page.evaluate(async item=>{
    return (await import('./scene.mjs')).paperControls(item).points.find(p=>Math.hypot(p.uv[0]-.5,p.uv[1]-.5)<1e-7);
  },crossed);
  assert.ok(intersection,'两条折痕相交后中心交点应可拾取');
  const destination=await projectCurrent([intersection.point[0]+1,intersection.point[1]]);
  await page.mouse.move(intersection.screen.x,intersection.screen.y);await page.mouse.down();await page.mouse.move(destination.x,destination.y,{steps:12});await page.mouse.up();
  const fromIntersection=await saved();assert.ok(fromIntersection.heldFold,'拖动内部交点应生成新折叠');
  assert.ok(Math.hypot(...fromIntersection.heldFold.pick.map((v,i)=>v-intersection.point[i]))<1e-6,'新折叠应来自内部交点');
  await page.click('#flatten');assert.ok((await saved()).creases.length>crossed.creases.length);
  const beforeResize=await saved();await numberThickness(.5);const persisted=await saved();
  if(persisted.thickness!==.01)fs.writeFileSync('/tmp/gami-gap-resize-fixture.json',JSON.stringify({beforeResize,persisted,message:await page.$eval('#message',e=>e.textContent)}));
  assert.equal(persisted.thickness,.01,await page.$eval('#message',e=>e.textContent));
  await page.reload({waitUntil:'domcontentloaded'});await page.click('#resume');
  assert.deepEqual(await saved(),persisted);assert.equal(await page.$eval('#thicknessValue',e=>e.value),'0.5');
  // 实际导出文件再经导入入口恢复，覆盖字段校验和副本保存。
  const os=require('node:os'),exportDir=fs.mkdtempSync(path.join(os.tmpdir(),'gami-thickness-'));
  t.after(()=>fs.rmSync(exportDir,{recursive:true,force:true}));
  const session=await page.createCDPSession();await session.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:exportDir});
  await page.click('#homeBtn');await page.click('#browse');await page.click('.saveRow button:last-child');
  let exported;
  for(let tries=0;tries<100;tries++){
    exported=fs.readdirSync(exportDir).find(name=>name.endsWith('.json'));if(exported)break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.ok(exported,'浏览页应导出 JSON');const exportFile=path.join(exportDir,exported);
  assert.deepEqual(JSON.parse(fs.readFileSync(exportFile,'utf8')).items[0],persisted);
  await page.click('#close');await page.$eval('#content',e=>e.replaceChildren());await (await page.$('#file')).uploadFile(exportFile);
  await page.waitForSelector('#confirmImport',{visible:true});await page.click('#confirmImport');
  assert.deepEqual(await saved(),persisted);assert.equal(await page.$eval('#thicknessValue',e=>e.value),'0.5');
  // 用实际截图中的橙色像素验证标记，避免只比较两段使用同一错误公式的投影代码。
  for(const view of ['正面','斜视','背面']){
    const expected=await page.evaluate(async view=>{
      const scene=await import('./scene.mjs'),{sheet,fold}=await import('./fold.mjs');
      if(view==='斜视'){scene.orbit(45,-45);scene.zoom(.8)}
      if(view==='背面')scene.orbit(0,-230);
      const item={id:'projection-check',faces:fold(sheet(),[[-1,0]],[1,0],180),thickness:.02,front:'#668f99',back:'#f5ead3',seed:1,x:0,y:0,rot:.3};
      scene.show({items:[item]},item.id,null,[],null,'fold',{uv:[0,0]});
      const anchor=scene.projectedMaterialPoint(item,[0,0]);
      return {x:anchor.x,y:anchor.y,world:anchor.world};
    },view);
    // 等浏览器完成新场景合成后再验证像素。
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const screenshot=await page.screenshot({encoding:'base64'});
    const orange=await page.evaluate(async({screenshot,expected})=>{
      const image=new Image();image.src='data:image/png;base64,'+screenshot;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const scale=image.width/innerWidth;
      const left=Math.max(0,Math.floor((expected.x-25)*scale)),top=Math.max(0,Math.floor((expected.y-25)*scale));
      const width=Math.min(Math.ceil(50*scale),image.width-left),height=Math.min(Math.ceil(50*scale),image.height-top);
      const data=ctx.getImageData(left,top,width,height).data,colors=new Map();
      for(let row=0;row<height;row++)for(let col=0;col<width;col++){
        const i=(row*width+col)*4,r=data[i],g=data[i+1],b=data[i+2];
        if(r>180&&g>95&&g<220&&b<135&&r>g*1.12){
          const key=[r,g,b].join(','),group=colors.get(key)||{count:0,x:0,y:0,color:key};
          group.count++;group.x+=(left+col+.5)/scale;group.y+=(top+row+.5)/scale;colors.set(key,group);
        }
      }
      // 无光照的橙色标记内部颜色恒定；用众数隔离背面纸张中相近的暖色纹理。
      const mode=[...colors.values()].sort((a,b)=>b.count-a.count)[0];
      return mode?{count:mode.count,x:mode.x/mode.count,y:mode.y/mode.count,color:mode.color}:{count:0};
    },{screenshot,expected});
    assert.ok(orange.count>4,view+'应看到橙色吸附标记');
    assert.ok(Math.hypot(orange.x-expected.x,orange.y-expected.y)<1.5,view+'标记中心应贴合实际表面投影：'+JSON.stringify({orange,expected}));
    t.diagnostic(view+'吸附标记像素中心误差 '+Math.hypot(orange.x-expected.x,orange.y-expected.y).toFixed(3)+' px，RGB '+orange.color);
    assert.ok(Math.abs(expected.world[1])>.005,view+'投影必须包含厚度及层位移');
  }
  assert.deepEqual(errors,[]);
});

test('独立分开模式点边展开、取消、撤销、刷新与窄屏触控', {timeout:600000}, async(t)=>{
  const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
  if(!process.env.DISPLAY){t.skip('需要指定图形会话 DISPLAY');return}
  const chromium=process.env.PUPPETEER_EXECUTABLE_PATH||'/usr/bin/chromium';
  if(!fs.existsSync(chromium)){t.skip('未安装 Chromium');return}
  const root=path.resolve(__dirname,'../web/gami'),server=http.createServer((req,res)=>{
    const name=new URL(req.url,'http://localhost').pathname.replace(/^\/+/, '')||'index.html',file=path.resolve(root,name);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
    fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return}res.writeHead(200,{'Content-Type':file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'}).end(data)});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
  const xauth=process.env.XAUTHORITY||fs.readdirSync('/tmp').filter(n=>n.startsWith('xauth_')).map(n=>path.join('/tmp',n)).find(f=>fs.existsSync(f));
  const browser=await require('puppeteer-core').launch({executablePath:chromium,headless:false,env:{...process.env,...(xauth?{XAUTHORITY:xauth}:{})},args:['--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--no-proxy-server']});
  t.after(()=>browser.close());const page=await browser.newPage(),errors=[];page.setDefaultNavigationTimeout(120000);page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:1000,height:760});await page.goto(process.env.GAMI_TEST_URL||'http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
  const {sheet,fold}=await import('../web/gami/fold.mjs'),{foldCreases}=await import('../web/gami/paper-topology.mjs');
  const fixture={id:'paper',front:'#668f99',back:'#f5ead3',seed:91,thickness:.008,x:0,y:0,rot:0,placed:false,folded:true,faces:fold(sheet(),[[-1,0]],[1,0],180),creases:foldCreases(sheet(),[[-1,0]],[1,0])};
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('gami.desks.v1'))[0].items[0]);
  const fixtureDir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'gami-separate-')),fixtureFile=path.join(fixtureDir,'paper.json');
  t.after(()=>fs.rmSync(fixtureDir,{recursive:true,force:true}));
  const load=async(item=fixture)=>{
    if(await page.$eval('#home',e=>e.hidden))await page.click('#homeBtn');
    fs.writeFileSync(fixtureFile,JSON.stringify({id:'separate-test',version:1,name:'分开验证',active:item.id,items:[item]}));
    await page.$eval('#content',e=>e.replaceChildren());
    await (await page.$('#file')).uploadFile(fixtureFile);await page.waitForSelector('#confirmImport',{visible:true});await page.click('#confirmImport');
    await page.select('#foldType','corner');await page.click('[data-tool=separate]');
    assert.equal(await page.$eval('#foldTools',e=>e.hidden),true);assert.equal(await page.$eval('[data-tool=separate]',e=>e.getAttribute('aria-pressed')),'true');
  };
  const handle=async(kind='point')=>page.evaluate(async({item,kind})=>{
    const controls=(await import('./scene.mjs')).paperControls(item),point=controls.points.find(p=>p.uv[0]<.01&&p.uv[1]<.01);if(!point)return null;
    if(kind==='point')return {screen:point.screen,uv:point.uv,face:point.face};
    const edge=controls.edges.find(e=>e.face===point.face&&(kind==='crease'?e.crease:!e.crease&&e.a[0]<.01&&e.b[0]<.01));
    return edge?{screen:edge.midScreen,uv:edge.a.map((v,i)=>(v+edge.b[i])/2),face:edge.face,edge}:null;
  },{item:await saved(),kind});
  const motion=async(control,pixels=60)=>page.evaluate(async({item,control,pixels})=>{
    const scene=await import('./scene.mjs'),{separationPick}=await import('./separate.mjs'),{safeTurnCrease}=await import('./paper-contact.mjs');
    const pick=separationPick(item,control.edge?null:control,control.edge,null),edge=pick.edge;
    const side=pick.side||Math.sign((edge.b[0]-edge.a[0])*(edge.centerUV[1]-edge.a[1])-(edge.b[1]-edge.a[1])*(edge.centerUV[0]-edge.a[0]));
    const uv=pick.direct?edge.centerUV:pick.handleUV,start=scene.projectedMaterialPoint(item,uv);
    for(const sign of [1,-1]){
      const probe=safeTurnCrease(item.faces,edge,side,0,sign*3,item.thickness,item.layers);if(Math.abs(probe.angle)<.5)continue;
      const frames=[];let previous=0;
      for(let i=1;i<=24;i++){
        const result=safeTurnCrease(item.faces,edge,side,previous,sign*Math.min(180,pixels*1.5)*i/24,item.thickness,item.layers);
        previous=result.angle;
        const end=scene.projectedMaterialPoint(item,uv,result.faces,result.layers);
        frames.push({x:control.screen.x+end.x-start.x,y:control.screen.y+end.y-start.y});
      }
      return {...frames.at(-1),frames};
    }
    return null;
  },{item:await saved(),control,pixels});
  const drag=async(control,pixels=60,cancel=false)=>{
    const end=await motion(control,pixels);assert.ok(end,'应存在安全展开方向');
    await page.mouse.move(control.screen.x,control.screen.y);await page.mouse.down();for(const frame of end.frames)await page.mouse.move(frame.x,frame.y);
    if(cancel&&!control.edge){
      for(const frame of [...end.frames].reverse()){
        await page.mouse.move(frame.x,frame.y);
        const projected=await page.evaluate(async({item,uv})=>(await import('./scene.mjs')).projectedMaterialPoint(item,uv),{item:await saved(),uv:control.uv});
        assert.ok(Math.hypot(projected.x-frame.x,projected.y-frame.y)<4,'回拖抓取点应跟随指针');
      }
    }
    const hint=await page.$eval('#hint',e=>e.textContent);
    if(cancel)await page.$eval('#view',e=>e.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true})));
    await page.mouse.up();return hint;
  };
  await load({...fixture,faces:sheet(),creases:undefined,folded:false});
  const blank=await page.evaluate(async item=>(await import('./scene.mjs')).paperControls(item).points[0],await saved());
  await page.mouse.move(blank.screen.x,blank.screen.y);await page.mouse.down();await page.mouse.move(blank.screen.x+35,blank.screen.y+35,{steps:4});await page.mouse.up();
  assert.equal((await saved()).heldFold,undefined);assert.equal(await page.$eval('#undo',e=>e.disabled),true);assert.match(await page.$eval('#hint',e=>e.textContent),/没有.*折痕/);
  await load({...fixture,faces:sheet(),creases:undefined,heldFold:{starts:[[-1,0]],dest:[1,0],angle:180,curl:.2,kind:'edge',pick:[-1,-1],other:[-1,1],index:0}});
  assert.match(await page.$eval('#hint',e=>e.textContent),/先.*压平/);
  await load();const original=await saved(),corner=await handle();assert.ok(corner);
  await drag(corner,40,true);assert.deepEqual(await saved(),original,'取消应丢弃预览');
  const hint=await drag(corner),opened=await saved();assert.notDeepEqual(opened.faces,original.faces,hint);assert.equal(opened.heldFold,undefined);assert.deepEqual(opened.creases,original.creases);
  assert.ok(opened.faces.flat().some(p=>Math.abs(p[2])>.1),'角点拖动应该抬起纸瓣');await page.screenshot({path:'/tmp/aasc-gami-separate-desktop.png'});
  await page.click('#undo');assert.deepEqual(await saved(),original);
  const boundary=await handle('boundary');assert.ok(boundary);await drag(boundary,130);
  const unfolded=await saved();assert.ok(unfolded.faces.flat().every(p=>Math.abs(p[2])<1e-6),'边界应可完全展开：'+JSON.stringify(unfolded.faces.map(f=>f.map(p=>p[2]))));assert.ok(unfolded.faces.flat().some(p=>p[0]<-.9));assert.deepEqual(unfolded.creases,original.creases);
  await page.reload({waitUntil:'domcontentloaded'});await page.click('#resume');assert.deepEqual(await saved(),unfolded);
  await load();const crease=await handle('crease');assert.ok(crease);await page.mouse.click(crease.screen.x,crease.screen.y);assert.deepEqual(await saved(),original,'点折痕只选轴');
  await drag(crease,50);assert.notDeepEqual((await saved()).faces,original.faces,'折痕也应可拖动');
  await load();const switching=await handle(),switchEnd=await motion(switching,45);
  await page.mouse.move(switching.screen.x,switching.screen.y);await page.mouse.down();for(const frame of switchEnd.frames)await page.mouse.move(frame.x,frame.y);await page.$eval('[data-tool=fold]',e=>e.click());await page.mouse.up();assert.deepEqual(await saved(),original,'切换工具应取消手势');
  await page.setViewport({width:390,height:844});await load();
  const layout=await page.evaluate(()=>{const panel=document.querySelector('#panel').getBoundingClientRect();return {left:panel.left,right:panel.right,buttons:[...document.querySelectorAll('.tabs button')].map(e=>e.getBoundingClientRect().right)}});
  assert.ok(layout.left>=0&&layout.right<=390);assert.ok(layout.buttons.every(x=>x<=390));
  const touch=await handle(),touchEnd=await motion(touch,65),cdp=await page.createCDPSession();assert.ok(touchEnd);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const touchAt=async(type,p)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:p?[{x:p.x,y:p.y,id:0,radiusX:2,radiusY:2}]:[]});
  await touchAt('touchStart',touch.screen);for(const frame of touchEnd.frames)await touchAt('touchMove',frame);await touchAt('touchEnd');
  assert.notDeepEqual((await saved()).faces,fixture.faces,'窄屏触控应可展开纸瓣');await page.screenshot({path:'/tmp/aasc-gami-separate-mobile.png'});assert.deepEqual(errors,[]);
  t.diagnostic('分开工具角点、边界、折痕、取消、选轴、撤销、刷新及390×844触控通过，页面错误0');
});

test('分开抓取轨迹求角支持不同投影、回拖与端点',async()=>{
  const {orbitPoint,closestOrbitAngle}=await import('../web/gami/separate.mjs');
  const p=orbitPoint([1,0,0],[0,0,0,.5,0],[0,1,0,.5,1],90);
  assert.ok(Math.abs(p[0])<1e-10&&Math.abs(p[2]+1)<1e-10);
  const {sheet,fold}=await import('../web/gami/fold.mjs');
  const {turnCrease,buildTopology,foldCreases,pointOnFace}=await import('../web/gami/paper-topology.mjs');
  const faces=fold(sheet(),[[-1,0]],[1,0],180),edge=buildTopology(faces,foldCreases(sheet(),[[-1,0]],[1,0])).edges.find(e=>e.crease);
  const face=faces.find(f=>f.some(p=>p[3]===0)),a=pointOnFace(face,edge.a),b=pointOnFace(face,edge.b),source=face.find(p=>p[3]===0&&p[4]===0);
  for(const angle of [-180,-90,-30,30,90,180]){
    const expected=turnCrease(faces,edge,-1,angle).flat().find(p=>p[3]===0&&p[4]===0),actual=orbitPoint(source.slice(0,3),a,b,angle);
    assert.ok(Math.hypot(...actual.map((v,i)=>v-expected[i]))<1e-9,'轨迹须与含材料坐标的纸面旋转一致');
  }
  for(const skew of [.2,.8,1.5]){
    const project=angle=>{const r=angle*Math.PI/180;return {x:300+150*Math.cos(r),y:250+100*skew*Math.sin(r)}};
    let previous=0;
    for(const angle of [5,20,45,90,135,175,180,175,130,90,45,20,0]){
      previous=closestOrbitAngle(project,project(angle),previous,0,180);
      assert.ok(Math.abs(previous-angle)<.05,`投影 ${skew} 目标 ${angle} 实际 ${previous}`);
    }
  }
});

test('预折痕还原原姿态及层次，保留交点并能沿痕再折，取消不留痕',async()=>{
  const {sheet,fold}=await import('../web/gami/fold.mjs');
  const {precreaseFold,cancelHeldFold,flattenHeldFold,validHeldFold}=await import('../web/gami/held-fold.mjs');
  const {buildTopology,turnCrease,layerDisplacements,LAYER_SPACING_VERSION,pointOnFace}=await import('../web/gami/paper-topology.mjs');
  const original={faces:sheet(),x:2,y:-1,rot:.7,thickness:.008,folded:false,creases:[]};
  const item=structuredClone(original);
  precreaseFold(item,[[-1,0]],[1,0]);precreaseFold(item,[[0,-1]],[0,1]);
  assert.deepEqual([item.x,item.y,item.rot,item.folded],[2,-1,.7,false]);
  assert.ok(item.faces.flat().every(p=>p[0]===p[3]*2-1&&p[1]===p[4]*2-1&&p[2]===0));
  assert.ok(buildTopology(item.faces,item.creases).vertices.some(p=>p[0]===.5&&p[1]===.5));
  const axis=buildTopology(item.faces,item.creases).edges.find(e=>e.crease&&e.a[0]===.5&&e.b[0]===.5);
  assert.ok(turnCrease(item.faces,axis,1,60).flat().some(p=>Math.abs(p[2])>.5));
  const creases=structuredClone(item.creases);precreaseFold(item,[[-1,0]],[1,0]);assert.deepEqual(item.creases,creases,'重复预折痕不得叠加记录');
  const layered={...original,faces:fold(sheet(),[[-1,0]],[1,0],180),folded:true};
  layered.layers=layerDisplacements(layered.faces,.008);layered.layerSpacingVersion=LAYER_SPACING_VERSION;
  const before=structuredClone(layered);precreaseFold(layered,[[.5,-1]],[.5,1]);
  layered.faces.forEach((face,i)=>{
    const uv=face.reduce((v,p)=>v.map((x,k)=>x+p[k+3]/face.length),[0,0]);
    const source=before.faces.findIndex(f=>pointOnFace(f,uv));assert.deepEqual(layered.layers[i],before.layers[source]);
    for(const p of face){const q=pointOnFace(before.faces[source],[p[3],p[4]]);assert.ok(Math.hypot(...p.slice(0,3).map((v,k)=>v-q[k]))<1e-12)}
  });
  const h={starts:[[-1,0]],dest:[1,0],angle:180,curl:.2,kind:'edge',index:0,mode:'precrease'};
  const pending={...structuredClone(item),heldFold:h},baseline=structuredClone(item);
  assert.equal(validHeldFold(pending),true);assert.equal(cancelHeldFold(pending),true);assert.deepEqual(pending,baseline);assert.equal(cancelHeldFold(pending),false);
  const normal={...structuredClone(original),heldFold:{...h,mode:'fold'}};flattenHeldFold(normal);assert.equal(normal.folded,true);assert.notDeepEqual(normal.faces,item.faces);
  const invalid=structuredClone(item);assert.throws(()=>precreaseFold(invalid,[[0,0]],[0,0]));assert.deepEqual(invalid,item);
});

test('双角分开两侧共轴且保持刚性、厚度与折痕，非法同侧角拒绝',async()=>{
  const {sheet,fold}=await import('../web/gami/fold.mjs');
  const {foldCreases}=await import('../web/gami/paper-topology.mjs');
  const {separationPair}=await import('../web/gami/separate.mjs');
  const {safePairTurn,safeTurnCrease}=await import('../web/gami/paper-contact.mjs');
  const item={faces:fold(sheet(),[[-1,0]],[1,0],180),creases:foldCreases(sheet(),[[-1,0]],[1,0]),thickness:.008};
  const first={face:0,uv:[1,0]},second={face:1,uv:[0,0]},pair=separationPair(item,first,second);
  assert.ok(pair);assert.equal(separationPair(item,first,{face:0,uv:[1,1]}),null);
  assert.equal(separationPair(item,first,{face:1,uv:[.5,0]}),null);
  const sign=[1,-1].find(sign=>Math.abs(safeTurnCrease(item.faces,pair.edge,pair.side,0,sign*3,.008).angle)>1);
  let from=0,result;
  for(let n=1;n<=12;n++){result=safePairTurn(item,pair.edge,pair.side,from,sign*n*10,-sign*n*5);from=result.angle}
  assert.ok(Math.abs(from)>100);
  for(const face of result.faces)for(let i=0;i<face.length;i++)for(let j=i+1;j<face.length;j++){
    const a=face[i],b=face[j],uvLength=Math.hypot(a[3]-b[3],a[4]-b[4])*2;
    assert.ok(Math.abs(Math.hypot(...a.slice(0,3).map((v,k)=>v-b[k]))-uvLength)<1e-10,'纸面不可拉伸');
  }
  assert.ok(result.faces.every(face=>face.some(p=>Math.abs(p[2])>.2)),'两侧都应离开起始平面');
  assert.ok(result.layers.every(p=>p.every(Number.isFinite)));
  assert.deepEqual(item.creases,foldCreases(sheet(),[[-1,0]],[1,0]));
});

test('浏览器预折痕双模式、弯折角球、整轮取消与双角鼠标触控', {timeout:900000},async(t)=>{
  if(!process.env.DISPLAY){t.skip('需要指定图形会话 DISPLAY');return}
  const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
  const root=path.resolve(__dirname,'../web/gami'),server=http.createServer((req,res)=>{
    const file=path.resolve(root,new URL(req.url,'http://local').pathname.slice(1)||'index.html');
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
    fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return}res.writeHead(200,{'Content-Type':file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'}).end(data)});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
  const xauth=process.env.XAUTHORITY||fs.readdirSync('/tmp').filter(n=>n.startsWith('xauth_')).map(n=>path.join('/tmp',n)).find(f=>fs.existsSync(f));
  const browser=await require('puppeteer-core').launch({executablePath:'/usr/bin/chromium',headless:false,env:{...process.env,...(xauth?{XAUTHORITY:xauth}:{})},args:['--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--no-proxy-server']});
  t.after(()=>browser.close());const page=await browser.newPage(),errors=[];page.setDefaultNavigationTimeout(120000);page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:1000,height:760});await page.goto(process.env.GAMI_TEST_URL||'http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
  const {sheet,fold}=await import('../web/gami/fold.mjs'),{foldCreases}=await import('../web/gami/paper-topology.mjs');
  const blank={id:'paper',front:'#668f99',back:'#f5ead3',seed:91,thickness:.008,x:0,y:0,rot:0,placed:false,folded:false,faces:sheet()};
  const fixture={...blank,folded:true,faces:fold(sheet(),[[-1,0]],[1,0],180),creases:foldCreases(sheet(),[[-1,0]],[1,0])};
  const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'gami-modes-')),file=path.join(dir,'paper.json');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('gami.desks.v1'))[0].items[0]);
  const load=async(item)=>{
    if(await page.$eval('#home',e=>e.hidden))await page.click('#homeBtn');
    fs.writeFileSync(file,JSON.stringify({id:'modes-test',version:1,name:'双模式验证',active:item.id,items:[item]}));
    await page.$eval('#content',e=>e.replaceChildren());await (await page.$('#file')).uploadFile(file);
    await page.waitForSelector('#confirmImport',{visible:true});await page.click('#confirmImport');
  };
  const point=uv=>page.evaluate(async({item,uv})=>(await import('./scene.mjs')).projectedMaterialPoint(item,uv),{item:blank,uv});
  const dragFold=async(to=[1,1])=>{
    const a=await point([0,0]),b=await point(to);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});
  };
  await load(blank);await dragFold([.65,.65]);
  await page.screenshot({path:'/tmp/aasc-gami-bending-markers.png'});await page.mouse.up();
  assert.ok((await saved()).heldFold);assert.equal(await page.$eval('#cancelFold',e=>e.hidden),false);
  assert.equal(await page.$eval('#foldMode',e=>e.disabled),true);
  const heldPoint=await point([0,0]);await page.mouse.move(heldPoint.x,heldPoint.y);await page.mouse.down();await page.mouse.move(heldPoint.x+20,heldPoint.y-12,{steps:3});
  await page.$eval('#cancelFold',e=>e.click());await page.mouse.up();assert.deepEqual(await saved(),blank,'取消整轮弯折并防止迟到松手重新提交');
  await page.click('#undo');assert.ok((await saved()).heldFold,'取消弯折可撤销');await page.click('#cancelFold');
  await page.select('#foldMode','precrease');await dragFold();await page.mouse.up();
  assert.equal((await saved()).heldFold.mode,'precrease');await page.reload({waitUntil:'domcontentloaded'});await page.click('#resume');
  assert.equal(await page.$eval('#foldMode',e=>e.value),'precrease');assert.equal(await page.$eval('#flatten',e=>e.textContent),'生成折痕并还原');
  await page.click('#flatten');const pre=await saved();assert.equal(pre.heldFold,undefined);assert.equal(pre.folded,false);assert.ok(pre.creases.length);
  assert.ok(pre.faces.flat().every(p=>Math.abs(p[0]-(p[3]*2-1))<1e-12&&Math.abs(p[1]-(p[4]*2-1))<1e-12&&p[2]===0));
  assert.equal(await page.$eval('#cancelFold',e=>e.hidden),true);await page.screenshot({path:'/tmp/aasc-gami-precrease.png'});
  await page.click('#undo');assert.ok((await saved()).heldFold);await page.click('#cancelFold');assert.deepEqual(await saved(),blank);
  await page.select('#foldMode','fold');await dragFold();await page.mouse.up();await page.click('#flatten');assert.equal((await saved()).folded,true);
  // 采用现有导入入口换成对折样纸，以独立验证编号选层而不是复用待测求角代码生成断言。
  await load(fixture);await page.click('[data-tool=separate]');await page.click('#pairMode');
  const button=async(face,uv)=>page.$eval(`#pairHandles button[data-face="${face}"][data-uv="${uv.join(',')}"]`,e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}});
  const a=await button(0,[1,0]),b=await button(1,[0,0]);assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>=36,'重叠角必须能分别选择');
  const pairPath=async(first,second,angle,baseAngle=0)=>page.evaluate(async({item,first,second,angle,baseAngle})=>{
    const scene=await import('./scene.mjs'),{separationPair}=await import('./separate.mjs'),{safeTurnCrease,safePairTurn}=await import('./paper-contact.mjs');
    const pair=separationPair(item,first,second),sign=[1,-1].find(s=>Math.abs(safeTurnCrease(item.faces,pair.edge,pair.side,0,s*3,item.thickness,item.layers).angle)>1);
    const origin=[first,second].map(p=>scene.projectedFacePoint(item,p.face,item.faces[p.face].find(v=>v[3]===p.uv[0]&&v[4]===p.uv[1])));
    const frames=[];let from=0;
    for(let i=1;i<=12;i++){
      const r=safePairTurn(item,pair.edge,pair.side,from,sign*angle*i/12,-sign*baseAngle*i/12);from=r.angle;
      frames.push([first,second].map((p,k)=>{const v=scene.projectedMaterialPoint(item,p.uv,r.faces,r.layers);return {x:v.x-origin[k].x,y:v.y-origin[k].y}}));
    }
    return frames;
  },{item:await saved(),first,second,angle,baseAngle});
  const first={face:0,uv:[1,0]},second={face:1,uv:[0,0]},pathMouse=await pairPath(first,second,90);
  await page.mouse.click(a.x,a.y);await page.mouse.move(b.x,b.y);await page.mouse.down();
  for(const frame of pathMouse)await page.mouse.move(b.x+frame[1].x,b.y+frame[1].y);
  await page.mouse.up();const opened=await saved();assert.ok(opened.faces.flat().some(p=>Math.abs(p[2])>.5));
  const fixed=opened.faces.flat().find(p=>p[3]===1&&p[4]===0);assert.ok(Math.abs(fixed[2])<1e-10,'鼠标固定角不得跟着移动');assert.deepEqual(opened.creases,fixture.creases);
  await page.click('#undo');assert.deepEqual(await saved(),JSON.parse(JSON.stringify(fixture)));
  const ca=await button(0,[1,0]),cb=await button(1,[0,0]);
  await page.mouse.click(ca.x,ca.y);await page.mouse.move(cb.x,cb.y);await page.mouse.down();
  for(const frame of pathMouse.slice(0,6))await page.mouse.move(cb.x+frame[1].x,cb.y+frame[1].y);
  await page.$eval('#cancelFold',e=>e.click());await page.mouse.up();assert.deepEqual(await saved(),JSON.parse(JSON.stringify(fixture)),'双角取消后迟到松手不得提交');
  await page.setViewport({width:390,height:844});
  const cdp=await page.createCDPSession();await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
  const ta=await button(0,[1,0]),tb=await button(1,[0,0]),pathTouch=await pairPath(first,second,100,50);
  const touch=async(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map((p,i)=>({x:p.x,y:p.y,id:i,radiusX:3,radiusY:3}))});
  await touch('touchStart',[ta]);await touch('touchStart',[ta,tb]);
  for(const frame of pathTouch)await touch('touchMove',[{x:ta.x+frame[0].x,y:ta.y+frame[0].y},{x:tb.x+frame[1].x,y:tb.y+frame[1].y}]);
  await touch('touchEnd',[]);const dual=await saved();
  assert.ok(dual.faces.every(f=>f.some(p=>Math.abs(p[2])>.2)),'双指对向拉开应使两侧均转动');assert.deepEqual(dual.creases,fixture.creases);
  await page.screenshot({path:'/tmp/aasc-gami-dual-touch.png'});
  await page.reload({waitUntil:'domcontentloaded'});await page.click('#resume');assert.deepEqual(await saved(),dual);
  assert.deepEqual(errors,[]);t.diagnostic('预折痕还原、取消、防迟到提交、模式刷新、鼠标选层固定及双指两侧转动通过');
});
