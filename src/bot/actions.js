const db = require('../db/index');

async function handlePlanSelect(ctx) {
    await ctx.answerCbQuery();
    await ctx.reply(
        'Prezado, esse bot foi desativado, realize sua assinatura pelo novo bot @frangaoclub_bot'
    );
}

async function handleCheckPayment(ctx) {
    await ctx.answerCbQuery(
        'Prezado, esse bot foi desativado. Realize sua assinatura pelo novo bot @frangaoclub_bot'
    );
}

module.exports = { handlePlanSelect, handleCheckPayment };
