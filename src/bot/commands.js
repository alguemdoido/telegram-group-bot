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
      // Bloqueia auto-indicacao
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
      // Verifica se o referrer existe
      const referrerRes = await db.query(
        `SELECT id FROM users WHERE telegram_id = $1`,
        [referrerTelegramId]
      );
      if (referrerRes.rows[0]) {
        // Salva referrer no usuario
        await db.query(
          `UPDATE users SET referred_by_user_id = $1 WHERE telegram_id = $2`,
          [referrerTelegramId, id]
        );
        // Insere na tabela referrals (UNIQUE em referred_telegram_id garante idempotencia)
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

module.exports = { handleStart, handlePlanos, handleIndicacoes };
