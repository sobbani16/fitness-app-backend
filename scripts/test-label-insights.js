// Local PostgreSQL + HTTP contract test. Never runs against hosted databases.
const assert = require('node:assert/strict');
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (url.hostname !== '127.0.0.1' || !url.pathname.startsWith('/fitness_ux_m2_')) throw new Error('Use a disposable local fitness_ux_m2_ database');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const express = require('express');
const { getPrisma } = require('../src/lib/prisma');
const prisma = getPrisma();
(async () => {
  const nonce = randomUUID();
  const user = await prisma.user.create({ data: { email: `${nonce}@example.test`, goalType:'muscle_gain' } });
  const other = await prisma.user.create({ data: { email: `other-${nonce}@example.test` } });
  const app = express(); app.use(express.json()); app.use((req, res, next) => { req.userId = req.headers['x-test-owner'] || user.id; next(); }); app.use('/labels', require('../src/routes/labelScanner'));
  const facts = {reviewed:true,personalize:true,ingredients:'Maida, honey',allergens:'Contains wheat',claims:'Sugar free',calories:200,proteinG:10,carbsG:30,fiberG:null,sugarG:2,addedSugarG:null,sodiumMg:null,basisAmount:100,basisUnit:'g',form:'solid',column:'100',portionRatio:1.5,jurisdiction:'IN'};
  const meal = {id:`label-${nonce}`,productName:'Local fixture',ingredients:facts.ingredients,labelCalories:200,labelProteinG:10,labelCarbsG:30,labelFatG:4,labelFiberG:null,labelSugarG:2,servingSizeG:100,actualPortionG:150,labelFacts:facts};
  const before = await prisma.ingredientCatalog.count();
  try {
    const analysis = await request(app).post('/labels/insights').send(facts).expect(200);
    assert(analysis.body.insights.some(i=>i.ruleId==='GOAL_PORTION_001' && i.personalRelevance.includes('muscle gain')));
    assert(analysis.body.insights.some(i=>i.finding==='Possible sugar-free claim mismatch'));
    console.log('PASS reviewed facts + saved goal -> evidence-linked HTTP findings');
    await request(app).post('/labels/save').send({...meal,labelFacts:{...facts,sugarG:0}}).expect(400);
    const saved = await request(app).post('/labels/save').send(meal).expect(201);
    const id = saved.body.foodLog.id;
    const stored = await prisma.foodLog.findUnique({where:{id}});
    assert.deepEqual(stored.nutritionSnapshot.labelInsights, analysis.body);
    assert.equal(stored.fiberG,null); assert.equal(stored.calories,300);
    console.log('PASS corrected facts validated and server-computed evidence snapshot survives PostgreSQL round trip');
    const retries = await Promise.all(Array.from({length:4},()=>request(app).post('/labels/save').send(meal).expect(201)));
    assert(retries.every(r=>r.body.foodLog.id===id));
    assert.equal(await prisma.foodLog.count({where:{userId:user.id}}),1);
    await request(app).post('/labels/save').set('x-test-owner',other.id).send(meal).expect(409);
    console.log('PASS stable retry and ownership preserve a single meal');
    await request(app).post('/labels/compare').send({first:facts,second:{...facts,sugarG:1}}).expect(200);
    await request(app).post('/labels/compare').send({first:facts,second:{...facts,reviewed:false}}).expect(400);
    assert.equal(await prisma.ingredientCatalog.count(),before);
    console.log('PASS comparison guarded; catalog unchanged');
  } finally {
    await prisma.scannedLabel.deleteMany({where:{userId:{in:[user.id,other.id]}}});
    await prisma.foodLog.deleteMany({where:{userId:user.id}});
    await prisma.user.deleteMany({where:{id:{in:[user.id,other.id]}}});
  }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>prisma.$disconnect());
