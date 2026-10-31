jest.mock('../src/services/aiProvider', () => ({ askJSON: jest.fn(), aiEnabled: () => true }));
const { askJSON } = require('../src/services/aiProvider');
const { generateDraft } = require('../src/services/workoutPlanner');
const { analyzeMenu } = require('../src/services/menuAnalysis');
function strictObjects(schema) {
  if (schema.type === 'object') {
    expect(schema.additionalProperties).toBe(false);
    expect([...(schema.required || [])].sort()).toEqual(Object.keys(schema.properties).sort());
    Object.values(schema.properties).forEach(strictObjects);
  }
  if (schema.items) strictObjects(schema.items);
}
test('every nested object in the workout and menu provider schemas is strict-compatible', async () => {
  askJSON.mockResolvedValueOnce({ days: [{ weekday: 'mon', exercises: [{ exerciseId: 'push-up', sets: 2, reps: '10', restSec: 60 }] }] });
  await generateDraft('alice', { equipment: ['bodyweight'] });
  askJSON.mockResolvedValueOnce({ restaurant: '', items: [{ name: 'Dish', calories: 100 }] });
  await analyzeMenu({ userId: 'alice', images: ['mocked-image'], prisma: {} });
  for (const args of askJSON.mock.calls) Object.values(args[1]).forEach(strictObjects);
});
