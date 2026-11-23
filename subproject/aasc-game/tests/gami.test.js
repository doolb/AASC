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
