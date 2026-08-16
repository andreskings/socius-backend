import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import {
  hashPassword,
  verifyPassword,
  signToken,
  setAuthCookie,
  clearAuthCookie,
  generateRawToken,
  readAuthCookie,
  verifyJwt,
} from '../lib/auth.js';
import { logEvent } from '../lib/logger.js';
import { enviarEmail, plantillaVerificacion, plantillaReset } from '../lib/mailer.js';
import { cvUpload } from '../lib/upload.js';
import { validateUploadedFile } from '../lib/fileValidation.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireCandidato } from '../middleware/authorize.js';
import fs from 'fs/promises';

const router = Router();

// Hash dummy para comparar contra él cuando el usuario/candidato no existe, así el
// tiempo de respuesta no delata si el correo está registrado (mitiga enumeración).
const DUMMY_HASH = '$2a$12$CwTycUXWue0Thq9StjUM0uJ8i6ZgFB6RkQqSf6/1E8VqM7lz9hJm2';

// Si SMTP está configurado (ver lib/mailer.js) se manda el correo real. Si no,
// mientras no estemos en producción el link se devuelve igual en la respuesta
// para no bloquear el desarrollo local sin credenciales de correo.
const esProduccion = process.env.NODE_ENV === 'production';
const frontendOrigin = () => process.env.FRONTEND_ORIGIN || 'http://localhost:3000';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Probá de nuevo en unos minutos.' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Probá de nuevo más tarde.' },
});

const GENERIC_LOGIN_ERROR = { error: 'Credenciales inválidas' };

// ---------- Candidato ----------

