const express = require('express');
const { requirePermission } = require('../middleware/rbac');
const { getPrisma } = require('../lib/prisma');

const router = express.Router();

// POST /coach-notes
router.post('/', requirePermission('CREATE_COACH_NOTES'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const { clientId, note, visibility } = req.body || {};
    if (!clientId || !note) return res.status(400).json({ error: 'clientId and note required.' });

    // Determine coach type
    const trainer = await prisma.trainerProfile.findUnique({ where: { userId: req.userId } });
    const nutritionist = await prisma.nutritionistProfile.findUnique({ where: { userId: req.userId } });

    const coachNote = await prisma.coachNote.create({
      data: {
        coachId: req.userId,
        coachRole: trainer ? 'trainer' : 'nutritionist',
        clientId,
        note,
        visibility: visibility || 'private',
        trainerId: trainer?.id || null,
        nutritionistId: nutritionist?.id || null,
      },
    });
    res.status(201).json(coachNote);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /coach-notes?clientId=...
router.get('/', requirePermission('CREATE_COACH_NOTES', 'VIEW_OWN_PROFILE'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const { clientId } = req.query;
    const where = {};
    if (clientId) {
      where.clientId = clientId;
      // If user is the client, only show client_visible notes
      if (clientId === req.userId) {
        where.visibility = 'client_visible';
      }
    } else {
      where.coachId = req.userId;
    }
    const notes = await prisma.coachNote.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ notes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
