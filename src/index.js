require('dotenv').config();
const { getPrisma } = require('./lib/prisma');
async function start() {
  if (process.env.NODE_ENV === 'production' && process.env.AUTH_TEST_BYPASS) throw new Error('Test authentication bypass cannot be configured in production.');
  require('./services/authLifecycle').validateConfig();
  await getPrisma().$connect();
  if (process.env.NODE_ENV === 'production') await require('./services/deploymentReadiness').assertDeploymentReady(getPrisma());
  const stopEmailWorker = require('./services/authEmail').startEmailWorker();
  const server = require('./app').listen(process.env.PORT || 4000, () => console.log('Backend listening'));
  server.requestTimeout = 60000;
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {
    server.close(async () => { await stopEmailWorker(); await getPrisma().$disconnect(); process.exit(0); });
    setTimeout(() => process.exit(1),10000).unref();
  });
}
start().catch(e => { console.error('Startup failed:', e.message); process.exit(1); });
