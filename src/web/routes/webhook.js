const express = require('express');
const router = express.Router();
const db = require('../../db/index');
const { getBot } = require('../../bot/index');

// Rota de health check para confirmar que o servidor recebe requests
router.get('/efi/webhook', (req, res) => {
  res.status(200).json({ status: 'webhook endpoint ativo' });
});

router.post(['/efi/webhook', '/efi/webhook/pix'], async (req, res) => {
  console.log('\ud83d\udce5 Webhook EFI recebido:', JSON.stringify(req.body));
  res.status(200).json({ ok: true }); // EFI exige resposta rapida

  const pixArr = req.body?.pix;
  if (!pixArr) {
    console.log('\u26a0\ufe0f Webhook sem campo pix:', JSON.stringify(req.body));
    return;
  }

  for (const pix of pixArr) {
    const { txid } = pix;
    console.log('\ud83d\udd0d Processando txid:', txid);

    const paymentRes = await db.query(`
      SELECT p.*, u.telegram_id, pl.duration_days, pl.name as plan_name
      FROM payments p
      JOIN users u ON u.id = p.user_id
      JOIN plans pl ON pl.id = p.plan_id
      WHERE p.txid = $1 AND p.status = 'pending'
    `, [txid]);

    if (!paymentRes.rows[0]) {
      console.log('\u26a0\ufe0f Pagamento nao encontrado ou ja processado para txid:', txid);
      continue;
    }

    const payment = paymentRes.rows[0];
    console.log('\u2705 Pagamento encontrado para telegram_id:', payment.telegram_id);

    let bot;
    try {
      bot = getBot();
    } catch (e) {
      console.error('\u274c Bot nao inicializado ainda:', e.message);
      continue;
    }

    const now = new Date();
    const durationDays = Number(payment.duration_days) || 30;
    const expiresAt = new Date(now.getTime() + durationDays * 86400000);

    // Verifica se ja tem assinatura ativa (renovacao)
    const existingSub = await db.query(`
      SELECT * FROM subscriptions
      WHERE user_id = $1 AND status = 'active'
    `, [payment.user_id]);

    let subscriptionId;
    try {
      if (existingSub.rows[0]) {
        // Renova: apenas estende a data
        await db.query(
          `UPDATE subscriptions SET expires_at = $1 WHERE id = $2`,
          [expiresAt, existingSub.rows[0].id]
        );
        subscriptionId = existingSub.rows[0].id;
        await bot.telegram.sendMessage(
          payment.telegram_id,
          `\u2705 Renova\u00e7\u00e3o confirmada!\n\nSeu acesso ao grupo foi renovado at\u00e9 ${expiresAt.toLocaleDateString('pt-BR')}. \ud83c\udf89`
        );
        console.log('\ud83c\udf89 Renovacao enviada para:', payment.telegram_id);
      } else {
        // Novo acesso: cria subscription e gera link unico
        const groupId = process.env.TELEGRAM_GROUP_ID;
        console.log('\ud83d\udd17 Criando invite link para grupo:', groupId);
        const inviteLink = await bot.telegram.createChatInviteLink(groupId, {
          member_limit: 1
        });
        const subRes = await db.query(`
          INSERT INTO subscriptions (user_id, plan_id, starts_at, expires_at, invite_link)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id
        `, [payment.user_id, payment.plan_id, now, expiresAt, inviteLink.invite_link]);
        subscriptionId = subRes.rows[0].id;

        await db.query(
          `UPDATE users SET never_bought = FALSE WHERE id = $1`,
          [payment.user_id]
        );

        await bot.telegram.sendMessage(
          payment.telegram_id,
          `\u2705 PAGAMENTO CONFIRMADO\n\n` +
          `Clique no link abaixo para entrar no grupo\n\n` +
          `NOME DO GRUPO (Club Frang\u00e3o)\n` +
          `${inviteLink.invite_link}\n\n` +
          `Se houver d\u00favidas, chame no insta FRANGINLIVE`
        );
        console.log('\ud83d\udd17 Link enviado para:', payment.telegram_id, inviteLink.invite_link);
      }

      // Atualiza pagamento
      await db.query(
        `UPDATE payments SET status = 'paid', paid_at = NOW(), subscription_id = $1 WHERE txid = $2`,
        [subscriptionId, txid]
      );
      console.log('\ud83d\udcb0 Payment atualizado para paid, txid:', txid);
    } catch (err) {
      console.error('\u274c Erro ao processar pagamento txid', txid, ':', err.message);
    }
  }
});

module.exports = router;
