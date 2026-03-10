const EfiPay = require('sdk-node-apis-efi');
const crypto = require('crypto');

const efi = new EfiPay({
  client_id: process.env.EFI_CLIENT_ID,
  client_secret: process.env.EFI_CLIENT_SECRET,

  // certificado em base64 (sem arquivo)
  certificate: process.env.EFI_CERT_BASE64,
  cert_base64: true,

  sandbox: process.env.EFI_SANDBOX === 'true'

  'x-skip-mtls-checking': 'true'
});

async function createPixCharge({ value, description }) {
  const txid = crypto.randomBytes(16).toString('hex'); // 32 chars

  const body = {
    calendario: { expiracao: 3600 },
    valor: { original: Number(value).toFixed(2) },
    chave: process.env.EFI_PIX_KEY,
    solicitacaoPagador: description || 'Pagamento'
  };

  const cob = await efi.pixCreateImmediateCharge({ txid }, body);

  const pixCopiaECola = cob.pixCopiaECola;

  return {
    txid: cob.txid,
    locId: cob.loc?.id,
    pixCopiaECola
  };
}

async function registerWebhook() {
  const webhookUrl = process.env.WEBHOOK_BASE_URL + '/efi/webhook/pix';  console.log('\ud83d\udd17 Registrando webhook EFI em:', webhookUrl);
  try {
    const params = { chave: process.env.EFI_PIX_KEY };
    const body = { webhookUrl };
    await efi.pixConfigWebhook(params, body);
    console.log('\u2705 Webhook EFI registrado com sucesso');
  } catch (err) {
    // Erro 409 = webhook ja cadastrado com a mesma URL (ok)
    if (err?.response?.data?.codigo === 'webhook-invalido' || err?.status === 409) {
      console.log('\u26a0\ufe0f Webhook ja estava cadastrado (ok)');
    } else {
      const msg = err?.response?.data
        ? JSON.stringify(err.response.data)
        : err?.message || err?.stack || JSON.stringify(err, Object.getOwnPropertyNames(err), 2);      console.error('\u274c Erro ao registrar webhook EFI:', msg);
    }
  }
}

module.exports = { createPixCharge, registerWebhook };
