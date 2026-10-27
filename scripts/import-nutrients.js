require('dotenv').config();
const fs = require('node:fs');
const {getPrisma} = require('../src/lib/prisma');
const {importNutrients} = require('../src/services/nutrientImport');
const args = process.argv.slice(2);
if (!args[0] || args.slice(1).some(a=>a!=='--apply')) throw new Error('Usage: node scripts/import-nutrients.js records.json [--apply]');
const rows = JSON.parse(fs.readFileSync(args[0],'utf8'));
const prisma = getPrisma();
importNutrients(prisma,rows,{apply:args.includes('--apply')}).then(report=>console.log(JSON.stringify(report,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
