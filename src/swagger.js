const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Fitness App Backend API',
      version: '0.1.0',
      description: 'API documentation for the Fitness App backend. Test endpoints directly from this page.',
    },
    servers: [
      { url: 'http://localhost:4000', description: 'Local dev' },
      { url: 'https://fitness-app-backend-production-c5d4.up.railway.app', description: 'Production (Railway)' },
    ],
    components: {
      parameters: {
        XUserId: {
          in: 'header',
          name: 'x-user-id',
          schema: { type: 'string', default: 'test-user-1' },
          description: 'Device / user identifier',
        },
      },
    },
  },
  apis: ['./src/routes/*.js', './src/swagger-docs.yaml', './src/swagger-rbac.yaml'],
};

const swaggerSpec = swaggerJsdoc(options);

function setupSwagger(app) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    explorer: true,
    swaggerOptions: { persistAuthorization: true },
  }));
  // Also expose raw JSON spec
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}

module.exports = { setupSwagger };
