// src/services/telegram.js
// Helpers do bot Telegram

const { bot } = require('../bot/index');

/**
 * Envia mensagem para um usuário pelo telegram_id
 */
async function sendMessage(telegramId, text, extra = {}) {
  try {
    await bot.telegram.sendMessage(telegramId, text, extra);
    return true;
  } catch (err) {
    console.error(`Erro ao enviar msg para ${telegramId}:`, err.message);
    return false;
  }
}

/**
 * Remove um membro do grupo (kick + unban para não banir permanentemente)
 */
async function removeMember(groupId, telegramId) {
  await bot.telegram.banChatMember(groupId, telegramId);
  await bot.telegram.unbanChatMember(groupId, telegramId);
}

/**
 * Gera link de convite de uso único com validade de 24 horas
 */
async function createInviteLink(groupId) {
  const expireDate = Math.floor((Date.now() + 86400000) / 1000);
  const result = await bot.telegram.createChatInviteLink(groupId, {
    member_limit: 1,
    expire_date: expireDate,
  });
  return result.invite_link;
}

module.exports = { sendMessage, removeMember, createInviteLink };
