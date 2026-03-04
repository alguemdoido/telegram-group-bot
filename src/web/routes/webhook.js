const express = require('express');
const router = express.Router();
const db = require('../../db/index');
const { getBot } = require('../../bot/index');

router.post('/efi/webhook', async (req, res) => {
  res.status(200).json({ ok: true }); // EFI exige resposta rapida

  const pixArr = req.body?.pix;
  if (!pixArr) return;

  for (const pix of pixArr) {
    const { txid } = pix;

    const paymentRes = await db.query(`
      SELECT p.*, u.telegram_id, pl.duration_days, pl.name as plan_name
      FROM payments p
      JOIN users u ON u.id = p.user_id
      JOIN plans pl ON pl.id = p.plan_id
      WHERE p.txid = $1 AND p.status = 'pending'
    `, [txid]);

    if (!paymentRes.rows[0]) continue;
    const payment = paymentRes.rows[0];

    const bot = getBot();
    const now = new Date();
    const durationDays = Number(payment.duration_days) || 30;
    const expiresAt = new Date(now.getTime() + durationDays * 86400000);

    // Verifica se ja tem assinatura ativa (renovacao)
    const existingSub = await db.query(`
      SELECT * FROM subscriptions
      WHERE user_id = $1 AND status = 'active'
    `, [payment.user_id]);

    let subscriptionId;
    if (existingSub.rows[0]) {
      // Renova: apenas estende a data
      await db.query(
        `UPDATE subscriptions SET expires_at = $1 WHERE id = $2`,
        [expiresAt, existingSub.rows[0].id]
      );
      subscriptionId = existingSub.rows[0].id;

      await bot.telegram.sendMessage(payment.telegram_id,
        `✅ *Renovação confirmada!*\n\nSeu acesso ao grupo foi renovado até *${expiresAt.toLocaleDateString('pt-BR')}*. 🎉`,
        { parse_mode: 'Markdown' }
      );
    } else {
      // Novo acesso: cria subscription e gera link unico
      const inviteLink = await bot.telegram.createChatInviteLink(process.env.GROUP_ID, {
        member_limit: 1, // link de uso unico
        expire_date: Math.floor((Date.now() + 3600000) / 1000) // expira em 1h
      });

      const subRes = await db.query(`
        INSERT INTO subscriptions (user_id, plan_id, starts_at, expires_at, invite_link)
        VALUES ($1, $2, $3, $4, $5) RETURNING id
      `, [payment.user_id, payment.plan_id, now, expiresAt, inviteLink.invite_link]);
      subscriptionId = subRes.rows[0].id;

      // Marca que ja comprou
      await db.query(
        `UPDATE users SET never_bought = FALSE WHERE id = $1`,
        [payment.user_id]
      );

      await bot.telegram.sendMessage(payment.telegram_id,
        `✅ *Pagamento confirmado!*\n\n` +
        `Clique no link abaixo para entrar no grupo.\n` +
        `⚠️ O link é de uso único e expira em 1 hora!\n\n` +
        `🔗 ${inviteLink.invite_link}`,
        { parse_mode: 'Markdown' }
      );
    }

    // Atualiza pagamento
    await db.query(
      `UPDATE payments SET status = 'paid', paid_at = NOW(), subscription_id = $1 WHERE txid = $2`,
      [subscriptionId, txid]
    );
  }
});

module.exports = router;
