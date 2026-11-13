/* Input-only SVG/JSON codec. Preserves raster pixels for lossless sharing. */
function makeContourInput(E){
  'use strict';
  const GRID=512,MAX_SIZE=4096;
  function dimensions(data){const w=data.width??GRID,h=data.height??GRID;if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>MAX_SIZE||h>MAX_SIZE)throw Error('轮廓尺寸必须是1～4096之间的整数。');return [w,h];}
  function pack(mask,width=GRID,height=GRID,metadata={}){
    dimensions({width,height});if(!mask||mask.length!==width*height||!mask.some(Boolean))throw Error('请先画出或载入轮廓。');
    const runs=[];let last=mask[0],length=0;for(const v of mask){if(v!==0&&v!==1)throw Error('填充数据只能为0或1。');if(v===last)length++;else{runs.push(length);length=1;last=v;}}runs.push(length);
    const info=E.maskInfo(mask,width,height);
    return {schema:'contour-lab/input',version:1,engineVersion:metadata.engineVersion??16,width,height,name:metadata.name||'输入轮廓',selectedLevel:metadata.selectedLevel||'near',options:metadata.options||{},holes:info.holes,maskRLE:{start:mask[0],runs}};
  }
  function pathData(mask,width=GRID,height=GRID){return E.maskInfo(mask,width,height).loops.map(r=>'M '+r.map(p=>p.join(' ')).join(' L ')+' Z').join(' ');}
  function fingerprint(path){const tokens=path.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)||[],canonical=tokens.map(t=>Number.isFinite(Number(t))?String(Number(t)):t).join(' ');let hash=2166136261;for(let i=0;i<canonical.length;i++){hash^=canonical.charCodeAt(i);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(16);}
  function svg(mask,width=GRID,height=GRID,metadata={}){const data=pack(mask,width,height,metadata),escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),d=pathData(mask,width,height);data.vectorSignature=fingerprint(d);return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><metadata>${escape(JSON.stringify(data))}</metadata><rect width="${width}" height="${height}" fill="white"/><path d="${d}" fill="black" fill-rule="evenodd"/></svg>`;}
  function restore(input){
    let data=input;if(Array.isArray(data))data={loops:typeof data[0]?.[0]==='number'?[data]:data};if(!data||typeof data!=='object')throw Error('不是有效的轮廓JSON。');if(data.schema==='contour-lab/input'&&data.version!==1)throw Error('不支持此轮廓数据版本。');const [w,h]=dimensions(data);let mask;
    if(data.maskRLE){const {start,runs}=data.maskRLE;if(![0,1].includes(start)||!Array.isArray(runs)||!runs.length||runs.some(n=>!Number.isInteger(n)||n<1)||runs.reduce((a,n)=>a+n,0)!==w*h)throw Error('轮廓填充数据损坏，像素数量不匹配。');mask=new Uint8Array(w*h);let offset=0,value=start;for(const n of runs){mask.fill(value,offset,offset+n);offset+=n;value^=1;}}
    else if(Array.isArray(data.mask)){if(data.mask.length!==w*h||data.mask.some(v=>v!==0&&v!==1&&v!==false&&v!==true))throw Error('轮廓像素数据无效。');mask=Uint8Array.from(data.mask,Number);}
    else{const loops=data.originalLoops||data.sourceLoops||data.loops||(data.original?[data.original]:null);if(!Array.isArray(loops)||!loops.length||loops.some(r=>!Array.isArray(r)||r.length<3||r.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))))throw Error('JSON缺少有效的原始轮廓点。');mask=E.rasterizeLoops(loops,w,h);}
    if(w!==GRID||h!==GRID){const scaled=new Uint8Array(GRID*GRID),scale=Math.min(GRID/w,GRID/h),iw=Math.max(1,Math.round(w*scale)),ih=Math.max(1,Math.round(h*scale)),ox=Math.floor((GRID-iw)/2),oy=Math.floor((GRID-ih)/2);for(let y=0;y<ih;y++)for(let x=0;x<iw;x++){const sx=Math.min(w-1,Math.floor((x+.5)/scale)),sy=Math.min(h-1,Math.floor((y+.5)/scale));scaled[(y+oy)*GRID+x+ox]=mask[sy*w+sx];}mask=scaled;}
    if(!mask.some(Boolean))throw Error('导入后没有可用的填充区域。');return {mask,name:typeof data.name==='string'?data.name:typeof data.sourceName==='string'?data.sourceName:'',options:data.options??null,selectedLevel:data.selectedLevel,resized:w!==GRID||h!==GRID};
  }
  function imageMask(data,width,height,{mode='alpha',threshold=mode==='alpha'?127:48,bounds=[0,0,width,height]}={}){
    dimensions({width,height});if(data.length!==width*height*4)throw Error('图片像素尺寸不匹配。');if(!['alpha','wireframe'].includes(mode))throw Error('未知的图片处理模式。');
    threshold=Number(threshold);if(!Number.isFinite(threshold)||threshold<1||threshold>254)throw Error('图片阈值应为1～254。');
    const [x0,y0,x1,y1]=bounds.map((v,i)=>Math.max(0,Math.min(i%2?height:width,Math.round(v)))),mask=new Uint8Array(width*height),luma=i=>.2126*data[i*4]+.7152*data[i*4+1]+.0722*data[i*4+2];
    if(mode==='alpha'){for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=y*width+x;mask[i]=data[i*4+3]>threshold?1:0;}if(!mask.some(Boolean))throw Error('没有达到透明度阈值的区域。');return {mask,audit:{mode,threshold,pixels:mask.reduce((n,v)=>n+v,0)}};}
    const border=[];let transparent=0,total=0;
    function probe(x,y){const i=y*width+x;total++;if(data[i*4+3]<=127)transparent++;else border.push(luma(i));}
    for(let x=x0;x<x1;x++){probe(x,y0);probe(x,y1-1);}for(let y=y0+1;y<y1-1;y++){probe(x0,y);probe(x1-1,y);}border.sort((a,b)=>a-b);const alphaInk=transparent/Math.max(1,total)>.7,background=border[Math.floor(border.length/2)]??255;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=y*width+x;mask[i]=data[i*4+3]>127&&(alphaInk||Math.abs(luma(i)-background)>=threshold)?1:0;}
    // Close isolated one-pixel gaps before an exterior background flood fill.
    const dilated=new Uint8Array(mask.length),closed=new Uint8Array(mask.length);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){let value=0;for(let j=-1;j<=1&&!value;j++)for(let k=-1;k<=1;k++)if(x+k>=0&&x+k<width&&y+j>=0&&y+j<height&&mask[(y+j)*width+x+k]){value=1;break;}dilated[y*width+x]=value;}
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){let value=1;for(let j=-1;j<=1&&value;j++)for(let k=-1;k<=1;k++)if(x+k<0||x+k>=width||y+j<0||y+j>=height||!dilated[(y+j)*width+x+k]){value=0;break;}closed[y*width+x]=mask[y*width+x]||value;}
    const outside=new Uint8Array(mask.length),queue=new Int32Array(mask.length);let head=0,tail=0;const put=i=>{if(!closed[i]&&!outside[i]){outside[i]=1;queue[tail++]=i;}};
    for(let x=0;x<width;x++){put(x);put((height-1)*width+x);}for(let y=0;y<height;y++){put(y*width);put(y*width+width-1);}
    while(head<tail){const i=queue[head++],x=i%width,y=Math.floor(i/width);if(x)put(i-1);if(x+1<width)put(i+1);if(y)put(i-width);if(y+1<height)put(i+width);}
    let enclosed=0;for(let i=0;i<mask.length;i++){if(!outside[i]&&!closed[i])enclosed++;mask[i]=outside[i]?0:1;}
    if(enclosed<4)throw Error('未找到闭合区域，请闭合外轮廓或调整线条阈值。');
    return {mask,audit:{mode,threshold,background,alphaInk,enclosedPixels:enclosed,pixels:mask.reduce((n,v)=>n+v,0),internalGridIgnored:true,smallGapClosing:1}};
  }
  return {imageMask,pack,svg,restore,pathData,fingerprint};
}
if(typeof module!=='undefined')module.exports=makeContourInput;
if(typeof window!=='undefined')window.makeContourInput=makeContourInput;
