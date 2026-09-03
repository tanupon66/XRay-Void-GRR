(() => {
'use strict';
const C=window.XGRRCore,$=id=>document.getElementById(id),A=()=>window.XGRRApp;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
const fmt=(v,d=3)=>Number.isFinite(+v)?(+v).toFixed(d):'—';
const nap=(n=0)=>new Promise(r=>setTimeout(r,n));
const xlsSafe=v=>typeof v==='string'&&/^[=+\-@]/.test(v)?"'"+v:v;
function machineOf(s,S){return S.files.find(f=>f.id===s.fileId)?.machine||'Unknown'}
function boardOf(s){return String(s.pcbId||s.pcbNo||s.fileName||`file-${s.fileId}`)}
function installControls(){
  const part=$('partMode');if(!part||$('studyMode'))return;
  const panel=part.closest('.panel'),hint=panel?.querySelector('.hint');if(!panel)return;
  const box=document.createElement('div');box.className='study-config';box.innerHTML=`
  <div class="grid two compact">
    <label class="field"><span>Study mode</span><select id="studyMode"><option value="auto">Auto</option><option value="repeatability">Same-board repeatability (1 machine)</option><option value="crossed">Crossed GR&R (2+ machines)</option><option value="process">Production process variation (different boards)</option></select></label>
    <label class="field"><span>Machine used for single-machine study</span><select id="studyMachine"><option value="">Import data first</option></select></label>
  </div>
  <label class="field"><span>PCB ID interpretation</span><select id="boardInterpretation"><option value="same">Same physical board — PCB IDs are repeated inspections</option><option value="different">Different physical boards — PCB IDs are production samples</option></select></label>
  <div id="studyModeInfo" class="hint strong"></div>`;
  if(hint)hint.after(box);else panel.appendChild(box);
  $('studyMode').addEventListener('change',()=>{updateModeInfo();invalidate()});
  $('boardInterpretation').addEventListener('change',()=>{if($('studyMode').value==='auto')updateModeInfo();invalidate()});
  $('studyMachine').addEventListener('change',invalidate);
  refreshMachines();updateModeInfo();
  const fl=$('fileList');if(fl)new MutationObserver(()=>refreshMachines()).observe(fl,{childList:true,subtree:true});
}
function invalidate(){const S=A()?.getState?.();if(S)S.analysis=null;$('results')?.classList.add('hidden')}
function refreshMachines(){
  const app=A(),S=app?.getState?.();if(!$('studyMachine')||!S)return;
  const ms=[...new Set(S.files.map(f=>f.machine).filter(Boolean))],old=$('studyMachine').value;
  $('studyMachine').innerHTML=ms.length?ms.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join(''):'<option value="">Import data first</option>';
  $('studyMachine').value=ms.includes(old)?old:(ms[0]||'');updateModeInfo();
}
function effectiveMode(){
  const mode=$('studyMode')?.value||'auto',S=A()?.getState?.(),machines=[...new Set((S?.files||[]).map(f=>f.machine).filter(Boolean))];
  if(mode!=='auto')return mode;
  if($('boardInterpretation')?.value==='different')return 'process';
  return machines.length>=2?'crossed':'repeatability';
}
function updateModeInfo(){
  const x=$('studyModeInfo');if(!x)return;const mode=effectiveMode();
  if(mode==='repeatability')x.innerHTML='<b>Same-board Repeatability:</b> PCB IDs are treated as repeated inspections of the same physical board. Primary customer KPI = <b>Repeatability %Contribution (of VarComp)</b>. Full Gage R&R still requires reproducibility from multiple machines.';
  else if(mode==='process')x.innerHTML='<b>Production Process Variation:</b> PCB ID is treated as a different physical board/sample. Primary optimizer KPI = <b>Process %Contribution (of VarComp)</b>. This is process consistency, not Gage R&R.';
  else x.innerHTML='<b>Crossed GR&R:</b> the same Component + Pin is repeatedly measured by two or more machines. Primary KPI = <b>Total Gage R&R %Contribution (of VarComp)</b>. ANOVA uses Minitab-style α = 0.05 to retain or pool Part × Machine interaction.';
}
function passes(values,rules,join){const hits=rules.map((r,i)=>C.compare(values[i],r.op,r.a,r.b));return join==='ALL'?hits.every(Boolean):hits.some(Boolean)}
function contributionStatus(pct,mode){
  if(mode==='process')return {key:'',label:'Process variance contribution'};
  return C.varianceContributionClass(pct);
}
function setPrimaryCardLabel(mode){
  const b=$('statGRR'),span=b?.previousElementSibling,small=$('grrStatus');
  if(span)span.textContent='%Contribution (of VarComp)';
  if(small)small.textContent=mode==='crossed'?'Total Gage R&R':mode==='repeatability'?'Repeatability component':'Process variation';
}
async function analyzeStudy(){
  const qa=C.selfTest?.();if(qa&&!qa.ok)throw new Error('Internal statistical self-test failed. Analysis was stopped to protect result accuracy.');
  const app=A(),S=app?.getState?.();if(!S?.samples?.length)return;
  const rules=app.getCurrentRules(),metric=app.getMeasurementMetric(),join=$('ruleJoin').value,mode=effectiveMode(),target=$('studyMachine')?.value||S.files[0]?.machine||'Unknown';
  app.progress(mode==='process'?'Production Process Study':mode==='repeatability'?'Single-Machine Repeatability':'Crossed GR&R','Selecting pins and measurements…',8);await nap(10);
  const eligible=s=>mode==='crossed'||machineOf(s,S)===target;
  const groups=new Map();
  for(const s of S.samples){if(!eligible(s))continue;const p=app.getPartId(s);if(!groups.has(p))groups.set(p,[]);groups.get(p).push(s)}
  const selectedByFilter=new Set(),trig=new Map();
  for(const [p,arr] of groups){let n=0;for(const s of arr){const vals=rules.map(r=>s.metrics[r.metric]);if(passes(vals,rules,join))n++}if(n){selectedByFilter.add(p);trig.set(p,n)}}
  app.progress('Collecting measurements',`${selectedByFilter.size.toLocaleString()} unique pins/parts passed filters`,35);await nap(10);
  const rows=[],trial=new Map();
  for(const s of S.samples){
    if(!eligible(s))continue;
    const p=app.getPartId(s),v=s.metrics[metric];if(!selectedByFilter.has(p)||!Number.isFinite(v))continue;
    const mach=machineOf(s,S),key=mach+'\0'+p,n=(trial.get(key)||0)+1;trial.set(key,n);
    const fv=rules.map(r=>s.metrics[r.metric]);
    rows.push({part:p,machine:mach,board:boardOf(s),value:v,trial:n,pcbNo:s.pcbNo,pcbId:s.pcbId,repetition:s.repetition,component:s.component,pin:s.pin==='__COMP__'?'':s.pin,fileName:s.fileName,volumePath:s.volumePath,filterValues:fv,triggerThisRun:passes(fv,rules,join)});
  }
  const selected=[...new Set(rows.map(r=>r.part))],byPart=new Map();for(const r of rows){if(!byPart.has(r.part))byPart.set(r.part,[]);byPart.get(r.part).push(r)}
  const summary=selected.map(p=>{const a=byPart.get(p)||[],z=C.summarize(a.map(r=>r.value)),fv=a.flatMap(r=>r.filterValues).filter(Number.isFinite);return {part:p,...z,filterMin:fv.length?Math.min(...fv):NaN,filterMax:fv.length?Math.max(...fv):NaN,triggerCount:trig.get(p)||0}}).sort((a,b)=>b.range-a.range);
  app.progress('Calculating study','Estimating variance components…',72);await nap(10);
  let result,b=null;
  if(mode==='crossed'){b=app.balanced(rows);result=C.calculateCrossedANOVA(b.rows.map(r=>({part:r.part,machine:r.machine,value:r.value})),{alpha:0.05})}
  else if(mode==='process')result=C.calculateProcessVariation(rows);
  else result=C.calculateSingleMachineRepeatability(rows);
  const machines=[...new Set(rows.map(r=>r.machine))],boards=[...new Set(rows.map(r=>r.board))];
  S.analysis={rules,join,metric,selected,selectedByFilter:[...selectedByFilter],rows,summary,grr:result,studyMode:mode,studyMachine:target,boardInterpretation:$('boardInterpretation')?.value||'same',quality:{machines,boards,commonParts:b?.common?.length??result.commonParts??result.parts??0,cells:b?.cells??0,expectedCells:b?.expected??0,minRepeats:b?.min??result.repeatsMin??0,balancedRows:b?.rows?.length??result.observations??rows.length,filteredParts:selectedByFilter.size,partsWithMeasurement:selected.length}};
  app.progress('Rendering results','Preparing Minitab-aligned summary…',94);renderStudy();await nap(20);app.progress('Done','Study ready.',100);await nap(80);app.hideProgress();
}
function line(k,v){return `<div class="metric-row"><span>${k}</span><b>${v}</b></div>`}
function qline(k,v){return `<div class="quality-item"><span>${k}</span><b>${esc(v)}</b></div>`}
function renderStudy(){
  const S=A().getState(),a=S.analysis,r=a.grr,mode=a.studyMode;$('results').classList.remove('hidden');
  $('statParts').textContent=(a.selectedByFilter?.length||0).toLocaleString();$('statMeasurements').textContent=a.rows.length.toLocaleString();$('statMachines').textContent=a.quality.machines.length;setPrimaryCardLabel(mode);
  if(mode==='repeatability'){
    const cs=r.ok?contributionStatus(r.pctContribution,mode):{key:'warn'};$('statGRR').textContent=r.ok?fmt(r.pctContribution,2)+'%':'N/A';
    $('grrPanel').innerHTML=r.ok?`<div class="status-card ${cs.key}"><b>Same-board repeatability</b><br>Repeatability %Contribution (of VarComp) = <b>${fmt(r.pctContribution,2)}%</b><br><span class="secondary-stat">%Study Variation = ${fmt(r.pctStudyVariation,2)}%</span></div>${line('Repeatability VarComp',fmt(r.variance.repeatability,6))}${line('Part-to-Part VarComp',fmt(r.variance.partToPart,6))}${line('Total Variation VarComp',fmt(r.variance.total,6))}${line('Repeatability SD',fmt(r.repeatabilitySD,6))}${line('6σ repeatability',fmt(r.studyVariation.repeatability,6))}${line('Mean pin range',fmt(r.meanRange,6))}${line('Maximum pin range',fmt(r.maxRange,6))}${line('%Study Variation repeatability',fmt(r.pctStudyVariation,2)+'%')}${line('Pins/parts with repeats',r.parts)}${line('Repeats per pin',`${r.repeatsMin}–${r.repeatsMax}`)}${line('ndc (repeatability-based)',r.ndc===Infinity?'∞':r.ndc)}<div class="hint"><b>${esc(cs.label)}</b><br>This matches Minitab variance-component reporting. Because only one machine is used, this is the Repeatability component, not Full Total Gage R&R.</div>`:`<div class="status-card warn"><b>Repeatability not calculated</b><br>${esc(r.reason)}</div>`;
    $('qualityPanel').innerHTML=`<div class="quality-list">${qline('Study mode','Same-board repeatability')}${qline('Machine',a.studyMachine)}${qline('Unique pins passing filter',a.quality.filteredParts)}${qline('Pins with measurement data',a.quality.partsWithMeasurement)}${qline('PCB IDs seen',a.quality.boards.length)}${qline('Interpretation','PCB IDs = repeated inspections of same board')}</div>`;
  }else if(mode==='process'){
    $('statGRR').textContent=r.ok?fmt(r.pctContribution,2)+'%':'N/A';
    $('grrPanel').innerHTML=r.ok?`<div class="status-card"><b>Production process variation</b><br>Process %Contribution (of VarComp) = <b>${fmt(r.pctContribution,2)}%</b><br><span class="secondary-stat">Process CV = ${fmt(r.processCV,2)}% · %Study Variation = ${fmt(r.pctStudyVariation,2)}%</span></div>${line('Process VarComp',fmt(r.variance.process,6))}${line('Board-to-board VarComp',fmt(r.variance.boardToBoard,6))}${line('Pin × board residual VarComp',fmt(r.variance.residual,6))}${line('Part-to-Part VarComp',fmt(r.variance.partToPart,6))}${line('Total Variation VarComp',fmt(r.variance.total,6))}${line('Process SD',fmt(r.sd.process,6))}${line('6σ process variation',fmt(r.studyVariation.process,6))}${line('Process CV',fmt(r.processCV,2)+'%')}${line('%Study Variation process',fmt(r.pctStudyVariation,2)+'%')}${line('Physical boards',r.boards)}${line('Common pins/parts',r.commonParts)}<div class="hint">PCB ID is treated as a different physical production board. This is a process consistency study, not Gage R&R.</div>`:`<div class="status-card warn"><b>Process variation not calculated</b><br>${esc(r.reason)}</div>`;
    $('qualityPanel').innerHTML=`<div class="quality-list">${qline('Study mode','Production process variation')}${qline('Machine',a.studyMachine)}${qline('Physical boards / PCB IDs',a.quality.boards.length)}${qline('Unique pins passing filter',a.quality.filteredParts)}${qline('Pins with measurement data',a.quality.partsWithMeasurement)}${qline('Interpretation','PCB IDs = different physical boards')}</div>`;
  }else{
    const cs=r.ok?contributionStatus(r.pctContribution,mode):{key:'warn'};$('statGRR').textContent=r.ok?fmt(r.pctContribution,2)+'%':'N/A';
    $('grrPanel').innerHTML=r.ok?`<div class="status-card ${cs.key}"><b>Crossed Gage R&R — ANOVA</b><br>Total Gage R&R %Contribution (of VarComp) = <b>${fmt(r.pctContribution,2)}%</b><br><span class="secondary-stat">%Study Variation GR&R = ${fmt(r.pctStudyVariation,2)}%</span></div>${line('Total Gage R&R VarComp',fmt(r.variance.grr,6))}${line('Repeatability VarComp',fmt(r.variance.repeatability,6))}${line('Reproducibility VarComp',fmt(r.variance.reproducibility,6))}${line('Machine VarComp',fmt(r.variance.machine,6))}${line('Machine × Part VarComp',fmt(r.variance.interaction,6))}${line('Part-to-Part VarComp',fmt(r.variance.partToPart,6))}${line('Total Variation VarComp',fmt(r.variance.total,6))}${line('%Contribution Repeatability',fmt(r.pctContributionBySource.repeatability,2)+'%')}${line('%Contribution Reproducibility',fmt(r.pctContributionBySource.reproducibility,2)+'%')}${line('%Study Variation GR&R',fmt(r.pctStudyVariation,2)+'%')}${line('ANOVA interaction p-value',fmt(r.interactionPValue,4))}${line('Interaction model',r.interactionIncluded?'Retained (p < 0.05)':'Pooled into repeatability (p ≥ 0.05)')}${line('ndc',r.ndc===Infinity?'∞':r.ndc)}<div class="hint"><b>${esc(cs.label)}</b><br>Minitab-compatible default: α=0.05 is used to decide whether Part × Machine interaction remains in the ANOVA model.</div>`:`<div class="status-card warn"><b>Crossed GR&R not calculated</b><br>${esc(r.reason)}</div>`;
    $('qualityPanel').innerHTML=`<div class="quality-list">${qline('Study mode','Crossed GR&R')}${qline('Machines',a.quality.machines.join(', '))}${qline('Unique pins passing filter',a.quality.filteredParts)}${qline('Common pins on every machine',a.quality.commonParts)}${qline('Minimum repeats per cell',a.quality.minRepeats)}${qline('Balanced rows used',a.quality.balancedRows)}</div>`;
  }
  renderTable();setTimeout(()=>window.XGRRUI?.updateAnalysisSummary?.(),0);
}
function renderTable(){const a=A().getState().analysis,q=($('tableSearch')?.value||'').trim().toLowerCase();$('pinTable').innerHTML=a.summary.filter(r=>!q||r.part.toLowerCase().includes(q)).slice(0,1500).map(r=>`<tr><td>${esc(r.part)}</td><td>${r.n}</td><td>${fmt(r.mean)}</td><td>${fmt(r.min)}</td><td>${fmt(r.max)}</td><td>${fmt(r.range)}</td><td>${fmt(r.sd)}</td><td>${fmt(r.cv,2)}</td><td>${fmt(r.filterMin)}</td><td>${fmt(r.filterMax)}</td></tr>`).join('')}
function sheet(rows,cols){
  const safe=rows.map(r=>Object.fromEntries(cols.map(c=>[c,xlsSafe(r[c])]))),ws=XLSX.utils.json_to_sheet(safe,{header:cols});
  ws['!cols']=cols.map(c=>({wch:Math.min(55,Math.max(12,c.length+2,...safe.slice(0,250).map(r=>String(r[c]??'').length+2)))}));if(ws['!ref'])ws['!autofilter']={ref:ws['!ref']};return ws;
}
function varianceRows(r,mode){
  if(!r.ok)return [{Source:'Status',VarComp:'',Contribution_Percent:'',Note:r.reason}];
  if(mode==='repeatability')return [
    {Source:'Repeatability',VarComp:r.variance.repeatability,Contribution_Percent:r.pctContributionBySource.repeatability},
    {Source:'Part-To-Part',VarComp:r.variance.partToPart,Contribution_Percent:r.pctContributionBySource.partToPart},
    {Source:'Total Variation',VarComp:r.variance.total,Contribution_Percent:100}
  ];
  if(mode==='process')return [
    {Source:'Process Variation',VarComp:r.variance.process,Contribution_Percent:r.pctContributionBySource.process},
    {Source:'  Board-To-Board',VarComp:r.variance.boardToBoard,Contribution_Percent:r.pctContributionBySource.boardToBoard},
    {Source:'  Residual Pin×Board',VarComp:r.variance.residual,Contribution_Percent:r.pctContributionBySource.residual},
    {Source:'Part-To-Part',VarComp:r.variance.partToPart,Contribution_Percent:r.pctContributionBySource.partToPart},
    {Source:'Total Variation',VarComp:r.variance.total,Contribution_Percent:100}
  ];
  return [
    {Source:'Total Gage R&R',VarComp:r.variance.grr,Contribution_Percent:r.pctContributionBySource.totalGRR},
    {Source:'  Repeatability',VarComp:r.variance.repeatability,Contribution_Percent:r.pctContributionBySource.repeatability},
    {Source:'  Reproducibility',VarComp:r.variance.reproducibility,Contribution_Percent:r.pctContributionBySource.reproducibility},
    {Source:'    Machine',VarComp:r.variance.machine,Contribution_Percent:r.pctContributionBySource.machine},
    {Source:'    Machine × Part',VarComp:r.variance.interaction,Contribution_Percent:r.pctContributionBySource.interaction},
    {Source:'Part-To-Part',VarComp:r.variance.partToPart,Contribution_Percent:r.pctContributionBySource.partToPart},
    {Source:'Total Variation',VarComp:r.variance.total,Contribution_Percent:100}
  ];
}
function gageRows(r,mode){
  if(!r.ok)return [];
  if(mode==='repeatability')return [
    {Source:'Repeatability',StdDev:r.stdDev.repeatability,Study_Var_6xSD:r.studyVariation.repeatability,Study_Var_Percent:r.pctStudyVariationBySource.repeatability},
    {Source:'Part-To-Part',StdDev:r.stdDev.partToPart,Study_Var_6xSD:6*r.stdDev.partToPart,Study_Var_Percent:r.pctStudyVariationBySource.partToPart},
    {Source:'Total Variation',StdDev:r.stdDev.total,Study_Var_6xSD:r.studyVariation.total,Study_Var_Percent:100}
  ];
  if(mode==='process')return [
    {Source:'Process Variation',StdDev:r.sd.process,Study_Var_6xSD:r.studyVariation.process,Study_Var_Percent:r.pctStudyVariationBySource.process},
    {Source:'  Board-To-Board',StdDev:r.sd.boardToBoard,Study_Var_6xSD:r.studyVariation.boardToBoard,Study_Var_Percent:r.pctStudyVariationBySource.boardToBoard},
    {Source:'  Residual Pin×Board',StdDev:r.sd.residual,Study_Var_6xSD:r.studyVariation.residual,Study_Var_Percent:r.pctStudyVariationBySource.residual},
    {Source:'Part-To-Part',StdDev:r.sd.partToPart,Study_Var_6xSD:6*r.sd.partToPart,Study_Var_Percent:r.pctStudyVariationBySource.partToPart},
    {Source:'Total Variation',StdDev:r.sd.total,Study_Var_6xSD:6*r.sd.total,Study_Var_Percent:100}
  ];
  return [
    {Source:'Total Gage R&R',StdDev:r.stdDev.grr,Study_Var_6xSD:r.studyVariation.grr,Study_Var_Percent:r.pctStudyVariationBySource.totalGRR},
    {Source:'  Repeatability',StdDev:r.stdDev.repeatability,Study_Var_6xSD:r.studyVariation.repeatability,Study_Var_Percent:r.pctStudyVariationBySource.repeatability},
    {Source:'  Reproducibility',StdDev:r.stdDev.reproducibility,Study_Var_6xSD:r.studyVariation.reproducibility,Study_Var_Percent:r.pctStudyVariationBySource.reproducibility},
    {Source:'Part-To-Part',StdDev:r.stdDev.partToPart,Study_Var_6xSD:r.studyVariation.partToPart,Study_Var_Percent:r.pctStudyVariationBySource.partToPart},
    {Source:'Total Variation',StdDev:r.stdDev.total,Study_Var_6xSD:r.studyVariation.total,Study_Var_Percent:100}
  ];
}
function anovaRows(r,mode){
  if(!r.ok)return [];
  if(mode==='repeatability')return [
    {Model:'One-way random effects',Source:'Part',DF:r.anova.dfPart,SS:r.anova.ssPart,MS:r.anova.msPart,F:'',P:''},
    {Model:'One-way random effects',Source:'Repeatability',DF:r.anova.dfError,SS:r.anova.ssError,MS:r.anova.msError,F:'',P:''}
  ];
  if(mode==='process')return [
    {Model:'Two-way additive',Source:'Part',DF:r.anova.dfPart,SS:r.anova.ssPart,MS:r.anova.msPart,F:'',P:''},
    {Model:'Two-way additive',Source:'Board',DF:r.anova.dfBoard,SS:r.anova.ssBoard,MS:r.anova.msBoard,F:'',P:''},
    {Model:'Two-way additive',Source:'Residual Part×Board',DF:r.anova.dfResidual,SS:r.anova.ssResidual,MS:r.anova.msResidual,F:'',P:''}
  ];
  const f=r.anova.full,u=r.anova.used;return [
    {Model:'Full model',Source:'Part',DF:f.dfPart,SS:f.ssPart,MS:f.msPart,F:'',P:''},
    {Model:'Full model',Source:'Machine',DF:f.dfMachine,SS:f.ssMachine,MS:f.msMachine,F:'',P:''},
    {Model:'Full model',Source:'Part × Machine',DF:f.dfInteraction,SS:f.ssInteraction,MS:f.msInteraction,F:r.interactionF,P:r.interactionPValue},
    {Model:'Full model',Source:'Repeatability',DF:f.dfError,SS:f.ssError,MS:f.msError,F:'',P:''},
    {Model:r.interactionIncluded?'Used model = full':'Used model = interaction pooled',Source:'Used Repeatability/Error',DF:u.dfError,SS:u.ssError,MS:u.msError,F:'',P:''}
  ];
}
function auditRows(r,mode){
  const rows=[],qa=C.selfTest?.();if(qa)for(const c of qa.checks)rows.push({Check:`Engine: ${c.name}`,Expected:'Pass',Actual:c.ok?'Pass':'FAIL',Status:c.ok?'PASS':'FAIL'});
  if(r.ok&&Number.isFinite(r.pctContribution)&&Number.isFinite(r.pctStudyVariation)){
    const derived=r.pctStudyVariation*r.pctStudyVariation/100,diff=Math.abs(derived-r.pctContribution);
    rows.push({Check:'%Contribution = (%Study Variation)^2 / 100',Expected:r.pctContribution,Actual:derived,Status:diff<1e-8?'PASS':'FAIL'});
  }
  const total=mode==='repeatability'?r.variance?.repeatability+r.variance?.partToPart:mode==='process'?r.variance?.process+r.variance?.partToPart:r.variance?.grr+r.variance?.partToPart;
  if(r.ok)rows.push({Check:'Variance components sum to Total Variation',Expected:r.variance.total,Actual:total,Status:Math.abs(total-r.variance.total)<1e-9*Math.max(1,Math.abs(r.variance.total))?'PASS':'FAIL'});
  return rows;
}
async function exportStudy(){
  const app=A(),S=app.getState(),a=S.analysis;if(!a||!window.XLSX)return;const mode=a.studyMode,r=a.grr,mi=S.metrics.get(a.metric),ml=S.logics.get(mi?.logicKey);
  app.progress('Creating Excel workbook','Minitab-aligned sheets…',8);await nap(10);const wb=XLSX.utils.book_new();
  const mini=a.rows.map(x=>({Part:x.part,Machine:x.machine,Measurement:x.value,Trial:x.trial,PCB_ID:x.pcbId,PCB_No:x.pcbNo,Component:x.component,Pin:x.pin,Physical_Board:mode==='process'?x.board:(mode==='repeatability'?'SAME_BOARD':x.board),Source_File:x.fileName}));
  XLSX.utils.book_append_sheet(wb,sheet(mini,['Part','Machine','Measurement','Trial','PCB_ID','PCB_No','Component','Pin','Physical_Board','Source_File']),mode==='crossed'?'Minitab_GRR':'Study_Data');
  XLSX.utils.book_append_sheet(wb,sheet(varianceRows(r,mode),['Source','VarComp','Contribution_Percent','Note']),'Variance_Components');
  XLSX.utils.book_append_sheet(wb,sheet(gageRows(r,mode),['Source','StdDev','Study_Var_6xSD','Study_Var_Percent']),'Gage_Evaluation');
  XLSX.utils.book_append_sheet(wb,sheet(anovaRows(r,mode),['Model','Source','DF','SS','MS','F','P']),'ANOVA');
  app.progress('Creating Excel workbook','Traceability and audit…',45);await nap(10);
  const st=a.summary.map(x=>({Part:x.part,N:x.n,Mean:x.mean,Min:x.min,Max:x.max,Range:x.range,SD:x.sd,CV_Percent:x.cv,Filter_Min:x.filterMin,Filter_Max:x.filterMax,Trigger_Count:x.triggerCount}));
  XLSX.utils.book_append_sheet(wb,sheet(st,['Part','N','Mean','Min','Max','Range','SD','CV_Percent','Filter_Min','Filter_Max','Trigger_Count']),'Part_Stability');
  XLSX.utils.book_append_sheet(wb,sheet(a.selected.map(p=>({Part:p,Selected:'Yes',Trigger_Count:a.summary.find(x=>x.part===p)?.triggerCount||0})),['Part','Selected','Trigger_Count']),'Selected_Parts');
  const det=a.rows.map(x=>{const o={Machine:x.machine,Part:x.part,Trial:x.trial,Measurement:x.value,Component:x.component,Pin:x.pin,PCB_No:x.pcbNo,PCB_ID:x.pcbId,Repetition:x.repetition,Trigger_This_Run:x.triggerThisRun?'Yes':'No',Source_File:x.fileName,Volume_Data_Path:x.volumePath};a.rules.forEach((rule,i)=>{o[`Filter_${i+1}_Logic`]=S.logics.get(rule.logic)?.label||rule.logic;o[`Filter_${i+1}_Metric`]=S.metrics.get(rule.metric)?.label||rule.metric;o[`Filter_${i+1}_Value`]=Number.isFinite(x.filterValues[i])?x.filterValues[i]:''});return o});
  const detCols=['Machine','Part','Trial','Measurement','Component','Pin','PCB_No','PCB_ID','Repetition','Trigger_This_Run',...a.rules.flatMap((_,i)=>[`Filter_${i+1}_Logic`,`Filter_${i+1}_Metric`,`Filter_${i+1}_Value`]),'Source_File','Volume_Data_Path'];
  XLSX.utils.book_append_sheet(wb,sheet(det,detCols),'All_Selected_Data');
  const catalog=[...S.metrics.values()].map(m=>{const l=S.logics.get(m.logicKey);return {Inspection_Logic:l?.inspectionName||'',Inspection_ID:l?.inspectionId||'',Window_Type:l?.windowType||'',Measurement:m.criteriaName,Unit:m.unit,Numeric_Data_Points:m.count,Logic_Key:m.logicKey,Metric_Key:m.key}});
  XLSX.utils.book_append_sheet(wb,sheet(catalog,['Inspection_Logic','Inspection_ID','Window_Type','Measurement','Unit','Numeric_Data_Points','Logic_Key','Metric_Key']),'Logic_Catalog');
  const il=S.files.map(f=>({File:f.name,Machine:f.machine,Detected_Machine:f.detected,System_Name:f.meta['System Name']||'',Inspection_Date:f.meta['Inspection Date']||'',Inspection_Time:f.meta['Inspection Time']||'',Program:f.meta['Inspection Program Name']||'',Indexed_Samples:f.samples,Numeric_Rows:f.numericRows,CSV_Rows:f.rows}));
  XLSX.utils.book_append_sheet(wb,sheet(il,['File','Machine','Detected_Machine','System_Name','Inspection_Date','Inspection_Time','Program','Indexed_Samples','Numeric_Rows','CSV_Rows']),'Import_Log');
  const primary=mode==='crossed'?'Total Gage R&R %Contribution (of VarComp)':mode==='repeatability'?'Repeatability %Contribution (of VarComp)':'Process %Contribution (of VarComp)';
  const summary=[{Metric:'Study mode',Value:mode},{Metric:'Measurement logic',Value:ml?.label||''},{Metric:'Measurement',Value:mi?.label||a.metric},{Metric:'Primary KPI',Value:primary},{Metric:'Primary KPI %',Value:r.ok?r.pctContribution:''},{Metric:'%Study Variation',Value:r.ok?r.pctStudyVariation:''},{Metric:'Unique pins/parts passing filter',Value:a.selectedByFilter.length},{Metric:'Pins/parts with measurement',Value:a.selected.length},{Metric:'Observations',Value:a.rows.length},{Metric:'ndc',Value:r.ok&&r.ndc!=null?(r.ndc===Infinity?'Infinity':r.ndc):''}];
  if(mode==='crossed'&&r.ok)summary.push({Metric:'ANOVA interaction alpha',Value:r.interactionAlpha},{Metric:'Part × Machine p-value',Value:r.interactionPValue},{Metric:'Interaction included',Value:r.interactionIncluded?'Yes':'No — pooled into repeatability'});
  XLSX.utils.book_append_sheet(wb,sheet(summary,['Metric','Value']),'Study_Summary');
  const settings=[{Setting:'Study mode',Value:mode},{Setting:'PCB ID interpretation',Value:a.boardInterpretation},{Setting:'Machine for single-machine study',Value:a.studyMachine},{Setting:'Part identity',Value:$('partMode').value},{Setting:'Rule join',Value:a.join},{Setting:'Selection behavior',Value:'If filter matches at least once, retain all available measurement repeats for that Component + Pin'},...a.rules.flatMap((rr,i)=>[{Setting:`Filter ${i+1} logic`,Value:S.logics.get(rr.logic)?.label||rr.logic},{Setting:`Filter ${i+1} metric`,Value:S.metrics.get(rr.metric)?.label||rr.metric},{Setting:`Filter ${i+1} condition`,Value:rr.op},{Setting:`Filter ${i+1} value A`,Value:rr.a},{Setting:`Filter ${i+1} value B`,Value:['between','outside'].includes(rr.op)?rr.b:''}])];
  XLSX.utils.book_append_sheet(wb,sheet(settings,['Setting','Value']),'Settings');
  XLSX.utils.book_append_sheet(wb,sheet(auditRows(r,mode),['Check','Expected','Actual','Status']),'Calculation_Audit');
  app.progress('Creating Excel workbook','Compressing…',88);await nap(20);const stamp=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');XLSX.writeFile(wb,`XRay_${mode}_VarComp_${stamp}.xlsx`,{compression:true});app.progress('Excel exported','Download started.',100);await nap(140);app.hideProgress();
}
function init(){
  installControls();
  const btn=$('analyzeBtn');btn?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();analyzeStudy().catch(err=>{A()?.hideProgress?.();console.error(err);A()?.toast?.(err.message||'Study failed')})},true);
  $('tableSearch')?.addEventListener('input',()=>{if(A()?.getState?.().analysis?.studyMode)renderTable()});
  $('exportBtn')?.addEventListener('click',e=>{const mode=A()?.getState?.().analysis?.studyMode;if(mode){e.preventDefault();e.stopImmediatePropagation();exportStudy().catch(err=>{A()?.hideProgress?.();console.error(err);A()?.toast?.(err.message||'Export failed')})}},true);
}
window.XGRRStudy={effectiveMode,analyzeStudy,refreshMachines,renderStudy,exportStudy};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
