(function(global){
'use strict';

const EPS = 1e-12;
const DEFAULT_INTERACTION_ALPHA = 0.05;
const num = v => Number.isFinite(+v) ? +v : NaN;
const mean = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : NaN;
const variance = (a, sample=true) => {
  if (a.length < (sample ? 2 : 1)) return NaN;
  const m = mean(a);
  return a.reduce((s,v)=>s+(v-m)*(v-m),0)/(a.length-(sample?1:0));
};
const sd = a => Math.sqrt(Math.max(0, variance(a,true)));

const enc = v => String(v ?? '').replaceAll('§',' ');
const logicKey = r => [enc(r['Window Type']),enc(r['Inspection Name']),enc(r['Inspection ID'])].join('§');
const logicInfo = key => {
  const [windowType='',inspectionName='',inspectionId=''] = String(key||'').split('§');
  return {windowType,inspectionName,inspectionId};
};
const logicLabel = key => {
  const x=logicInfo(key), name=x.inspectionName||x.windowType||'Unnamed logic';
  return `${name}${x.inspectionId?` · ID ${x.inspectionId}`:''}${x.windowType&&x.windowType!==x.inspectionName?` · ${x.windowType}`:''}`;
};
const metricKey = r => [enc(r['Window Type']),enc(r['Inspection Name']),enc(r['Inspection ID']),enc(r['Inspection Criteria Name']),enc(r['Unit'])].join('§');
const metricInfo = key => {
  const [windowType='',inspectionName='',inspectionId='',criteriaName='',unit=''] = String(key||'').split('§');
  return {windowType,inspectionName,inspectionId,criteriaName,unit,logicKey:[windowType,inspectionName,inspectionId].join('§')};
};
const metricLabel = key => {
  const x=metricInfo(key);
  return `${x.criteriaName||'(unnamed measurement)'}${x.unit?` [${x.unit}]`:''}`;
};
const metricFullLabel = key => `${logicLabel(metricInfo(key).logicKey)} → ${metricLabel(key)}`;

function compare(v,op,a,b){
  v=+v; a=+a; b=+b;
  if(!Number.isFinite(v)||!Number.isFinite(a)) return false;
  switch(op){
    case '>': return v>a;
    case '>=': return v>=a;
    case '<': return v<a;
    case '<=': return v<=a;
    case '=': return Math.abs(v-a)<EPS;
    case 'between': return Number.isFinite(b)&&v>=Math.min(a,b)&&v<=Math.max(a,b);
    case 'outside': return Number.isFinite(b)&&(v<Math.min(a,b)||v>Math.max(a,b));
    default: return false;
  }
}

function summarize(values){
  values=values.map(num).filter(Number.isFinite);
  if(!values.length) return {n:0,mean:NaN,min:NaN,max:NaN,range:NaN,sd:NaN,cv:NaN};
  const m=mean(values),lo=Math.min(...values),hi=Math.max(...values),s=sd(values);
  return {n:values.length,mean:m,min:lo,max:hi,range:hi-lo,sd:s,cv:Number.isFinite(s)&&Math.abs(m)>EPS?Math.abs(s/m)*100:NaN};
}

function logGamma(z){
  const c=[0.99999999999980993,676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.984369578019571e-6,1.5056327351493116e-7];
  if(z<0.5) return Math.log(Math.PI)-Math.log(Math.sin(Math.PI*z))-logGamma(1-z);
  z-=1;
  let x=c[0];
  for(let i=1;i<c.length;i++) x+=c[i]/(z+i);
  const t=z+7.5;
  return 0.5*Math.log(2*Math.PI)+(z+0.5)*Math.log(t)-t+Math.log(x);
}
function betaContinuedFraction(a,b,x){
  const MAX=300, FPMIN=1e-300, EPSCF=3e-14;
  let qab=a+b,qap=a+1,qam=a-1,c=1,d=1-qab*x/qap;
  if(Math.abs(d)<FPMIN)d=FPMIN;
  d=1/d;
  let h=d;
  for(let m=1;m<=MAX;m++){
    const m2=2*m;
    let aa=m*(b-m)*x/((qam+m2)*(a+m2));
    d=1+aa*d;if(Math.abs(d)<FPMIN)d=FPMIN;
    c=1+aa/c;if(Math.abs(c)<FPMIN)c=FPMIN;
    d=1/d;h*=d*c;
    aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2));
    d=1+aa*d;if(Math.abs(d)<FPMIN)d=FPMIN;
    c=1+aa/c;if(Math.abs(c)<FPMIN)c=FPMIN;
    d=1/d;
    const del=d*c;h*=del;
    if(Math.abs(del-1)<EPSCF)break;
  }
  return h;
}
function regularizedBeta(x,a,b){
  if(x<=0)return 0;
  if(x>=1)return 1;
  const bt=Math.exp(logGamma(a+b)-logGamma(a)-logGamma(b)+a*Math.log(x)+b*Math.log1p(-x));
  if(x<(a+1)/(a+b+2)) return bt*betaContinuedFraction(a,b,x)/a;
  return 1-bt*betaContinuedFraction(b,a,1-x)/b;
}
function fSurvival(f,df1,df2){
  if(!(df1>0&&df2>0))return NaN;
  if(f<=0)return 1;
  if(!Number.isFinite(f))return 0;
  const x=(df1*f)/(df1*f+df2);
  const cdf=regularizedBeta(x,df1/2,df2/2);
  return Math.max(0,Math.min(1,1-cdf));
}

