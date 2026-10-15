const DATE=/^\d{4}-\d{2}-\d{2}$/;
module.exports=(req,res,next)=>{
 const b=req.body || {},q=req.query || {};
 for(const [key,value] of Object.entries({...q,...b})) {
  if(['date','weekStartDate'].includes(key) && (typeof value!=='string'||!DATE.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))return res.status(400).json({error:`Invalid ${key}`});
  if(['days','limit'].includes(key) && !Array.isArray(value) && (!Number.isInteger(Number(value))||Number(value)<1||Number(value)>365))return res.status(400).json({error:`${key} must be between 1 and 365`});
  if(['amountMl','steps','quantityG','quantity','caloriesTarget','proteinTarget','carbsTarget','fatTarget','fiberTarget','waterMlTarget','servingSizeG','actualPortionG','labelCalories','labelProteinG','labelCarbsG','labelFatG','labelFiberG','labelSugarG','labelSodiumMg'].includes(key) && (!Number.isFinite(Number(value))||Number(value)<0||Number(value)>100000))return res.status(400).json({error:`Invalid ${key}`});
 }
 if(b.quantity!==undefined&&Number(b.quantity)<=0)return res.status(400).json({error:'Quantity must be positive'});
 if(b.amountMl!==undefined&&!Number.isInteger(Number(b.amountMl)))return res.status(400).json({error:'Water amount must be an integer'});
 if(b.steps!==undefined&&!Number.isInteger(Number(b.steps)))return res.status(400).json({error:'Steps must be an integer'});
 if(b.ocrText!==undefined&&(typeof b.ocrText!=='string'||b.ocrText.length>20000))return res.status(400).json({error:'Invalid label text'});
 next();
};
