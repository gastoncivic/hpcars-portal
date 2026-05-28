const nodemailer = require('nodemailer');
const BASE_URL = process.env.BASE_URL || 'https://hpcars-portal.onrender.com';

// ─── TRANSPORTER ───
function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

const FROM = process.env.SMTP_FROM || `HP CARS <${process.env.SMTP_USER}>`;

async function sendEmail({ to, subject, html }) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log(`📧 [EMAIL SIMULADO] To: ${to} | Subject: ${subject}`);
    return { success: true, simulated: true };
  }
  try {
    const transporter = createTransporter();
    const info = await transporter.sendMail({ from: FROM, to, subject, html });
    console.log(`📧 Email enviado a ${to}: ${info.messageId}`);
    return { success: true, id: info.messageId };
  } catch(e) {
    console.error(`📧 Error enviando a ${to}:`, e.message);
    return { success: false, error: e.message };
  }
}

// ─── TEMPLATES ───
function emailVerification(name, token) {
  const link = `${BASE_URL}/api/auth/verify/${token}`;
  return {
    subject: '✅ Verificá tu cuenta — HP CARS Portal',
    html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#07080f;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:560px;margin:40px auto;background:#0d0f1a;border:1px solid #1e2235;border-radius:16px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#e8321a,#ff4d33);padding:32px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:28px;letter-spacing:2px">HP CARS</h1>
    <p style="color:rgba(255,255,255,.8);margin:8px 0 0;font-size:13px">PORTAL PROFESIONAL</p>
  </div>
  <div style="padding:32px">
    <h2 style="color:#e8eaf0;margin:0 0 12px">Hola, ${name} 👋</h2>
    <p style="color:#7a8296;line-height:1.6;margin:0 0 24px">Gracias por registrarte en HP CARS Portal. Para activar tu cuenta hacé clic en el botón:</p>
    <div style="text-align:center;margin:32px 0">
      <a href="${link}" style="background:#e8321a;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">✅ VERIFICAR MI CUENTA</a>
    </div>
    <p style="color:#7a8296;font-size:12px">Este link expira en 24 horas.</p>
    <p style="color:#3a3f55;font-size:11px;margin-top:16px">O copiá este link: <a href="${link}" style="color:#e8321a">${link}</a></p>
  </div>
  <div style="border-top:1px solid #1e2235;padding:16px 32px;text-align:center">
    <p style="color:#3a3f55;font-size:11px;margin:0">© HP CARS Portal · Chiptuning Profesional</p>
  </div>
</div></body></html>`
  };
}

function fileReceived(name, { service, brand, model, fileId }) {
  const svcNames = { chiptuning:'Chiptuning', immo:'IMMO OFF', seedkey:'Seed Key', special:'Soluciones Especiales' };
  return {
    subject: `📁 Archivo recibido — ${brand} ${model} | HP CARS`,
    html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#07080f;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:560px;margin:40px auto;background:#0d0f1a;border:1px solid #1e2235;border-radius:16px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#e8321a,#ff4d33);padding:32px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:28px;letter-spacing:2px">HP CARS</h1>
  </div>
  <div style="padding:32px">
    <h2 style="color:#e8eaf0;margin:0 0 12px">Hola, ${name} 👋</h2>
    <p style="color:#7a8296;line-height:1.6;margin:0 0 24px">Recibimos tu archivo correctamente. Un tuner lo va a revisar pronto.</p>
    <div style="background:#12151f;border:1px solid #1e2235;border-radius:10px;padding:20px;margin:24px 0">
      <div style="margin-bottom:8px"><span style="color:#7a8296;font-size:13px">Servicio: </span><span style="color:#e8321a;font-weight:700">${svcNames[service]||service}</span></div>
      <div style="margin-bottom:8px"><span style="color:#7a8296;font-size:13px">Vehículo: </span><span style="color:#e8eaf0">${brand} ${model}</span></div>
      <div><span style="color:#7a8296;font-size:13px">ID: </span><span style="color:#e8eaf0">#${fileId}</span></div>
    </div>
    <p style="color:#7a8296;font-size:13px">⏱️ Tiempo estimado: <strong style="color:#f5a623">&lt; 4 horas hábiles</strong></p>
    <div style="text-align:center;margin:28px 0">
      <a href="${BASE_URL}/dashboard.html" style="background:#e8321a;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block">📊 VER MI DASHBOARD</a>
    </div>
  </div>
  <div style="border-top:1px solid #1e2235;padding:16px 32px;text-align:center">
    <p style="color:#3a3f55;font-size:11px;margin:0">© HP CARS Portal</p>
  </div>
</div></body></html>`
  };
}

function fileReady(name, { service, brand, model, fileId, tunerNotes }) {
  const svcNames = { chiptuning:'Chiptuning', immo:'IMMO OFF', seedkey:'Seed Key', special:'Soluciones Especiales' };
  return {
    subject: `✅ ¡Tu archivo está listo! — ${brand} ${model} | HP CARS`,
    html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#07080f;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:560px;margin:40px auto;background:#0d0f1a;border:1px solid #1e2235;border-radius:16px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#2ed573,#1db954);padding:32px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:28px;letter-spacing:2px">HP CARS</h1>
    <p style="color:rgba(255,255,255,.9);margin:8px 0 0;font-size:15px;font-weight:700">✅ ARCHIVO LISTO</p>
  </div>
  <div style="padding:32px">
    <h2 style="color:#e8eaf0;margin:0 0 12px">¡Listo, ${name}! 🎉</h2>
    <p style="color:#7a8296;line-height:1.6;margin:0 0 24px">Tu archivo fue procesado y está disponible para descargar.</p>
    <div style="background:#12151f;border:1px solid rgba(46,213,115,.2);border-radius:10px;padding:20px;margin:24px 0">
      <div style="margin-bottom:8px"><span style="color:#7a8296;font-size:13px">Servicio: </span><span style="color:#2ed573;font-weight:700">${svcNames[service]||service}</span></div>
      <div style="margin-bottom:8px"><span style="color:#7a8296;font-size:13px">Vehículo: </span><span style="color:#e8eaf0">${brand} ${model}</span></div>
      ${tunerNotes ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid #1e2235"><span style="color:#7a8296;font-size:12px">Nota del tuner:</span><p style="color:#e8eaf0;font-size:13px;margin:4px 0 0">${tunerNotes}</p></div>` : ''}
    </div>
    <p style="color:#7a8296;font-size:12px">⚠️ Tenés 3 descargas o 2 días para descargar el archivo.</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${BASE_URL}/dashboard.html" style="background:#2ed573;color:#07080f;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">⬇️ DESCARGAR ARCHIVO</a>
    </div>
  </div>
  <div style="border-top:1px solid #1e2235;padding:16px 32px;text-align:center">
    <p style="color:#3a3f55;font-size:11px;margin:0">© HP CARS Portal</p>
  </div>
</div></body></html>`
  };
}

module.exports = { sendEmail, emailVerification, fileReceived, fileReady };
