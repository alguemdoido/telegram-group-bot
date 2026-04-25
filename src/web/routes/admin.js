const router = require('express').Router();
const db = require('../../db/index');
const { Markup } = require('telegraf');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

function getBotInstance() {
  const mod = require('../../bot/index');
  if (mod?.bot?.telegram) return mod.bot;
  if (typeof mod?.getBot === 'function') return mod.getBot();
  throw new Error('Bot module must export { bot } or { getBot }');
}

function requireAuth(req, res, next) {
  if (req.session.admin) return next();
  res.redirect('/admin/login');
}

// Login
router.get('/login', (req, res) => res.render('login', { error: null }));
router.post('/login', (req, res) => {
  if (req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.admin = true;
    res.redirect('/admin');
  } else {
    res.render('login', { error: 'Senha incorreta' });
  }
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// Dashboard
router.get('/', requireAuth, async (req, res) => {
  const [
    active,
    expiring,
    revenueTotal,
    revenueActive,
    revenueToday,
    revenueWeek,
    revenueMonth,
    mrr,
  ] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM subscriptions WHERE status = 'active'`),
    db.query(`SELECT COUNT(*) FROM subscriptions WHERE status = 'active' AND expires_at <= NOW() + INTERVAL '3 days'`),
    db.query(`SELECT SUM(amount) FROM payments WHERE status = 'paid'`),
    db.query(`
      SELECT SUM(p.amount) FROM payments p
      JOIN subscriptions s ON s.id = p.subscription_id
      WHERE p.status = 'paid' AND s.status = 'active'
    `),
    db.query(`SELECT SUM(amount) FROM payments WHERE status = 'paid' AND paid_at >= CURRENT_DATE`),
    db.query(`SELECT SUM(amount) FROM payments WHERE status = 'paid' AND paid_at >= CURRENT_DATE - INTERVAL '7 days'`),
    db.query(`SELECT SUM(amount) FROM payments WHERE status = 'paid' AND paid_at >= DATE_TRUNC('month', CURRENT_DATE)`),
    db.query(`
      SELECT SUM(pl.price) FROM subscriptions s
      JOIN plans pl ON pl.id = s.plan_id
      WHERE s.status = 'active'
    `),
  ]);

  res.render('dashboard', {
    activeCount: active.rows[0].count,
    expiringCount: expiring.rows[0].count,
    totalRevenue: revenueTotal.rows[0].sum || 0,
    activeRevenue: revenueActive.rows[0].sum || 0,
    revenueToday: revenueToday.rows[0].sum || 0,
    revenueWeek: revenueWeek.rows[0].sum || 0,
    revenueMonth: revenueMonth.rows[0].sum || 0,
    mrr: mrr.rows[0].sum || 0,
  });
});

// Listar assinantes ativos
router.get('/subscribers', requireAuth, async (req, res) => {
  const subs = await db.query(`
    SELECT s.*, u.telegram_id, u.first_name, u.username, pl.name as plan_name
    FROM subscriptions s
    JOIN users u ON u.id = s.user_id
    JOIN plans pl ON pl.id = s.plan_id
    WHERE s.status = 'active'
    ORDER BY s.expires_at ASC
  `);
  res.render('subscribers', {
    subscribers: subs.rows,
    success: req.query.success || null,
    error: req.query.error || null,
  });
});

// Listar assinantes que vencem em 3 dias
router.get('/expiring', requireAuth, async (req, res) => {
    const tab = req.query.tab || 'not_sent';
  let subsQuery;
  
  if (tab === 'sent_today') {
    subsQuery = `
      SELECT s.*, u.telegram_id, u.first_name, u.username, pl.name as plan_name
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      JOIN plans pl ON pl.id = s.plan_id
      WHERE s.status = 'active' 
        AND s.expires_at <= NOW() + INTERVAL '3 days'
        AND s.renewal_sent_at >= CURRENT_DATE
      ORDER BY s.expires_at ASC
    `;
  } else {
    subsQuery = `
      SELECT s.*, u.telegram_id, u.first_name, u.username, pl.name as plan_name
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      JOIN plans pl ON pl.id = s.plan_id
      WHERE s.status = 'active' 
        AND s.expires_at <= NOW() + INTERVAL '3 days'
        AND (s.renewal_sent_at IS NULL OR s.renewal_sent_at < CURRENT_DATE)
      ORDER BY s.expires_at ASC
    `;
  }

  const subs = await db.query(subsQuery);
  const plans = await db.query(`SELECT id, name, price FROM plans WHERE active = TRUE ORDER BY duration_days`);

  res.render('expiring', {
    subscribers: subs.rows,
    plans: plans.rows,
    currentTab: tab,
    result: null,
    success: req.query.success || null,
    error: req.query.error || null,
  })
});

// Enviar mensagem de renovação para assinantes expirando
router.post('/expiring/send', requireAuth, async (req, res) => {
  const bot = getBotInstance();
  const { message = '', includePlans = '0' } = req.body;
  let selectedPlanIds = req.body.planIds || [];
  if (typeof selectedPlanIds === 'string') selectedPlanIds = [selectedPlanIds];
  selectedPlanIds = selectedPlanIds.map(Number).filter(Boolean);

  let keyboard = null;
  if (includePlans === '1' && selectedPlanIds.length > 0) {
    const plansRes = await db.query(
      `SELECT id, name, price FROM plans WHERE id = ANY($1) AND active = TRUE ORDER BY duration_days`,
      [selectedPlanIds]
    );
    if (plansRes.rows.length > 0) {
      keyboard = Markup.inlineKeyboard(
        plansRes.rows.map((pl) => [
          Markup.button.callback(`💳 ${pl.name} - R$ ${Number(pl.price).toFixed(2)}`, `plan_${pl.id}`),
        ])
      );
    }
  }

  const subs = await db.query(`
      SELECT DISTINCT u.telegram_id, s.id as subscription_id
      FROM subscriptions s
    JOIN users u ON u.id = s.user_id
    WHERE s.status = 'active' AND s.expires_at <= NOW() + INTERVAL '3 days'
  `);

  let sent = 0;
  let failed = 0;
  for (const sub of subs.rows) {    try {
      await bot.telegram.sendMessage(sub.telegram_id, message, {
        parse_mode: 'Markdown',
        ...(keyboard ? keyboard : {}),
      });
      sent++;
              await db.query('UPDATE subscriptions SET renewal_sent_at = NOW() WHERE id = $1', [sub.subscription_id]);
      await new Promise((r) => setTimeout(r, 50));
    } catch (e) {
      failed++;
    }
  }
  res.redirect(`/admin/expiring?success=sent_${sent}_failed_${failed}`);
});

// Planos CRUD
router.get('/plans', requireAuth, async (req, res) => {
  const plans = await db.query(`SELECT * FROM plans ORDER BY duration_days`);
  res.render('plans', { plans: plans.rows });
});

router.post('/plans', requireAuth, async (req, res) => {
  const { name, duration_days, price } = req.body;
  await db.query(`INSERT INTO plans (name, duration_days, price) VALUES ($1, $2, $3)`, [name, duration_days, price]);
  res.redirect('/admin/plans');
});

router.post('/plans/:id/toggle', requireAuth, async (req, res) => {
  await db.query(`UPDATE plans SET active = NOT active WHERE id = $1`, [req.params.id]);
  res.redirect('/admin/plans');
});

router.post('/plans/:id/delete', requireAuth, async (req, res) => {
  await db.query(`UPDATE plans SET active = FALSE WHERE id = $1`, [req.params.id]);
  res.redirect('/admin/plans');
});

// ─── CANCELAR ASSINANTE ──────────────────────────────────────────────────────────────
router.post('/subscribers/:id/cancel', requireAuth, async (req, res) => {
  const { id } = req.params;
  const subRes = await db.query(`
    SELECT s.*, u.telegram_id
    FROM subscriptions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = $1 AND s.status = 'active'
  `, [id]);

  if (!subRes.rows[0]) {
    return res.redirect('/admin/subscribers?error=not_found');
  }

  const sub = subRes.rows[0];
  const bot = getBotInstance();

  await db.query(`UPDATE subscriptions SET status = 'expired' WHERE id = $1`, [id]);
  await db.query(`UPDATE users SET is_in_group = FALSE WHERE telegram_id = $1`, [sub.telegram_id]);
  await db.query(`UPDATE payments SET status = 'cancelled' WHERE subscription_id = $1`, [id]);

  try {
    await bot.telegram.banChatMember(process.env.TELEGRAM_GROUP_ID, sub.telegram_id);
    await bot.telegram.unbanChatMember(process.env.TELEGRAM_GROUP_ID, sub.telegram_id);
    console.log('🚫 Assinante removido do grupo:', sub.telegram_id);
  } catch (e) {
    console.log('⚠️ Nao foi possivel remover do grupo:', e.message);
  }

  try {
    await bot.telegram.sendMessage(
      sub.telegram_id,
      `❌ *Sua assinatura foi cancelada.*

Seu acesso ao grupo foi removido.

Se tiver dúvidas, entre em contato com o suporte.`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    console.log('⚠️ Nao foi possivel enviar mensagem ao usuario:', e.message);
  }

  res.redirect('/admin/subscribers?success=cancelled');
});

// ─── ALTERAR VENCIMENTO ────────────────────────────────────────────────────────────
router.post('/subscribers/:id/expiry', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { expires_at } = req.body;

  if (!expires_at) {
    return res.redirect('/admin/subscribers?error=invalid_date');
  }

  const subRes = await db.query(
    `SELECT s.*, u.telegram_id, u.first_name FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.status = 'active'`,
    [id]
  );

  if (!subRes.rows[0]) {
    return res.redirect('/admin/subscribers?error=not_found');
  }

  const sub = subRes.rows[0];
  const newExpiry = new Date(expires_at + 'T23:59:59');

  await db.query(
    `UPDATE subscriptions SET expires_at = $1 WHERE id = $2`,
    [newExpiry, id]
  );

  try {
    const bot = getBotInstance();
    const dataFormatada = newExpiry.toLocaleDateString('pt-BR');
    await bot.telegram.sendMessage(
      sub.telegram_id,
      `📅 *Seu vencimento foi atualizado!*

Olá ${sub.first_name}, sua assinatura agora expira em *${dataFormatada}*. ✅`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    console.log('⚠️ Não foi possível notificar usuário:', e.message);
  }

  res.redirect('/admin/subscribers?success=expiry_updated');
});

// ─── BROADCAST ───────────────────────────────────────────────────────────────
async function getRecipients(segment) {
  if (segment === 'active') {
    const r = await db.query(`
      SELECT DISTINCT u.telegram_id FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      WHERE s.status = 'active' AND u.telegram_id IS NOT NULL
    `);
    return r.rows.map((x) => x.telegram_id);
  }
  if (segment === 'never') {
    const r = await db.query(`
      SELECT DISTINCT u.telegram_id FROM users u
      WHERE u.telegram_id IS NOT NULL AND u.never_bought = TRUE
      AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id)
    `);
    return r.rows.map((x) => x.telegram_id);
  }
  if (segment === 'expired') {
    const r = await db.query(`
      SELECT DISTINCT u.telegram_id FROM users u
      WHERE u.telegram_id IS NOT NULL AND u.never_bought = FALSE
      AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active')
      AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'expired')
    `);
    return r.rows.map((x) => x.telegram_id);
  }
  const r = await db.query(`SELECT telegram_id FROM users WHERE telegram_id IS NOT NULL`);
  return r.rows.map((x) => x.telegram_id);
}

router.get('/broadcast', requireAuth, async (req, res) => {
  const plans = await db.query(`SELECT id, name, price FROM plans WHERE active = TRUE ORDER BY duration_days`);
  res.render('broadcast', { result: null, plans: plans.rows });
});

router.post('/broadcast', requireAuth, upload.single('photo'), async (req, res) => {
  const bot = getBotInstance();
  const { segment = 'active', message = '', includePlans = '0' } = req.body;
  let selectedPlanIds = req.body.planIds || [];
  if (typeof selectedPlanIds === 'string') selectedPlanIds = [selectedPlanIds];
  selectedPlanIds = selectedPlanIds.map(Number).filter(Boolean);

  let keyboard = null;
  if (includePlans === '1' && selectedPlanIds.length > 0) {
    const plansRes = await db.query(
      `SELECT id, name, price FROM plans WHERE id = ANY($1) AND active = TRUE ORDER BY duration_days`,
      [selectedPlanIds]
    );
    if (plansRes.rows.length > 0) {
      keyboard = Markup.inlineKeyboard(
        plansRes.rows.map((pl) => [
          Markup.button.callback(`💳 ${pl.name} - R$ ${Number(pl.price).toFixed(2)}`, `plan_${pl.id}`),
        ])
      );
    }
  }

  const recipients = await getRecipients(segment);
  let sent = 0;
  let failed = 0;

  for (const chatId of recipients) {
    try {
      if (req.file) {
        await bot.telegram.sendPhoto(chatId, { source: req.file.buffer }, {
          caption: message, parse_mode: 'Markdown', ...(keyboard ? keyboard : {}),
        });
      } else {
        await bot.telegram.sendMessage(chatId, message, {
          parse_mode: 'Markdown', ...(keyboard ? keyboard : {}),
        });
      }
      sent++;
      await new Promise((r) => setTimeout(r, 50));
    } catch (e) {
      failed++;
            console.error('❌ Erro ao enviar broadcast para', chatId, ':', e.message);
    }
  }

  const result = { sent, failed, total: recipients.length, segment };
  const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
  if (wantsJson) return res.json(result);

  const plans = await db.query(`SELECT id, name, price FROM plans WHERE active = TRUE ORDER BY duration_days`);
  return res.render('broadcast', { result, plans: plans.rows });
});

// ─── REENVIAR LINK ───────────────────────────────────────────────────────────────
router.post('/subscribers/:id/resend-link', requireAuth, async (req, res) => {
  const { id } = req.params;

  const subRes = await db.query(`
    SELECT s.*, u.telegram_id, u.first_name
    FROM subscriptions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = $1 AND s.status = 'active'
  `, [id]);

  if (!subRes.rows[0]) {
    return res.redirect('/admin/subscribers?error=not_found');
  }

  const sub = subRes.rows[0];

  // Gera um novo invite link único (member_limit: 1)
  const bot = getBotInstance();
  const groupId = process.env.TELEGRAM_GROUP_ID;

  try {
    const inviteLink = await bot.telegram.createChatInviteLink(groupId, {
      member_limit: 1
    });

    // Atualiza o link no banco
    await db.query(
      `UPDATE subscriptions SET invite_link = $1 WHERE id = $2`,
      [inviteLink.invite_link, id]
    );

    // Envia o novo link pro usuário
    await bot.telegram.sendMessage(
      sub.telegram_id,
      `🔗 Novo link de acesso ao grupo:\n\n${inviteLink.invite_link}\n\nClique no link para entrar no grupo.`
    );

    console.log('🔗 Novo link enviado para:', sub.telegram_id, inviteLink.invite_link);
    res.redirect('/admin/subscribers?success=link_sent');
  } catch (err) {
    console.error('❌ Erro ao reenviar link:', err.message);
    res.redirect('/admin/subscribers?error=send_failed');
  }
});


// ── RANKING DE INDICACOES ──────────────────────────────────────────────────────────
router.get('/referrals', requireAuth, async (req, res) => {
  const ranking = await db.query(`
    SELECT
      r.referrer_telegram_id,
      u.first_name,
      u.username,
      COUNT(*) as total_indicados,
      COUNT(*) FILTER (WHERE r.converted = TRUE) as convertidos,
      COUNT(*) FILTER (WHERE r.rewarded = TRUE) as recompensados,
      COALESCE((
        SELECT SUM(rw.reward_days)
        FROM referral_rewards rw
        WHERE rw.referrer_telegram_id = r.referrer_telegram_id
      ), 0) as dias_bonus_total
    FROM referrals r
    LEFT JOIN users u ON u.telegram_id = r.referrer_telegram_id
    GROUP BY r.referrer_telegram_id, u.first_name, u.username
    ORDER BY convertidos DESC, total_indicados DESC
    LIMIT 50
  `);

  res.render('referrals', { ranking: ranking.rows });
});


// ── BROADCAST DIRETO (TEMPORÁRIO) ────────────────────────────────────────────────────────────
router.get('/send-broadcast-now', requireAuth, async (req, res) => {
    const bot = getBotInstance();
  const message = `CARD RECHEADO DE BRASILEIRO HOJE, FAÇA SUA ASSINATURA PELO NOVO BOT @FRANGAOCLUB_BOT\n\nTem mais de 7mil seguidores no Instagram no nicho de lutas e quer fechar parceria? Me envia uma DM no insta FRANGINLIVE.`;
    // Buscar destinatários: nunca compraram + vencidos (NÃO ativos)
    const neverBought = await getRecipients('never');
    const expired = await getRecipients('expired');
    const allRecipients = [...new Set([...neverBought, ...expired])];

    let sent = 0, failed = 0;
    for (const chatId of allRecipients) {
          try {
                  await bot.telegram.sendMessage(chatId, message);
                  sent++;
                  await new Promise(r => setTimeout(r, 50));
                } catch (e) {
                  failed++;
                  console.error('❌ Erro broadcast:', chatId, e.message);
                }
        }

    console.log('✅ Broadcast concluído:', sent, 'enviados', failed, 'falhas');
    res.send(`Broadcast concluído! Enviados: ${sent}, Falhas: ${failed}`);
  });
module.exports = router;
