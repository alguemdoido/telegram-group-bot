const db = require('../db/index');
const { Markup } = require('telegraf');
const { createPixCharge } = require('../services/efi');
const QRCode = require('qrcode');

async function handlePlanSelect(ctx) {
  const planId = ctx.match[1];
  const telegramId = ctx.from.id;

  const planRes = await db.query(`SELECT * FROM plans WHERE id = $1`, [planId]);
  const plan = planRes.rows[0];
  if (!plan) return ctx.reply('Plano não encontrado.');

  const userRes = await db.query(`SELECT * FROM users WHERE telegram_id = $1`, [telegramId]);
  const user = userRes.rows[0];

  await ctx.reply('⏳ Gerando PIX...');

  try {
    const { txid, pixCopiaECola } = await createPixCharge({
      value: plan.price,
      description: `Acesso ${plan.name} - ${ctx.from.first_name}`
    });

    // Salva pagamento pendente
    await db.query(`
      INSERT INTO payments (user_id, plan_id, txid, amount, pix_copia_cola)
      VALUES ($1, $2, $3, $4, $5)
    `, [user.id, plan.id, txid, plan.price, pixCopiaECola]);

    // Gera QR Code em base64
    const qrImage = await QRCode.toDataURL(pixCopiaECola);

    await ctx.replyWithPhoto(
      { source: Buffer.from(qrImage.split(',')[1], 'base64') },
      {
        caption: `💰 *${plan.name} — R$ ${Number(plan.price).toFixed(2)}*\n\n` +
          `📋 Pix Copia e Cola:\n\`${pixCopiaECola}\`\n\n` +
          `⏱ Após pagar, clique em *Verificar Pagamento*`,
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Verificar Pagamento', `check_pay_${txid}`)]
        ])
      }
    );
  } catch (err) {
    console.error(err);
    await ctx.reply('❌ Erro ao gerar PIX. Tente novamente.');
  }
}

async function handleCheckPayment(ctx) {
  const txid = ctx.match[1];
  const payment = await db.query(
    `SELECT * FROM payments WHERE txid = $1`,
    [txid]
  );

  if (!payment.rows[0]) return ctx.answerCbQuery('Pagamento não encontrado.');

  if (payment.rows[0].status === 'paid') {
    await ctx.answerCbQuery('✅ Pagamento já confirmado!');
  } else {
    await ctx.answerCbQuery('⏳ Pagamento ainda não confirmado. Aguarde.');
  }
}

module.exports = { handlePlanSelect, handleCheckPayment };