router.post('/candidato/registro', registerLimiter, cvUpload.single('cv'), async (req, res) => {
  const {
    nombre,
    apellido,
    email,
    password,
    telefono,
    region,
    disponibilidadPresencial,
    experienciaRango,
    mensaje,
  } = req.body;

  if (!nombre || !apellido || !email || !password) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'nombre, apellido, email y password son requeridos' });
  }
  if (password.length < 8) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }

  const existente = await prisma.candidato.findUnique({ where: { email } });
  if (existente) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    return res.status(409).json({ error: 'Ya existe una cuenta con ese correo. Iniciá sesión.' });
  }

  if (req.file) {
    const valido = await validateUploadedFile(req.file.path, req.file.originalname);
    if (!valido) return res.status(400).json({ error: 'El archivo de CV no es un PDF o Word válido' });
  }

  const passwordHash = await hashPassword(password);
  const candidato = await prisma.candidato.create({
    data: {
      nombre,
      apellido,
      email,
      passwordHash,
      telefono,
      region,
      disponibilidadPresencial,
      experienciaRango,
      mensaje,
      cvArchivo: req.file ? req.file.filename : null,
      cvNombreOriginal: req.file ? req.file.originalname : null,
    },
  });

  const rawToken = generateRawToken();
  await prisma.verificationToken.create({
    data: {
      token: rawToken,
      tipo: 'verificacion_email',
      candidatoId: candidato.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  const linkVerificacion = `${frontendOrigin()}/candidato/verificar-email?token=${rawToken}`;
  const enviado = await enviarEmail({
    to: email,
    subject: 'Verificá tu correo — SOCIUS',
    html: plantillaVerificacion(nombre, linkVerificacion),
  });
  logEvent('candidato.registro', { candidatoId: candidato.id, email, linkVerificacion, enviado });

  const jwtToken = signToken({ id: candidato.id, tipo: 'candidato' });
  setAuthCookie(res, jwtToken);
  res.status(201).json({
    id: candidato.id,
    nombre: candidato.nombre,
    apellido: candidato.apellido,
    email: candidato.email,
    emailVerificado: false,
    ...(esProduccion || enviado ? {} : { devVerificationUrl: linkVerificacion }),
  });
});

// Genera un nuevo link de verificación para la cuenta ya logueada (perdiste el
// anterior, expiró, o nunca lo viste porque no hay email real en este entorno).
router.post('/candidato/reenviar-verificacion', authenticate, requireCandidato, async (req, res) => {
  const candidato = await prisma.candidato.findUnique({ where: { id: req.user.id } });
  if (candidato.emailVerificado) {
    return res.status(400).json({ error: 'Ese correo ya está verificado' });
  }

  const rawToken = generateRawToken();
  await prisma.verificationToken.create({
    data: {
      token: rawToken,
      tipo: 'verificacion_email',
      candidatoId: candidato.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  const linkVerificacion = `${frontendOrigin()}/candidato/verificar-email?token=${rawToken}`;
  const enviado = await enviarEmail({
    to: candidato.email,
    subject: 'Verificá tu correo — SOCIUS',
    html: plantillaVerificacion(candidato.nombre, linkVerificacion),
  });
  logEvent('candidato.verificacion_reenviada', { candidatoId: candidato.id, linkVerificacion, enviado });

  res.json({ ok: true, ...(esProduccion || enviado ? {} : { devVerificationUrl: linkVerificacion }) });
});

router.post('/candidato/verificar-email', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token requerido' });

  const record = await prisma.verificationToken.findUnique({ where: { token } });
  if (
    !record ||
    record.tipo !== 'verificacion_email' ||
    record.usedAt ||
    record.expiresAt < new Date() ||
    !record.candidatoId
  ) {
    return res.status(400).json({ error: 'Token inválido o expirado' });
  }

  await prisma.$transaction([
    prisma.candidato.update({ where: { id: record.candidatoId }, data: { emailVerificado: true } }),
    prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
  logEvent('candidato.email_verificado', { candidatoId: record.candidatoId });
  res.json({ ok: true });
});

router.post('/candidato/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json(GENERIC_LOGIN_ERROR);

  const candidato = await prisma.candidato.findUnique({ where: { email } });
  const valid = await verifyPassword(password, candidato?.passwordHash ?? DUMMY_HASH);

  if (!candidato || !valid) {
    logEvent('candidato.login_fallido', { email });
    return res.status(401).json(GENERIC_LOGIN_ERROR);
  }

  const jwtToken = signToken({ id: candidato.id, tipo: 'candidato' });
  setAuthCookie(res, jwtToken);
  logEvent('candidato.login_ok', { candidatoId: candidato.id });
  res.json({
    id: candidato.id,
    nombre: candidato.nombre,
    apellido: candidato.apellido,
    email: candidato.email,
    emailVerificado: candidato.emailVerificado,
  });
});

// ---------- Staff (Admin / Reclutador) ----------

router.post('/staff/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json(GENERIC_LOGIN_ERROR);

  const usuario = await prisma.usuario.findUnique({ where: { email } });
  const valid = await verifyPassword(password, usuario?.passwordHash ?? DUMMY_HASH);

  if (!usuario || !valid || !usuario.activo) {
    logEvent('usuario.login_fallido', { email });
    return res.status(401).json(GENERIC_LOGIN_ERROR);
  }

  const jwtToken = signToken({ id: usuario.id, tipo: 'usuario', rol: usuario.rol });
  setAuthCookie(res, jwtToken);
  logEvent('usuario.login_ok', { usuarioId: usuario.id, rol: usuario.rol });
  res.json({ id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol });
});

// ---------- Comunes ----------

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  const token = readAuthCookie(req);
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  let payload;
  try {
    payload = verifyJwt(token);
  } catch {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }

  if (payload.tipo === 'usuario') {
    const usuario = await prisma.usuario.findUnique({ where: { id: payload.id } });
    if (!usuario || !usuario.activo) return res.status(401).json({ error: 'Sesión inválida' });
    return res.json({ tipo: 'usuario', id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol });
  }

  const candidato = await prisma.candidato.findUnique({ where: { id: payload.id } });
  if (!candidato) return res.status(401).json({ error: 'Sesión inválida' });
  return res.json({
    tipo: 'candidato',
    id: candidato.id,
    nombre: candidato.nombre,
    apellido: candidato.apellido,
    email: candidato.email,
    emailVerificado: candidato.emailVerificado,
  });
});

// actor: 'candidato' | 'usuario'
router.post('/forgot-password', loginLimiter, async (req, res) => {
  const { email, actor } = req.body;
  if (!email || !['candidato', 'usuario'].includes(actor)) {
    return res.status(400).json({ error: 'email y actor son requeridos' });
  }

  const cuenta =
    actor === 'usuario'
      ? await prisma.usuario.findUnique({ where: { email } })
      : await prisma.candidato.findUnique({ where: { email } });

  // Respuesta idéntica exista o no la cuenta, para no permitir enumeración de correos.
  // devResetUrl solo se agrega si la cuenta existe Y no se pudo enviar el correo real,
  // así que su presencia/ausencia en la respuesta no delata si el correo está registrado.
  let devResetUrl;
  if (cuenta) {
    const rawToken = generateRawToken();
    await prisma.verificationToken.create({
      data: {
        token: rawToken,
        tipo: 'reset_password',
        candidatoId: actor === 'candidato' ? cuenta.id : undefined,
        usuarioId: actor === 'usuario' ? cuenta.id : undefined,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const resetPath = actor === 'usuario' ? '/login/restablecer' : '/candidato/restablecer';
    const linkReset = `${frontendOrigin()}${resetPath}?resetToken=${rawToken}`;
    const enviado = await enviarEmail({ to: email, subject: 'Restablecé tu contraseña — SOCIUS', html: plantillaReset(linkReset) });
    logEvent('password.reset_solicitado', { actor, email, linkReset, enviado });
    if (!esProduccion && !enviado) devResetUrl = linkReset;
  }

  res.json({ ok: true, mensaje: 'Si el correo existe, vas a recibir instrucciones para restablecer tu contraseña.', devResetUrl });
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'token y password son requeridos' });
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

  const record = await prisma.verificationToken.findUnique({ where: { token } });
  if (!record || record.tipo !== 'reset_password' || record.usedAt || record.expiresAt < new Date()) {
    return res.status(400).json({ error: 'Token inválido o expirado' });
  }

  const passwordHash = await hashPassword(password);
  if (record.candidatoId) {
    await prisma.$transaction([
      prisma.candidato.update({ where: { id: record.candidatoId }, data: { passwordHash } }),
      prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
    logEvent('password.reset_aplicado', { actor: 'candidato', candidatoId: record.candidatoId });
  } else if (record.usuarioId) {
    await prisma.$transaction([
      prisma.usuario.update({ where: { id: record.usuarioId }, data: { passwordHash } }),
      prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
    logEvent('password.reset_aplicado', { actor: 'usuario', usuarioId: record.usuarioId });
  }

  res.json({ ok: true });
});

export default router;
