const { Telegraf } = require('telegraf');
const { handleStart, handlePlanos } = require('./commands');
const { handlePlanSelect, handleCheckPayment } = require('./actions');
const db = require('../db/index');

const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
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

  // Callbacks dos botoes inline
  // (OBS: aqui era \\d, isso quebrava o regex. O certo é \d)
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
  if (started) return;

  initBot();

  // Garante que não tem webhook ativo e ainda limpa updates pendentes no Telegram
  await bot.telegram.deleteWebhook({ drop_pending_updates: true }); // Telegram suporta drop_pending_updates [web:159]

  await bot.launch({
    dropPendingUpdates: true,
    allowedUpdates: ['message', 'callback_query', 'chat_member', 'my_chat_member'],
  });

  started = true;
  console.log('🤖 Bot iniciado');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

module.exports = { bot: () => getBot(), getBot, initBot, startBot };
