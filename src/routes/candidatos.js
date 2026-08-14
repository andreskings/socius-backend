import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { prisma } from '../lib/prisma.js';

const upload = multer({
  storage: multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.pdf', '.doc', '.docx'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Solo se aceptan archivos PDF o Word'), ok);
  },
});

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
    fechaPostulacion: candidato.fechaPostulacion,
    cargo: postulacion?.busqueda?.posicion ?? null,
    busquedaId: postulacion?.busquedaId ?? null,
  };
}

// GET /candidatos?nombre=&region=&busquedaId=
router.get('/', async (req, res) => {
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

router.get('/:id', async (req, res) => {
  const candidato = await prisma.candidato.findUnique({
    where: { id: req.params.id },
    include: { postulaciones: { include: { busqueda: true } } },
  });
  if (!candidato) return res.status(404).json({ error: 'Candidato no encontrado' });
  res.json(serialize(candidato));
});

// POST /candidatos  (multipart/form-data: cv + campos + busquedaId opcional)
router.post('/', upload.single('cv'), async (req, res) => {
  const { nombre, apellido, email, telefono, region, disponibilidadPresencial, experienciaRango, mensaje, busquedaId } = req.body;
  if (!nombre || !apellido || !email) {
    return res.status(400).json({ error: 'nombre, apellido y email son requeridos' });
  }
  const candidato = await prisma.candidato.create({
    data: {
      nombre,
      apellido,
      email,
      telefono,
      region,
      disponibilidadPresencial,
      experienciaRango,
      mensaje,
      cvArchivo: req.file ? req.file.filename : null,
      cvNombreOriginal: req.file ? req.file.originalname : null,
      postulaciones: {
        create: { busquedaId: busquedaId || null },
      },
    },
    include: { postulaciones: { include: { busqueda: true } } },
  });
  res.status(201).json(serialize(candidato));
});

router.get('/:id/cv', async (req, res) => {
  const candidato = await prisma.candidato.findUnique({ where: { id: req.params.id } });
  if (!candidato?.cvArchivo) return res.status(404).json({ error: 'CV no encontrado' });
  res.download(path.join('uploads', candidato.cvArchivo), candidato.cvNombreOriginal || candidato.cvArchivo);
});

export default router;
