// 音符按音频时钟提前排程。纸声共享噪声缓冲，快速拖动时限制触发频率。
let ctx,noise,next=0,step=0,last=0;
export const sound={music:localStorage.getItem('gami.music')!=='off',sfx:localStorage.getItem('gami.sfx')!=='off'};
function tone(t,f,d,gain,type){
  const o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.value=f;
  g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(gain,t+.015);
  g.gain.exponentialRampToValueAtTime(.0001,t+d);o.connect(g).connect(ctx.destination);o.start(t);o.stop(t+d);
}
export function unlock(){
  if(!ctx){
    ctx=new AudioContext();noise=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate);
    const data=noise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
    setInterval(()=>{
      if(!sound.music||document.hidden||ctx.state!=='running')return;
      if(next<ctx.currentTime)next=ctx.currentTime+.05;
      if(next>ctx.currentTime+.15)return;
      const root=[50,55,52,57][Math.floor(step/8)%4];
      if(step%8===0)for(const n of [0,4,7])tone(next,440*2**((root+n-69)/12),3,.012,'sine');
      const n=[12,19,16,14,19,24,16,19][step%8];
      tone(next,440*2**((root+n-69)/12),1.2,.035,'sine');next+=.52;step++;
    },90);
    document.addEventListener('visibilitychange',()=>document.hidden?ctx.suspend():ctx.resume());
  }
  ctx.resume();
}
export function paperSound(kind){
  if(!ctx||!sound.sfx)return;const t=ctx.currentTime;
  if(kind==='drag'&&t-last<.13)return;last=t;
  const s=ctx.createBufferSource(),f=ctx.createBiquadFilter(),g=ctx.createGain();s.buffer=noise;
  f.type='bandpass';f.frequency.value=kind==='cut'?4300:1850;
  g.gain.setValueAtTime(kind==='drag'?.04:.15,t);g.gain.exponentialRampToValueAtTime(.0001,t+.19);
  s.connect(f).connect(g).connect(ctx.destination);s.start(t);s.stop(t+.2);
  if(kind==='place')tone(t,120,.18,.12,'triangle');
}
