/* Independent sidebar scrolling and persistent section folding. */
(() => {
  'use strict';
  const key='contour-lab/sidebar-sections:v1',workspace=document.querySelector('.workspace'),panels=[...document.querySelectorAll('.left-panel,.right-panel')],sections=[];
  let saved={};try{const value=JSON.parse(localStorage.getItem(key));if(value&&typeof value==='object'&&!Array.isArray(value))saved=value;}catch{}
  const persist=()=>{try{localStorage.setItem(key,JSON.stringify(Object.fromEntries(sections.map(s=>[s.id,s.open()]))));}catch{}};
  for(const [panelIndex,panel] of panels.entries()){
    panel.setAttribute('aria-label',panelIndex?'轮廓与河流设置':'输入与分区设置');panel.setAttribute('tabindex','0');
    const controls=document.createElement('div');controls.className='sidebar-tools';
    for(const [text,open] of [['全部展开',true],['全部折叠',false]]){const button=document.createElement('button');button.type='button';button.textContent=text;button.addEventListener('click',()=>{for(const item of sections.filter(s=>s.panel===panel))item.set(open);persist();});controls.append(button);}panel.prepend(controls);
    let legacyIndex=0;
    for(const section of panel.querySelectorAll(':scope > section')){
      const heading=section.querySelector(':scope > .section-label');if(!heading)continue;
      const id=section.id||((panelIndex?'right':'left')+'-'+legacyIndex++),button=document.createElement('button');button.className='section-toggle';button.type='button';
      // Keep actions such as “默认” separate from the folding button.
      for(const node of [...heading.childNodes])if(!(node.nodeType===1&&node.matches('button')))button.append(node);heading.prepend(button);section.classList.add('sidebar-section');
      const item={id,panel,open:()=>button.getAttribute('aria-expanded')==='true',set:open=>{button.setAttribute('aria-expanded',String(open));section.classList.toggle('is-collapsed',!open);}};
      item.set(saved[id]!==false);button.addEventListener('click',()=>{item.set(!item.open());persist();});sections.push(item);
    }
    for(const [index,details] of [...panel.querySelectorAll(':scope > details')].entries()){
      const id=(panelIndex?'right':'left')+'-details-'+index;if(typeof saved[id]==='boolean')details.open=saved[id];sections.push({id,panel,open:()=>details.open,set:open=>{details.open=open;}});details.addEventListener('toggle',persist);
    }
  }
  let frame=null;
  const measure=()=>{frame=null;document.documentElement.style.setProperty('--sidebar-offset',Math.max(16,workspace.getBoundingClientRect().top)+'px');};
  const schedule=()=>{if(frame===null)frame=requestAnimationFrame(measure);};
  window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,{passive:true});
  const observer=new ResizeObserver(schedule);for(const node of document.querySelectorAll('header,.intro'))observer.observe(node);document.fonts?.ready.then(schedule);measure();
})();
