(() => {
'use strict';
const $=id=>document.getElementById(id);
function showView(name){
  const analysis=$('analysisView'),optimizer=$('optimizerView');
  if(!analysis||!optimizer)return;
  const isOpt=name==='optimizer';
  analysis.classList.toggle('hidden',isOpt);optimizer.classList.toggle('hidden',!isOpt);
  document.querySelectorAll('.nav-tab').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
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
function init(){
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
  $('partMode')?.addEventListener('change',()=>setTimeout(updateAnalysisSummary,0));
  showView('analysis');
}
window.XGRRUI={showView,updateAnalysisSummary,applyTableLimit};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();