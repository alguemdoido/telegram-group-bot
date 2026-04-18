const db = require('../db/index');

async function handleStart(ctx) {
    await ctx.reply('Prezado, esse bot foi desativado, realize sua assinatura pelo novo bot @frangaoclub_bot');
}

async function handlePlanos(ctx) {
    return handleStart(ctx);
}

async function handleIndicacoes(ctx) {
    await ctx.reply('Prezado, esse bot foi desativado, realize sua assinatura pelo novo bot @frangaoclub_bot');
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
        await ctx.reply('Voce nao possui uma assinatura ativa.');
        return;
    }

    const sub = subRes.rows[0];
    const expires = new Date(sub.expires_at);
    const now = new Date();
    const diffMs = expires - now;
    const diffDias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const dataFormatada = expires.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

    let statusMsg;
    if (diffDias <= 3) {
        statusMsg = 'Sua assinatura vence em ' + diffDias + ' dia(s). Renove agora pelo novo bot @Frangaoclub_bot!';
    } else {
        statusMsg = 'Sua assinatura esta ativa por mais ' + diffDias + ' dias';
    }

    await ctx.reply(
        'Detalhes da sua Assinatura\nPlano: ' + sub.plan_name + '\nVence em: ' + dataFormatada + '\n' + statusMsg
    );
}

module.exports = { handleStart, handlePlanos, handleIndicacoes, handleAssinatura };
