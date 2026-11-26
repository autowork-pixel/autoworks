const main=document.querySelector('main');
if(main){
  const title=document.querySelector('h1')?.textContent?.trim()||document.title;
  const sections=[...main.querySelectorAll('section.card,section[id],div.card[id]')]
    .filter(el=>el.querySelector('h2') && !el.closest('form'))
    .filter(el=>!['accountData','inquiries','accountDeletion'].includes(el.id));
  const nav=document.createElement('nav');nav.className='report-nav';nav.setAttribute('aria-label','화면 바로가기');
  const label=document.createElement('strong');label.textContent='바로가기';nav.append(label);
  let n=0;
  for(const section of sections.slice(0,6)){
    if(!section.id)section.id='report-section-'+(++n);
    const heading=section.querySelector('h2');const link=document.createElement('a');
    link.href='#'+section.id;link.textContent=heading.textContent.trim().replace(/\s+/g,' ').slice(0,26);nav.append(link);
  }
  const resultSelectors=['#occupancyResults','#results','#result','#auditResults','#draft'];
  const resultNodes=resultSelectors.map(x=>main.querySelector(x)).filter(Boolean);
  if(resultNodes.length){
    const button=document.createElement('button');button.type='button';button.className='report-export';button.textContent='HTML 보고서 저장';nav.append(button);
    const visible=el=>!el.hidden && !el.closest('[hidden]') && !!(el.value||el.textContent).trim() && !el.querySelector('.empty') && !(el.id==='result'&&location.pathname.endsWith('/brand-search.html')&&document.querySelector('#runStatus')?.textContent?.includes('아직 실행하지'));
    const current=()=>resultNodes.find(visible);
    const update=()=>{button.disabled=!current();button.title=button.disabled?'결과를 먼저 조회하세요.':''};
    const observer=new MutationObserver(update);
    resultNodes.forEach(el=>observer.observe(el.tagName==='TEXTAREA'?el.parentElement:el,{subtree:true,childList:true,attributes:true,characterData:true}));update();
    button.addEventListener('click',()=>{
      const result=current();if(!result)return;
      let copy=result.tagName==='TEXTAREA'?document.createElement('pre'):result.cloneNode(true);
      if(result.tagName==='TEXTAREA')copy.textContent=result.value;
      if(location.pathname.endsWith('/brand-search.html')){
        copy=document.createElement('div');
        main.querySelectorAll('section.card').forEach(section=>copy.append(section.cloneNode(true)));
      }
      copy.querySelectorAll('script,button,input,select,textarea,form,iframe,object,embed,[contenteditable],.report-export').forEach(x=>x.remove());
      [copy,...copy.querySelectorAll('*')].forEach(el=>{for(const attr of [...el.attributes]){if(/^on/i.test(attr.name)||(['href','src'].includes(attr.name)&&/^\s*(?:javascript|data):/i.test(attr.value)))el.removeAttribute(attr.name)}el.removeAttribute('id')});
      const safeTitle=title.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const date=new Date().toLocaleDateString('ko-KR');
      const html='<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+safeTitle+' 보고서</title><style>body{font:16px/1.6 system-ui,"Malgun Gothic",sans-serif;color:#19343b;background:#f4f7f8;margin:0}main{max-width:1100px;margin:auto;padding:36px 22px 70px}header{border-bottom:3px solid #087f68;margin-bottom:24px;padding-bottom:16px}h1{font-size:30px;margin:0}h2{font-size:21px}p{line-height:1.6}.meta{color:#60757b;font-size:14px}.card,.metric,article{background:white;border:1px solid #dce8e8;border-radius:12px;padding:16px;margin:12px 0}.summary-grid,.metrics{display:flex;gap:12px;flex-wrap:wrap}.summary-grid>* , .metrics>*{flex:1;min-width:150px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #dce8e8;padding:9px;text-align:left}img,svg{max-width:100%}a{color:#087f68}@media print{body{background:white}main{padding:0}}</style></head><body><main><header><h1>'+safeTitle+'</h1><p class="meta">저장일 '+date+' · 오토웍스 화면에 표시된 결과</p></header>'+copy.outerHTML+'</main></body></html>';
      const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='autoworks-report-'+new Date().toISOString().slice(0,10)+'.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
  }
  const hero=main.querySelector('.hero')||main.querySelector('h1');
  hero?.insertAdjacentElement('afterend',nav);
}
