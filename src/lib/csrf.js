import crypto from 'crypto';

const CSRF_COOKIE = 'csrfToken';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

// Patrón double-submit cookie: el token viaja en una cookie legible por JS (no
// httpOnly) y el frontend lo repite en un header en cada request que muta datos.
// Un atacante cross-site puede hacer que el navegador mande la cookie sola (por
// eso sameSite:'none' en prod no alcanza), pero no puede leerla para copiarla al
// header — así que el header ausente o distinto delata el request forjado.
export function issueCsrfCookie(res) {
  const production = process.env.NODE_ENV === 'production';
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: production ? 'none' : 'lax',
    secure: production,
    maxAge: 2 * 60 * 60 * 1000,
  });
  return token;
}

export function clearCsrfCookie(res) {
  res.clearCookie(CSRF_COOKIE);
}

export function verifyCsrf(req, res, next) {
  if (SAFE_METHODS.includes(req.method)) return next();
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'Token CSRF inválido o ausente' });
  }
  next();
}
