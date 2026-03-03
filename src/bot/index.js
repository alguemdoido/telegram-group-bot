const { Telegraf } = require('telegraf');
const { handleStart, handlePlanos } = require('./commands');
const { handlePlanSelect, handleCheckPayment } = require('./actions');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Registra usuarios no /start
bot.start(handleStart);
bot.command('planos', handlePlanos);

// Callbacks dos botoes inline
bot.action(/^plan_(\d+)$/, handlePlanSelect);
bot.action(/^check_pay_(.+)$/, handleCheckPayment);
bot.action('show_plans', handleStart);

// Detecta entrada no grupo via invite link
bot.on('chat_member', async (ctx) => {
  const member = ctx.update.chat_member;
  if (member.new_chat_member.status === 'member') {
    const userId = member.new_chat_member.user.id;
    const db = require('../db/index');
    await db.query(
      `UPDATE users SET is_in_group = TRUE WHERE telegram_id = $1`,
      [userId]
    );
  }
});

function startBot() {
  bot.launch({
    allowedUpdates: ['message', 'callback_query', 'chat_member', 'my_chat_member']
  });
  console.log('🤖 Bot iniciado');
}

module.exports = { bot, startBot };
