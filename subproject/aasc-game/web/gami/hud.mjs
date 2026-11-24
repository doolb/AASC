const $=id=>document.getElementById(id);
// 界面只映射已有动作，纸形和存档仍由应用层持有。
export function initHUD(refresh){
  const toggle=$('settingsToggle'),panel=$('settingsPanel');
  const settings=open=>{panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));refresh();if(open)$('settingsClose').focus()};
  toggle.onclick=()=>settings(panel.hidden);
  $('settingsClose').onclick=()=>{settings(false);toggle.focus()};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){e.preventDefault();settings(false);toggle.focus()}});
  $('view').addEventListener('pointerdown',()=>{if(!panel.hidden)settings(false)},true);
  document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{
    const select=$('foldMode');if(select.disabled)return;
    select.value=button.dataset.mode;select.dispatchEvent(new Event('change',{bubbles:true}));
  });
  return {close(){settings(false)}};
}
export function syncHUD({tool,busy,held}){
  document.querySelectorAll('[data-mode]').forEach(button=>{
    button.disabled=$('foldMode').disabled;button.setAttribute('aria-pressed',String(button.dataset.mode===$('foldMode').value));
  });
  $('actionTray').hidden=!Array.from($('actionTray').children).some(el=>!el.hidden);
  $('studio').classList.toggle('dragging',busy);
  $('panel').dataset.activeTool=tool;
  $('settingsToggle').disabled=busy;
  $('paperTools').hidden=$('studio').hidden;
  $('hint').dataset.state=held?'held':busy?'active':'idle';
}
// 只读取可见 HUD 的真实边界。折叠设置、横竖屏及状态按钮变化自动参与避让。
export function hudRects(){
  return Array.from(document.querySelectorAll('[data-hud],#settingsToggle')).map(el=>el.getBoundingClientRect()).filter(r=>r.width&&r.height);
}
export function freeHandlePosition(point,occupied,rects,width,height){
  const margin=26,step=48,clamp=(v,max)=>Math.max(margin,Math.min(max-margin,v));
  const origin={x:clamp(point.x,width),y:clamp(point.y,height)};
  const free=p=>!rects.some(r=>p.x>r.left-margin&&p.x<r.right+margin&&p.y>r.top-margin&&p.y<r.bottom+margin)&&!occupied.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<step);
  if(free(origin))return origin;
  const candidates=[];
  for(let y=margin;y<=height-margin;y+=step)for(let x=margin;x<=width-margin;x+=step){const p={x,y};if(free(p))candidates.push(p)}
  candidates.sort((a,b)=>Math.hypot(a.x-origin.x,a.y-origin.y)-Math.hypot(b.x-origin.x,b.y-origin.y));
  return candidates[0]||null;
}
