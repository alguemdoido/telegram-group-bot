const db = require('../db/index');
const { Markup } = require('telegraf');

async function handleStart(ctx) {
  const { id, username, first_name } = ctx.from;

  // Upsert do usuario
  await db.query(`
    INSERT INTO users (telegram_id, username, first_name)
    VALUES ($1, $2, $3)
    ON CONFLICT (telegram_id) DO UPDATE
    SET username = $2, first_name = $3
  `, [id, username, first_name]);

  const plans = await db.query(
    `SELECT * FROM plans WHERE active = TRUE ORDER BY duration_days`
  );

  const buttons = plans.rows.map(p =>
    [Markup.button.callback(
      `📦 ${p.name} — R$ ${Number(p.price).toFixed(2)}`,
      `plan_${p.id}`
    )]
  );

  await ctx.reply(
    `👋 Olá, ${first_name}! Escolha um plano para acessar o grupo:`,
    Markup.inlineKeyboard(buttons)
  );
}

async function handlePlanos(ctx) {
  return handleStart(ctx);
}

module.exports = { handleStart, handlePlanos };
