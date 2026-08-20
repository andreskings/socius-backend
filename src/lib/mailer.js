import { logEvent } from './logger.js';

// Se usa la API HTTP de Brevo (antes Sendinblue) en vez de SMTP: Gmail bloquea el
// acceso SMTP programático en cuentas nuevas/no reconocidas por sus políticas
// anti-spam, algo que no depende de que las credenciales estén bien puestas.
// Brevo está pensado justo para correo transaccional desde apps y no tiene esa
// fricción — solo necesita la API key y un remitente verificado en su panel.
const apiKeyConfigurada = !!(process.env.BREVO_API_KEY && process.env.MAIL_FROM);

// Otros módulos usan esto para saber si deben ofrecer el link de respaldo
// (modo desarrollo sin proveedor de correo configurado) o confiar en que el
// correo real llegó.
export const emailHabilitado = apiKeyConfigurada;

export async function enviarEmail({ to, subject, html }) {
  if (!apiKeyConfigurada) return false;
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'SOCIUS', email: process.env.MAIL_FROM },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logEvent('email.error', { to, subject, status: res.status, body });
      return false;
    }
    logEvent('email.enviado', { to, subject });
    return true;
  } catch (err) {
    logEvent('email.error', { to, subject, error: err.message });
    return false;
  }
}

function plantillaBase(titulo, mensaje, link, textoBoton) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;">
    <div style="background:#0f1b2d;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
      <h1 style="margin:0;font-size:18px;letter-spacing:0.5px;">SOCIUS</h1>
    </div>
    <div style="background:#f7f9fb;padding:28px 24px;border-radius:0 0 12px 12px;">
      <h2 style="font-size:16px;color:#1a1f36;margin:0 0 12px;">${titulo}</h2>
      <p style="font-size:14px;color:#4b5563;line-height:1.6;margin:0 0 20px;">${mensaje}</p>
      <div style="text-align:center;margin-bottom:20px;">
        <a href="${link}" style="background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;display:inline-block;">${textoBoton}</a>
      </div>
      <p style="font-size:12px;color:#9ca3af;margin:0;word-break:break-all;">Si el botón no funciona, copiá y pegá este link:<br>${link}</p>
    </div>
  </div>`;
}

export function plantillaVerificacion(nombre, link) {
  return plantillaBase(
    'Verificá tu correo',
    `Hola ${nombre}, confirmá tu correo para activar tu cuenta y poder postular a búsquedas en SOCIUS. Este link vence en 24 horas.`,
    link,
    'Verificar correo'
  );
}

export function plantillaReset(link) {
  return plantillaBase(
    'Restablecé tu contraseña',
    'Recibimos una solicitud para restablecer tu contraseña. Si no fuiste vos, podés ignorar este correo. Este link vence en 1 hora.',
    link,
    'Restablecer contraseña'
  );
}

function fechaLegible(fecha) {
  return new Date(fecha).toLocaleString('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function plantillaEntrevista({ nombre, posicion, fecha, mensaje, linkPortal }) {
  const parrafoMensaje = mensaje
    ? `<p style="font-size:14px;color:#4b5563;line-height:1.6;margin:0 0 20px;white-space:pre-line;">${mensaje}</p>`
    : '';
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;">
    <div style="background:#0f1b2d;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
      <h1 style="margin:0;font-size:18px;letter-spacing:0.5px;">SOCIUS</h1>
    </div>
    <div style="background:#f7f9fb;padding:28px 24px;border-radius:0 0 12px 12px;">
      <h2 style="font-size:16px;color:#1a1f36;margin:0 0 12px;">¡Fuiste seleccionado/a para una entrevista!</h2>
      <p style="font-size:14px;color:#4b5563;line-height:1.6;margin:0 0 16px;">
        Hola ${nombre}, avanzaste a la etapa de entrevista${posicion ? ` para <strong>${posicion}</strong>` : ''}.
      </p>
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin:0 0 20px;">
        <p style="font-size:13px;color:#9ca3af;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.3px;">Fecha y hora</p>
        <p style="font-size:15px;color:#1a1f36;margin:0;font-weight:600;text-transform:capitalize;">${fechaLegible(fecha)}</p>
      </div>
      ${parrafoMensaje}
      <div style="text-align:center;margin-bottom:8px;">
        <a href="${linkPortal}" style="background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;display:inline-block;">Ver mi postulación</a>
      </div>
    </div>
  </div>`;
}

export function plantillaRechazo({ nombre, posicion, mensaje, linkPortal }) {
  const parrafoMensaje = mensaje
    ? `<p style="font-size:14px;color:#4b5563;line-height:1.6;margin:0 0 20px;white-space:pre-line;">${mensaje}</p>`
    : '';
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;">
    <div style="background:#0f1b2d;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
      <h1 style="margin:0;font-size:18px;letter-spacing:0.5px;">SOCIUS</h1>
    </div>
    <div style="background:#f7f9fb;padding:28px 24px;border-radius:0 0 12px 12px;">
      <h2 style="font-size:16px;color:#1a1f36;margin:0 0 12px;">Novedades sobre tu postulación</h2>
      <p style="font-size:14px;color:#4b5563;line-height:1.6;margin:0 0 16px;">
        Hola ${nombre}, te escribimos para contarte que${posicion ? ` para <strong>${posicion}</strong>` : ''}
        decidimos avanzar con otro candidato en esta oportunidad.
      </p>
      ${parrafoMensaje}
      <p style="font-size:14px;color:#4b5563;line-height:1.6;margin:0 0 20px;">
        Gracias por tu interés y por el tiempo dedicado al proceso. Tu perfil queda disponible
        en nuestra base de talentos para futuras búsquedas.
      </p>
      <div style="text-align:center;margin-bottom:8px;">
        <a href="${linkPortal}" style="background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;display:inline-block;">Ver mi portal</a>
      </div>
    </div>
  </div>`;
}
