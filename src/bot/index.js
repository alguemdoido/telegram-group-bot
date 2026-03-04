const { Telegraf } = require('telegraf');
const { handleStart, handlePlanos } = require('./commands');
const { handlePlanSelect, handleCheckPayment } = require('./actions');
const db = require('../db/index');

const token = (process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '').trim();
if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN');

let bot;        // instância única
let started = false;

function getBot() {
  if (!bot) throw new Error('Bot ainda não foi inicializado');
  return bot;
}

function initBot() {
  if (bot) return bot;

  bot = new Telegraf(token);

  // Registra usuarios no /start
  bot.start(handleStart);
  bot.command('planos', handlePlanos);

  // Callbacks dos botoes inline ✅ FINAL
  bot.action(/^plan_(\d+)$/, handlePlanSelect);
  bot.action(/^check_pay_(.+)$/, handleCheckPayment);
  bot.action('show_plans', handlePlanos);

  // Detecta entrada no grupo via invite link
  bot.on('chat_member', async (ctx) => {
    const member = ctx.update.chat_member;
    if (member?.new_chat_member?.status === 'member') {
      const userId = member.new_chat_member.user.id;
      await db.query(
        `UPDATE users SET is_in_group = TRUE WHERE telegram_id = $1`,
        [userId]
      );
    }
  });

  return bot;
}

async function startBot() {
  initBot();

  // 🔥 FIX 409 DEFINITIVO: retry deleteWebhook 3x + delay
  for (let i = 0; i < 3; i++) {
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      console.log('🧹 Polling anterior LIMPO');
      break;
    } catch (e) {
      console.log(`⚠️  Tentativa ${i+1}/3 deleteWebhook:`, e.message);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Espera polling morrer
  await new Promise(r => setTimeout(r, 2000));

  if (started) return;

  await bot.launch({
    dropPendingUpdates: true,
    allowedUpdates: ['message', 'callback_query', 'chat_member', 'my_chat_member'],
  });

  started = true;
  console.log('🤖 Bot iniciado OK');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

module.exports = { bot: () => getBot(), getBot, initBot, startBot };
