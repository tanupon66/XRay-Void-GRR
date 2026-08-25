(() => {
'use strict';
const $=id=>document.getElementById(id);
function showView(name){
  const analysis=$('analysisView'),optimizer=$('optimizerView');
  if(!analysis||!optimizer)return;
  const isOpt=name==='optimizer';
  analysis.classList.toggle('hidden',isOpt);optimizer.classList.toggle('hidden',!isOpt);
  document.querySelectorAll('.nav-tab').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  if(isOpt)setTimeout(()=>{refreshStudyUI();updateOptimizerMeaning()},0);
  window.scrollTo({top:0,behavior:'smooth'});
}
function modeInfo(){
  const pinMode=$('partMode')?.value!=='component';
  return pinMode?{noun:'pin',plural:'pins',label:'Filtered unique pins',detail:'same Component + Pin across boards counts once'}:{noun:'component',plural:'components',label:'Filtered unique components',detail:'same Component across boards counts once'};
}
function applyTableLimit(){
  const body=$('pinTable');if(!body)return;
  const rows=[...body.querySelectorAll('tr')],limit=Math.max(1,+($('tableLimit')?.value||50));
  let shown=0;rows.forEach((tr,i)=>{const ok=i<limit;tr.style.display=ok?'':'none';if(ok)shown++});
  const x=$('tableShown');if(x)x.textContent=`Showing ${shown.toLocaleString()} of ${rows.length.toLocaleString()} loaded rows`;
}
function updateAnalysisSummary(){
  const app=window.XGRRApp,state=app?.getState?.(),a=state?.analysis;if(!a)return;
  const m=modeInfo(),passed=a.selectedByFilter?.length??a.quality?.filteredParts??0,measured=a.selected?.length??a.quality?.partsWithMeasurement??0,obs=a.rows?.length??0;
  const stat=$('statParts'),label=$('statPartsLabel'),detail=$('statPartsDetail');
  if(stat)stat.textContent=passed.toLocaleString();if(label)label.textContent=m.label;if(detail)detail.textContent=`${measured.toLocaleString()} with measurement data · ${m.detail}`;
  const fs=$('filterCountSummary');if(fs)fs.innerHTML=`<b>${passed.toLocaleString()} unique ${m.plural}</b> passed the filter · ${measured.toLocaleString()} have the selected measurement · ${obs.toLocaleString()} measurement rows retained`;
  const st=$('stabilityTitle');if(st)st.textContent=`Most unstable selected ${m.plural}`;
  const ss=$('stabilitySummary');if(ss)ss.textContent=`${(a.summary?.length||0).toLocaleString()} ${m.plural} with measurement data · sorted by Range`;
  const qp=$('qualityPanel');if(qp){
    qp.querySelectorAll('.quality-item span').forEach(s=>{
      if(s.textContent==='Parts passing filter')s.textContent=`Unique ${m.plural} passing filter`;
      if(s.textContent==='Parts with measurement data')s.textContent=`${m.plural[0].toUpperCase()+m.plural.slice(1)} with measurement data`;
      if(s.textContent==='Common parts on every machine')s.textContent=`Common ${m.plural} on every machine`;
    });
  }
  applyTableLimit();
}
function studyName(mode){return mode==='repeatability'?'Same-board repeatability · one machine':mode==='process'?'Different boards · production process variation':'Crossed GR&R · multiple machines'}
function refreshStudyUI(){
  const mode=window.XGRRStudy?.effectiveMode?.();if(!mode)return;
  const intro=document.querySelector('#optimizerView .tool-intro p');
  if(intro)intro.innerHTML=`<b>Study mode: ${studyName(mode)}.</b> The optimizer uses the Measurement and Filter rules configured in Analysis and returns the lowest variation score it can calculate in the selected threshold range.`;
  const hint=document.querySelector('#grrOptimizer .hint.strong');
  if(hint){
    const base=mode==='repeatability'?'<b>Same-board Repeatability:</b> PCB IDs are treated as repeated inspections of the same physical board. Only one machine is required. The optimizer finds the threshold with the lowest repeatability variation.':mode==='process'?'<b>Production Process:</b> each PCB ID is treated as a different physical board. The optimizer finds the threshold with the lowest board/process variation.':'<b>Crossed GR&R:</b> use this mode when the same pins are repeatedly measured by two or more machines.';
    hint.innerHTML=`${base}<br><br><b>Search range matters:</b> the optimizer can only choose thresholds between <i>Search from</i> and <i>Search to</i>. If Max Void must start at 10%, set <b>Search from = 10</b>.`;
  }
  const minLabel=$('optMinParts')?.previousElementSibling;if(minLabel)minLabel.textContent='Preferred common/repeated pins (0 = off)';
  if($('optimizeBtn'))$('optimizeBtn').textContent='Find lowest available variation';
  updateOptimizerMeaning();
}
function injectResponsiveFixes(){
  if($('mobileOptimizerFix'))return;
  const s=document.createElement('style');s.id='mobileOptimizerFix';s.textContent=`
    html,body{max-width:100%;overflow-x:hidden}
    .shell,.tool-view,.panel,#optimizerOutput,.opt-table-wrap,.opt-actions{min-width:0;max-width:100%}
    .optimizer-panel{min-width:0;overflow:hidden}
    .opt-table-wrap{width:100%;max-width:100%;overscroll-behavior-x:contain}
    .opt-actions{flex-wrap:wrap;max-width:100%}
    .opt-actions>button{min-width:0;max-width:100%;white-space:normal;overflow-wrap:anywhere}
    .opt-note,.opt-warning,.optimizer-meaning,.tool-intro p{overflow-wrap:anywhere;word-break:normal}
    .optimizer-meaning{margin:12px 0;padding:13px 14px;border-radius:12px;border:1px solid #315477;background:#0b1b2d;color:#b7c9dc;font-size:12px;line-height:1.55}
    .optimizer-meaning b{color:#eef5ff}.optimizer-meaning .meaning-status{font-size:15px;display:block;margin-bottom:5px}
    .optimizer-meaning.good{border-color:rgba(86,216,155,.38);background:rgba(86,216,155,.07)}
    .optimizer-meaning.warn{border-color:rgba(246,198,91,.38);background:rgba(246,198,91,.07)}
    .optimizer-meaning.bad{border-color:rgba(255,123,136,.38);background:rgba(255,123,136,.07)}
    @media(max-width:720px){
      .tool-view,.optimizer-panel,#optimizerOutput{width:100%;max-width:100%;min-width:0}
      .opt-table-wrap{overflow:visible;border:0;background:transparent}
      .opt-table,.opt-table tbody{display:block;width:100%;min-width:0}
      .opt-table thead{display:none}
      .opt-table tbody{display:grid;gap:10px}
      .opt-table tr{display:block;width:100%;border:1px solid #22344f;border-radius:12px;overflow:hidden;background:#091523}
      .opt-table tr.best{border-color:#4b91ff;box-shadow:inset 0 0 0 1px rgba(75,145,255,.16)}
      .opt-table td{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;width:100%;padding:9px 11px;white-space:normal;text-align:right;overflow-wrap:anywhere}
      .opt-table td::before{color:#8297af;text-align:left;font-weight:700;flex:0 0 46%}
      .opt-table td:nth-child(1)::before{content:'Rank'}
      .opt-table td:nth-child(2)::before{content:'Threshold'}
      .opt-table td:nth-child(3)::before{content:'Variation'}
      .opt-table td:nth-child(4)::before{content:'Common / repeated pins'}
      .opt-table td:nth-child(5)::before{content:'Measurements'}
      .opt-table td:nth-child(6)::before{content:'Machines'}
      .opt-table td:nth-child(7)::before{content:'Boards'}
      .opt-table td:nth-child(8)::before{content:'Repeats'}
      .opt-actions{display:grid!important;grid-template-columns:1fr!important;gap:9px!important;width:100%}
      .opt-actions>button{display:block;width:100%!important;white-space:normal!important;line-height:1.25;padding:12px 10px}
    }
  `;document.head.appendChild(s);
}
function objectiveInfo(){
  const mode=window.XGRRStudy?.effectiveMode?.()||'crossed';
  return mode==='repeatability'?{name:'Repeatability %Study Variation',short:'repeatability',isPercent:true}:mode==='process'?{name:'Process CV',short:'process variation',isPercent:true}:{name:'GR&R %Study Variation',short:'GR&R',isPercent:true};
}
function updateOptimizerMeaning(){
  const out=$('optimizerOutput'),bestEl=$('optBestValue'),scoreEl=$('optBestGRR');if(!out||!bestEl||!scoreEl)return;
  const score=parseFloat(String(scoreEl.textContent||'').replace(',','.'));if(!Number.isFinite(score))return;
  let card=out.querySelector('.optimizer-meaning');if(!card){card=document.createElement('div');card.className='optimizer-meaning';out.insertBefore(card,out.firstChild)}
  const info=objectiveInfo(),common=$('optBestParts')?.textContent||'—',ndc=$('optBestNdc')?.textContent||'—',best=bestEl.textContent||'—';
  const from=+$('optFrom')?.value,to=+$('optTo')?.value,step=Math.abs(+$('optStep')?.value||0),m=String(best).match(/-?\d+(?:\.\d+)?/),t=m?+m[0]:NaN,lo=Math.min(from,to),atLower=Number.isFinite(t)&&Number.isFinite(lo)&&Math.abs(t-lo)<=Math.max(step/2,1e-9);
  const cls=score<10?'good':score<=30?'warn':'bad',status=score<10?'Low variation':score<=30?'Review / moderate variation':'High variation';
  card.className=`optimizer-meaning ${cls}`;
  let boundary='';if(atLower)boundary=`<br><br><b>Boundary result:</b> the best threshold is at the start of your search range (${lo}). This does not mean the target must be below 1%; it means no higher threshold in this scan produced a lower ${info.short}. ${lo<10?'If your practical minimum Max Void is 10%, rerun with <b>Search from = 10</b>.':''}`;
  const mode=window.XGRRStudy?.effectiveMode?.()||'crossed';
  const ndcText=mode==='process'?'':` · ndc ${ndc}`;
  const html=`<span class="meaning-status"><b>${status}</b></span><b>${info.name}:</b> ${score.toFixed(2)}% · <b>Threshold:</b> ${best}<br><b>Coverage:</b> ${common} unique common/repeated pins${ndcText}.${mode==='repeatability'?'<br>This is repeatability for one machine, not full multi-machine GR&R.':''}${boundary}`;
  if(card.innerHTML!==html)card.innerHTML=html;
}
function loadStudyMode(){
  if(window.XGRRStudy){refreshStudyUI();return}
  const s=document.createElement('script');s.src='study-mode.js';s.onload=()=>{
    refreshStudyUI();
    ['studyMode','studyMachine','boardInterpretation'].forEach(id=>$(id)?.addEventListener('change',()=>setTimeout(()=>{refreshStudyUI();updateOptimizerMeaning()},0)));
  };s.onerror=()=>console.error('Failed to load study-mode.js');document.body.appendChild(s);
}
function init(){
  injectResponsiveFixes();
  document.querySelectorAll('.nav-tab').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
  $('backToAnalysis')?.addEventListener('click',()=>showView('analysis'));
  $('exportTopBtn')?.addEventListener('click',()=>$('exportBtn')?.click());
  $('toggleStability')?.addEventListener('click',()=>{
    const body=$('stabilityBody'),btn=$('toggleStability');if(!body||!btn)return;
    const opening=body.classList.contains('hidden');body.classList.toggle('hidden');btn.textContent=opening?'Hide table':'Show table';if(opening)applyTableLimit();
  });
  $('tableLimit')?.addEventListener('change',applyTableLimit);
  $('tableSearch')?.addEventListener('input',()=>setTimeout(applyTableLimit,0));
  const results=$('results');if(results)new MutationObserver(()=>{if(!results.classList.contains('hidden'))setTimeout(updateAnalysisSummary,0)}).observe(results,{attributes:true,attributeFilter:['class']});
  const pinTable=$('pinTable');if(pinTable)new MutationObserver(()=>applyTableLimit()).observe(pinTable,{childList:true});
  const optOut=$('optimizerOutput');if(optOut)new MutationObserver(()=>requestAnimationFrame(updateOptimizerMeaning)).observe(optOut,{childList:true,subtree:true});
  ['optFrom','optTo','optStep','optDirection'].forEach(id=>$(id)?.addEventListener('change',()=>setTimeout(updateOptimizerMeaning,0)));
  $('partMode')?.addEventListener('change',()=>setTimeout(updateAnalysisSummary,0));
  showView('analysis');loadStudyMode();
}
window.XGRRUI={showView,updateAnalysisSummary,applyTableLimit,refreshStudyUI,updateOptimizerMeaning};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();