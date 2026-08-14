import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireCandidato } from '../middleware/authorize.js';
import { logEvent } from '../lib/logger.js';

const router = Router();

router.use(authenticate, requireCandidato);

// Postularse a una búsqueda (o a la base de talentos si no se envía busquedaId).
// candidatoId sale SIEMPRE del token, nunca del body: evita que un candidato
// autenticado cree postulaciones a nombre de otro candidato (IDOR).
router.post('/', async (req, res) => {
  const candidato = await prisma.candidato.findUnique({ where: { id: req.user.id } });
  if (!candidato.emailVerificado) {
    return res.status(403).json({ error: 'Tenés que verificar tu correo antes de postular' });
  }

  const { busquedaId } = req.body;
  if (busquedaId) {
    const busqueda = await prisma.busqueda.findUnique({ where: { id: busquedaId } });
    if (!busqueda) return res.status(404).json({ error: 'Búsqueda no encontrada' });
  }

  const yaPostulo = busquedaId
    ? await prisma.postulacion.findFirst({ where: { candidatoId: req.user.id, busquedaId } })
    : null;
  if (yaPostulo) return res.status(409).json({ error: 'Ya postulaste a esta búsqueda' });

  const postulacion = await prisma.postulacion.create({
    data: { candidatoId: req.user.id, busquedaId: busquedaId || null },
    include: { busqueda: true },
  });
  logEvent('postulacion.creada', { candidatoId: req.user.id, busquedaId: busquedaId || null });
  res.status(201).json(postulacion);
});

router.get('/mias', async (req, res) => {
  const postulaciones = await prisma.postulacion.findMany({
    where: { candidatoId: req.user.id },
    include: { busqueda: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(postulaciones);
});

export default router;