function contribution(varComp,total){return total>EPS?100*varComp/total:NaN;}
function studyPct(varComp,total){return total>EPS?100*Math.sqrt(Math.max(varComp,0))/Math.sqrt(total):NaN;}
function ndcFrom(partVar,gaugeVar){
  const sGauge=Math.sqrt(Math.max(0,gaugeVar)), sPart=Math.sqrt(Math.max(0,partVar));
  return sGauge>EPS?Math.max(1,Math.floor(1.41*sPart/sGauge)):Infinity;
}

function calculateCrossedANOVA(rows,options={}){
  rows=rows.filter(r=>r&&Number.isFinite(+r.value)&&r.part!=null&&r.machine!=null)
    .map(r=>({part:String(r.part),machine:String(r.machine),value:+r.value}));
  const parts=[...new Set(rows.map(r=>r.part))],machines=[...new Set(rows.map(r=>r.machine))];
  if(parts.length<2||machines.length<2)return {ok:false,reason:'Need at least 2 parts and 2 machines.'};
  const cells=new Map();
  for(const r of rows){const k=r.part+'\0'+r.machine;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(r.value);}
  const counts=[];
  for(const p of parts)for(const m of machines)counts.push((cells.get(p+'\0'+m)||[]).length);
  if(counts.some(c=>c<2)||new Set(counts).size!==1)return {ok:false,reason:'Dataset is not balanced with at least 2 repeats per Part × Machine cell.'};

  const rep=counts[0],n=parts.length,a=machines.length,grand=mean(rows.map(x=>x.value));
  const partMean=new Map(parts.map(p=>[p,mean(rows.filter(x=>x.part===p).map(x=>x.value))]));
  const machineMean=new Map(machines.map(m=>[m,mean(rows.filter(x=>x.machine===m).map(x=>x.value))]));
  const cellMean=new Map();
  for(const p of parts)for(const m of machines)cellMean.set(p+'\0'+m,mean(cells.get(p+'\0'+m)));
  let ssP=0,ssM=0,ssI=0,ssE=0;
  for(const p of parts)ssP+=a*rep*Math.pow(partMean.get(p)-grand,2);
  for(const m of machines)ssM+=n*rep*Math.pow(machineMean.get(m)-grand,2);
  for(const p of parts)for(const m of machines){
    const cm=cellMean.get(p+'\0'+m);
    ssI+=rep*Math.pow(cm-partMean.get(p)-machineMean.get(m)+grand,2);
    for(const y of cells.get(p+'\0'+m))ssE+=Math.pow(y-cm,2);
  }
  const dfP=n-1,dfM=a-1,dfI=(n-1)*(a-1),dfE=n*a*(rep-1);
  const msP=ssP/dfP,msM=ssM/dfM,msI=ssI/dfI,msE=ssE/dfE;
  const fInteraction=msE>EPS?msI/msE:(msI>EPS?Infinity:0);
  const pInteraction=fSurvival(fInteraction,dfI,dfE);
  const alpha=Number.isFinite(+options.alpha)?Math.max(0,Math.min(1,+options.alpha)):DEFAULT_INTERACTION_ALPHA;
  const keepInteraction=Number.isFinite(pInteraction)?pInteraction<alpha:true;

  let varRepeat,varInteraction,varMachine,varPart,usedErrorMS,usedErrorDF,usedErrorSS,model;
  if(keepInteraction){
    model='with_interaction';
    varRepeat=Math.max(msE,0);
    varInteraction=Math.max((msI-msE)/rep,0);
    varMachine=Math.max((msM-msI)/(n*rep),0);
    varPart=Math.max((msP-msI)/(a*rep),0);
    usedErrorMS=msE;usedErrorDF=dfE;usedErrorSS=ssE;
  }else{
    model='without_interaction';
    usedErrorSS=ssI+ssE;usedErrorDF=dfI+dfE;usedErrorMS=usedErrorSS/usedErrorDF;
    varRepeat=Math.max(usedErrorMS,0);
    varInteraction=0;
    varMachine=Math.max((msM-usedErrorMS)/(n*rep),0);
    varPart=Math.max((msP-usedErrorMS)/(a*rep),0);
  }
  const varRepro=varMachine+varInteraction,varGRR=varRepeat+varRepro,varTotal=varGRR+varPart;
  const sRepeat=Math.sqrt(varRepeat),sRepro=Math.sqrt(varRepro),sGRR=Math.sqrt(varGRR),sPart=Math.sqrt(varPart),sTotal=Math.sqrt(varTotal);
  const pctContribution=contribution(varGRR,varTotal),pctStudyVariation=studyPct(varGRR,varTotal),ndc=ndcFrom(varPart,varGRR);
  const pctContributionBySource={
    totalGRR:pctContribution,
    repeatability:contribution(varRepeat,varTotal),
    reproducibility:contribution(varRepro,varTotal),
    machine:contribution(varMachine,varTotal),
    interaction:contribution(varInteraction,varTotal),
    partToPart:contribution(varPart,varTotal)
  };
  const pctStudyVariationBySource={
    totalGRR:pctStudyVariation,
    repeatability:studyPct(varRepeat,varTotal),
    reproducibility:studyPct(varRepro,varTotal),
    machine:studyPct(varMachine,varTotal),
    interaction:studyPct(varInteraction,varTotal),
    partToPart:studyPct(varPart,varTotal)
  };
  return {
    ok:true,method:'crossed_grr_anova',model,parts:n,machines:a,repeats:rep,observations:rows.length,
    interactionAlpha:alpha,interactionF:fInteraction,interactionPValue:pInteraction,interactionIncluded:keepInteraction,
    variance:{repeatability:varRepeat,machine:varMachine,interaction:varInteraction,reproducibility:varRepro,grr:varGRR,partToPart:varPart,total:varTotal},
    stdDev:{repeatability:sRepeat,reproducibility:sRepro,grr:sGRR,partToPart:sPart,total:sTotal},
    studyVariation:{repeatability:6*sRepeat,reproducibility:6*sRepro,grr:6*sGRR,partToPart:6*sPart,total:6*sTotal},
    pctStudyVariation,pctContribution,pctContributionBySource,pctStudyVariationBySource,ndc,
    anova:{
      full:{ssPart:ssP,ssMachine:ssM,ssInteraction:ssI,ssError:ssE,dfPart:dfP,dfMachine:dfM,dfInteraction:dfI,dfError:dfE,msPart:msP,msMachine:msM,msInteraction:msI,msError:msE},
      used:{ssPart:ssP,ssMachine:ssM,ssError:usedErrorSS,dfPart:dfP,dfMachine:dfM,dfError:usedErrorDF,msPart:msP,msMachine:msM,msError:usedErrorMS}
    }
  };
}

