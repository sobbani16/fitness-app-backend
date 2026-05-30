const request = require('supertest');
const app = require('../src/app');
const exercisesRouter = require('../src/routes/exercises');

jest.setTimeout(30000);

const USER = 'user-test-1';

beforeEach(() => {
  exercisesRouter.__store.reset();
});

describe('exercises routes', () => {
  it('rejects requests without x-user-id', async () => {
    const res = await request(app).get('/exercises');
    expect(res.status).toBe(400);
  });

  it('creates a session and lists it', async () => {
    const create = await request(app)
      .post('/exercises')
      .set('x-user-id', USER)
      .send({
        exerciseType: 'bench-press',
        sets: [{ reps: 10, weight: 40 }],
      });
    expect(create.status).toBe(201);
    expect(create.body.exerciseType).toBe('bench-press');
    expect(create.body.sets).toHaveLength(1);
    expect(create.body.sets[0]).toMatchObject({ reps: 10, weight: 40 });

    const list = await request(app).get('/exercises').set('x-user-id', USER);
    expect(list.status).toBe(200);
    expect(list.body.sessions).toHaveLength(1);
  });

  it('validates set fields on creation', async () => {
    const res = await request(app)
      .post('/exercises')
      .set('x-user-id', USER)
      .send({ exerciseType: 'squat', sets: [{ reps: -1, weight: 10 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reps/);
  });

  it('appends sets and autofills by reusing prior weight if omitted', async () => {
    const create = await request(app)
      .post('/exercises')
      .set('x-user-id', USER)
      .send({ exerciseType: 'deadlift', sets: [{ reps: 5, weight: 100 }] });
    const id = create.body.id;

    const append = await request(app)
      .post(`/exercises/${id}/sets`)
      .set('x-user-id', USER)
      .send({ reps: 5, weight: 100 });
    expect(append.status).toBe(200);
    expect(append.body.sets).toHaveLength(2);
    expect(append.body.sets[1]).toMatchObject({ reps: 5, weight: 100 });
  });

  it('returns 404 when appending to an unknown session', async () => {
    const res = await request(app)
      .post('/exercises/missing-id/sets')
      .set('x-user-id', USER)
      .send({ reps: 5, weight: 50 });
    expect(res.status).toBe(404);
  });

  it('prefill returns null when no history', async () => {
    const res = await request(app)
      .get('/exercises/prefill/bench-press')
      .set('x-user-id', USER);
    expect(res.status).toBe(200);
    expect(res.body.suggestedWeight).toBeNull();
    expect(res.body.lastSetCount).toBe(0);
  });

  it('prefill returns last weight when history exists', async () => {
    await request(app)
      .post('/exercises')
      .set('x-user-id', USER)
      .send({
        exerciseType: 'bench-press',
        sets: [
          { reps: 10, weight: 40 },
          { reps: 8, weight: 45 },
        ],
      });
    const res = await request(app)
      .get('/exercises/prefill/bench-press')
      .set('x-user-id', USER);
    expect(res.status).toBe(200);
    expect(res.body.suggestedWeight).toBe(45);
    expect(res.body.lastSetCount).toBe(2);
  });

  it('prefill scopes history per user', async () => {
    await request(app)
      .post('/exercises')
      .set('x-user-id', 'alice')
      .send({ exerciseType: 'squat', sets: [{ reps: 5, weight: 80 }] });

    const res = await request(app)
      .get('/exercises/prefill/squat')
      .set('x-user-id', 'bob');
    expect(res.body.suggestedWeight).toBeNull();
  });
});
