/* Destructive fixture setup is restricted to a disposable localhost database.
 * Start backend separately with this DATABASE_URL, NODE_ENV=production,
 * PORT=4400 and API_RATE_LIMIT=1000. No authentication bypass is used.
 */
require('dotenv').config();
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {getPrisma}=require('../src/lib/prisma');
const base=process.env.SMOKE_API_URL || 'http://127.0.0.1:4400';
const db=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname)||!['localhost','127.0.0.1'].includes(db.hostname)||!db.pathname.includes('readiness'))throw new Error('Use an isolated localhost database with readiness in its name.');
const prisma=getPrisma(), results=[], covered=new Set();
const run=randomUUID().slice(0,8), password=`Test-only-${randomUUID()}`;
let member,coach,admin,nutri,outsider;
async function hit(method,path,body,who=member,expected=200,route=path.split('?')[0],external=false){
 const res=await fetch(base+path,{method,headers:{'content-type':'application/json',...(who?{authorization:`Bearer ${who.token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
 let data;try{data=await res.json();}catch{data={};}
 const wanted=Array.isArray(expected)?expected:[expected];
 const ok=wanted.includes(res.status);
 const state=external && res.status>=500 ? 'BLOCKED_EXTERNAL' : ok ? 'PASS' : 'FAIL';
 results.push({method,route,path,status:res.status,expected:wanted,result:state,...(!ok||state==='BLOCKED_EXTERNAL'?{error:data.error}:{} )});covered.add(`${method} ${route}`);
 console.log(`${state} ${method} ${route}: ${res.status}`);
 if(!ok&&!external)throw new Error(`${method} ${path}: expected ${wanted}, got ${res.status}: ${data.error}`);
 return data;
}
async function account(name){
 const session=await hit('POST','/auth/register',{email:`${name}-${run}@example.test`,password},null,201);
 const action=await prisma.authAction.findFirst({where:{userId:session.user.id,purpose:'verify-email',consumedAt:null}});
 const {actionToken}=require('../src/services/authLifecycle');
 await hit('POST','/auth/verify-email',{token:actionToken(action.id)},null);
 return session;
}
async function role(user,name){const r=await prisma.role.findUnique({where:{name}});await prisma.userRole.upsert({where:{userId_roleId:{userId:user.user.id,roleId:r.id}},create:{userId:user.user.id,roleId:r.id},update:{active:true}});}
function discover(){
 const source=fs.readFileSync('src/routes/index.js','utf8');
 const vars=Object.fromEntries([...source.matchAll(/const (\w+) = require\('\.\/(\w+)'\)/g)].map(m=>[m[1],m[2]]));
 const mounts=[...source.matchAll(/router.use\('([^']+)', (\w+)\)/g)].map(m=>[m[1],vars[m[2]]]);
 mounts.push(['/auth','auth'],['/me/profile','profile']);
 const all=[];
 for(const [prefix,file] of mounts){for(const layer of require(`../src/routes/${file}`).stack){if(layer.route)for(const method of Object.keys(layer.route.methods)){const path=prefix+(layer.route.path==='/'?'':layer.route.path);all.push({method:method.toUpperCase(),path});}}}
 return all;
}
async function main(){
 await hit('GET','/health',undefined,null);await hit('GET','/health/ready',undefined,null);
 member=await account('member');coach=await account('trainer');admin=await account('admin');nutri=await account('nutritionist');outsider=await account('outsider');
 await role(admin,'SUPER_ADMIN');
 await hit('POST','/auth/login',{email:member.user.email,password},null);
 await hit('POST','/auth/login',{email:member.user.email,password:'wrong-password-123'},null,401);
 await hit('GET','/me/profile',undefined,null,401);
 const profile={name:'Smoke Member',age:30,sex:'male',heightCm:175,weightKg:75,goalWeightKg:72,activityLevel:'moderate',goal:'maintain',units:'metric',createdAt:new Date().toISOString()};
 await hit('PUT','/me/profile',profile);const saved=await hit('GET','/me/profile');assert.equal(saved.profile.weightKg,75);
 await hit('GET','/me/roles');
 const date=new Date().toISOString().slice(0,10),week=date;
 const meal={id:`smoke-${run}`,foodName:'Grilled chicken',quantityG:150,calories:250,proteinG:40,carbsG:1,fatG:8,fiberG:3,mealType:'lunch',loggedAt:new Date().toISOString()};
 await hit('POST','/food-logs',meal,member,201);await hit('POST','/food-logs',meal);let logs=await hit('GET',`/food-logs?date=${date}`,undefined);assert.equal(logs.logs.filter(x=>x.id===meal.id).length,1);
 await hit('POST','/food-logs',meal,outsider,409);await hit('POST','/food-logs',{...meal,id:randomUUID(),calories:-1},member,400);
 await hit('POST','/daily-stats/water',{amountMl:250,date},member,201);await hit('PUT','/daily-stats/water/replace',{amountMl:750,date});const water=await hit('GET',`/daily-stats/water?date=${date}`);assert.equal(water.amountMl,750);
 await hit('POST','/daily-stats/steps',{steps:6500,date});await hit('GET',`/daily-stats/steps?date=${date}`);
 const exercise=await hit('POST','/exercises',{exerciseType:'squat',sets:[{reps:8,weight:60}]},member,201);
 await hit('POST',`/exercises/${exercise.id}/sets`,{reps:8,weight:65},member,200,'/exercises/:id/sets');
 const sessions=await hit('GET','/exercises');assert(sessions.sessions.some(s=>s.id===exercise.id));assert(await prisma.workoutSession.findUnique({where:{id:exercise.id}}));
 await hit('GET','/exercises/prefill/squat',undefined,member,200,'/exercises/prefill/:exerciseType');
 await hit('POST',`/exercises/${exercise.id}/sets`,{reps:8,weight:1},outsider,404,'/exercises/:id/sets');
 await hit('GET','/supplements');await hit('GET','/supplements/search?q=Creatine');
 const sup=await hit('POST','/supplements',{name:`Smoke supplement ${run}`,calories:100,proteinG:20},member,201);
 const link=await hit('POST','/supplements/mine',{supplementId:sup.id},member,201);await hit('GET','/supplements/mine');
 const sl=await hit('POST','/supplements/log',{userSupplementId:link.userSupplementId,quantity:1,date},member,201);await hit('GET','/supplements/log');
 await hit('DELETE',`/supplements/log/${sl.id}`,undefined,member,200,'/supplements/log/:id');await hit('DELETE',`/supplements/mine/${sup.id}`,undefined,member,200,'/supplements/mine/:supplementId');
 await hit('GET','/macro-score/goals');await hit('PUT','/macro-score/goals',{caloriesTarget:2200,proteinTarget:150});await hit('GET','/macro-score');await hit('GET','/macro-score/trend?days=7');
 const score=await hit('GET','/health-score');await hit('GET','/health-score/actions');await hit('GET','/health-score/trend?days=7');await hit('GET',`/health-score/${score.id}/detail`,undefined,member,200,'/health-score/:id/detail');await hit('GET',`/health-score/${score.id}/detail`,undefined,outsider,404,'/health-score/:id/detail');
 const query=new URLSearchParams({...profile,caloriesIn:1500,caloriesBurnedExercise:0});await hit('GET',`/recommendations?${query}`);
 await hit('POST','/summary/daily',{profile,meals:[{name:'Chicken',calories:250,mealType:'lunch'}]});await hit('POST','/summary/history',{profile,days:[{date,caloriesIn:250,mealCount:1}]});
 await hit('GET','/safety/context');await hit('GET','/safety/recommend');await hit('GET','/safety/coaching');await hit('POST','/safety/validate/ingredients',{ingredients:[]});await hit('POST','/safety/validate/supplements',{supplements:[]});await hit('POST','/safety/validate/recipe',{ingredients:[],totalCalories:300,totalProteinG:20,totalCarbsG:30,totalFatG:10});
 const label={productName:'Smoke oats',servingSizeG:40,actualPortionG:80,labelCalories:150,labelProteinG:5,labelCarbsG:27,labelFatG:3,labelFiberG:4,mealType:'breakfast'};
 const extraction=await hit('POST','/label-scanner/extract',{ocrText:'Serving Size 40g\nCalories 150\nProtein 5g\nTotal Carbohydrate 27g\nTotal Fat 3g'});assert.equal(extraction.extracted.calories,150);
 await hit('POST','/label-scanner/adjust',{servingSizeG:40,actualPortionG:80,calories:150,proteinG:5,carbsG:27,fatG:3});
 const scan=await hit('POST','/label-scanner/save',label,member,201);assert.equal(scan.foodLog.calories,300);await hit('GET','/label-scanner/history');
 await hit('POST','/food-logs',{...meal,id:scan.foodLog.id},member,200);assert.equal((await prisma.foodLog.findUnique({where:{id:scan.foodLog.id}})).fiberG,8);
 await hit('PUT','/weekly-plan/preferences',{mealPrepStyle:'weekly_prep',dietaryRestrictions:[],availableEquipment:['oven'],householdSize:1});await hit('GET','/weekly-plan/preferences/me');
 await hit('POST','/weekly-plan/inventory',{foodName:'oats',quantityG:100},member,201);await hit('GET','/weekly-plan/inventory/list');
 await hit('POST','/weekly-plan/generate',{weekStartDate:week,caloriesTarget:2200,proteinTarget:150,carbsTarget:250,fatTarget:70,fiberTarget:30},member,201);
 const plan=await hit('GET','/weekly-plan/current');await hit('GET',`/weekly-plan/${week}`,undefined,member,200,'/weekly-plan/:weekStartDate');
 await hit('GET','/weekly-plan/notifications/me');const first=plan.meals[0];
 const alternatives=await hit('GET',`/weekly-plan/meals/${first.id}/alternatives`,undefined,member,200,'/weekly-plan/meals/:mealId/alternatives');
 if(alternatives.alternatives.length)await hit('POST',`/weekly-plan/meals/${first.id}/swap`,{recipeId:alternatives.alternatives[0].id},member,200,'/weekly-plan/meals/:mealId/swap');
 await hit('POST',`/weekly-plan/meals/${first.id}/swap`,{recipeId:first.recipeId},outsider,403,'/weekly-plan/meals/:mealId/swap');
 for(let day=0;day<7;day++)await hit('POST',`/weekly-plan/days/${day}/confirm`,{planId:plan.id},member,200,'/weekly-plan/days/:dayOfWeek/confirm');
 await hit('GET',`/weekly-plan/days/0/edit-state?planId=${plan.id}`,undefined,member,200,'/weekly-plan/days/:dayOfWeek/edit-state');
 await hit('POST','/weekly-plan/shopping-list/generate',{planId:plan.id});const shopping=await hit('GET',`/weekly-plan/shopping-list?planId=${plan.id}`);
 assert(shopping.items.length);await hit('PATCH',`/weekly-plan/shopping-list/items/${shopping.items[0].id}/check`,{checked:true},member,200,'/weekly-plan/shopping-list/items/:itemId/check');
 await hit('GET',`/weekly-plan/shopping-list?planId=${plan.id}`,undefined,outsider,403);
 await hit('GET',`/weekly-plan/adherence/${week}`,undefined,member,200,'/weekly-plan/adherence/:weekStartDate');await hit('POST',`/weekly-plan/review/${week}`,{},member,200,'/weekly-plan/review/:weekStartDate');await hit('GET','/weekly-plan/deficiencies/detect');await hit('POST','/weekly-plan/adjust-calories',{weekStartDate:week,currentCalories:2200,adherencePercent:80,recoveryScore:80,weightTrendKg:-0.5,weeksStalled:0});
 const trainer=await hit('POST','/trainers/signup',{bio:'Smoke trainer',specialties:['strength'],certifications:['test'],yearsExperience:3,tier:'standard'},coach,201);
 await hit('PATCH',`/admin/trainers/${trainer.id}/verify`,{verified:true},admin,200,'/admin/trainers/:id/verify');
 await hit('PATCH','/trainers/me/profile',{bio:'Updated smoke bio'},coach);await hit('GET','/trainers',undefined,member);await hit('GET',`/trainers/${trainer.id}`,undefined,member,200,'/trainers/:id');await hit('GET','/trainers/drop-reasons');
 await hit('POST',`/trainers/${trainer.id}/subscribe`,{},member,201,'/trainers/:id/subscribe');await hit('GET','/trainers/me/assigned');await hit('GET','/trainers/me/clients',undefined,coach);await hit('GET',`/trainers/clients/${member.user.id}/progress`,undefined,coach,200,'/trainers/clients/:clientId/progress');
 await hit('POST','/trainers/clients/assign',{trainerId:trainer.id,clientId:outsider.user.id},admin,201);
 await hit('PATCH',`/trainers/clients/${outsider.user.id}/status`,{status:'active'},coach,200,'/trainers/clients/:clientId/status');
 await hit('POST','/trainers/me/drop',{reasons:['other'],notes:'Smoke test'},member,423);
 await hit('POST','/weekly-plan/days/0/unconfirm',{planId:plan.id},coach,200,'/weekly-plan/days/:dayOfWeek/unconfirm');
 await hit('GET',`/weekly-plan/current?clientId=${member.user.id}`,undefined,coach);await hit('GET',`/weekly-plan/current?clientId=${member.user.id}`,undefined,outsider,403);
 const wp=await hit('POST','/workout-plans',{clientId:member.user.id,title:'Smoke workout',exercises:[{exerciseName:'Squat',sets:3,reps:8}]},coach,201);await hit('GET','/workout-plans',undefined,coach);await hit('GET',`/workout-plans/${wp.id}`,undefined,member,200,'/workout-plans/:id');await hit('GET',`/workout-plans/${wp.id}`,undefined,outsider,403,'/workout-plans/:id');
 await hit('POST','/coach-notes',{clientId:member.user.id,note:'Smoke visible note',visibility:'client_visible'},coach,201);await hit('GET',`/coach-notes?clientId=${member.user.id}`,undefined,member);const privateNotes=await hit('GET',`/coach-notes?clientId=${member.user.id}`,undefined,outsider);assert.equal(privateNotes.notes.length,0);
 await role(nutri,'NUTRITIONIST');const np=await prisma.nutritionistProfile.create({data:{userId:nutri.user.id,verified:true,active:true}});
 await hit('GET','/nutritionists');await hit('POST','/nutritionists/clients/assign',{nutritionistId:np.id,clientId:member.user.id},admin,201);await prisma.nutritionistClient.updateMany({where:{nutritionistId:np.id,clientId:member.user.id},data:{status:'active'}});await hit('GET','/nutritionists/me/clients',undefined,nutri);
 const mp=await hit('POST','/meal-plans',{clientId:member.user.id,title:'Smoke meal plan',caloriesTarget:2200,proteinTarget:150,items:[{foodName:'Chicken',quantityG:150,mealType:'lunch'}]},nutri,201);await hit('GET','/meal-plans',undefined,nutri);await hit('GET',`/meal-plans/${mp.id}`,undefined,member,200,'/meal-plans/:id');await hit('GET',`/meal-plans/${mp.id}`,undefined,outsider,403,'/meal-plans/:id');
 await hit('GET','/admin/users',undefined,admin);await hit('GET','/admin/trainers',undefined,admin);await hit('GET','/admin/analytics',undefined,admin);await hit('GET','/admin/users',undefined,member,403);
 await hit('POST','/admin/roles/assign',{userId:outsider.user.id,roleName:'CREATOR'},admin,201);await hit('POST','/admin/roles/remove',{userId:outsider.user.id,roleName:'CREATOR'},admin);await hit('GET','/audit-logs',undefined,admin);
 await hit('POST',`/trainers/clients/${outsider.user.id}/drop`,{reasons:['other'],notes:'Smoke test'},coach,200,'/trainers/clients/:clientId/drop');
 await hit('GET','/chat/status');await hit('POST','/chat',{message:'Explain progressive overload briefly.'},member,200,'/chat',true);
 await hit('POST','/meals/detect',{description:'150 grams grilled chicken'},member,200,'/meals/detect',true);await hit('POST','/meals/analyze',{description:'150 grams grilled chicken'},member,200,'/meals/analyze',true);
 await hit('GET','/weather?lat=40.7&lon=-74',undefined,member,200,'/weather',true);await hit('GET','/ingredients/search?q=raw%20chicken%20breast',undefined,member,200,'/ingredients/search',true);
 const recipes=await hit('GET','/recipes/search?q=chicken',undefined,member,200,'/recipes/search',true);await hit('GET',`/recipes/${recipes.results?.[0]?.id || '716429'}/nutrition`,undefined,member,200,'/recipes/:id/nutrition',true);
 await hit('DELETE',`/food-logs/${meal.id}`,undefined,member,200,'/food-logs/:id');assert.equal(await prisma.foodLog.findUnique({where:{id:meal.id}}),null);
 // Header impersonation is ignored when there is a valid session.
 const spoof=await fetch(base+'/me/roles',{headers:{authorization:`Bearer ${member.token}`,'x-user-id':admin.user.id}});assert.equal((await spoof.json()).userId,member.user.id);
 await hit('POST','/auth/logout',{},member);await hit('GET','/me/profile',undefined,member,401);
}
main().catch(e=>{results.push({result:'FAIL',error:e.message});console.error(e.message);process.exitCode=1;}).finally(async()=>{
 const routes=discover();const missing=routes.filter(r=>!covered.has(`${r.method} ${r.path}`));
 const report={generatedAt:new Date().toISOString(),runtime:process.version,base,database:'isolated localhost fitness_readiness',authentication:'real password + opaque session; no bypass',routes:routes.length,covered:routes.length-missing.length,missing,results};
 fs.mkdirSync('docs',{recursive:true});fs.writeFileSync('docs/endpoint-results.json',JSON.stringify(report,null,2)+'\n');
 fs.writeFileSync('docs/ENDPOINT_RESULTS.md',`# Live endpoint verification\n\nGenerated: ${report.generatedAt}\n\nRuntime: ${process.version}. Isolated PostgreSQL; backend production mode. Real authentication, no bypass.\n\nCovered ${report.covered}/${routes.length} route signatures. BLOCKED_EXTERNAL means the upstream service did not succeed; it is not a successful feature test.\n\n| Method | Route | HTTP | Result |\n|---|---|---|---|\n`+results.filter(x=>x.method).map(x=>`| ${x.method} | ${x.route} | ${x.status} | ${x.result} |`).join('\n')+'\n\nUncovered: '+JSON.stringify(missing)+'\n'+(process.exitCode?'\nRun failed. See endpoint-results.json.\n':''));
 if(missing.length)process.exitCode=1;
 await prisma.$disconnect();
});
