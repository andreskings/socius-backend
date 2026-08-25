import { Router } from 'express';
import path from 'path';
import fs from 'fs/promises';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole, requireOwnCandidatoOrStaff } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { actualizarPerfilCandidatoSchema } from '../lib/schemas.js';
import { cvUpload } from '../lib/upload.js';
import { validateUploadedFile } from '../lib/fileValidation.js';
import { extraerTextoCv } from '../lib/extractText.js';
import { analizarCv } from '../lib/groq.js';
import { logEvent } from '../lib/logger.js';

const router = Router();

const INCLUDE_COMPLETO = {
  postulaciones: { include: { busqueda: true } },
  analisisIaCargoSugerido: true,
};

const analisisLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados análisis en poco tiempo. Probá de nuevo más tarde.' },
});

function serialize(candidato) {
  const postulacion = candidato.postulaciones?.[0] ?? null;
  return {
    id: candidato.id,
    nombre: candidato.nombre,
    apellido: candidato.apellido,
    email: candidato.email,
    telefono: candidato.telefono,
    region: candidato.region,
    disponibilidadPresencial: candidato.disponibilidadPresencial,
    experienciaRango: candidato.experienciaRango,
    mensaje: candidato.mensaje,
    cvArchivo: candidato.cvArchivo,
    cvNombreOriginal: candidato.cvNombreOriginal,
    emailVerificado: candidato.emailVerificado,
    fechaPostulacion: candidato.fechaPostulacion,
    cargo: postulacion?.busqueda?.posicion ?? null,
    busquedaId: postulacion?.busquedaId ?? null,
    analisisIa: candidato.analisisIaFecha
      ? {
          cargoSugerido: candidato.analisisIaCargoSugerido?.posicion ?? null,
          busquedaSugeridaId: candidato.analisisIaCargoSugeridoId ?? null,
          puntaje: candidato.analisisIaPuntaje,
          veredicto: candidato.analisisIaVeredicto,
          resumen: candidato.analisisIaResumen,
          fecha: candidato.analisisIaFecha,
        }
      : null,
  };
}

router.use(authenticate);

// GET /candidatos?nombre=&region=&busquedaId=  — solo staff (expone PII de todos)
// Un candidato rechazado en todas sus postulaciones ya no aparece acá — tiene su
// propio lugar en la pestaña "Rechazados". Si tiene alguna postulación activa en
// otra búsqueda, sigue apareciendo (el rechazo es por búsqueda, no por persona).
router.get('/', requireRole('ADMIN', 'RECLUTADOR'), async (req, res) => {
  const { nombre, region, busquedaId } = req.query;
  const candidatos = await prisma.candidato.findMany({
    where: {
      ...(nombre && {
        OR: [
          { nombre: { contains: nombre, mode: 'insensitive' } },
          { apellido: { contains: nombre, mode: 'insensitive' } },
          { email: { contains: nombre, mode: 'insensitive' } },
        ],
      }),
      ...(region && { region }),
      ...(busquedaId && { postulaciones: { some: { busquedaId } } }),
      NOT: {
        AND: [{ postulaciones: { some: {} } }, { postulaciones: { every: { estado: 'Rechazado' } } }],
      },
    },
    orderBy: { createdAt: 'desc' },
    include: INCLUDE_COMPLETO,
  });
  res.json(candidatos.map(serialize));
});

router.get('/me', async (req, res) => {
  if (req.user.tipo !== 'candidato') return res.status(403).json({ error: 'Solo para candidatos' });
  const candidato = await prisma.candidato.findUnique({
    where: { id: req.user.id },
    include: INCLUDE_COMPLETO,
  });
  res.json(serialize(candidato));
});

router.patch('/me', validate(actualizarPerfilCandidatoSchema), async (req, res) => {
  if (req.user.tipo !== 'candidato') return res.status(403).json({ error: 'Solo para candidatos' });
  const { telefono, region, disponibilidadPresencial, experienciaRango, mensaje } = req.body;
  const candidato = await prisma.candidato.update({
    where: { id: req.user.id },
    data: { telefono, region, disponibilidadPresencial, experienciaRango, mensaje },
    include: INCLUDE_COMPLETO,
  });
  res.json(serialize(candidato));
});

