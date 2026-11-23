const test=require('node:test'),assert=require('node:assert/strict');
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
  const {layerDisplacements}=await import('../web/gami/paper-topology.mjs');
  const {resizedPaper,faceCollision}=await import('../web/gami/paper-contact.mjs');
  const item={faces:fold(sheet(),[[-1,0]],[1,0],180),thickness:.008};
  item.layers=layerDisplacements(item.faces,item.thickness);
  const original=JSON.stringify(item);
  for(const thickness of [.002,.008,.02]){
    const next=resizedPaper(item,thickness);assert.equal(next.thickness,thickness);
    assert.ok(Math.abs(Math.hypot(...next.layers[1])-thickness)<1e-8);
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

test('浏览器厚度设置、手工角点吸附、松手保持、刷新、继续调整、压平与撤销', {timeout:480000}, async(t)=>{
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
  const browser=await puppeteer.launch({executablePath:chromium,headless:false,timeout:15000,env:{...process.env,DISPLAY:display,XAUTHORITY:xauth},args:['--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--no-proxy-server']});
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
  await numberThickness(.5);const persisted=await saved();assert.equal(persisted.thickness,.01);
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
  await page.click('#close');await (await page.$('#file')).uploadFile(exportFile);
  await page.waitForSelector('#confirmImport');await page.click('#confirmImport');
  assert.deepEqual(await saved(),persisted);assert.equal(await page.$eval('#thicknessValue',e=>e.value),'0.5');
  assert.deepEqual(errors,[]);
});
