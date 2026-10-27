jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const { analyzeForUser } = require('../src/services/labelInsights');
const request = require('supertest');
test('does not read private profile without opt-in', async () => {
  await analyzeForUser({ingredients:'Maida'},'alice');
  expect(getPrisma).not.toHaveBeenCalled();
});
test('loads only the authenticated account’s active conditions and allergies after opt-in', async () => {
  const findUnique = jest.fn(async()=>({goalType:'maintain',healthConditions:[{condition:{name:'diabetes'}}],allergies:[]}));
  getPrisma.mockReturnValue({user:{findUnique}});
  const result = await analyzeForUser({personalize:true,carbsG:20},'alice');
  expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({where:{id:'alice'},select:expect.objectContaining({healthConditions:expect.objectContaining({where:{active:true}})})}));
  expect(result.insights.some(i=>i.ruleId==='DIABETES_PORTION_001')).toBe(true);
});
test('insights, comparison and save remain behind bearer authentication', async () => {
  const old = process.env.AUTH_TEST_BYPASS;
  process.env.AUTH_TEST_BYPASS = 'false';
  try {
    const app = require('../src/app');
    for (const action of ['insights','compare','save']) await request(app).post(`/label-scanner/${action}`).set('x-user-id','alice').send({}).expect(401);
  } finally { process.env.AUTH_TEST_BYPASS = old; }
});
