// src/config.js

module.exports = {
  bot: {
    token: process.env.BOT_TOKEN,
    groupId: process.env.GROUP_ID,
  },
  efi: {
    clientId: process.env.EFI_CLIENT_ID,
    clientSecret: process.env.EFI_CLIENT_SECRET,
    pixKey: process.env.EFI_PIX_KEY,
    certPath: process.env.EFI_CERT_PATH,
    sandbox: process.env.NODE_ENV !== 'production',
  },
  db: {
    connectionString: process.env.DATABASE_URL,
  },
  admin: {
    password: process.env.ADMIN_PASSWORD,
    sessionSecret: process.env.SESSION_SECRET,
  },
  port: process.env.PORT || 3000,
};
