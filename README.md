# Fitness App — Backend (Node + Express)

## Requirements
- Node.js >= 18

## Setup
```bash
npm install
cp .env.example .env
npm run dev     # nodemon, :4000
npm test        # Jest + supertest
```

## Endpoints (MVP)
- `GET  /health` — liveness check (implemented).
- `POST /meals` — stub for meal logging.
- `GET  /recommendations` — stub for workout/diet suggestions.
- `GET  /summary/daily` — stub for daily summary.
- `POST /chat` — stub for AI chat (will enforce 5/day).

## Structure
```
src/
  index.js          server bootstrap
  app.js            express app (middleware + routes)
  routes/           one file per resource
  controllers/      (future) thin handlers
  services/         calorieEngine, recommendationEngine, weatherService, aiService
  utils/            logger
tests/              Jest + supertest
```

## Next step
Implement calorie engine + rule-based recommendation engine with unit tests.
