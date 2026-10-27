const { createHash } = require('node:crypto');
const levels = ['SOURCE_BACKED_FULL','PARTIALLY_SOURCE_BACKED','GENERIC_COMPOSITION','ESTIMATED','REVIEW_CONFLICT'];
const numeric = ['kcal_per_100g','protein_g_per_100g','carbs_g_per_100g','fat_g_per_100g','fiber_g_per_100g','total_carbs_g_per_100g','digestible_carbs_approx_g_per_100g','serving_g_assumed','serving_kcal','serving_protein_g','serving_carbs_g','serving_fat_g','serving_fiber_g','sugar_g_per_100g','sodium_mg_per_100g','saturated_fat_g_per_100g'];
// RFC4180 quotes, embedded newlines, CRLF and BOM; reject malformed/truncated input.
function parseCsv(input) {
 const text=input.replace(/^\uFEFF/,''); const rows=[]; let row=[],cell='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++) {const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(c==='"'){if(cell || closed)throw Error('Unexpected CSV quote');quoted=true;continue;}
  if(c===',' || c==='\n' || c==='\r'){row.push(cell);cell='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(x=>x!==''))rows.push(row);row=[];}continue;}
  if(closed)throw Error('Text after CSV closing quote'); cell+=c;
 }
 if(quoted)throw Error('Unclosed CSV quote');if(cell || closed || row.length){row.push(cell);rows.push(row);}
 const headers=rows.shift();if(!headers?.length || new Set(headers).size!==headers.length)throw Error('Missing or duplicate CSV headers');
 for(const h of ['id','name','nutrition_verification_level','carb_definition',...numeric.slice(0,5)])if(!headers.includes(h))throw Error(`Missing CSV header ${h}`);
 return rows.map((r,i)=>{if(r.length!==headers.length)throw Error(`CSV row ${i+2} has wrong column count`);const o=Object.fromEntries(headers.map((h,j)=>[h,r[j]]));for(const k of numeric){const raw=o[k];o[k]=raw==null||raw.trim()===''?null:Number(raw);if(o[k]!=null && (!Number.isFinite(o[k]) || o[k]<0))throw Error(`Invalid ${k} at ${o.id}`);}return o;});
}
const normalize = s => String(s || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
function identity(row) {return ['name','brand','restaurant_chain','preparation','market','food_type','basis','source','source_id'].map(k=>normalize(row[k])).join('|');}
function validate(rows) {
 const ids=new Set();for(const r of rows){if(!/^[\w-]{1,100}$/.test(r.id)||!normalize(r.name)||ids.has(r.id))throw Error('Missing or duplicate catalog identity');ids.add(r.id);if(!levels.includes(r.nutrition_verification_level))throw Error(`Invalid verification level ${r.id}`);
 for(const k of numeric){if(r[k]!=null && (!Number.isFinite(r[k])||r[k]<0))throw Error(`Invalid ${k}: ${r.id}`);}
 for(const k of ['protein_g_per_100g','carbs_g_per_100g','fat_g_per_100g','fiber_g_per_100g','total_carbs_g_per_100g'])if(r[k]>100)throw Error(`Out-of-range ${k}: ${r.id}`);
 if(r.kcal_per_100g>1000 || !r.basis?.startsWith('100 g'))throw Error(`Unsupported basis or energy: ${r.id}`);
 }return rows;
}
module.exports={parseCsv,validate,levels,numeric,normalize,identity,checksum:text=>createHash('sha256').update(text).digest('hex')};
