const db = require('../db/index');
const { Markup } = require('telegraf');

async function handleStart(ctx) {
    await ctx.reply(
        'Prezado, esse bot foi desativado, realize sua assinatura pelo novo bot @frangaoclub_bot'
    );
}

async function handlePlanos(ctx) {
    return handleStart(ctx);
}

async function handleIndicacoes(ctx) {
    await ctx.reply(
        'Prezado, esse bot foi desativado, realize sua assinatura pelo novo bot @frangaoclub_bot'
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
            `*Voce nao possui uma assinatura ativa.*`,
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
        statusMsg = `\u26a0\ufe0f Sua assinatura vence em *${diffDias} dia(s)*. Renove agora pelo novo bot @Frangaoclub_bot!`;
    } else {
        statusMsg = `\u2705 Sua assinatura esta ativa por mais *${diffDias} dias*`;
    }

    await ctx.reply(
        `\ud83d\udccb *Detalhes da sua Assinatura*
` +
        `\ud83d\udce6 Plano: *${sub.plan_name}*
` +
        `\ud83d\udcc5 Vence em: *${dataFormatada}*
` +
        statusMsg,
        { parse_mode: 'Markdown' }
    );
}

module.exports = { handleStart, handlePlanos, handleIndicacoes, handleAssinatura };
