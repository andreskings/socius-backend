import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { crearBusquedaSchema } from '../lib/schemas.js';
import { CANDIDATO_PUBLICO } from '../lib/selects.js';
import { logEvent } from '../lib/logger.js';

const router = Router();

// GET /busquedas?estado=&practica=&prioridad=&posicion=
router.get('/', async (req, res) => {
  const { estado, practica, prioridad, posicion } = req.query;
  const busquedas = await prisma.busqueda.findMany({
    where: {
      ...(estado && { estado }),
      ...(practica && { practica }),
      ...(prioridad && { prioridad }),
      ...(posicion && { posicion: { contains: posicion, mode: 'insensitive' } }),
    },
    include: { _count: { select: { postulaciones: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(
    busquedas.map((b) => ({ ...b, candidatos: b._count.postulaciones, _count: undefined }))
  );
});

router.get('/:id', authenticate, requireRole('ADMIN', 'RECLUTADOR'), async (req, res) => {
  const busqueda = await prisma.busqueda.findUnique({
    where: { id: req.params.id },
    include: { postulaciones: { include: { candidato: CANDIDATO_PUBLICO } } },
  });
  if (!busqueda) return res.status(404).json({ error: 'Búsqueda no encontrada' });
  res.json(busqueda);
});

router.post('/', authenticate, requireRole('ADMIN', 'RECLUTADOR'), validate(crearBusquedaSchema), async (req, res) => {
  const { posicion, practica, prioridad, solicitante, descripcionCarga } = req.body;
  const busqueda = await prisma.busqueda.create({
    data: { posicion, practica, prioridad, solicitante, descripcionCarga },
  });
  res.status(201).json(busqueda);
});

// Elimina una búsqueda. Las postulaciones asociadas no se borran: por el schema
// (onDelete: SetNull) quedan con busquedaId = null, es decir, caen a la "base de
// talentos" en vez de perderse.
router.delete('/:id', authenticate, requireRole('ADMIN', 'RECLUTADOR'), async (req, res) => {
  const busqueda = await prisma.busqueda.findUnique({ where: { id: req.params.id } });
  if (!busqueda) return res.status(404).json({ error: 'Búsqueda no encontrada' });

  await prisma.busqueda.delete({ where: { id: req.params.id } });
  logEvent('busqueda.eliminada', { busquedaId: busqueda.id, posicion: busqueda.posicion, eliminadaPor: req.user.id });
  res.json({ ok: true });
});

export default router;
