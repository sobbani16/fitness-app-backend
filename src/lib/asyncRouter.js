// Express 4 does not forward async throws/rejections to the error
// middleware — a `throw httpError(...)` inside an async handler hangs the
// request. This wraps router verb registrations so rejections reach
// app-level error handling. Sync middleware (returns undefined) is untouched.
const express = require('express');

module.exports = function asyncRouter() {
  const router = express.Router();
  for (const m of ['get', 'post', 'put', 'patch', 'delete', 'use']) {
    const orig = router[m].bind(router);
    router[m] = (...args) => {
      const fns = args.map(f => {
        if (typeof f !== 'function' || f.length >= 4) return f; // error mw or path string
        return (req, res, next) => {
          try {
            const p = f(req, res, next);
            if (p && p.catch) p.catch(next);
          } catch (e) { next(e); }
        };
      });
      return orig(...fns);
    };
  }
  return router;
};
