const cron = require('node-cron');
const db = require('../db/index');
const { bot } = require('../bot/index');
const { Markup } = require('telegraf');

function startScheduler() {

  // A cada hora: remove membros expirados do grupo
  cron.schedule('0 * * * *', async () => {
    const expired = await db.query(`
      SELECT s.*, u.telegram_id, u.first_name
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      WHERE s.status = 'active' AND s.expires_at <= NOW()
    `);

    for (const sub of expired.rows) {
      try {
        // Kick + unban (remove sem banir permanentemente)
        await bot.telegram.banChatMember(process.env.GROUP_ID, sub.telegram_id);
        await bot.telegram.unbanChatMember(process.env.GROUP_ID, sub.telegram_id);

        await db.query(
          `UPDATE subscriptions SET status = 'expired' WHERE id = $1`,
          [sub.id]
        );
        await db.query(
          `UPDATE users SET is_in_group = FALSE WHERE telegram_id = $1`,
          [sub.telegram_id]
        );

        await bot.telegram.sendMessage(sub.telegram_id,
          `⚠️ Seu acesso ao grupo expirou.\n\nRenove agora para voltar! 👇`,
          Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Ver Planos', 'show_plans')]
          ])
        );
      } catch (err) {
        console.error(`Erro ao remover ${sub.telegram_id}:`, err.message);
      }
    }
    console.log(`✅ Verificação de expirados: ${expired.rows.length} processados`);
  });

  // Diariamente às 10h: avisa quem expira em 1 dia
  cron.schedule('0 10 * * *', async () => {
    const expiringSoon = await db.query(`
      SELECT s.*, u.telegram_id, pl.name as plan_name, pl.id as plan_id
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      JOIN plans pl ON pl.id = s.plan_id
      WHERE s.status = 'active'
      AND s.expires_at BETWEEN NOW() AND NOW() + INTERVAL '25 hours'
    `);

    for (const sub of expiringSoon.rows) {
      await bot.telegram.sendMessage(sub.telegram_id,
        `⏰ *Seu acesso expira amanhã!*\n\nRenove agora e não perca o acesso ao grupo. Basta gerar o PIX abaixo 👇`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(`💳 Renovar ${sub.plan_name}`, `plan_${sub.plan_id}`)]
          ])
        }
      );
    }
  });
}

module.exports = { startScheduler };
