const db = require('../db/index');
const { Markup } = require('telegraf');

async function handleStart(ctx) {
  const { id, username, first_name } = ctx.from;

  // Captura parametro de referral: /start ref_123456
  const startPayload = ctx.startPayload || '';
  let referrerTelegramId = null;
  if (startPayload.startsWith('ref_')) {
    const refId = parseInt(startPayload.replace('ref_', ''), 10);
    if (!isNaN(refId) && refId !== id) {
      referrerTelegramId = refId;
    }
  }

  // Upsert do usuario
  const userRes = await db.query(`
    INSERT INTO users (telegram_id, username, first_name)
    VALUES ($1, $2, $3)
    ON CONFLICT (telegram_id) DO UPDATE
    SET username = $2, first_name = $3
    RETURNING id, referred_by_user_id
  `, [id, username, first_name]);

  const user = userRes.rows[0];

  // Registra referral apenas se ainda nao tem um referrer e veio de link valido
  if (referrerTelegramId && !user.referred_by_user_id) {
    try {
      const referrerRes = await db.query(
        `SELECT id FROM users WHERE telegram_id = $1`,
        [referrerTelegramId]
      );
      if (referrerRes.rows[0]) {
        await db.query(
          `UPDATE users SET referred_by_user_id = $1 WHERE telegram_id = $2`,
          [referrerTelegramId, id]
        );
        await db.query(`
          INSERT INTO referrals (referrer_telegram_id, referred_telegram_id)
          VALUES ($1, $2)
          ON CONFLICT (referred_telegram_id) DO NOTHING
        `, [referrerTelegramId, id]);
      }
    } catch (e) {
      console.error('Erro ao registrar referral:', e.message);
    }
  }

  const plans = await db.query(
    `SELECT * FROM plans WHERE active = TRUE ORDER BY duration_days`
  );

  const buttons = plans.rows.map(p =>
    [Markup.button.callback(
      `\u{1F4B3} ${p.name} - R$ ${Number(p.price).toFixed(2)}`,
      `plan_${p.id}`
    )]
  );

  await ctx.reply(
    `\u{1F44B} Ol\u00e1, ${first_name}! Escolha um plano para acessar o grupo:`,
    Markup.inlineKeyboard(buttons)
  );
}

async function handlePlanos(ctx) {
  return handleStart(ctx);
}

async function handleIndicacoes(ctx) {
  const { id } = ctx.from;

  const referralsRes = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE converted = TRUE) as convertidos,
      COUNT(*) as total
    FROM referrals
    WHERE referrer_telegram_id = $1
  `, [id]);

  const rewardsRes = await db.query(`
    SELECT COALESCE(SUM(reward_days), 0) as total_dias
    FROM referral_rewards
    WHERE referrer_telegram_id = $1
  `, [id]);

  const { convertidos, total } = referralsRes.rows[0];
  const totalDias = rewardsRes.rows[0].total_dias;

  const linkDeIndicacao = `https://t.me/${ctx.botInfo.username}?start=ref_${id}`;

  await ctx.reply(
    `\u{1F91D} *Seu Painel de Indica\u00e7\u00f5es*\n\n` +
    `\u{1F517} Seu link:\n\`${linkDeIndicacao}\`\n\n` +
    `\u{1F4CA} *Estat\u00edsticas:*\n` +
    `\u2022 Total de indicados: ${total}\n` +
    `\u2022 Indicados que assinaram: ${convertidos}\n` +
    `\u2022 Dias de b\u00f4nus ganhos: ${totalDias}\n\n` +
    `\u{1F381} *Regra:* A cada 2 pessoas que voc\u00ea indicar e assinarem, voc\u00ea ganha 1 m\u00eas gr\u00e1tis!`,
    { parse_mode: 'Markdown' }
  );
}

async function handleAssinatura(ctx) {
  const { id } = ctx.from;

  const subRes = await db.query(`
    SELECT s.expires_at, s.status, pl.name as plan_name
    FROM subscriptions s
    JOIN users u ON u.id = s.user_id
    JOIN plans pl ON pl.id = s.plan_id
    WHERE u.telegram_id = $1 AND s.status = 'active'
    ORDER BY s.expires_at DESC
    LIMIT 1
  `, [id]);

  if (!subRes.rows[0]) {
    await ctx.reply(
      `\u274c *Voc\u00ea n\u00e3o possui uma assinatura ativa.*\n\nDigite /planos para ver as op\u00e7\u00f5es dispon\u00edveis.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const sub = subRes.rows[0];
  const expires = new Date(sub.expires_at);
  const now = new Date();
  const diffMs = expires - now;
  const diffDias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  const dataFormatada = expires.toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });

  let statusMsg;
  if (diffDias <= 3) {
    statusMsg = `\u26a0\ufe0f *Aten\u00e7\u00e3o!* Sua assinatura vence em *${diffDias} dia(s)*!`;
  } else {
    statusMsg = `\u2705 Sua assinatura est\u00e1 ativa por mais *${diffDias} dias*`;
  }

  await ctx.reply(
    `\u{1F4CB} *Detalhes da sua Assinatura*\n\n` +
    `\u{1F4E6} Plano: *${sub.plan_name}*\n` +
    `\u{1F4C5} Vence em: *${dataFormatada}*\n\n` +
    statusMsg,
    { parse_mode: 'Markdown' }
  );
}

module.exports = { handleStart, handlePlanos, handleIndicacoes, handleAssinatura };
