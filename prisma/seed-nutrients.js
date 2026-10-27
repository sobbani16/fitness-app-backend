require('dotenv').config();
const { getPrisma } = require('../src/lib/prisma');
const { seedNutrients } = require('../src/services/nutrientMaster');
const prisma = getPrisma();
seedNutrients(prisma).then(result=>console.log(result)).catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
