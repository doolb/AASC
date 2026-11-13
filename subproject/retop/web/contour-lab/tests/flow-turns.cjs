const assert=require('node:assert/strict'),fs=require('node:fs'),E=require('../engine.js'),F=require('../flow.js')(E),checks=[],examples=[];
for(const id of [7,8,9])for(const stage of [2,4]){
 const l=JSON.parse(fs.readFileSync(`artifacts/contour-lab/reference-${id}-vectors.json`)).levels[stage],saved=JSON.stringify(l),ports=F.automaticPorts(l),low=F.compute(l,ports,{turnResistance:0}),high=F.compute(l,ports,{turnResistance:8});
 for(const a of [low,high]){assert(a.coverage.complete&&a.steady.valid&&a.river.audit.massValid);assert(!('routes' in a));for(const s of a.river.streamlines)for(let i=1;i<s.points.length;i++)assert(F.visible(s.points[i-1],s.points[i],a.river.domain,1e-6));}
 assert.notDeepEqual(low.river.sites.map(s=>s.direction),high.river.sites.map(s=>s.direction));assert.equal(JSON.stringify(l),saved);const g=F.graph(l);for(const edge of F.edges(l).filter(e=>e.faces.length===2)){const p=E.bez(edge,.5),a=F.evaluateRiver(high.river,p),b=F.evaluateRiver(high.river,[p[0]+g.D*1e-8,p[1]]);assert(Math.hypot(...a.direction.map((v,k)=>v-b.direction[k]))<1e-4,'field jumps across a partition edge');}
 checks.push(`reference ${id} ${l.id}: live resistance, shared continuous direction, safe streamlines`);examples.push({reference:id,level:l.id,low:low.river.audit,high:high.river.audit});console.log('PASS',checks.at(-1));
}
fs.writeFileSync('artifacts/contour-lab/flow-turns-report.json',JSON.stringify({checks,examples},null,2));
