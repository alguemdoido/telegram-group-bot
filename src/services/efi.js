const EfiPay = require('sdk-node-apis-efi');
const { v4: uuidv4 } = require('uuid');

const efi = new EfiPay({
  client_id: process.env.EFI_CLIENT_ID,
  client_secret: process.env.EFI_CLIENT_SECRET,
  certificate: process.env.EFI_CERT_PATH, // caminho do .p12
  sandbox: process.env.NODE_ENV !== 'production'
});

async function createPixCharge({ value, description }) {
  const txid = uuidv4().replace(/-/g, '').substring(0, 35);

  const body = {
    calendario: { expiracao: 3600 }, // 1 hora para pagar
    devedor: {},
    valor: { original: Number(value).toFixed(2) },
    chave: process.env.EFI_PIX_KEY,
    infoAdicionais: [{ nome: 'Servico', valor: description }]
  };

  const response = await efi.pixCreateImmediateCharge({ txid }, body);

  const qrRes = await efi.pixGenerateQRCode({
    id: response.loc.id
  });

  return {
    txid: response.txid,
    pixCopiaECola: qrRes.qrcode
  };
}

module.exports = { createPixCharge };
