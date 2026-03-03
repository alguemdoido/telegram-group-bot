require('dotenv').config();
const { initDB } = require('./db/schema');
const { startBot } = require('./bot/index');
const { startServer } = require('./web/server');
const { startScheduler } = require('./services/scheduler');

async function main() {
  await initDB();
  startBot();
  startServer();
  startScheduler();
  console.log('✅ Bot, servidor e scheduler iniciados');
}

main().catch(console.error);
