/* One GPU draw for a repeating image; UV coordinates stay immutable. */
function makeSurfaceTexture(S,A){
  'use strict';
  let canvas=null,gl=null,ctx=null,program=null,buffer=null,texture=null,uniforms=null,lastSurface=null,lastMode=null,lastMaterial=null,lastFrame=null;
  const cpu=new WeakMap(),mod=(a,b)=>(a%b+b)%b;
  function initialize(){
    canvas=document.createElement('canvas');canvas.style.cssText='display:block;width:100%;height:100%;pointer-events:none';canvas.width=canvas.height=768;
    try{
      gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:false,antialias:false,preserveDrawingBuffer:true});if(!gl)throw Error('WebGL unavailable');
      const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
      const vertex=shader(gl.VERTEX_SHADER,'attribute vec2 a_position;attribute vec2 a_uv;varying vec2 v_uv;void main(){v_uv=a_uv;gl_Position=vec4(a_position,0.0,1.0);}'),fragment=shader(gl.FRAGMENT_SHADER,'precision highp float;varying vec2 v_uv;uniform sampler2D u_image;uniform vec2 u_repeat;uniform vec2 u_phase;void main(){gl_FragColor=texture2D(u_image,fract((v_uv-u_phase)/u_repeat));}');
      program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.deleteShader(vertex);gl.deleteShader(fragment);gl.useProgram(program);buffer=gl.createBuffer();texture=gl.createTexture();uniforms={repeat:gl.getUniformLocation(program,'u_repeat'),phase:gl.getUniformLocation(program,'u_phase')};gl.uniform1i(gl.getUniformLocation(program,'u_image'),0);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      for(const [name,offset]of [['a_position',0],['a_uv',8]]){const at=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,16,offset);}
      gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.clearColor(0,0,0,0);
    }catch{if(gl)gl.getExtension('WEBGL_lose_context')?.loseContext();gl=null;canvas=document.createElement('canvas');canvas.style.cssText='display:block;width:100%;height:100%;pointer-events:none';ctx=canvas.getContext('2d');}
  }
  let count=0;
  function paint(target,surface,analysis,mode,material,phase){
    if(!target||!material?.pixels)return false;if(!canvas)initialize();if(canvas.parentNode!==target)target.append(canvas);
    if(gl){
      if(surface!==lastSurface||mode!==lastMode){const layout=S.layout(surface),triangles=surface.uvRenderTriangles||surface.quads.flatMap(q=>[[0,1,2],[0,2,3]].map(t=>({v:t.map(i=>q.v[i]),uv:t.map(i=>q.uv[i])}))),data=new Float32Array(triangles.length*12);let cursor=0;for(const t of triangles)for(let i=0;i<3;i++){const p=mode==='uv'?layout.uvPositions[t.uv[i]]:layout.positions[t.v[i]],uv=surface.uv[t.uv[i]];data[cursor++]=p[0]/256-1;data[cursor++]=1-p[1]/256;data[cursor++]=uv[0];data[cursor++]=uv[1];}gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);count=triangles.length*3;}
      if(material!==lastMaterial){gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,material.width,material.height,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(material.pixels.buffer,material.pixels.byteOffset,material.pixels.byteLength));}
      const width=2*(surface.checker.uvCellSize??1),height=width*material.height/material.width,axis=surface.uvProjection.flowAxis??1;gl.uniform2f(uniforms.repeat,width,height);gl.uniform2f(uniforms.phase,axis===0?mod(phase,width):0,axis===1?mod(phase,height):0);gl.viewport(0,0,canvas.width,canvas.height);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,count);canvas.dataset.renderer='webgl';
    }else{
      let flow=cpu.get(surface);if(!flow){flow=A.create(surface,analysis,S.layout(surface),{resolution:40,fallback:false});cpu.set(surface,flow);}flow.advance(phase/(surface.checker.uvCellSize??1)-flow.phaseCells);const frame=flow.render(mode,material,256);if(canvas.width!==256)canvas.width=canvas.height=256;ctx.putImageData(new ImageData(frame.pixels,256,256),0,0);canvas.dataset.renderer='cpu';
    }
    lastSurface=surface;lastMode=mode;lastMaterial=material;lastFrame=canvas;return true;
  }
  function snapshot(surface,mode){return surface===lastSurface&&mode===lastMode&&lastFrame?lastFrame.toDataURL('image/png'):null;}
  return {paint,snapshot};
}
if(typeof module!=='undefined')module.exports=makeSurfaceTexture;
if(typeof window!=='undefined')window.makeSurfaceTexture=makeSurfaceTexture;
