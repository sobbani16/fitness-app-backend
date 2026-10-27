process.env.NODE_ENV='test';process.env.AUTH_TEST_BYPASS='false';
const assert=require('node:assert/strict'),request=require('supertest');const u=new URL(process.env.DATABASE_URL||'http://missing');if(u.hostname!=='127.0.0.1'||!u.pathname.startsWith('/fitness_catalog_v5'))throw Error('Isolated database required');
const db=require('../src/lib/prisma').getPrisma(),app=require('../src/app');
(async()=>{let user,recipeId;try{
 user=await db.user.create({data:{email:`api-v5-${Date.now()}@example.test`,emailVerifiedAt:new Date()}});const session=await require('../src/services/authService').createSession(user,db);const auth={Authorization:`Bearer ${session.token}`};
 await request(app).get('/ingredients/search?q=bajra').expect(401);
 const search=await request(app).get('/ingredients/search?q=bajra').set(auth).expect(200);const i=search.body.results[0];assert.equal(i.catalogId,'IFCT-A003');assert.equal(i.verificationLevel,'SOURCE_BACKED_FULL');
 await request(app).post(`/ingredients/${i.id}/nutrition`).set(auth).send({grams:-1}).expect(400);
 const calc=(await request(app).post(`/ingredients/${i.id}/nutrition`).set(auth).send({grams:150}).expect(200)).body;
 await request(app).put(`/ingredients/${i.id}/selection`).set(auth).send({favorite:true}).expect(200);await request(app).put(`/ingredients/${i.id}/selection`).set(auth).send({favorite:true}).expect(200);
 assert.equal((await request(app).get('/ingredients/selections?favorite=true').set(auth).expect(200)).body.results.length,1);
 const meal={id:`v5-meal-${Date.now()}`,ingredientId:i.id,foodName:i.name,quantityG:150,mealType:'lunch',...calc.nutrition,calories:123};
 const saved=(await request(app).post('/food-logs').set(auth).send(meal).expect(201)).body;assert.equal(saved.nutritionSnapshot.userEdited,true);assert.equal(saved.calories,123);
 const again=(await request(app).post('/food-logs').set(auth).send({...meal,calories:999}).expect(200)).body;assert.equal(again.calories,123);assert.deepEqual(again.nutritionSnapshot,saved.nutritionSnapshot);
 const rec=(await request(app).post('/recipes').set(auth).send({name:`V5 Test ${Date.now()}`,ingredients:[{ingredientId:i.id,grams:150}],yieldGrams:300}).expect(201)).body;recipeId=rec.id;assert.equal(rec.portionG,300);
 await request(app).get(`/recipes/${rec.id}/nutrition`).set(auth).expect(200);

 }finally{if(recipeId)await db.recipe.delete({where:{id:recipeId}});if(user){await db.foodLog.deleteMany({where:{userId:user.id}});await db.userIngredient.deleteMany({where:{userId:user.id}});await db.authSession.deleteMany({where:{userId:user.id}});await db.user.delete({where:{id:user.id}});}await db.$disconnect();}})().then(()=>console.log('PASS authenticated v5 search, quantities, idempotent favorites/logs, correction provenance and local recipes')).catch(e=>{console.error(e);process.exitCode=1;});