function calculateSingleMachineRepeatability(rows){
  rows=rows.filter(r=>r&&Number.isFinite(+r.value)&&r.part!=null)
    .map(r=>({part:String(r.part),value:+r.value,machine:String(r.machine??'')}));
  const groups=new Map();
  for(const r of rows){if(!groups.has(r.part))groups.set(r.part,[]);groups.get(r.part).push(r.value);}
  const repeatGroups=[...groups.entries()].filter(([,v])=>v.length>=2);
  if(repeatGroups.length<2)return {ok:false,reason:'Need at least 2 repeated pins/parts with 2 or more measurements each.'};
  const vals=repeatGroups.flatMap(([,v])=>v),N=vals.length,k=repeatGroups.length,grand=mean(vals);
  let ssWithin=0,ssBetween=0,sumN2=0;const ranges=[];
  for(const [,v] of repeatGroups){
    const m=mean(v);sumN2+=v.length*v.length;ssBetween+=v.length*Math.pow(m-grand,2);
    for(const y of v)ssWithin+=Math.pow(y-m,2);
    ranges.push(Math.max(...v)-Math.min(...v));
  }
  const dfWithin=N-k,dfBetween=k-1;
  if(dfWithin<=0||dfBetween<=0)return {ok:false,reason:'Not enough repeated observations.'};
  const msWithin=ssWithin/dfWithin,msBetween=ssBetween/dfBetween,n0=(N-sumN2/N)/(k-1);
  const varRepeat=Math.max(msWithin,0),varPart=Math.max(n0>EPS?(msBetween-msWithin)/n0:0,0),varTotal=varRepeat+varPart;
  const sRepeat=Math.sqrt(varRepeat),sPart=Math.sqrt(varPart),sTotal=Math.sqrt(varTotal);
  const pctStudyVariation=studyPct(varRepeat,varTotal),pctContribution=contribution(varRepeat,varTotal),ndc=ndcFrom(varPart,varRepeat),counts=repeatGroups.map(([,v])=>v.length);
  return {
    ok:true,method:'single_machine_repeatability',parts:k,machines:[...new Set(rows.map(r=>r.machine).filter(Boolean))].length||1,
    repeatsMin:Math.min(...counts),repeatsMax:Math.max(...counts),observations:N,
    variance:{repeatability:varRepeat,partToPart:varPart,total:varTotal},
    stdDev:{repeatability:sRepeat,partToPart:sPart,total:sTotal},
    studyVariation:{repeatability:6*sRepeat,partToPart:6*sPart,total:6*sTotal},
    pctStudyVariation,pctContribution,
    pctContributionBySource:{repeatability:pctContribution,partToPart:contribution(varPart,varTotal)},
    pctStudyVariationBySource:{repeatability:pctStudyVariation,partToPart:studyPct(varPart,varTotal)},
    ndc,repeatabilitySD:sRepeat,meanRange:mean(ranges),maxRange:Math.max(...ranges),
    anova:{ssPart:ssBetween,ssError:ssWithin,dfPart:dfBetween,dfError:dfWithin,msPart:msBetween,msError:msWithin,effectiveRepeats:n0}
  };
}

