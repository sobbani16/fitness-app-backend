const express = require('express');
const ctrl = require('../controllers/exerciseController');

const router = express.Router();
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);

// Expose store for tests (mirrors the pattern in chat.js).
router.__store = ctrl.store;

router.get('/', wrap(ctrl.listSessions));
router.get('/prefill/:exerciseType', wrap(ctrl.getPrefill));
router.post('/', wrap(ctrl.createSession));
router.post('/:id/sets', wrap(ctrl.appendSet));

router.post('/:id/finish', wrap(ctrl.finishSession));

module.exports = router;
