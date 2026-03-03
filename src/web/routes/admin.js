const router = require('express').Router();
const db = require('../../db/index');
const { bot } = require('../../bot/index');
const { Markup } = require('telegraf');

// Middleware de autenticacao
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
  const [active, expiring, revenue] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM subscriptions WHERE status = 'active'`),
    db.query(`SELECT COUNT(*) FROM subscriptions WHERE status = 'active' AND expires_at <= NOW() + INTERVAL '3 days'`),
    db.query(`SELECT SUM(amount) FROM payments WHERE status = 'paid'`)
  ]);
  res.render('dashboard', {
    activeCount: active.rows[0].count,
    expiringCount: expiring.rows[0].count,
    totalRevenue: revenue.rows[0].sum || 0
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
  res.render('subscribers', { subscribers: subs.rows });
});

// Planos CRUD
router.get('/plans', requireAuth, async (req, res) => {
  const plans = await db.query(`SELECT * FROM plans ORDER BY duration_days`);
  res.render('plans', { plans: plans.rows });
});

router.post('/plans', requireAuth, async (req, res) => {
  const { name, duration_days, price } = req.body;
  await db.query(
    `INSERT INTO plans (name, duration_days, price) VALUES ($1, $2, $3)`,
    [name, duration_days, price]
  );
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

// Broadcast
router.get('/broadcast', requireAuth, (req, res) => res.render('broadcast', { result: null }));

router.post('/broadcast/expiring', requireAuth, async (req, res) => {
  const { days, message } = req.body;

  const users = await db.query(`
    SELECT u.telegram_id, pl.id as plan_id, pl.name as plan_name
    FROM subscriptions s
    JOIN users u ON u.id = s.user_id
    JOIN plans pl ON pl.id = s.plan_id
    WHERE s.status = 'active'
    AND s.expires_at <= NOW() + ($1 || ' days')::INTERVAL
    AND s.expires_at > NOW()
  `, [days]);

  let sent = 0;
  for (const user of users.rows) {
    try {
      await bot.telegram.sendMessage(user.telegram_id, message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`💳 Renovar ${user.plan_name}`, `plan_${user.plan_id}`)]
        ])
      });
      sent++;
      await new Promise(r => setTimeout(r, 50)); // evita flood
    } catch (e) { /* usuario bloqueou o bot */ }
  }
  res.json({ sent });
});

router.post('/broadcast/never-paid', requireAuth, async (req, res) => {
  const { message } = req.body;

  const users = await db.query(`
    SELECT u.telegram_id FROM users u
    WHERE u.never_bought = TRUE
    OR EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.user_id = u.id AND s.status = 'expired'
      AND NOT EXISTS (
        SELECT 1 FROM subscriptions s2
        WHERE s2.user_id = u.id AND s2.status = 'active'
      )
    )
  `);

  let sent = 0;
  for (const user of users.rows) {
    try {
      await bot.telegram.sendMessage(user.telegram_id, message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🛒 Ver Planos', 'show_plans')]
        ])
      });
      sent++;
      await new Promise(r => setTimeout(r, 50));
    } catch (e) { }
  }
  res.json({ sent });
});

module.exports = router;
