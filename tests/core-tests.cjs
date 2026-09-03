'use strict';
const assert=require('node:assert/strict');
global.window=global;
require('../core.js');
const C=global.XGRRCore;
const approx=(a,b,tol=1e-6)=>Math.abs(a-b)<=tol*Math.max(1,Math.abs(a),Math.abs(b));

const qa=C.selfTest();
assert.equal(qa.ok,true,JSON.stringify(qa.checks,null,2));

// Minitab published Crossed Gage R&R example.
// Interaction p = 0.974, so alpha=0.05 pools Part*Operator into Repeatability.
const ssI=0.3590,ssE=2.7589,dfI=18,dfE=60,msP=9.81799,msM=1.58363,nParts=10,nMachines=3,repeats=3;
const msI=ssI/dfI,msE=ssE/dfE,p=C.fSurvival(msI/msE,dfI,dfE);
assert.ok(approx(p,0.974,0.002),`Minitab interaction p regression: ${p}`);
const pooled=(ssI+ssE)/(dfI+dfE);
const varRepeat=pooled;
const varMachine=Math.max((msM-pooled)/(nParts*repeats),0);
const varPart=Math.max((msP-pooled)/(nMachines*repeats),0);
const varGRR=varRepeat+varMachine,total=varGRR+varPart;
const pctContribution=100*varGRR/total,pctStudy=100*Math.sqrt(varGRR/total);
assert.ok(approx(varRepeat,0.03997,5e-4),`Repeatability VarComp ${varRepeat}`);
assert.ok(approx(varMachine,0.05146,5e-4),`Reproducibility VarComp ${varMachine}`);
assert.ok(approx(varPart,1.08645,5e-4),`Part VarComp ${varPart}`);
assert.ok(approx(pctContribution,7.76,5e-4),`Minitab %Contribution ${pctContribution}`);
assert.ok(approx(pctStudy,27.86,5e-4),`Minitab %Study Var ${pctStudy}`);

assert.equal(C.varianceContributionClass(0.99).key,'good');
assert.equal(C.varianceContributionClass(1.00).key,'warn');
assert.equal(C.varianceContributionClass(9.00).key,'warn');
assert.equal(C.varianceContributionClass(9.01).key,'bad');

assert.equal(C.compare(10,'>=',10),true);
assert.equal(C.compare(10,'>',10),false);
assert.equal(C.compare(12,'between',10,15),true);
assert.equal(C.compare(9,'outside',10,15),true);

const a=C.metricKey({'Window Type':'Land','Inspection Name':'Flat void','Inspection ID':'8105','Inspection Criteria Name':'Void Ratio','Unit':'%'});
const b=C.metricKey({'Window Type':'Land','Inspection Name':'Flat void','Inspection ID':'9999','Inspection Criteria Name':'Void Ratio','Unit':'%'});
assert.notEqual(a,b);

console.log('All X-Ray GR&R statistical regression tests passed.');