function calculateProcessVariation(rows){
  rows=rows.filter(r=>r&&Number.isFinite(+r.value)&&r.part!=null&&r.board!=null&&String(r.board)!=='')
    .map(r=>({part:String(r.part),board:String(r.board),value:+r.value}));
  const parts=[...new Set(rows.map(r=>r.part))],boards=[...new Set(rows.map(r=>r.board))];
  if(parts.length<2||boards.length<2)return {ok:false,reason:'Need at least 2 physical boards and 2 common pins/parts.'};
  const cell=new Map();
  for(const r of rows){const k=r.part+'\0'+r.board;if(!cell.has(k))cell.set(k,[]);cell.get(k).push(r.value);}
  const common=parts.filter(p=>boards.every(b=>(cell.get(p+'\0'+b)||[]).length>=1));
  if(common.length<2)return {ok:false,reason:'Need at least 2 pins/parts measured on every physical board.'};
  const data=[];
  for(const p of common)for(const b of boards){const v=cell.get(p+'\0'+b);data.push({part:p,board:b,value:mean(v)});}
  const P=common.length,B=boards.length,grand=mean(data.map(r=>r.value));
  const partMean=new Map(common.map(p=>[p,mean(data.filter(r=>r.part===p).map(r=>r.value))]));
  const boardMean=new Map(boards.map(b=>[b,mean(data.filter(r=>r.board===b).map(r=>r.value))]));
  let ssP=0,ssB=0,ssE=0;
  for(const p of common)ssP+=B*Math.pow(partMean.get(p)-grand,2);
  for(const b of boards)ssB+=P*Math.pow(boardMean.get(b)-grand,2);
  for(const r of data)ssE+=Math.pow(r.value-partMean.get(r.part)-boardMean.get(r.board)+grand,2);
  const dfP=P-1,dfB=B-1,dfE=(P-1)*(B-1),msP=ssP/dfP,msB=ssB/dfB,msE=ssE/dfE;
  const varResidual=Math.max(msE,0),varBoard=Math.max((msB-msE)/P,0),varPart=Math.max((msP-msE)/B,0),varProcess=varBoard+varResidual,varTotal=varProcess+varPart;
  const sProcess=Math.sqrt(varProcess),sBoard=Math.sqrt(varBoard),sResidual=Math.sqrt(varResidual),sPart=Math.sqrt(varPart),sTotal=Math.sqrt(varTotal);
  const pctStudyVariation=studyPct(varProcess,varTotal),pctContribution=contribution(varProcess,varTotal),cv=Math.abs(grand)>EPS?100*sProcess/Math.abs(grand):NaN;
  const boardStats=boards.map(b=>({board:b,...summarize(data.filter(r=>r.board===b).map(r=>r.value))})).sort((a,b)=>b.mean-a.mean);
  return {
    ok:true,method:'production_process',parts:P,boards:B,observations:data.length,grandMean:grand,
    variance:{boardToBoard:varBoard,residual:varResidual,process:varProcess,partToPart:varPart,total:varTotal},
    sd:{boardToBoard:sBoard,residual:sResidual,process:sProcess,partToPart:sPart,total:sTotal},
    studyVariation:{process:6*sProcess,boardToBoard:6*sBoard,residual:6*sResidual,total:6*sTotal},
    pctStudyVariation,pctContribution,processCV:cv,commonParts:P,
    pctContributionBySource:{process:pctContribution,boardToBoard:contribution(varBoard,varTotal),residual:contribution(varResidual,varTotal),partToPart:contribution(varPart,varTotal)},
    pctStudyVariationBySource:{process:pctStudyVariation,boardToBoard:studyPct(varBoard,varTotal),residual:studyPct(varResidual,varTotal),partToPart:studyPct(varPart,varTotal)},
    boardStats,anova:{ssPart:ssP,ssBoard:ssB,ssResidual:ssE,dfPart:dfP,dfBoard:dfB,dfResidual:dfE,msPart:msP,msBoard:msB,msResidual:msE}
  };
}

