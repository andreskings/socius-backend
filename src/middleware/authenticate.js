import { readAuthCookie, verifyJwt } from '../lib/auth.js';
import { verifyCsrf } from '../lib/csrf.js';

// Exige sesión válida (usuario staff o candidato). Adjunta req.user.
// También exige CSRF en métodos que mutan datos (ver lib/csrf.js) — todas las
// rutas autenticadas pasan por acá, así que alcanza con validarlo una vez.
export function authenticate(req, res, next) {
  const token = readAuthCookie(req);
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = verifyJwt(token);
  } catch {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
  verifyCsrf(req, res, next);
}

// Igual que authenticate pero no falla si no hay sesión (req.user queda undefined).
export function authenticateOptional(req, res, next) {
  const token = readAuthCookie(req);
  if (!token) return next();
  try {
    req.user = verifyJwt(token);
  } catch {
    // token inválido/expirado: se ignora, sigue como anónimo
  }
  next();
}
