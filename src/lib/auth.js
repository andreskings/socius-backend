import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('Falta JWT_SECRET en las variables de entorno');
}

const TOKEN_COOKIE = 'token';
const TOKEN_TTL = '2h';

export function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// payload: { id, tipo: 'usuario' | 'candidato', rol? }
export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function verifyJwt(token) {
  return jwt.verify(token, JWT_SECRET);
}

function cookieOptions() {
  const production = process.env.NODE_ENV === 'production';
  // En producción front y back viven en dominios distintos (Vercel / Railway),
  // así que la cookie necesita sameSite 'none' para viajar cross-site — eso a su
  // vez exige 'secure', que en dev rompería el login por http://localhost.
  return {
    httpOnly: true,
    sameSite: production ? 'none' : 'lax',
    secure: production,
  };
}

export function setAuthCookie(res, token) {
  res.cookie(TOKEN_COOKIE, token, { ...cookieOptions(), maxAge: 2 * 60 * 60 * 1000 });
}

export function clearAuthCookie(res) {
  res.clearCookie(TOKEN_COOKIE, cookieOptions());
}

export function readAuthCookie(req) {
  return req.cookies?.[TOKEN_COOKIE];
}

export function generateRawToken() {
  return crypto.randomBytes(32).toString('hex');
}
