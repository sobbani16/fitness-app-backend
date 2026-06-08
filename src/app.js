const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const routes = require('./routes');
const { setupSwagger } = require('./swagger');

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Swagger UI at /api-docs
setupSwagger(app);

app.use('/', routes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

module.exports = app;