function varianceContributionClass(pct){
  if(!Number.isFinite(+pct))return {key:'unknown',label:'N/A'};
  pct=+pct;
  if(pct<1)return {key:'good',label:'Acceptable (<1% of variance components)'};
  if(pct<=9)return {key:'warn',label:'Conditional (1–9% of variance components)'};
  return {key:'bad',label:'Needs improvement (>9% of variance components)'};
}

function selfTest(){
  const checks=[];
  const add=(name,ok,detail='')=>checks.push({name,ok:!!ok,detail});
  const approx=(a,b,tol=1e-9)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tol*Math.max(1,Math.abs(a),Math.abs(b));
  add('F survival matches Minitab interaction example',approx(fSurvival(0.434,18,60),0.974,0.002),`p=${fSurvival(0.434,18,60)}`);
  const repRows=[];
  for(let p=1;p<=6;p++)for(let r=0;r<4;r++)repRows.push({part:String(p),machine:'M1',value:p*10+[-0.3,0.2,-0.1,0.2][r]});
  const rr=calculateSingleMachineRepeatability(repRows);
  add('Single-machine repeatability calculable',rr.ok);
  add('%Contribution = (%StudyVar)^2 / 100',rr.ok&&approx(rr.pctContribution,rr.pctStudyVariation*rr.pctStudyVariation/100,1e-10),`${rr.pctContribution} vs ${rr.pctStudyVariation}`);
  const crossRows=[];
  for(let p=1;p<=5;p++)for(const m of ['A','B'])for(let r=0;r<3;r++)crossRows.push({part:String(p),machine:m,value:p*10+(m==='B'?0.4:0)+[-0.2,0,0.2][r]});
  const cr=calculateCrossedANOVA(crossRows);
  add('Crossed ANOVA calculable',cr.ok);
  add('Crossed %Contribution identity',cr.ok&&approx(cr.pctContribution,cr.pctStudyVariation*cr.pctStudyVariation/100,1e-10));
  add('Crossed variance components sum to total',cr.ok&&approx(cr.variance.grr+cr.variance.partToPart,cr.variance.total,1e-12));
  const procRows=[];
  for(let p=1;p<=5;p++)for(let b=1;b<=4;b++)procRows.push({part:String(p),board:String(b),value:p*10+b*0.2+((p*b)%3-1)*0.05});
  const pr=calculateProcessVariation(procRows);
  add('Process variation calculable',pr.ok);
  add('Process %Contribution identity',pr.ok&&approx(pr.pctContribution,pr.pctStudyVariation*pr.pctStudyVariation/100,1e-10));
  return {ok:checks.every(x=>x.ok),checks};
}

global.XGRRCore={
  mean,sd,summarize,logicKey,logicInfo,logicLabel,metricKey,metricInfo,metricLabel,metricFullLabel,compare,
  fSurvival,calculateCrossedANOVA,calculateSingleMachineRepeatability,calculateProcessVariation,varianceContributionClass,selfTest,
  DEFAULT_INTERACTION_ALPHA
};
})(typeof window!=='undefined'?window:globalThis);
