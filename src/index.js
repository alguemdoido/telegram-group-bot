require('dotenv').config();
const { initDB } = require('./db/schema');
const { startBot } = require('./bot/index');
const { startServer } = require('./web/server');
const { startScheduler } = require('./services/scheduler');
const { registerWebhook } = require('./services/efi');

async function main() {
  await initDB();
  await startBot();
  startServer();
  startScheduler();
  // Registra o webhook da EFI automaticamente no boot
  await registerWebhook();
  console.log('\u2705 Bot, servidor e scheduler iniciados');
}

main().catch(console.error);
