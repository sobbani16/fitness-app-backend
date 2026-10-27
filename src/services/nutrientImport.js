const { createHash } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { normalize } = require('./ingredientCatalog');
const { NUTRIENTS } = require('./nutrientMaster');
const definitions = new Map(NUTRIENTS.map(n=>[n.code,n]));
const mass = {g:'1',mg:'0.001',mcg:'0.000001'};
const unit = value => String(value || '').trim().toLowerCase().replace(/^(?:µg|μg|ug)$/, 'mcg');
function normalizeAmount(value, from, to) {
  const source = unit(from), target = unit(to);
  if (!((mass[source] && mass[target]) || (['kcal','kj'].includes(source) && target === 'kcal'))) throw new Error(`Unsupported unit conversion: ${from} -> ${to}`);
  if (value == null) return null;
  if (!['string','number'].includes(typeof value) || !/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(String(value).trim())) throw new Error('Invalid nutrient amount');
  let amount;
  try { amount = new Prisma.Decimal(value); } catch { throw new Error('Invalid nutrient amount'); }
  if (!amount.isFinite() || amount.isNegative()) throw new Error('Nutrient amount must be finite and nonnegative');
  amount = mass[source] ? amount.mul(mass[source]).div(mass[target]) : source === 'kj' ? amount.div('4.184') : amount;
  const rounded = amount.toDecimalPlaces(9, Prisma.Decimal.ROUND_HALF_UP);
  if (rounded.gte('1000000000') || (amount.gt(0) && rounded.isZero())) throw new Error('Nutrient amount outside supported decimal precision');
  return rounded.toFixed(9);
}
function required(value, name, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Required valid ${name}`);
  return value.trim();
}
function prepareRecord(row) {
  if (!row || row.basis !== 'PER_100_G') throw new Error('Explicit PER_100_G edible-portion basis required; no volume/dry-to-cooked conversion');
  if (!['RAW','BOILED','STEAMED','FRIED','ROASTED','OTHER'].includes(row.preparationType)) throw new Error('Explicit preparationType required');
  if (!['USDA','IFCT','MANUAL','OTHER'].includes(row.source)) throw new Error('Unsupported source');
  const sourceFoodId = row.sourceFoodId == null ? null : required(row.sourceFoodId, 'sourceFoodId');
  const method = row.preparationMethod == null ? null : required(row.preparationMethod, 'preparationMethod');
  const verifiedAt = row.verifiedAt == null ? null : new Date(row.verifiedAt);
  if (verifiedAt && (typeof row.verifiedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(row.verifiedAt) || !Number.isFinite(verifiedAt.getTime()) || verifiedAt > new Date())) throw new Error('Invalid verifiedAt');
  if (!Array.isArray(row.nutrients) || !row.nutrients.length) throw new Error('Nutrients must be a nonempty array');
  const seen = new Set();
  const nutrients = row.nutrients.map(n => {
    const definition = definitions.get(n?.code);
    if (!definition || seen.has(n.code)) throw new Error('Unknown or duplicate nutrient code');
    seen.add(n.code);
    return {code:n.code, amountPer100g:normalizeAmount(n.amountPer100g,n.unit,definition.unit)};
  });
  return {
    ingredientId: row.ingredientId == null ? null : required(row.ingredientId,'ingredientId'),
    catalogId: row.catalogId == null ? null : required(row.catalogId,'catalogId'),
    name: row.name == null ? null : required(row.name,'name'),
    preparationType:row.preparationType, preparationMethod:method, source:row.source, sourceFoodId,
    sourceDataset:required(row.sourceDataset,'sourceDataset'),
    sourceRecordKey:sourceFoodId ? `food:${sourceFoodId}` : `record:${required(row.sourceRecordKey,'sourceRecordKey')}`,
    sourceCitation:required(row.sourceCitation,'sourceCitation',4000), verifiedAt, nutrients,
  };
}
function identityKey(ingredientId, row) {
  return createHash('sha256').update(JSON.stringify([ingredientId,row.preparationType,row.preparationMethod,row.source,row.sourceDataset,row.sourceRecordKey])).digest('hex');
}
function matchIngredient(row, ingredients) {
  let matches;
  if (row.ingredientId) matches = ingredients.filter(i=>i.id===row.ingredientId && (!row.catalogId || i.catalogId===row.catalogId));
  else if (row.catalogId) matches = ingredients.filter(i=>i.catalogId===row.catalogId);
  else if (row.source === 'USDA' && row.sourceFoodId && ingredients.some(i=>i.fdcId===row.sourceFoodId)) matches = ingredients.filter(i=>i.fdcId===row.sourceFoodId);
  else matches = row.name ? ingredients.filter(i=>normalize(i.normalizedName)===normalize(row.name) || i.catalog?.aliases?.some(a=>normalize(a)===normalize(row.name))) : [];
  return matches.length === 1 ? {ingredient:matches[0]} : {status:'REVIEW_REQUIRED', reason:matches.length ? 'AMBIGUOUS_INGREDIENT' : 'UNMATCHED_INGREDIENT', candidates:matches.map(i=>i.id)};
}
// Trusted offline import boundary; callers attest verifiedAt after reviewing provenance.
// No source provider is automatically considered verified, and no network calls occur here.
async function importNutrients(prisma, rows, {apply = false, preserveVerified = false} = {}) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) throw new Error('Import 1–500 records per batch');
  const entries = rows.map(prepareRecord);
  return prisma.$transaction(async tx => {
    // All import/seed entry points serialize to make verification checks + writes atomic.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(6822982481)`;
    const masters = await tx.nutrient.findMany();
    const byCode = new Map(masters.map(n=>[n.code,n]));
    for (const row of entries) for (const n of row.nutrients) {
      if (byCode.get(n.code)?.unit !== definitions.get(n.code).unit) throw new Error(`Seed nutrient definitions first: ${n.code}`);
    }
    const ingredients = await tx.ingredient.findMany({select:{id:true,catalogId:true,fdcId:true,normalizedName:true,catalog:{select:{aliases:true}}}});
    const report = [];
    const batchKeys = new Set();
    for (const [index, row] of entries.entries()) {
      const match = matchIngredient(row,ingredients);
      if (!match.ingredient) { report.push({index,...match}); continue; }
      const ingredientId = match.ingredient.id, identity = identityKey(ingredientId,row);
      if (batchKeys.has(identity)) throw new Error('Duplicate profile identity in batch; combine its nutrients in one record');
      batchKeys.add(identity);
      const old = await tx.ingredientNutritionProfile.findUnique({where:{identityKey:identity},include:{nutrients:true}});
      if (old?.verifiedAt && (!row.verifiedAt || row.verifiedAt < old.verifiedAt)) {
        report.push({index,status:'PROTECTED',reason:'VERIFIED_PROFILE',profileId:old.id}); continue;
      }
      const incoming = new Map(row.nutrients.map(n=>[byCode.get(n.code).id,n.amountPer100g]));
      if (old && row.verifiedAt && !old.verifiedAt && old.nutrients.some(n=>n.amountPer100g != null && incoming.get(n.nutrientId) == null)) {
        report.push({index,status:'REVIEW_REQUIRED',reason:'INCOMPLETE_VERIFICATION',profileId:old.id}); continue;
      }
      if (old?.verifiedAt && (preserveVerified || row.verifiedAt.getTime() === old.verifiedAt.getTime()) && old.nutrients.some(n=>n.amountPer100g != null && incoming.get(n.nutrientId) != null && !n.amountPer100g.equals(incoming.get(n.nutrientId)))) {
        report.push({index,status:'REVIEW_REQUIRED',reason:'VERIFIED_VALUE_CONFLICT',profileId:old.id}); continue;
      }
      if (!apply) { report.push({index,status:'READY',ingredientId,profileId:old?.id || null}); continue; }
      const data = {ingredientId,identityKey:identity,preparationType:row.preparationType,preparationMethod:row.preparationMethod,source:row.source,sourceFoodId:row.sourceFoodId,sourceDataset:row.sourceDataset,sourceRecordKey:row.sourceRecordKey,sourceCitation:row.sourceCitation,verifiedAt:row.verifiedAt};
      let profile = old;
      if (!old) profile = await tx.ingredientNutritionProfile.create({data});
      else if (old.sourceCitation !== data.sourceCitation || old.verifiedAt?.getTime() !== data.verifiedAt?.getTime()) profile = await tx.ingredientNutritionProfile.update({where:{id:old.id},data:{sourceCitation:data.sourceCitation,verifiedAt:data.verifiedAt}});
      for (const [nutrientId, amountPer100g] of incoming) {
        const previous = old?.nutrients.find(n=>n.nutrientId===nutrientId);
        // Unknown is not a request to erase known data. Omitted values also stay untouched.
        if (previous && (amountPer100g == null || previous.amountPer100g?.equals(amountPer100g))) continue;
        await tx.ingredientNutrient.upsert({where:{nutritionProfileId_nutrientId:{nutritionProfileId:profile.id,nutrientId}},create:{nutritionProfileId:profile.id,nutrientId,amountPer100g},update:{amountPer100g}});
      }
      report.push({index,status:old ? 'UPSERTED' : 'CREATED',ingredientId,profileId:profile.id});
    }
    return {applied:apply,records:report};
  }, {timeout:120000});
}
module.exports = {normalizeAmount,prepareRecord,identityKey,matchIngredient,importNutrients};
