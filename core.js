(function(global){
  'use strict';
  const EPS = 1e-12;
  const num = v => Number.isFinite(+v) ? +v : NaN;
  const mean = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : NaN;
  const variance = (a, sample=true) => {
    if (a.length < (sample ? 2 : 1)) return NaN;
    const m=mean(a), d=a.reduce((s,v)=>s+(v-m)*(v-m),0);
    return d/(a.length-(sample?1:0));
  };
  const sd = a => Math.sqrt(Math.max(0, variance(a,true)));
  const min = a => a.length ? Math.min(...a) : NaN;
  const max = a => a.length ? Math.max(...a) : NaN;
  const metricKey = r => [r['Window Type']||'',r['Inspection Name']||'',r['Inspection Criteria Name']||'',r['Unit']||''].join('§');
  const metricLabel = key => {
    const [w,i,c,u]=key.split('§');
    return `${i || w || 'Measurement'} · ${c || '(unnamed)'}${u ? ` [${u}]` : ''}${w && w!==i ? ` — ${w}` : ''}`;
  };
  function compare(v, op, a, b){
    v=+v; a=+a; b=+b;
    if(!Number.isFinite(v) || !Number.isFinite(a)) return false;
    switch(op){
      case '>': return v>a;
      case '>=': return v>=a;
      case '<': return v<a;
      case '<=': return v<=a;
      case '=': return Math.abs(v-a)<EPS;
      case 'between': return Number.isFinite(b) && v>=Math.min(a,b) && v<=Math.max(a,b);
      case 'outside': return Number.isFinite(b) && (v<Math.min(a,b) || v>Math.max(a,b));
      default: return false;
    }
  }
  function summarize(values){
    values=values.map(num).filter(Number.isFinite);
    const m=mean(values), lo=min(values), hi=max(values), s=sd(values);
    return {n:values.length, mean:m, min:lo, max:hi, range:hi-lo, sd:s, cv:Number.isFinite(s)&&Math.abs(m)>EPS ? Math.abs(s/m)*100 : NaN};
  }
  function calculateCrossedANOVA(rows){
    // rows: {part,machine,value}; must be balanced, >=2 parts, >=2 machines, >=2 repeats/cell
    const parts=[...new Set(rows.map(r=>r.part))];
    const machines=[...new Set(rows.map(r=>r.machine))];
    if(parts.length<2 || machines.length<2) return {ok:false, reason:'Need at least 2 parts and 2 machines.'};
    const cells=new Map();
    for(const r of rows){
      const k=r.part+'\u0000'+r.machine;
      if(!cells.has(k)) cells.set(k,[]);
      cells.get(k).push(+r.value);
    }
    const counts=[];
    for(const p of parts) for(const m of machines){
      const arr=cells.get(p+'\u0000'+m)||[];
      counts.push(arr.length);
    }
    if(counts.some(c=>c<2) || new Set(counts).size!==1) return {ok:false, reason:'Dataset is not balanced with at least 2 repeats per Part × Machine cell.'};
    const r=counts[0], n=parts.length, a=machines.length;
    const all=rows.map(x=>+x.value), grand=mean(all);
    const partMean=new Map(parts.map(p=>[p,mean(rows.filter(x=>x.part===p).map(x=>+x.value))]));
    const machineMean=new Map(machines.map(m=>[m,mean(rows.filter(x=>x.machine===m).map(x=>+x.value))]));
    const cellMean=new Map();
    for(const p of parts) for(const m of machines) cellMean.set(p+'\u0000'+m, mean(cells.get(p+'\u0000'+m)));
    let ssP=0, ssM=0, ssI=0, ssE=0;
    for(const p of parts) ssP += a*r*Math.pow(partMean.get(p)-grand,2);
    for(const m of machines) ssM += n*r*Math.pow(machineMean.get(m)-grand,2);
    for(const p of parts) for(const m of machines){
      const cm=cellMean.get(p+'\u0000'+m);
      ssI += r*Math.pow(cm-partMean.get(p)-machineMean.get(m)+grand,2);
      for(const y of cells.get(p+'\u0000'+m)) ssE += Math.pow(y-cm,2);
    }
    const dfP=n-1, dfM=a-1, dfI=(n-1)*(a-1), dfE=n*a*(r-1);
    const msP=ssP/dfP, msM=ssM/dfM, msI=ssI/dfI, msE=ssE/dfE;
    const varRepeat=Math.max(msE,0);
    const varInteraction=Math.max((msI-msE)/r,0);
    const varMachine=Math.max((msM-msI)/(n*r),0);
    const varPart=Math.max((msP-msI)/(a*r),0);
    const varRepro=varMachine+varInteraction;
    const varGRR=varRepeat+varRepro;
    const varTotal=varGRR+varPart;
    const sGRR=Math.sqrt(varGRR), sPart=Math.sqrt(varPart), sTotal=Math.sqrt(varTotal);
    const pctStudy = sTotal>EPS ? 100*sGRR/sTotal : NaN;
    const pctContribution = varTotal>EPS ? 100*varGRR/varTotal : NaN;
    const ndc = sGRR>EPS ? Math.max(1,Math.floor(1.41*sPart/sGRR)) : Infinity;
    return {
      ok:true, parts:n, machines:a, repeats:r, observations:rows.length,
      variance:{repeatability:varRepeat,machine:varMachine,interaction:varInteraction,reproducibility:varRepro,grr:varGRR,partToPart:varPart,total:varTotal},
      studyVariation:{repeatability:6*Math.sqrt(varRepeat),reproducibility:6*Math.sqrt(varRepro),grr:6*sGRR,partToPart:6*sPart,total:6*sTotal},
      pctStudyVariation:pctStudy, pctContribution, ndc,
      anova:{ssPart:ssP,ssMachine:ssM,ssInteraction:ssI,ssError:ssE,dfPart:dfP,dfMachine:dfM,dfInteraction:dfI,dfError:dfE,msPart:msP,msMachine:msM,msInteraction:msI,msError:msE}
    };
  }
  global.XGRRCore={mean,sd,summarize,metricKey,metricLabel,compare,calculateCrossedANOVA};
})(window);
