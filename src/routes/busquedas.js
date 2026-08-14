import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

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

router.get('/:id', async (req, res) => {
  const busqueda = await prisma.busqueda.findUnique({
    where: { id: req.params.id },
    include: { postulaciones: { include: { candidato: true } } },
  });
  if (!busqueda) return res.status(404).json({ error: 'Búsqueda no encontrada' });
  res.json(busqueda);
});

router.post('/', async (req, res) => {
  const { posicion, practica, prioridad, solicitante, descripcionCarga } = req.body;
  if (!posicion || !practica || !prioridad || !solicitante) {
    return res.status(400).json({ error: 'posicion, practica, prioridad y solicitante son requeridos' });
  }
  const busqueda = await prisma.busqueda.create({
    data: { posicion, practica, prioridad, solicitante, descripcionCarga },
  });
  res.status(201).json(busqueda);
});

export default router;
