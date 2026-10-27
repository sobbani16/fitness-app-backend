// Stable semantic identities; RAE, alpha-tocopherol and total folate are not interchangeable with IU/DFE.
const NUTRIENTS = [
  ['ENERGY_KCAL','Calories','kcal','OTHER'],
  ['PROTEIN','Protein','g','MACRO'], ['CARBOHYDRATE_TOTAL','Total Carbohydrates','g','MACRO'],
  ['FAT_TOTAL','Total Fat','g','MACRO'], ['FAT_SATURATED','Saturated Fat','g','MACRO'],
  ['FAT_TRANS','Trans Fat','g','MACRO'], ['FIBER','Fiber','g','MACRO'],
  ['SUGAR_TOTAL','Total Sugar','g','MACRO'], ['SUGAR_ADDED','Added Sugar','g','MACRO'],
  ...['Sodium','Potassium','Phosphorus','Calcium','Iron','Magnesium','Zinc'].map(name => [name.toUpperCase(),name,'mg','MINERAL']),
  ['CHOLESTEROL','Cholesterol','mg','OTHER'],
  ['VITAMIN_A_RAE','Vitamin A (RAE)','mcg','VITAMIN'], ['VITAMIN_B6','Vitamin B6','mg','VITAMIN'],
  ['VITAMIN_B12','Vitamin B12','mcg','VITAMIN'], ['VITAMIN_C','Vitamin C','mg','VITAMIN'],
  ['VITAMIN_D','Vitamin D (D2 + D3)','mcg','VITAMIN'], ['VITAMIN_E_ALPHA_TOCOPHEROL','Vitamin E (alpha-tocopherol)','mg','VITAMIN'],
  ['VITAMIN_K','Vitamin K (phylloquinone)','mcg','VITAMIN'], ['FOLATE_TOTAL','Folate (total)','mcg','VITAMIN'],
  ['IODINE','Iodine','mcg','MINERAL'], ['SELENIUM','Selenium','mcg','MINERAL'],
].map(([code,name,unit,category]) => ({code,name,unit,category}));
async function seedNutrients(prisma) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(6822982481)`;
    for (const data of NUTRIENTS) {
      const existing = await tx.nutrient.findUnique({where:{code:data.code}});
      if (existing) {
        if (['name','unit','category'].some(key=>existing[key]!==data[key])) throw new Error(`Nutrient definition conflict: ${data.code}`);
      } else await tx.nutrient.create({data});
    }
    return {nutrients:NUTRIENTS.length};
  });
}
module.exports = { NUTRIENTS, seedNutrients };
