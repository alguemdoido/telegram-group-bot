const express = require('express');
const router = express.Router();
const db = require('../../db/index');
const { getBot } = require('../../bot/index');

// Rota de health check
router.get('/efi/webhook', (req, res) => {
  res.status(200).json({ status: 'webhook endpoint ativo' });
});

router.post(['/efi/webhook', '/efi/webhook/pix'], async (req, res) => {
  console.log('\u{1F4E5} Webhook EFI recebido:', JSON.stringify(req.body));
  res.status(200).json({ ok: true });

  const pixArr = req.body?.pix;
  if (!pixArr) {
    console.log('\u26a0\ufe0f Webhook sem campo pix:', JSON.stringify(req.body));
    return;
  }

  for (const pix of pixArr) {
    const { txid } = pix;
    console.log('\u{1F50D} Processando txid:', txid);

    const paymentRes = await db.query(`
      SELECT p.*, u.telegram_id, u.id as user_db_id, pl.duration_days, pl.name as plan_name
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

    // Verifica se ja tem assinatura ativa (renovacao)
    const existingSub = await db.query(`
      SELECT * FROM subscriptions
      WHERE user_id = $1 AND status = 'active'
    `, [payment.user_id]);

    let subscriptionId;
    let isPrimeiraCompra = false;

    try {
      if (existingSub.rows[0]) {
        // RENOVACAO: estende a partir da data de expiracao atual
        const currentExpires = new Date(existingSub.rows[0].expires_at);
        const baseDate = currentExpires > now ? currentExpires : now;
        const newExpiresAt = new Date(baseDate.getTime() + durationDays * 86400000);

        await db.query(
          `UPDATE subscriptions SET expires_at = $1 WHERE id = $2`,
          [newExpiresAt, existingSub.rows[0].id]
        );
        subscriptionId = existingSub.rows[0].id;

        await bot.telegram.sendMessage(
          payment.telegram_id,
          `\u2705 Renova\u00e7\u00e3o confirmada!\n\nSeu acesso ao grupo foi renovado at\u00e9 ${newExpiresAt.toLocaleDateString('pt-BR')}. \u{1F389}`
        );
        console.log('\u{1F389} Renovacao enviada para:', payment.telegram_id);
      } else {
        // NOVA ASSINATURA
        isPrimeiraCompra = true;
        const groupId = process.env.TELEGRAM_GROUP_ID;

        // Verifica se tem dias de bonus acumulados de indicacoes
        const bonusRes = await db.query(`
          SELECT COALESCE(SUM(reward_days), 0) as bonus_dias
          FROM referral_rewards
          WHERE referrer_telegram_id = $1 AND applied = FALSE
        `, [payment.telegram_id]);
        const bonusDias = parseInt(bonusRes.rows[0].bonus_dias, 10) || 0;
        const totalDias = durationDays + bonusDias;

        const expiresAt = new Date(now.getTime() + totalDias * 86400000);

        console.log('\u{1F517} Criando invite link para grupo:', groupId);
        const inviteLink = await bot.telegram.createChatInviteLink(groupId, { member_limit: 1 });

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

        // Marca os bonus como aplicados
        if (bonusDias > 0) {
          await db.query(`
            UPDATE referral_rewards SET applied = TRUE
            WHERE referrer_telegram_id = $1 AND applied = FALSE
          `, [payment.telegram_id]);
        }

        let msgBonus = '';
        if (bonusDias > 0) {
          msgBonus = `\n\n\u{1F381} *B\u00f4nus de indica\u00e7\u00f5es aplicado:* +${bonusDias} dias extras!\nSeu acesso expira em ${expiresAt.toLocaleDateString('pt-BR')}.`;
        }

        await bot.telegram.sendMessage(
          payment.telegram_id,
          `\u2705 PAGAMENTO CONFIRMADO\n\n` +
          `Clique no link abaixo para entrar no grupo\n\n` +
          `NOME DO GRUPO (Club Frang\u00e3o)\n` +
          `${inviteLink.invite_link}\n\n` +
          `Se houver d\u00favidas, chame no insta FRANGINLIVE` +
          msgBonus,
          bonusDias > 0 ? { parse_mode: 'Markdown' } : {}
        );
        console.log('\u{1F517} Link enviado para:', payment.telegram_id, inviteLink.invite_link);
      }

      // Atualiza pagamento
      await db.query(
        `UPDATE payments SET status = 'paid', paid_at = NOW(), subscription_id = $1 WHERE txid = $2`,
        [subscriptionId, txid]
      );
      console.log('\u{1F4B0} Payment atualizado para paid, txid:', txid);

      // ── LOGICA DE REFERRAL (apenas na primeira compra) ──────────────────────
      if (isPrimeiraCompra) {
        try {
          const refRes = await db.query(`
            SELECT r.id, r.referrer_telegram_id
            FROM referrals r
            WHERE r.referred_telegram_id = $1 AND r.converted = FALSE
          `, [payment.telegram_id]);

          if (refRes.rows[0]) {
            const referral = refRes.rows[0];

            // Marca referral como convertido (idempotente)
            await db.query(`
              UPDATE referrals SET converted = TRUE, converted_at = NOW()
              WHERE id = $1 AND converted = FALSE
            `, [referral.id]);

            await db.query(
              `UPDATE users SET referral_converted = TRUE WHERE telegram_id = $1`,
              [payment.telegram_id]
            );

            // Conta convertidos nao recompensados do referrer
            const countRes = await db.query(`
              SELECT COUNT(*) as total FROM referrals
              WHERE referrer_telegram_id = $1 AND converted = TRUE AND rewarded = FALSE
            `, [referral.referrer_telegram_id]);

            const totalNaoRecompensados = parseInt(countRes.rows[0].total, 10);

            if (totalNaoRecompensados >= 2) {
              const pares = Math.floor(totalNaoRecompensados / 2);
              const rewardDays = pares * 30;

              // Marca referrals como recompensados
              await db.query(`
                UPDATE referrals SET rewarded = TRUE
                WHERE id IN (
                  SELECT id FROM referrals
                  WHERE referrer_telegram_id = $1 AND converted = TRUE AND rewarded = FALSE
                  ORDER BY converted_at ASC LIMIT $2
                )
              `, [referral.referrer_telegram_id, pares * 2]);

              // Registra recompensa (applied = FALSE ate ele assinar)
              await db.query(`
                INSERT INTO referral_rewards (referrer_telegram_id, reward_days, reason, applied)
                VALUES ($1, $2, $3, FALSE)
              `, [referral.referrer_telegram_id, rewardDays, `${pares * 2} indicacoes convertidas`]);

              // Verifica se referrer JA TEM assinatura ativa
              const referrerUserRes = await db.query(`
                SELECT u.id FROM users u WHERE u.telegram_id = $1
              `, [referral.referrer_telegram_id]);

              if (referrerUserRes.rows[0]) {
                const referrerSubRes = await db.query(`
                  SELECT * FROM subscriptions
                  WHERE user_id = $1 AND status = 'active'
                  ORDER BY expires_at DESC LIMIT 1
                `, [referrerUserRes.rows[0].id]);

                if (referrerSubRes.rows[0]) {
                  // TEM assinatura: aplica agora estendendo o prazo
                  const refExpires = new Date(referrerSubRes.rows[0].expires_at);
                  const refBase = refExpires > now ? refExpires : now;
                  const newRefExpires = new Date(refBase.getTime() + rewardDays * 86400000);

                  await db.query(
                    `UPDATE subscriptions SET expires_at = $1 WHERE id = $2`,
                    [newRefExpires, referrerSubRes.rows[0].id]
                  );

                  // Marca o bonus como aplicado imediatamente
                  await db.query(`
                    UPDATE referral_rewards SET applied = TRUE
                    WHERE referrer_telegram_id = $1 AND applied = FALSE
                  `, [referral.referrer_telegram_id]);

                  try {
                    await bot.telegram.sendMessage(
                      referral.referrer_telegram_id,
                      `\u{1F389} *Parab\u00e9ns!* Voc\u00ea ganhou *${rewardDays} dias gr\u00e1tis* por indicar ${pares * 2} pessoas que assinaram!\n\nSeu acesso foi extendido at\u00e9 ${newRefExpires.toLocaleDateString('pt-BR')}. \u2764\ufe0f`,
                      { parse_mode: 'Markdown' }
                    );
                  } catch (e) {
                    console.log('Nao foi possivel notificar referrer:', e.message);
                  }
                } else {
                  // NAO TEM assinatura: bonus fica salvo, sera aplicado quando ele assinar
                  try {
                    await bot.telegram.sendMessage(
                      referral.referrer_telegram_id,
                      `\u{1F389} *Parab\u00e9ns!* Voc\u00ea ganhou *${rewardDays} dias gr\u00e1tis* por indicar ${pares * 2} pessoas que assinaram!\n\n\u{1F4CB} Como voc\u00ea ainda n\u00e3o \u00e9 assinante, os dias ser\u00e3o aplicados *automaticamente* quando voc\u00ea assinar qualquer plano. \u2764\ufe0f`,
                      { parse_mode: 'Markdown' }
                    );
                  } catch (e) {
                    console.log('Nao foi possivel notificar referrer:', e.message);
                  }
                }
              }
            }
          }
        } catch (e) {
          console.error('Erro ao processar referral:', e.message);
        }
      }
      // ────────────────────────────────────────────────────────────────────────

    } catch (err) {
      console.error('\u274c Erro ao processar pagamento txid', txid, ':', err.message);
    }
  }
});

module.exports = router;
