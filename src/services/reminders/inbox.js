// Privacy-safe analytics + inbox records. Event payloads carry categories and
// outcomes only — never log contents, health values, or notification text.
async function emit(prisma, userId, eventType, eventData) {
  try {
    await prisma.userEvent.create({ data: { userId, eventType, eventData } });
  } catch (err) {
    console.error('reminder event failed:', err.message);
  }
}

// Notification is the existing inbox model. Bodies stay discreet: no meal
// names, nutrient values, or health details beyond the reminder category.
async function notifyInbox(prisma, { userId, category, title, body, why }) {
  try {
    return await prisma.notification.create({ data: { userId, type: `reminder:${category}`, title, body: why ? `${body}\n\nWhy: ${why}` : body } });
  } catch (err) {
    console.error('reminder inbox failed:', err.message);
    return null;
  }
}

module.exports = { emit, notifyInbox };
