const express = require('express');
const { requirePermission } = require('../middleware/rbac');
const { getPrisma } = require('../lib/prisma');
const { coachingTransaction } = require('../services/coachingTransaction');
const audit = require('../services/auditService');
const { httpError } = require('../lib/errors');

const router = express.Router();

// POST /coach-notes
router.post('/', requirePermission('CREATE_COACH_NOTES'), async (req, res) => {
  try {
    const { clientId, note, visibility } = req.body || {};
    if (!clientId || !note) return res.status(400).json({ error: 'clientId and note required.' });

    const coachNote = await coachingTransaction(async prisma => {
      // Determine coach type
      const trainer = await prisma.trainerProfile.findUnique({ where: { userId: req.userId } });
      const nutritionist = await prisma.nutritionistProfile.findUnique({ where: { userId: req.userId } });

      const assigned = (trainer && await prisma.trainerClient.findFirst({where:{trainerId:trainer.id,clientId,status:'active'}})) || (nutritionist && await prisma.nutritionistClient.findFirst({where:{nutritionistId:nutritionist.id,clientId,status:'active'}}));
      if (!assigned) throw httpError(403, 'Client access denied');
      if (visibility && !['private','client_visible'].includes(visibility)) throw httpError(400, 'Invalid visibility');
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
      await audit.log({ actorId: req.userId, action: 'coach_note.create', entityType: 'CoachNote', entityId: coachNote.id, afterData: { clientId, visibility: coachNote.visibility } }, prisma);
      return coachNote;
    });
    res.status(201).json(coachNote);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
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
      } else { where.coachId = req.userId; }
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
