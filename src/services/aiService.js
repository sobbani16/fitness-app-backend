// AI service — mock chat responder (no real LLM yet).
// Rule-based, deterministic, topic-tagged. Responses kept short (<150 words).

const TOPICS = [
  {
    id: 'calories',
    keywords: ['calorie', 'calories', 'kcal', 'deficit', 'surplus'],
    answer:
      'Daily calories depend on your age, sex, weight, height and activity. Aim for a 300–500 kcal deficit to lose, a 300–500 surplus to gain, and eat at your TDEE to maintain. Consistency beats intensity — small daily adjustments add up.',
  },
  {
    id: 'protein',
    keywords: ['protein', 'macros', 'muscle gain'],
    answer:
      'For most active adults, 1.4–2.0 g of protein per kg of body weight per day supports muscle maintenance and growth. Spread it across 3–4 meals. Good sources: eggs, chicken, fish, Greek yogurt, tofu, beans.',
  },
  {
    id: 'cardio',
    keywords: ['cardio', 'running', 'walk', 'hiit'],
    answer:
      'Mix steady-state cardio (brisk walk or easy jog, 30–45 min) 3x/week with one HIIT session (20 min). Walking after meals helps blood sugar and appetite control. If knees bother you, try cycling or swimming.',
  },
  {
    id: 'strength',
    keywords: ['strength', 'lift', 'weights', 'gym'],
    answer:
      'Train 3x/week full-body: squat, hinge, push, pull, carry. 3 sets of 6–10 reps, adding a little weight or a rep each week. Rest 1–2 minutes between sets. Sleep and protein matter as much as the lifts.',
  },
  {
    id: 'sleep',
    keywords: ['sleep', 'recovery', 'tired'],
    answer:
      'Aim for 7–9 hours of sleep. Keep a consistent bedtime, dim lights an hour before, and avoid caffeine after noon. Poor sleep raises hunger hormones and reduces workout output — it is a lever, not a luxury.',
  },
  {
    id: 'hydration',
    keywords: ['water', 'hydration', 'thirsty'],
    answer:
      'A reasonable target is 30–35 ml per kg of body weight daily, more on hot or active days. Start the day with a glass, keep a bottle visible, and drink before and after workouts.',
  },
];

const FALLBACK =
  'Good question. For MVP I am a rule-based assistant. I can help with calories, protein, cardio, strength, sleep, and hydration. Try asking about one of those and log your meals so the dashboard can personalize suggestions.';

function generateReply(message) {
  if (typeof message !== 'string' || !message.trim()) {
    throw new Error('message is required');
  }
  const lower = message.toLowerCase();
  const topic = TOPICS.find((t) => t.keywords.some((k) => lower.includes(k)));
  return {
    topic: topic ? topic.id : 'general',
    answer: topic ? topic.answer : FALLBACK,
  };
}

module.exports = { generateReply, TOPICS };
