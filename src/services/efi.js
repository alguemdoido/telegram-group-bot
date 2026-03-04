const EfiPay = require('sdk-node-apis-efi');
const crypto = require('crypto');

const efi = new EfiPay({
  client_id: process.env.EFI_CLIENT_ID,
  client_secret: process.env.EFI_CLIENT_SECRET,

  // certificado em base64 (sem arquivo)
  certificate: process.env.EFI_CERT_BASE64,
  cert_base64: true, // <- a SDK suporta isso [page:1]

  sandbox: process.env.EFI_SANDBOX === 'true'
});

async function createPixCharge({ value, description }) {
  const txid = crypto.randomBytes(16).toString('hex'); // 32 chars

  const body = {
    calendario: { expiracao: 3600 },
    valor: { original: Number(value).toFixed(2) }, // ex "37.00" [page:0]
    chave: process.env.EFI_PIX_KEY,
    solicitacaoPagador: description || 'Pagamento'
    // NÃO mande devedor: {}  (omita inteiro) [page:2]
  };

  const cob = await efi.pixCreateImmediateCharge({ txid }, body);

  // Em sucesso, a própria resposta pode trazer pixCopiaECola [page:0]
  const pixCopiaECola = cob.pixCopiaECola;

  // Se você também quiser QRCode “texto/ASCII”, dá pra gerar pelo loc.id [page:0]
  // const qr = await efi.pixGenerateQRCode({ id: cob.loc.id });
  // const pixCopiaECola = qr.qrcode;

  return {
    txid: cob.txid,
    locId: cob.loc?.id,
    pixCopiaECola
  };
}

module.exports = { createPixCharge };
