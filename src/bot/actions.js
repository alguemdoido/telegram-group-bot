const db = require('../db/index');
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

    // ✅ INSERT com status 'pending' obrigatorio para o webhook encontrar
    await db.query(
      `INSERT INTO payments (user_id, plan_id, txid, amount, pix_copia_cola, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [user.id, plan.id, txid, plan.price, pixCopiaECola]
    );

    const qrImage = await QRCode.toDataURL(pixCopiaECola);

    const canCopyBtn =
      typeof pixCopiaECola === 'string' &&
      pixCopiaECola.length > 0 &&
      pixCopiaECola.length <= 256;

    const inline_keyboard = [];

    if (canCopyBtn) {
      inline_keyboard.push([
        { text: '📋🧹 COPIAR PIX COPIA E COLA', copy_text: { text: pixCopiaECola } }
      ]);
    }

    inline_keyboard.push([
      { text: '✅ Verificar Pagamento', callback_data: `check_pay_${txid}` }
    ]);

    const planNameSafe = String(plan.name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const priceFormatted = Number(plan.price).toFixed(2);
    const extraMsg = !canCopyBtn ? '\n\n<i>(Se não aparecer o botão, copie pelo código acima)</i>' : '';

    await ctx.replyWithPhoto(
      { source: Buffer.from(qrImage.split(',')[1], 'base64') },
      {
        caption:
          `💰 <b>${planNameSafe} — R$ ${priceFormatted}</b>\n\n` +
          `📋 Pix Copia e Cola:\n<code>${pixCopiaECola}</code>\n\n` +
          `⏰ Após pagar, clique em <b>Verificar Pagamento</b>` +
          extraMsg,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard }
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
