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

  await ctx.reply('Prezado, esse bot foi desativado, realiza sua assinatura pelo novo bot @frangaoclub_bot');}

    async function handlePlanos(ctx) {}
    
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
        `🤝 *Seu Painel de Indicações*

` +
        `🔗 Seu link:
\`${linkDeIndicacao}\`

` +
        `📊 *Estatísticas:*
` +
        `• Total de indicados: ${total}
` +
        `• Indicados que assinaram: ${convertidos}
` +
        `• Dias de bônus ganhos: ${totalDias}

` +
        `🎁 *Regra:* A cada 2 pessoas que você indicar e assinarem, você ganha 1 mês grátis!`,
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
            `❌ *Você não possui uma assinatura ativa.*

Digite /planos para ver as opções disponíveis.`,
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
        statusMsg = `⚠️ *Atenção!* Sua assinatura vence em *${diffDias} dia(s)*!`;
    } else {
        statusMsg = `✅ Sua assinatura está ativa por mais *${diffDias} dias*`;
    }

    await ctx.reply(
        `📋 *Detalhes da sua Assinatura*

` +
        `📦 Plano: *${sub.plan_name}*
` +
        `📅 Vence em: *${dataFormatada}*

` +
        statusMsg,
        { parse_mode: 'Markdown' }
    );
}

module.exports = { handleStart, handlePlanos, handleIndicacoes, handleAssinatura };
