const { Telegraf } = require('telegraf');
const { handleStart, handlePlanos, handleIndicacoes } = require('./commands');
const { handlePlanSelect, handleCheckPayment } = require('./actions');
const db = require('../db/index');

const token = (process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '').trim();
if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN');

let bot; // instancia unica
let started = false;

function getBot() {
  if (!bot) throw new Error('Bot ainda nao foi inicializado');
  return bot;
}

function initBot() {
  if (bot) return bot;

  bot = new Telegraf(token);

  // Registra usuarios no /start
  bot.start(handleStart);
  bot.command('planos', handlePlanos);
  bot.command('indicacoes', handleIndicacoes);

  // Callbacks dos botoes inline
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
  // Checa ANTES de qualquer coisa - evita conflito entre processos duplicados
  if (started) {
    console.log('\u26a0\ufe0f startBot() chamado mas ja iniciado. Ignorando.');
    return;
  }

  initBot();

  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    console.log('\u{1F9F9} Webhook deletado / Polling anterior LIMPO');
  } catch (e) {
    console.log('\u26a0\ufe0f deleteWebhook falhou (nao critico):', e.message);
  }

  // Pequeno delay para garantir que conexao anterior fechou
  await new Promise(r => setTimeout(r, 1500));

  // Lanca o bot sem bloquear o processo (nao usa await)
  bot.launch({
    dropPendingUpdates: true,
    allowedUpdates: ['message', 'callback_query', 'chat_member', 'my_chat_member'],
  }).then(() => {
    console.log('\u{1F916} Bot encerrado.');
  }).catch((err) => {
    if (err.response && err.response.error_code === 409) {
      console.error('\u274c Conflito 409: outra instancia ja esta rodando. Encerrando...');
      process.exit(0);
    } else {
      console.error('\u274c Erro ao iniciar o bot:', err.message);
    }
  });

  started = true;
  console.log('\u{1F916} Bot iniciado OK');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

module.exports = { bot: () => getBot(), getBot, initBot, startBot };
