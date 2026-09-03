(() => {
'use strict';
const C=window.XGRRCore,$=id=>document.getElementById(id),A=()=>window.XGRRApp;
let lastResult=null;
const fmt=(v,d=3)=>Number.isFinite(+v)?(+v).toFixed(d):'—';
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
const nap=(n=0)=>new Promise(r=>setTimeout(r,n));
function resetOutput(){lastResult=null;['optBestValue','optBestGRR','optBestParts','optBestNdc'].forEach(id=>{if($(id))$(id).textContent='—'});if($('optimizerOutput'))$('optimizerOutput').innerHTML=''}
function selectedRuleIndex(){return Math.max(0,Math.floor(+$('optRule').value||0))}
function effectiveMode(){return window.XGRRStudy?.effectiveMode?.()||(([...new Set((A()?.getState?.()?.files||[]).map(f=>f.machine))].length>=2)?'crossed':'repeatability')}
function machineOf(s,S){return S.files.find(f=>f.id===s.fileId)?.machine||'Unknown'}
function boardOf(s){return String(s.pcbId||s.pcbNo||s.fileName||`file-${s.fileId}`)}
function installScopeControl(){
  if($('optScope'))return;
  const rule=$('optRule'),grid=rule?.closest('.opt-grid');if(!rule||!grid)return;
  const label=document.createElement('label');label.className='field wide';label.innerHTML=`<span>Optimizer data scope</span><select id="optScope"><option value="all">All imported eligible data (recommended)</option><option value="respect">Respect other Analysis filters</option></select><small style="color:#7f94ad;line-height:1.4">All imported eligible data ignores every other filter while scanning the selected rule. Study mode still applies: Repeatability/Process uses the selected machine; Crossed GR&R uses all machines.</small>`;
  rule.closest('label')?.after(label);
  $('optScope')?.addEventListener('change',resetOutput);
}
function makePrepared(){
  const app=A(),S=app?.getState(),rules=app?.getCurrentRules()||[],measurementMetric=app?.getMeasurementMetric();
  if(!app||!S?.samples?.length||!rules.length||!measurementMetric)throw new Error('Import data and configure measurement/filter rules first.');
  const idx=selectedRuleIndex();if(idx>=rules.length)throw new Error('Selected optimizer rule no longer exists.');
  const mode=effectiveMode(),target=$('studyMachine')?.value||S.files[0]?.machine||'Unknown',scope=$('optScope')?.value||'all',eligible=s=>mode==='crossed'||machineOf(s,S)===target,byPart=new Map();
  let eligibleSamples=0,eligibleFilterValues=0,eligibleMeasurementRows=0;const eligibleMachines=new Set(),eligibleBoards=new Set();
  for(const s of S.samples){
    if(!eligible(s))continue;
    eligibleSamples++;eligibleMachines.add(machineOf(s,S));eligibleBoards.add(boardOf(s));
    const p=app.getPartId(s);let d=byPart.get(p);if(!d){d={part:p,samples:[],rows:[]};byPart.set(p,d)}
    const values=rules.map(r=>s.metrics[r.metric]);d.samples.push(values);
    if(Number.isFinite(values[idx]))eligibleFilterValues++;
    const mv=s.metrics[measurementMetric];
    if(Number.isFinite(mv)){eligibleMeasurementRows++;d.rows.push({part:p,machine:machineOf(s,S),board:boardOf(s),value:mv})}
  }
  return {app,S,rules,measurementMetric,ruleIndex:idx,byPart,mode,target,scope,audit:{importedSamples:S.samples.length,eligibleSamples,eligibleFilterValues,eligibleMeasurementRows,eligibleParts:byPart.size,eligibleMachines:[...eligibleMachines],eligibleBoards:[...eligibleBoards]}};
}
function partHits(d,rules,idx,direction,t,scope){
  if(scope==='all'){
    const r=rules[idx];
    for(const values of d.samples)if(C.compare(values[idx],direction,t,r.b))return true;
    return false;
  }
  for(const values of d.samples){
    const hits=rules.map((r,i)=>i===idx?C.compare(values[i],direction,t,r.b):C.compare(values[i],r.op,r.a,r.b));
    const join=$('ruleJoin')?.value||'ALL';
    if(join==='ALL'?hits.every(Boolean):hits.some(Boolean))return true;
  }
  return false;
}
function evaluate(prep,rows,selected,preferredParts,t){
  let g,commonParts=selected.length,repeats=0,machines=[...new Set(rows.map(r=>r.machine))].length,boards=[...new Set(rows.map(r=>r.board))].length,balancedRows=rows.length;
  if(prep.mode==='crossed'){
    const b=prep.app.balanced(rows);commonParts=b.common.length;repeats=b.min;machines=b.machines.length;balancedRows=b.rows.length;
    g=C.calculateCrossedANOVA(b.rows.map(r=>({part:r.part,machine:r.machine,value:r.value})),{alpha:0.05});
  }else if(prep.mode==='process'){
    g=C.calculateProcessVariation(rows);commonParts=g.ok?g.commonParts:selected.length;boards=g.ok?g.boards:boards;repeats=1;
  }else{
    g=C.calculateSingleMachineRepeatability(rows);commonParts=g.ok?g.parts:selected.length;repeats=g.ok?g.repeatsMin:0;machines=1;
  }
  const objective=g?.ok?g.pctContribution:NaN;
  return {threshold:t,valid:!!g?.ok&&Number.isFinite(objective),recommended:preferredParts===0||commonParts>=preferredParts,selectedParts:selected.length,commonParts,measurements:rows.length,machines,boards,repeats,balancedRows,objective,pctStudyVariation:g?.ok?g.pctStudyVariation:NaN,g};
}
async function scan(prep,from,to,step,direction,preferredParts){
  const lo=Math.min(from,to),hi=Math.max(from,to),count=Math.floor((hi-lo)/step+1+1e-9);
  if(count>10000)throw new Error(`This scan would test ${count.toLocaleString()} thresholds. Use a larger Step or a smaller range (maximum 10,000 points).`);
  const thresholds=[];for(let i=0;i<count;i++)thresholds.push(+(lo+i*step).toFixed(10));if(thresholds[thresholds.length-1]<hi-step*1e-8)thresholds.push(+hi.toFixed(10));
  const results=[],allParts=[...prep.byPart.values()],refreshEvery=Math.max(1,Math.floor(thresholds.length/100));
  for(let i=0;i<thresholds.length;i++){
    const t=thresholds[i],selected=[];
    for(const d of allParts)if(partHits(d,prep.rules,prep.ruleIndex,direction,t,prep.scope)&&d.rows.length)selected.push(d);
    const rows=selected.flatMap(d=>d.rows),base=evaluate(prep,rows,selected,preferredParts,t);results.push(base);
    if(i%refreshEvery===0||i===thresholds.length-1){prep.app.progress('Study Optimizer',`Testing threshold ${i+1} / ${thresholds.length}`,12+80*(i+1)/thresholds.length,`${direction} ${fmt(t,4)} · minimizing %Contribution`);await nap(0)}
  }
  return results;
}
function labels(mode){
  if(mode==='repeatability')return {name:'Repeatability %Contribution (of VarComp)',short:'%Contribution',noun:'repeated pins'};
  if(mode==='process')return {name:'Process %Contribution (of VarComp)',short:'%Contribution',noun:'common production pins'};
  return {name:'Total Gage R&R %Contribution (of VarComp)',short:'%Contribution',noun:'common pins'};
}
function contributionInterpretation(mode,pct){
  if(mode==='process')return `Process variance contribution = ${fmt(pct,2)}%. This is a process-consistency metric, not an AIAG Gage R&R pass/fail result.`;
  const c=C.varianceContributionClass(pct);
  if(mode==='repeatability')return `Repeatability contribution = ${fmt(pct,2)}% → ${c.label}. This is the repeatability component only; Full Total Gage R&R also needs reproducibility from multiple machines.`;
  return `Total Gage R&R contribution = ${fmt(pct,2)}% → ${c.label}. AIAG/Minitab variance-component guidance is <1% acceptable, 1–9% conditional, >9% needs improvement.`;
}
function scopeText(result){return result.scope==='all'?'All imported eligible data — only the optimized rule is used to select pins at each threshold. Other Analysis filters are ignored.':'Respect other Analysis filters — the optimized rule is scanned while all other current Analysis filters remain active.'}
function auditHtml(result,best){
  const a=result.audit,modeScope=result.mode==='crossed'?'All imported machines':`Selected machine ${esc(result.target)}`;
  return `<div class="opt-interpret"><b>Data scope audit</b><br><b>Scope:</b> ${esc(scopeText(result))}<br><b>Study-mode scope:</b> ${modeScope}<br><br><b>Imported indexed samples:</b> ${a.importedSamples.toLocaleString()}<br><b>Eligible after Study Mode:</b> ${a.eligibleSamples.toLocaleString()}<br><b>Eligible values for optimized filter:</b> ${a.eligibleFilterValues.toLocaleString()}<br><b>Eligible measurement rows before threshold:</b> ${a.eligibleMeasurementRows.toLocaleString()}<br><b>Unique pins/parts before threshold:</b> ${a.eligibleParts.toLocaleString()}<br><br><b>At best threshold:</b> ${best.selectedParts.toLocaleString()} selected unique pins/parts · ${best.measurements.toLocaleString()} measurement rows used · ${best.commonParts.toLocaleString()} common/repeated pins used by the statistical calculation.</div>`;
}
function keepOnlyOptimizedRule(result){
  let keep=result.ruleIndex;
  if(result.scope!=='all'||result.rules.length<=1)return keep;
  for(let i=result.rules.length-1;i>=0;i--){
    if(i===keep)continue;
    const el=document.querySelector(`#rules .rule[data-i="${i}"]`),btn=el?.querySelector('.delete-rule');
    if(btn&&!btn.disabled){btn.click();if(i<keep)keep--}
  }
  return keep;
}
function render(result){
  lastResult=result;
  const out=$('optimizerOutput'),L=labels(result.mode),valid=result.results.filter(x=>x.valid).sort((a,b)=>a.objective-b.objective);
  const bestLabel=$('optBestGRR')?.previousElementSibling;if(bestLabel)bestLabel.textContent=`Lowest ${L.short}`;
  if(!valid.length){
    const maxMachines=Math.max(0,...result.results.map(x=>x.machines||0)),maxCommon=Math.max(0,...result.results.map(x=>x.commonParts||0)),maxRepeats=Math.max(0,...result.results.map(x=>x.repeats||0)),maxBoards=Math.max(0,...result.results.map(x=>x.boards||0));
    let req='';if(result.mode==='repeatability')req=`Same-board Repeatability needs at least 2 pins/parts with 2 repeated measurements each on machine ${esc(result.target)}.`;else if(result.mode==='process')req='Production Process Variation needs at least 2 physical PCB IDs/boards and 2 common pins/parts.';else req='Crossed GR&R needs at least 2 machines, 2 common pins and 2 repeats per Pin × Machine cell.';
    out.innerHTML=`${auditHtml(result,{selectedParts:0,measurements:0,commonParts:maxCommon})}<div class="opt-warning"><b>No calculable candidate in this range.</b><br>${req}<br><br><b>Best data availability found:</b><br>Machines: ${maxMachines}<br>Boards: ${maxBoards}<br>Common/repeated pins: ${maxCommon}<br>Repeats: ${maxRepeats}</div>`;return;
  }
  const best=valid[0],unit=result.filterMetric?.unit?` ${result.filterMetric.unit}`:'',lo=Math.min(result.from,result.to),hi=Math.max(result.from,result.to),tol=Math.max(1e-9,result.step*1e-6);
  $('optBestValue').textContent=`${result.direction} ${fmt(best.threshold,4)}${unit}`;$('optBestGRR').textContent=`${fmt(best.objective,2)}%`;$('optBestParts').textContent=best.commonParts.toLocaleString();$('optBestNdc').textContent=best.g?.ndc===Infinity?'∞':(best.g?.ndc??'—');
  const coverage=result.preferredParts===0?'No preferred minimum was requested.':best.commonParts>=result.preferredParts?`${best.commonParts} ${L.noun} meets your preferred ${result.preferredParts}.`:`Best result uses ${best.commonParts} ${L.noun}, below your preferred ${result.preferredParts}; it is shown anyway.`;
  const atLow=Math.abs(best.threshold-lo)<=tol,atHigh=Math.abs(best.threshold-hi)<=tol,boundary=atLow||atHigh?`<div class="opt-warning"><b>Best value is on the search boundary (${fmt(best.threshold,4)}${unit}).</b> The optimizer only searches the range you provide. If your intended rule must start at 10%, set <b>Search from = 10</b>; otherwise a lower threshold such as 0% is allowed to win.</div>`:'';
  const top=valid.slice(0,50),modelNote=result.mode==='crossed'&&best.g?.interactionIncluded!=null?`<br><b>Minitab ANOVA model:</b> ${best.g.interactionIncluded?'Part × Machine interaction retained':'Part × Machine interaction pooled into repeatability'} (p=${fmt(best.g.interactionPValue,4)}, α=${fmt(best.g.interactionAlpha,2)}).`:'';
  out.innerHTML=`<div class="opt-note"><b>Lowest available ${L.name}:</b> ${fmt(best.objective,2)}% at ${result.direction} ${fmt(best.threshold,4)}${unit}.<br><b>Secondary %Study Variation:</b> ${fmt(best.pctStudyVariation,2)}%<br><b>Study mode:</b> ${result.mode==='repeatability'?'Same-board Repeatability':result.mode==='process'?'Production Process Variation':'Crossed GR&R'}${result.mode!=='crossed'?` · Machine ${esc(result.target)}`:''}<br><b>Optimizer scope:</b> ${result.scope==='all'?'All imported eligible data':'Respect other Analysis filters'}<br><b>Coverage:</b> ${coverage}${modelNote}<br><br><b>Measurement:</b> ${esc(result.measurementMetric.fullLabel)}<br><b>Optimized filter:</b> Rule ${result.ruleIndex+1} · ${esc(result.filterMetric.fullLabel)}</div>${auditHtml(result,best)}${boundary}<div class="opt-interpret"><b>How to read this result</b><br>${esc(contributionInterpretation(result.mode,best.objective))}<br><br>The optimizer ranks thresholds by <b>%Contribution (of VarComp)</b>, the same variance-component KPI shown in Minitab. %Study Variation remains available as a secondary diagnostic.</div><div class="opt-table-wrap"><table class="opt-table"><thead><tr><th>Rank</th><th>Threshold</th><th>%Contribution</th><th>%Study Var</th><th>Selected pins</th><th>Common/repeated pins</th><th>Measurements</th><th>Machines</th><th>Boards</th><th>Repeats</th></tr></thead><tbody>${top.map((r,i)=>`<tr class="${i===0?'best':''}"><td>${i+1}</td><td>${result.direction} ${fmt(r.threshold,4)}${unit}</td><td>${fmt(r.objective,2)}%</td><td>${fmt(r.pctStudyVariation,2)}%</td><td>${r.selectedParts}</td><td>${r.commonParts}</td><td>${r.measurements}</td><td>${r.machines}</td><td>${r.boards}</td><td>${r.repeats}</td></tr>`).join('')}</tbody></table></div><div class="opt-actions"><button id="applyBestThreshold" class="primary">Apply lowest-%Contribution threshold & analyze</button><button id="downloadOptCsv" class="ghost">Export optimizer CSV</button></div>`;
  $('applyBestThreshold').onclick=async()=>{const keep=keepOnlyOptimizedRule(result);if(result.app.applyRuleThreshold(keep,result.direction,best.threshold)){result.app.toast(`Applied optimized rule: ${result.direction} ${best.threshold}${result.scope==='all'&&result.rules.length>1?' · other filters removed to match optimizer scope':''}`);if(window.XGRRStudy?.analyzeStudy)await window.XGRRStudy.analyzeStudy();else await result.app.analyze()}};
  $('downloadOptCsv').onclick=()=>downloadCsv(valid,result);setTimeout(()=>window.XGRRUI?.enhanceOptimizerMobile?.(),0);
}
function downloadCsv(rows,result){
  const L=labels(result.mode),cols=['Threshold','Direction','Optimizer_Scope','Study_Mode','Objective_Name','Contribution_Percent','Study_Variation_Percent','Selected_Parts','Common_Parts','Measurements','Machines','Boards','Repeats','NDC','Imported_Samples','Eligible_Samples','Eligible_Filter_Values','Eligible_Measurement_Rows','Eligible_Unique_Parts','Interaction_P_Value','Interaction_Included','Filter_Metric','Measurement_Metric'],lines=[cols.join(',')],q=v=>`"${String(v??'').replaceAll('"','""')}"`;
  for(const r of [...rows].sort((a,b)=>a.threshold-b.threshold))lines.push([r.threshold,result.direction,result.scope,result.mode,q(L.name),r.objective,r.pctStudyVariation,r.selectedParts,r.commonParts,r.measurements,r.machines,r.boards,r.repeats,r.g?.ndc===Infinity?'Infinity':(r.g?.ndc??''),result.audit.importedSamples,result.audit.eligibleSamples,result.audit.eligibleFilterValues,result.audit.eligibleMeasurementRows,result.audit.eligibleParts,r.g?.interactionPValue??'',r.g?.interactionIncluded??'',q(result.filterMetric.fullLabel),q(result.measurementMetric.fullLabel)].join(','));
  const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8'}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='Study_Optimizer_PercentContribution_Scan.csv';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);
}
async function optimize(){
  const app=A();try{
    resetOutput();const prep=makePrepared(),from=+$('optFrom').value,to=+$('optTo').value,step=+$('optStep').value,preferredParts=Math.max(0,Math.floor(+$('optMinParts').value||0)),direction=$('optDirection').value;
    if(![from,to,step].every(Number.isFinite)||step<=0)throw new Error('Check optimizer range and step.');
    const filterKey=prep.rules[prep.ruleIndex].metric,filterMetric=prep.S.metrics.get(filterKey),measurementMetric=prep.S.metrics.get(prep.measurementMetric);
    app.progress('Study Optimizer','Preparing complete eligible data matrix…',5,`${prep.scope==='all'?'All imported eligible data':'Respect other filters'} · ${filterMetric?.fullLabel||filterKey} → ${measurementMetric?.fullLabel||prep.measurementMetric}`);await nap(10);
    const results=await scan(prep,from,to,step,direction,preferredParts);app.progress('Study Optimizer','Ranking thresholds by %Contribution (of VarComp)…',96);await nap(10);
    const result={...prep,results,from,to,step,direction,preferredParts,filterMetric,measurementMetric};render(result);app.progress('Done','Lowest %Contribution threshold search ready.',100);await nap(80);app.hideProgress();
  }catch(e){app?.hideProgress();console.error(e);$('optimizerOutput').innerHTML=`<div class="opt-warning"><b>Optimizer stopped.</b><br>${esc(e.message||e)}</div>`;app?.toast(e.message||'Optimizer failed')}
}
function sync(){
  installScopeControl();const app=A(),rules=app?.getCurrentRules?.()||[],opt=$('optRule'),btn=$('optimizeBtn');if(!opt||!btn)return;const old=+opt.value;
  if(!rules.length){opt.innerHTML='<option>No filter rules</option>';opt.disabled=btn.disabled=true;resetOutput();return}
  const S=app.getState();opt.innerHTML=rules.map((r,i)=>`<option value="${i}">Rule ${i+1}: ${esc(S.metrics.get(r.metric)?.fullLabel||r.metric)}</option>`).join('');opt.value=Number.isInteger(old)&&old<rules.length?String(old):'0';opt.disabled=btn.disabled=false;
}
installScopeControl();$('optimizeBtn').onclick=optimize;$('optRule').onchange=resetOutput;
const mo=new MutationObserver(sync);mo.observe($('rules'),{childList:true,subtree:true});$('fileList')&&new MutationObserver(sync).observe($('fileList'),{childList:true,subtree:true});$('resetBtn').addEventListener('click',()=>setTimeout(()=>{sync();resetOutput()},0));['studyMode','studyMachine','boardInterpretation'].forEach(id=>$(id)?.addEventListener('change',resetOutput));sync();
})();