// Reemplaza el CV del candidato autenticado. Borra el archivo anterior del disco:
// regla de negocio "1 CV activo" forzada en el servidor, no solo en el frontend.
router.put('/me/cv', cvUpload.single('cv'), async (req, res) => {
  if (req.user.tipo !== 'candidato') return res.status(403).json({ error: 'Solo para candidatos' });
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo de CV' });

  const valido = await validateUploadedFile(req.file.path, req.file.originalname);
  if (!valido) return res.status(400).json({ error: 'El archivo de CV no es un PDF o Word válido' });

  const anterior = await prisma.candidato.findUnique({ where: { id: req.user.id } });
  const candidato = await prisma.candidato.update({
    where: { id: req.user.id },
    data: {
      cvArchivo: req.file.filename,
      cvNombreOriginal: req.file.originalname,
      // El CV cambió: cualquier análisis de IA anterior queda obsoleto.
      analisisIaCargoSugeridoId: null,
      analisisIaPuntaje: null,
      analisisIaVeredicto: null,
      analisisIaResumen: null,
      analisisIaFecha: null,
    },
  });

  if (anterior?.cvArchivo) {
    await fs.unlink(path.join('uploads', anterior.cvArchivo)).catch(() => {});
  }
  logEvent('candidato.cv_reemplazado', { candidatoId: req.user.id });
  res.json(serialize(candidato));
});

router.get('/:id', requireOwnCandidatoOrStaff('id'), async (req, res) => {
  const candidato = await prisma.candidato.findUnique({
    where: { id: req.params.id },
    include: INCLUDE_COMPLETO,
  });
  if (!candidato) return res.status(404).json({ error: 'Candidato no encontrado' });
  res.json(serialize(candidato));
});

router.get('/:id/cv', requireOwnCandidatoOrStaff('id'), async (req, res) => {
  const candidato = await prisma.candidato.findUnique({ where: { id: req.params.id } });
  if (!candidato?.cvArchivo) return res.status(404).json({ error: 'CV no encontrado' });
  res.download(path.join('uploads', candidato.cvArchivo), candidato.cvNombreOriginal || candidato.cvArchivo);
});

// Analiza el CV del candidato con IA (Groq) y sugiere a qué búsqueda activa encaja
// mejor. Es una sugerencia para que el staff revise, nunca un filtro automático
// que descarte candidatos — ver 04-roles-permisos-login-candidatos.md.
router.post('/:id/analizar-ia', analisisLimiter, requireRole('ADMIN', 'RECLUTADOR'), async (req, res) => {
  const candidato = await prisma.candidato.findUnique({ where: { id: req.params.id } });
  if (!candidato) return res.status(404).json({ error: 'Candidato no encontrado' });
  if (!candidato.cvArchivo) return res.status(400).json({ error: 'Este candidato no tiene CV cargado' });

  const cvTexto = await extraerTextoCv(path.join('uploads', candidato.cvArchivo)).catch(() => null);
  if (cvTexto === null) {
    return res.status(422).json({ error: 'No se pudo leer este formato de archivo para el análisis (solo PDF y DOCX)' });
  }
  if (!cvTexto.trim()) {
    return res.status(422).json({ error: 'No se encontró texto legible en el CV' });
  }

  const busquedas = await prisma.busqueda.findMany({
    where: { estado: 'Activa' },
    select: { id: true, posicion: true, practica: true, descripcionCarga: true },
  });

  let resultado;
  try {
    resultado = await analizarCv({ cvTexto, busquedas });
  } catch (err) {
    return res.status(502).json({ error: `No se pudo completar el análisis: ${err.message}` });
  }

  const actualizado = await prisma.candidato.update({
    where: { id: candidato.id },
    data: {
      analisisIaCargoSugeridoId: resultado.busquedaSugeridaId,
      analisisIaPuntaje: resultado.puntaje,
      analisisIaVeredicto: resultado.veredicto,
      analisisIaResumen: resultado.resumen,
      analisisIaFecha: new Date(),
    },
    include: INCLUDE_COMPLETO,
  });

  logEvent('candidato.analizado_ia', {
    candidatoId: candidato.id,
    busquedaSugeridaId: resultado.busquedaSugeridaId,
    puntaje: resultado.puntaje,
    veredicto: resultado.veredicto,
    analizadoPor: req.user.id,
  });
  res.json(serialize(actualizado));
});

// Eliminar una cuenta de candidato: solo ADMIN (un reclutador no puede borrar
// candidatos directamente, ver 04-roles-permisos-login-candidatos.md sección 3).
// Borra también el CV del disco y, en cascada por el schema, sus postulaciones
// y tokens de verificación.
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const candidato = await prisma.candidato.findUnique({ where: { id: req.params.id } });
  if (!candidato) return res.status(404).json({ error: 'Candidato no encontrado' });

  await prisma.candidato.delete({ where: { id: req.params.id } });
  if (candidato.cvArchivo) {
    await fs.unlink(path.join('uploads', candidato.cvArchivo)).catch(() => {});
  }
  logEvent('candidato.eliminado', { candidatoId: candidato.id, eliminadoPor: req.user.id });
  res.json({ ok: true });
});

export default router;
