const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const db = require('../db/index');
const adminRoutes = require('./routes/admin');
const webhookRoutes = require('./routes/webhook');

function startServer() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.use(session({
    store: new pgSession({
      pool: db,
      tableName: 'sessions',
      createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
  }));

  // Webhook EFI na raiz - URL final: /efi/webhook
  app.use('/', webhookRoutes);

  // Painel Admin
  app.use('/admin', adminRoutes);

  // Redirect raiz para /admin
  app.get('/', (req, res) => res.redirect('/admin'));

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Servidor rodando na porta ${PORT}`);
  });
}

module.exports = { startServer };
