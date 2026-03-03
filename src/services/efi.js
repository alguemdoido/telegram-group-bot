const EfiPay = require('sdk-node-apis-efi');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Converte base64 → arquivo temporário (EFI SDK exige path de arquivo)
function getCertPath() {
  const base64 = process.env.EFI_CERT_BASE64;
  if (!base64) throw new Error('EFI_CERT_BASE64 não definido');

  const certBuffer = Buffer.from(base64, 'base64');
  const tempPath = path.join(os.tmpdir(), 'efi_cert.p12');
  fs.writeFileSync(tempPath, certBuffer);
  return tempPath;
}

const efi = new EfiPay({
  client_id: process.env.EFI_CLIENT_ID,
  client_secret: process.env.EFI_CLIENT_SECRET,
  certificate: getCertPath(),
  sandbox: process.env.NODE_ENV !== 'production'
});

async function createPixCharge({ value, description }) {
  const txid = uuidv4().replace(/-/g, '').substring(0, 35);

  const body = {
    calendario: { expiracao: 3600 },
    devedor: {},
    valor: { original: Number(value).toFixed(2) },
    chave: process.env.EFI_PIX_KEY,
    infoAdicionais: [{ nome: 'Serviço', valor: description }]
  };

  const response = await efi.pixCreateImmediateCharge({ txid }, body);
  const qrRes = await efi.pixGenerateQRCode({ id: response.loc.id });

  return {
    txid: response.txid,
    pixCopiaECola: qrRes.qrcode
  };
}

module.exports = { createPixCharge };
