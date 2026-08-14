import { Router } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole, requireOwnCandidatoOrStaff } from '../middleware/authorize.js';
import { cvUpload } from '../lib/upload.js';
import { validateUploadedFile } from '../lib/fileValidation.js';
import { logEvent } from '../lib/logger.js';

const router = Router();

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
  };
}

router.use(authenticate);

// GET /candidatos?nombre=&region=&busquedaId=  — solo staff (expone PII de todos)
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
    },
    orderBy: { createdAt: 'desc' },
    include: { postulaciones: { include: { busqueda: true } } },
  });
  res.json(candidatos.map(serialize));
});

router.get('/me', async (req, res) => {
  if (req.user.tipo !== 'candidato') return res.status(403).json({ error: 'Solo para candidatos' });
  const candidato = await prisma.candidato.findUnique({
    where: { id: req.user.id },
    include: { postulaciones: { include: { busqueda: true } } },
  });
  res.json(serialize(candidato));
});

router.patch('/me', async (req, res) => {
  if (req.user.tipo !== 'candidato') return res.status(403).json({ error: 'Solo para candidatos' });
  const { telefono, region, disponibilidadPresencial, experienciaRango, mensaje } = req.body;
  const candidato = await prisma.candidato.update({
    where: { id: req.user.id },
    data: { telefono, region, disponibilidadPresencial, experienciaRango, mensaje },
    include: { postulaciones: { include: { busqueda: true } } },
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
    data: { cvArchivo: req.file.filename, cvNombreOriginal: req.file.originalname },
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
    include: { postulaciones: { include: { busqueda: true } } },
  });
  if (!candidato) return res.status(404).json({ error: 'Candidato no encontrado' });
  res.json(serialize(candidato));
});

router.get('/:id/cv', requireOwnCandidatoOrStaff('id'), async (req, res) => {
  const candidato = await prisma.candidato.findUnique({ where: { id: req.params.id } });
  if (!candidato?.cvArchivo) return res.status(404).json({ error: 'CV no encontrado' });
  res.download(path.join('uploads', candidato.cvArchivo), candidato.cvNombreOriginal || candidato.cvArchivo);
});

export default router;
