(() => {
'use strict';
const C=window.XGRRCore,$=id=>document.getElementById(id);
const S={
  files:[],samples:[],metrics:new Map(),logics:new Map(),filters:[],analysis:null,id:1
};
const E={
  fileInput:$('fileInput'),fileList:$('fileList'),fileCount:$('fileCount'),logicCount:$('logicCount'),logicSummary:$('logicSummary'),
  measurementLogic:$('measurementLogic'),measurementMetric:$('measurementMetric'),measurementCoverage:$('measurementCoverage'),measurementInfo:$('measurementInfo'),
  partMode:$('partMode'),ruleJoin:$('ruleJoin'),rules:$('rules'),addRule:$('addRule'),analyzeBtn:$('analyzeBtn'),resetBtn:$('resetBtn'),
  results:$('results'),exportBtn:$('exportBtn'),pinTable:$('pinTable'),tableSearch:$('tableSearch'),
  modal:$('progressModal'),title:$('progressTitle'),msg:$('progressMessage'),bar:$('progressBar'),pct:$('progressPct'),detail:$('progressDetail')
};
const nap=(n=0)=>new Promise(r=>setTimeout(r,n));
const fmt=(v,d=3)=>Number.isFinite(+v)?(+v).toFixed(d):'—';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const xlsSafe=v=>typeof v==='string'&&/^[=+\-@]/.test(v)?"'"+v:v;
function toast(t){const x=$('toast');x.textContent=t;x.classList.remove('hidden');setTimeout(()=>x.classList.add('hidden'),2800)}
function prog(t,m,p=0,d=''){E.title.textContent=t;E.msg.textContent=m;E.bar.style.width=Math.max(0,Math.min(100,p))+'%';E.pct.textContent=Math.round(p)+'%';E.detail.textContent=d;E.modal.classList.remove('hidden')}
function hide(){E.modal.classList.add('hidden')}
async function meta(file){
  const ls=(await file.slice(0,8192).text()).split(/\r?\n/),k=(Papa.parse(ls[0]||'').data[0]||[]),v=(Papa.parse(ls[1]||'').data[0]||[]),o={};
  k.forEach((x,i)=>o[x]=v[i]||'');return o;
}
function machine(path,m,name){
  const s=[path||'',m['System Name']||'',name||''].join(' ');
  const x=s.match(/VT-X750[-_ ]?(\d{3,8})/i)||s.match(/(?:machine|m)[-_ ]?(\d{3,8})/i);
  return x?x[1]:(m['System Name']||'Unknown');
}
function partId(s){
  if(E.partMode.value==='component')return s.component;
  return s.pin&&s.pin!=='__COMP__'?`${s.component}_${s.pin}`:`${s.component}_COMP`;
}
function registerMetric(mk){
  let m=S.metrics.get(mk);
  if(!m){
    const x=C.metricInfo(mk);
    m={key:mk,logicKey:x.logicKey,label:C.metricLabel(mk),fullLabel:C.metricFullLabel(mk),criteriaName:x.criteriaName,unit:x.unit,count:0};
    S.metrics.set(mk,m);
  }
  m.count++;
  let l=S.logics.get(m.logicKey);
  if(!l){
    const x=C.logicInfo(m.logicKey);
    l={key:m.logicKey,label:C.logicLabel(m.logicKey),windowType:x.windowType,inspectionName:x.inspectionName,inspectionId:x.inspectionId,count:0,metrics:new Set()};
    S.logics.set(m.logicKey,l);
  }
  l.count++;l.metrics.add(mk);
}
function rebuildRegistry(){
  S.metrics=new Map();S.logics=new Map();
  for(const s of S.samples)for(const mk of Object.keys(s.metrics))registerMetric(mk);
}
async function load(files){
  if(!window.Papa)return toast('CSV library unavailable. Reload with internet connection.');
  for(const [fi,file] of [...files].entries()){
    const m=await meta(file),id=S.id++,rec={id,name:file.name,size:file.size,file,meta:m,machine:'Detecting…',detected:'',rows:0,samples:0,numericRows:0},map=new Map();
    S.files.push(rec);prog('Reading X-ray CSV',file.name,0,`${fi+1}/${files.length}`);
    await new Promise((ok,bad)=>Papa.parse(file,{
      header:true,worker:true,skipEmptyLines:'greedy',chunkSize:2*1024*1024,
      beforeFirstChunk:c=>c.split(/\r?\n/).slice(3).join('\n'),
      chunk:r=>{
        for(const row of r.data){
          rec.rows++;
          const y=+row.Measured;
          if(!Number.isFinite(y))continue;
          const comp=String(row['Component Name']||row['Component Number']||'').trim();
          if(!comp)continue;
          const pinRaw=String(row['Pin Number']??'').trim(),pin=pinRaw||'__COMP__';
          const key=[id,row['PCB ID']||row['PCB No.']||'',comp,pin,row.Individual||''].join('\u0001');
          const mk=C.metricKey(row);registerMetric(mk);rec.numericRows++;
          let s=map.get(key);
          if(!s){
            s={fileId:id,fileName:file.name,pcbNo:String(row['PCB No.']||''),pcbId:String(row['PCB ID']||''),repetition:String(row['Repetition Frequency']||''),component:comp,pin,individual:String(row.Individual||''),volumePath:String(row['Volume Data Path']||''),metrics:{},criteria:{},results:{}};
            map.set(key,s);
          }
          s.metrics[mk]=y;
          const cr=+row['Inspection Criteria'];if(Number.isFinite(cr))s.criteria[mk]=cr;
          s.results[mk]=String(row.Result||'');
          if(!rec.detected&&s.volumePath)rec.detected=machine(s.volumePath,m,file.name);
        }
        const cur=r.meta?.cursor||0;
        prog('Reading X-ray CSV',file.name,Math.min(99,100*cur/file.size),`${(cur/1048576).toFixed(1)} / ${(file.size/1048576).toFixed(1)} MB`);
      },complete:ok,error:bad
    }));
    rec.machine=rec.detected||machine('',m,file.name);rec.samples=map.size;S.samples.push(...map.values());
    prog('Indexing inspection logics',`${S.logics.size} logics · ${S.metrics.size} numeric metrics`,100,file.name);await nap(70);
  }
  hide();renderFiles();refreshAll();E.results.classList.add('hidden');toast(`Imported ${files.length} file(s) · ${S.logics.size} logics detected`);
}
function renderFiles(){
  E.fileCount.textContent=`${S.files.length} file${S.files.length===1?'':'s'}`;
  if(!S.files.length){E.fileList.className='empty-state';E.fileList.textContent='No CSV loaded yet.';return}
  E.fileList.className='';
  E.fileList.innerHTML=S.files.map(f=>`<div class="file-card" data-id="${f.id}"><div class="file-main"><b>${esc(f.name)}</b><small>${f.samples.toLocaleString()} indexed samples · ${f.numericRows.toLocaleString()} numeric rows · ${esc(f.meta['Inspection Program Name']||'Program unknown')}</small></div><input class="machine-input" value="${esc(f.machine)}" aria-label="Machine ID"><button class="remove" title="Remove">×</button></div>`).join('');
  E.fileList.querySelectorAll('.file-card').forEach(c=>{
    const id=+c.dataset.id;
    c.querySelector('input').onchange=e=>{const f=S.files.find(z=>z.id===id);if(f)f.machine=e.target.value.trim()||f.detected||'Unknown';invalidate()};
    c.querySelector('button').onclick=()=>{
      S.files=S.files.filter(f=>f.id!==id);S.samples=S.samples.filter(s=>s.fileId!==id);rebuildRegistry();renderFiles();refreshAll();invalidate();
    };
  });
}
function sortedLogics(){return [...S.logics.values()].sort((a,b)=>a.label.localeCompare(b.label))}
function metricsForLogic(lk){return [...S.metrics.values()].filter(m=>m.logicKey===lk).sort((a,b)=>a.label.localeCompare(b.label))}
function logicOptions(sel){return sortedLogics().map(l=>`<option value="${esc(l.key)}" ${l.key===sel?'selected':''}>${esc(l.label)}</option>`).join('')}
function metricOptions(lk,sel){return metricsForLogic(lk).map(m=>`<option value="${esc(m.key)}" ${m.key===sel?'selected':''}>${esc(m.label)}</option>`).join('')}
function defaultLogic(){
  const l=sortedLogics();
  return l.find(x=>/flat\s*void/i.test(x.inspectionName))?.key||l[0]?.key||'';
}
function defaultMetric(lk,kind='measurement'){
  const ms=metricsForLogic(lk);
  if(kind==='filter'){
    return ms.find(m=>/maximum\s*void.*void\s*ratio/i.test(m.criteriaName))?.key||
           ms.find(m=>/maximum.*void.*ratio/i.test(m.criteriaName))?.key||ms[0]?.key||'';
  }
  return ms.find(m=>/^void\s*ratio$/i.test(m.criteriaName))?.key||
         ms.find(m=>/void\s*ratio/i.test(m.criteriaName))?.key||ms[0]?.key||'';
}
function renderLogicSummary(){
  E.logicCount.textContent=`${S.logics.size} logic${S.logics.size===1?'':'s'}`;
  if(!S.logics.size){E.logicSummary.innerHTML='<div class="empty-state">Import CSV to detect inspection logics.</div>';return}
  const active=E.measurementLogic.value;
  E.logicSummary.innerHTML=sortedLogics().map(l=>`<button type="button" class="logic-card ${l.key===active?'active':''}" data-logic="${esc(l.key)}"><h3>${esc(l.inspectionName||l.windowType||'Unnamed logic')}</h3><div class="meta">${l.inspectionId?`Inspection ID: ${esc(l.inspectionId)}<br>`:''}${l.windowType?`Window: ${esc(l.windowType)}<br>`:''}${l.count.toLocaleString()} numeric data points</div><div class="logic-stats"><span>${l.metrics.size} metrics</span></div></button>`).join('');
  E.logicSummary.querySelectorAll('.logic-card').forEach(x=>x.onclick=()=>{
    E.measurementLogic.value=x.dataset.logic;refreshMeasurement(true);invalidate();
  });
}
function refreshMeasurement(forceDefault=false){
  if(!S.logics.size){
    E.measurementLogic.disabled=E.measurementMetric.disabled=true;
    E.measurementLogic.innerHTML=E.measurementMetric.innerHTML='<option>Import CSV first</option>';
    E.measurementCoverage.textContent='—';return;
  }
  E.measurementLogic.disabled=E.measurementMetric.disabled=false;
  let lk=forceDefault?E.measurementLogic.value:(S.logics.has(E.measurementLogic.value)?E.measurementLogic.value:defaultLogic());
  if(!S.logics.has(lk))lk=defaultLogic();
  E.measurementLogic.innerHTML=logicOptions(lk);E.measurementLogic.value=lk;
  let mk=!forceDefault&&S.metrics.has(E.measurementMetric.value)&&S.metrics.get(E.measurementMetric.value).logicKey===lk?E.measurementMetric.value:defaultMetric(lk,'measurement');
  E.measurementMetric.innerHTML=metricOptions(lk,mk);E.measurementMetric.value=mk;
  const m=S.metrics.get(mk),l=S.logics.get(lk);
  E.measurementCoverage.textContent=m?`${m.count.toLocaleString()} values`:'—';
  E.measurementInfo.innerHTML=m?`Active: <b>${esc(l?.label||'')}</b> → <b>${esc(m.label)}</b>. This numeric value becomes the Minitab Measurement column.`:'Choose a numeric measurement.';
  renderLogicSummary();
}
function ruleDefault(){
  const lk=defaultLogic()||E.measurementLogic.value;
  const mk=defaultMetric(lk,'filter');
  const m=S.metrics.get(mk);
  return {logic:lk,metric:mk,op:'>',a:/maximum.*void.*ratio/i.test(m?.criteriaName||'')?10:0,b:20};
}
function renderRules(){
  if(!S.logics.size){E.rules.innerHTML='';return}
  E.rules.innerHTML=S.filters.map((r,i)=>{
    const lk=S.logics.has(r.logic)?r.logic:defaultLogic();
    const mk=S.metrics.has(r.metric)&&S.metrics.get(r.metric).logicKey===lk?r.metric:defaultMetric(lk,'filter');
    r.logic=lk;r.metric=mk;
    return `<div class="rule" data-i="${i}">
      <label class="rule-field"><span>Filter logic</span><select class="rl">${logicOptions(lk)}</select></label>
      <label class="rule-field"><span>Filter measurement</span><select class="rm">${metricOptions(lk,mk)}</select></label>
      <label class="rule-field"><span>Condition</span><select class="ro"><option ${r.op==='>'?'selected':''}>&gt;</option><option ${r.op==='>='?'selected':''}>&gt;=</option><option ${r.op==='<'?'selected':''}>&lt;</option><option ${r.op==='<='?'selected':''}>&lt;=</option><option ${r.op==='='?'selected':''}>=</option><option value="between" ${r.op==='between'?'selected':''}>between</option><option value="outside" ${r.op==='outside'?'selected':''}>outside</option></select></label>
      <label class="rule-field"><span>Value</span><input class="ra" type="number" step="any" value="${r.a}"></label>
      <label class="rule-field rb ${['between','outside'].includes(r.op)?'':'hidden'}"><span>Second value</span><input type="number" step="any" value="${r.b}"></label>
      <button class="delete-rule" ${S.filters.length===1?'disabled':''} title="Delete">×</button>
    </div>`;
  }).join('');
  E.rules.querySelectorAll('.rule').forEach(el=>{
    const i=+el.dataset.i;
    const save=()=>{
      S.filters[i]={logic:el.querySelector('.rl').value,metric:el.querySelector('.rm').value,op:el.querySelector('.ro').value,a:+el.querySelector('.ra').value,b:+el.querySelector('.rb input').value};
      el.querySelector('.rb').classList.toggle('hidden',!['between','outside'].includes(S.filters[i].op));
      refreshOptimizerRuleList();invalidate();
    };
    el.querySelector('.rl').onchange=()=>{
      const lk=el.querySelector('.rl').value,mk=defaultMetric(lk,'filter');
      el.querySelector('.rm').innerHTML=metricOptions(lk,mk);el.querySelector('.rm').value=mk;save();
    };
    el.querySelectorAll('.rm,.ro,.ra,.rb input').forEach(x=>x.onchange=save);
    el.querySelector('.delete-rule').onclick=()=>{if(S.filters.length>1){S.filters.splice(i,1);renderRules();refreshOptimizerRuleList();invalidate()}};
  });
}
function currentRules(){
  return [...E.rules.querySelectorAll('.rule')].map(el=>({logic:el.querySelector('.rl').value,metric:el.querySelector('.rm').value,op:el.querySelector('.ro').value,a:+el.querySelector('.ra').value,b:+el.querySelector('.rb input').value}));
}
function refreshOptimizerRuleList(){
  const opt=$('optRule'),btn=$('optimizeBtn');
  if(!opt)return;
  const rs=currentRules();
  if(!rs.length){opt.innerHTML='<option>No filter rules</option>';opt.disabled=btn.disabled=true;return}
  const old=+opt.value;
  opt.innerHTML=rs.map((r,i)=>`<option value="${i}">Rule ${i+1}: ${esc(S.metrics.get(r.metric)?.fullLabel||r.metric)}</option>`).join('');
  opt.value=Number.isInteger(old)&&old<rs.length?String(old):'0';opt.disabled=btn.disabled=false;
}
function refreshAll(){
  const yes=S.logics.size>0;E.addRule.disabled=E.analyzeBtn.disabled=!yes;
  refreshMeasurement(false);
  if(yes&&!S.filters.length)S.filters=[ruleDefault()];
  if(!yes)S.filters=[];
  renderRules();renderLogicSummary();refreshOptimizerRuleList();
}
function invalidate(){S.analysis=null;E.results.classList.add('hidden')}
function balanced(rows){
  const ms=[...new Set(rows.map(r=>r.machine))],ps=[...new Set(rows.map(r=>r.part))],cell=new Map();
  rows.forEach(r=>{const k=r.part+'\0'+r.machine;if(!cell.has(k))cell.set(k,[]);cell.get(k).push(r)});
  const common=ps.filter(p=>ms.every(m=>(cell.get(p+'\0'+m)||[]).length>=2));
  const min=common.length?Math.min(...common.flatMap(p=>ms.map(m=>cell.get(p+'\0'+m).length))):0,out=[];
  common.forEach(p=>ms.forEach(m=>out.push(...cell.get(p+'\0'+m).slice(0,min))));
  return {rows:out,common,min,machines:ms,cells:cell.size,expected:ps.length*ms.length};
}
async function analyze(){
  if(!S.samples.length)return;
  const rs=currentRules(),join=E.ruleJoin.value,metric=E.measurementMetric.value;
  prog('Selecting parts','Evaluating logic and filter rules…',8);await nap(20);
  const groups=new Map();
  for(const s of S.samples){const p=partId(s);if(!groups.has(p))groups.set(p,[]);groups.get(p).push(s)}
  const selectedByFilter=new Set(),trig=new Map();
  for(const [p,a] of groups){
    let count=0;
    for(const s of a){
      const hits=rs.map(r=>C.compare(s.metrics[r.metric],r.op,r.a,r.b));
      const hit=join==='ALL'?hits.every(Boolean):hits.some(Boolean);
      if(hit)count++;
    }
    if(count){selectedByFilter.add(p);trig.set(p,count)}
  }
  prog('Collecting measurement repeats',`${selectedByFilter.size.toLocaleString()} parts passed filters`,35);await nap(20);
  const rows=[],trial=new Map();
  for(const s of S.samples){
    const p=partId(s),v=s.metrics[metric];if(!selectedByFilter.has(p)||!Number.isFinite(v))continue;
    const f=S.files.find(x=>x.id===s.fileId),mach=f?.machine||'Unknown',k=mach+'\0'+p,n=(trial.get(k)||0)+1;trial.set(k,n);
    const fv=rs.map(r=>s.metrics[r.metric]);
    const hits=rs.map((r,i)=>C.compare(fv[i],r.op,r.a,r.b));
    rows.push({part:p,machine:mach,value:v,trial:n,pcbNo:s.pcbNo,pcbId:s.pcbId,repetition:s.repetition,component:s.component,pin:s.pin==='__COMP__'?'':s.pin,fileName:s.fileName,volumePath:s.volumePath,filterValues:fv,triggerThisRun:join==='ALL'?hits.every(Boolean):hits.some(Boolean)});
  }
  const selected=[...new Set(rows.map(r=>r.part))];
  prog('Calculating stability','Mean, range, SD and CV…',58);await nap(20);
  const byPart=new Map();for(const r of rows){if(!byPart.has(r.part))byPart.set(r.part,[]);byPart.get(r.part).push(r)}
  const summary=selected.map(p=>{
    const a=byPart.get(p)||[],z=C.summarize(a.map(r=>r.value)),fv=a.flatMap(r=>r.filterValues).filter(Number.isFinite);
    return {part:p,...z,filterMin:fv.length?Math.min(...fv):NaN,filterMax:fv.length?Math.max(...fv):NaN,triggerCount:trig.get(p)||0};
  }).sort((a,b)=>b.range-a.range);
  const b=balanced(rows);
  prog('Quick Gage R&R','Crossed ANOVA screening…',78);await nap(20);
  const grr=C.calculateCrossedANOVA(b.rows.map(r=>({part:r.part,machine:r.machine,value:r.value})));
  S.analysis={rules:rs,join,metric,selected,selectedByFilter:[...selectedByFilter],rows,summary,grr,quality:{machines:b.machines,commonParts:b.common.length,cells:b.cells,expectedCells:b.expected,minRepeats:b.min,balancedRows:b.rows.length,filteredParts:selectedByFilter.size,partsWithMeasurement:selected.length}};
  prog('Rendering results','Preparing tables…',94);await nap(20);renderResults();prog('Done','Analysis ready.',100);await nap(100);hide();
}
function row(k,v){return `<div class="metric-row"><span>${k}</span><b>${v}</b></div>`}
function qrow(k,v){return `<div class="quality-item"><span>${k}</span><b>${esc(v)}</b></div>`}
function renderResults(){
  const a=S.analysis;E.results.classList.remove('hidden');
  $('statParts').textContent=a.selected.length.toLocaleString();$('statMeasurements').textContent=a.rows.length.toLocaleString();$('statMachines').textContent=a.quality.machines.length;
  $('statGRR').textContent=a.grr.ok?fmt(a.grr.pctStudyVariation,2)+'%':'N/A';
  $('grrStatus').textContent=a.grr.ok?(a.grr.pctStudyVariation<10?'Good screening result':a.grr.pctStudyVariation<=30?'Review / conditional':'Measurement system concern'):'insufficient design';
  if(a.grr.ok){
    const g=a.grr,cl=g.pctStudyVariation<10?'good':g.pctStudyVariation<=30?'warn':'bad';
    $('grrPanel').innerHTML=`<div class="status-card ${cl}"><b>${g.pctStudyVariation<10?'Good':g.pctStudyVariation<=30?'May be acceptable':'Needs investigation'}</b><br>Quick %Study Variation GR&R = ${fmt(g.pctStudyVariation,2)}%</div>${row('Repeatability variance',fmt(g.variance.repeatability,6))}${row('Reproducibility variance',fmt(g.variance.reproducibility,6))}${row('Machine × Part interaction',fmt(g.variance.interaction,6))}${row('Part-to-Part variance',fmt(g.variance.partToPart,6))}${row('%Contribution GR&R',fmt(g.pctContribution,2)+'%')}${row('ndc',g.ndc===Infinity?'∞':g.ndc)}${row('Balanced design used',`${g.parts} parts × ${g.machines} machines × ${g.repeats} repeats`)}<div class="hint">Screening estimate only. Confirm the official study in Minitab.</div>`;
  }else $('grrPanel').innerHTML=`<div class="status-card warn"><b>GR&R not calculated yet</b><br>${esc(a.grr.reason)}</div><div class="hint">Excel export is still available. Full crossed GR&R needs at least 2 machines and repeated measurements.</div>`;
  const q=a.quality;
  $('qualityPanel').innerHTML=`<div class="quality-list">${qrow('Parts passing filter',q.filteredParts)}${qrow('Parts with measurement data',q.partsWithMeasurement)}${qrow('Machines / appraisers',q.machines.join(', ')||'—')}${qrow('Common parts on every machine',q.commonParts)}${qrow('Observed Part × Machine cells',`${q.cells} / ${q.expectedCells}`)}${qrow('Minimum repeats per common cell',q.minRepeats)}${qrow('Rows used in balanced GR&R',q.balancedRows)}</div><div class="hint" style="margin-top:12px">Quick GR&R balances unequal repeat counts; Excel keeps all selected measurements.</div>`;
  renderTable();
}
function renderTable(){
  if(!S.analysis)return;const q=E.tableSearch.value.trim().toLowerCase();
  E.pinTable.innerHTML=S.analysis.summary.filter(r=>!q||r.part.toLowerCase().includes(q)).slice(0,1500).map(r=>`<tr><td>${esc(r.part)}</td><td>${r.n}</td><td>${fmt(r.mean)}</td><td>${fmt(r.min)}</td><td>${fmt(r.max)}</td><td>${fmt(r.range)}</td><td>${fmt(r.sd)}</td><td>${fmt(r.cv,2)}</td><td>${fmt(r.filterMin)}</td><td>${fmt(r.filterMax)}</td></tr>`).join('');
}
function sheet(rows,cols){
  const a=rows.map(r=>Object.fromEntries(cols.map(c=>[c,xlsSafe(r[c])])));
  const ws=XLSX.utils.json_to_sheet(a,{header:cols});ws['!cols']=cols.map(c=>({wch:Math.min(55,Math.max(12,c.length+2,...a.slice(0,300).map(r=>String(r[c]??'').length+2)))}));
  if(ws['!ref'])ws['!autofilter']={ref:ws['!ref']};return ws;
}
async function exportX(){
  if(!S.analysis||!window.XLSX)return toast('Excel library unavailable. Reload with internet connection.');
  const a=S.analysis,wb=XLSX.utils.book_new(),mi=S.metrics.get(a.metric),ml=S.logics.get(mi?.logicKey);
  prog('Creating Excel workbook','Minitab sheet…',8);await nap(20);
  const mini=a.rows.map(r=>({Part:r.part,Machine:r.machine,Measurement:r.value,Trial:r.trial,PCB_ID:r.pcbId,Component:r.component,Pin:r.pin,Measurement_Logic:ml?.label||'',Measurement_Name:mi?.label||'',Source_File:r.fileName}));
  XLSX.utils.book_append_sheet(wb,sheet(mini,['Part','Machine','Measurement','Trial','PCB_ID','Component','Pin','Measurement_Logic','Measurement_Name','Source_File']),'Minitab_GRR');
  const st=a.summary.map(r=>({Part:r.part,N:r.n,Mean:r.mean,Min:r.min,Max:r.max,Range:r.range,SD:r.sd,CV_Percent:r.cv,Filter_Min:r.filterMin,Filter_Max:r.filterMax,Trigger_Count:r.triggerCount}));
  XLSX.utils.book_append_sheet(wb,sheet(st,['Part','N','Mean','Min','Max','Range','SD','CV_Percent','Filter_Min','Filter_Max','Trigger_Count']),'Part_Stability');
  XLSX.utils.book_append_sheet(wb,sheet(a.selected.map(p=>({Part:p,Selected:'Yes',Trigger_Count:a.summary.find(x=>x.part===p)?.triggerCount||0})),['Part','Selected','Trigger_Count']),'Selected_Parts');
  prog('Creating Excel workbook','Traceability and GR&R summary…',45);await nap(20);
  const det=a.rows.map(r=>{
    const o={Machine:r.machine,Part:r.part,Trial:r.trial,Measurement:r.value,Component:r.component,Pin:r.pin,PCB_No:r.pcbNo,PCB_ID:r.pcbId,Repetition:r.repetition,Trigger_This_Run:r.triggerThisRun?'Yes':'No',Source_File:r.fileName,Volume_Data_Path:r.volumePath};
    a.rules.forEach((rule,i)=>{o[`Filter_${i+1}_Logic`]=S.logics.get(rule.logic)?.label||rule.logic;o[`Filter_${i+1}_Metric`]=S.metrics.get(rule.metric)?.label||rule.metric;o[`Filter_${i+1}_Value`]=Number.isFinite(r.filterValues[i])?r.filterValues[i]:''});
    return o;
  });
  const detCols=['Machine','Part','Trial','Measurement','Component','Pin','PCB_No','PCB_ID','Repetition','Trigger_This_Run',...a.rules.flatMap((_,i)=>[`Filter_${i+1}_Logic`,`Filter_${i+1}_Metric`,`Filter_${i+1}_Value`]),'Source_File','Volume_Data_Path'];
  XLSX.utils.book_append_sheet(wb,sheet(det,detCols),'All_Selected_Data');
  const g=a.grr.ok?[
    {Metric:'Method',Value:'Crossed Gage R&R — ANOVA screening'},{Metric:'Parts used',Value:a.grr.parts},{Metric:'Machines used',Value:a.grr.machines},{Metric:'Repeats per cell',Value:a.grr.repeats},
    {Metric:'Repeatability variance',Value:a.grr.variance.repeatability},{Metric:'Reproducibility variance',Value:a.grr.variance.reproducibility},{Metric:'Machine × Part variance',Value:a.grr.variance.interaction},{Metric:'Part-to-Part variance',Value:a.grr.variance.partToPart},
    {Metric:'%Study Variation GRR',Value:a.grr.pctStudyVariation},{Metric:'%Contribution GRR',Value:a.grr.pctContribution},{Metric:'ndc',Value:a.grr.ndc===Infinity?'Infinity':a.grr.ndc},{Metric:'Note',Value:'Screening only; confirm in Minitab.'}
  ]:[{Metric:'GRR status',Value:a.grr.reason}];
  XLSX.utils.book_append_sheet(wb,sheet(g,['Metric','Value']),'GRR_Summary');
  const catalog=[...S.metrics.values()].map(m=>{const l=S.logics.get(m.logicKey);return {Inspection_Logic:l?.inspectionName||'',Inspection_ID:l?.inspectionId||'',Window_Type:l?.windowType||'',Measurement:m.criteriaName,Unit:m.unit,Numeric_Data_Points:m.count,Logic_Key:m.logicKey,Metric_Key:m.key}});
  XLSX.utils.book_append_sheet(wb,sheet(catalog,['Inspection_Logic','Inspection_ID','Window_Type','Measurement','Unit','Numeric_Data_Points','Logic_Key','Metric_Key']),'Logic_Catalog');
  const il=S.files.map(f=>({File:f.name,Machine:f.machine,Detected_Machine:f.detected,System_Name:f.meta['System Name']||'',Inspection_Date:f.meta['Inspection Date']||'',Inspection_Time:f.meta['Inspection Time']||'',Program:f.meta['Inspection Program Name']||'',Indexed_Samples:f.samples,Numeric_Rows:f.numericRows,CSV_Rows:f.rows}));
  XLSX.utils.book_append_sheet(wb,sheet(il,['File','Machine','Detected_Machine','System_Name','Inspection_Date','Inspection_Time','Program','Indexed_Samples','Numeric_Rows','CSV_Rows']),'Import_Log');
  const set=[{Setting:'Measurement logic',Value:ml?.label||''},{Setting:'Measurement metric',Value:mi?.label||a.metric},{Setting:'Part ID',Value:E.partMode.value},{Setting:'Rule join',Value:a.join},{Setting:'Selection behavior',Value:'Match once => keep every available measurement repeat for that Part'},...a.rules.flatMap((r,i)=>[{Setting:`Filter ${i+1} logic`,Value:S.logics.get(r.logic)?.label||r.logic},{Setting:`Filter ${i+1} metric`,Value:S.metrics.get(r.metric)?.label||r.metric},{Setting:`Filter ${i+1} condition`,Value:r.op},{Setting:`Filter ${i+1} value A`,Value:r.a},{Setting:`Filter ${i+1} value B`,Value:['between','outside'].includes(r.op)?r.b:''}])];
  XLSX.utils.book_append_sheet(wb,sheet(set,['Setting','Value']),'Settings');
  prog('Creating Excel workbook','Compressing…',85);await nap(30);
  const stamp=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');XLSX.writeFile(wb,`XRay_GRR_${stamp}.xlsx`,{compression:true});
  prog('Excel exported','Download started.',100);await nap(220);hide();
}
function reset(){
  S.files=[];S.samples=[];S.metrics=new Map();S.logics=new Map();S.filters=[];S.analysis=null;S.id=1;E.fileInput.value='';
  renderFiles();refreshAll();invalidate();
}
E.fileInput.onchange=e=>load([...e.target.files]).catch(x=>{hide();console.error(x);toast(x.message||'Import failed')});
E.addRule.onclick=()=>{S.filters.push(ruleDefault());renderRules();refreshOptimizerRuleList();invalidate()};
E.analyzeBtn.onclick=()=>analyze().catch(x=>{hide();console.error(x);toast(x.message||'Analysis failed')});
E.resetBtn.onclick=reset;
E.exportBtn.onclick=()=>exportX().catch(x=>{hide();console.error(x);toast(x.message||'Export failed')});
E.tableSearch.oninput=renderTable;
E.partMode.onchange=()=>{invalidate()};
E.measurementLogic.onchange=()=>{refreshMeasurement(true);invalidate()};
E.measurementMetric.onchange=()=>{const m=S.metrics.get(E.measurementMetric.value);E.measurementCoverage.textContent=m?`${m.count.toLocaleString()} values`:'—';invalidate()};
E.ruleJoin.onchange=invalidate;
if('serviceWorker'in navigator)addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));

window.XGRRApp={
  getState:()=>S,
  getPartId:partId,
  getCurrentRules:currentRules,
  getMeasurementMetric:()=>E.measurementMetric.value,
  getMetric:key=>S.metrics.get(key),
  getLogic:key=>S.logics.get(key),
  balanced,
  progress:prog,hideProgress:hide,toast,
  applyRuleThreshold:(index,direction,threshold)=>{
    const el=E.rules.querySelector(`.rule[data-i="${index}"]`);if(!el)return false;
    el.querySelector('.ro').value=direction;el.querySelector('.ra').value=threshold;
    el.querySelector('.ro').dispatchEvent(new Event('change',{bubbles:true}));el.querySelector('.ra').dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  },
  analyze
};
renderFiles();refreshAll();
})();