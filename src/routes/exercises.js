const express = require('express');
const ctrl = require('../controllers/exerciseController');

const router = express.Router();

// Expose store for tests (mirrors the pattern in chat.js).
router.__store = ctrl.store;

router.get('/', ctrl.listSessions);
router.get('/prefill/:exerciseType', ctrl.getPrefill);
router.post('/', ctrl.createSession);
router.post('/:id/sets', ctrl.appendSet);

module.exports = router;
