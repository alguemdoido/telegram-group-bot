const db = require('./index');

async function initDB() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      username VARCHAR(255),
      first_name VARCHAR(255),
      started_at TIMESTAMPTZ DEFAULT NOW(),
      is_in_group BOOLEAN DEFAULT FALSE,
      never_bought BOOLEAN DEFAULT TRUE,
      referred_by_user_id BIGINT DEFAULT NULL,
      referral_converted BOOLEAN DEFAULT FALSE
    );
  `);

  // Adiciona colunas de referral se nao existirem (migracao segura)
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_user_id BIGINT DEFAULT NULL`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_converted BOOLEAN DEFAULT FALSE`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS plans (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      duration_days INTEGER NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      plan_id INTEGER REFERENCES plans(id),
      starts_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      status VARCHAR(20) DEFAULT 'active',
      invite_link TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      plan_id INTEGER REFERENCES plans(id),
      subscription_id INTEGER REFERENCES subscriptions(id),
      txid VARCHAR(255) UNIQUE NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      status VARCHAR(20) DEFAULT 'pending',
      pix_copia_cola TEXT,
      qr_code_base64 TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      paid_at TIMESTAMPTZ
    );
  `);

  // Tabela de indicacoes
  await db.query(`
    CREATE TABLE IF NOT EXISTS referrals (
      id SERIAL PRIMARY KEY,
      referrer_telegram_id BIGINT NOT NULL,
      referred_telegram_id BIGINT NOT NULL UNIQUE,
      converted BOOLEAN DEFAULT FALSE,
      converted_at TIMESTAMPTZ,
      rewarded BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Tabela de recompensas de indicacao
  await db.query(`
    CREATE TABLE IF NOT EXISTS referral_rewards (
      id SERIAL PRIMARY KEY,
      referrer_telegram_id BIGINT NOT NULL,
      reward_days INTEGER NOT NULL DEFAULT 30,
      reason VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log('\u2705 Banco de dados inicializado');
}

module.exports = { initDB };
