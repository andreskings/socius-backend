import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireCandidato, requireRole } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { postularSchema, estadoPostulacionSchema } from '../lib/schemas.js';
import { logEvent } from '../lib/logger.js';
import { CANDIDATO_PUBLICO } from '../lib/selects.js';
import { enviarEmail, plantillaEntrevista, plantillaRechazo } from '../lib/mailer.js';

const frontendOrigin = () => process.env.FRONTEND_ORIGIN || 'http://localhost:3000';

export const ESTADOS_POSTULACION = ['Nuevo', 'En revisión', 'Entrevista', 'Contratado', 'Rechazado'];
const cambiarEstadoSchema = estadoPostulacionSchema(ESTADOS_POSTULACION);

const router = Router();

router.use(authenticate);

// GET /postulaciones?busquedaId=&estado=  — staff, alimenta el pipeline/kanban
router.get('/', requireRole('ADMIN', 'RECLUTADOR'), async (req, res) => {
  const { busquedaId, estado } = req.query;
  const postulaciones = await prisma.postulacion.findMany({
    where: {
      ...(busquedaId && { busquedaId }),
      ...(estado && { estado }),
    },
    include: { busqueda: true, candidato: CANDIDATO_PUBLICO },
    orderBy: { createdAt: 'desc' },
  });
  res.json(postulaciones);
});

router.get('/mias', requireCandidato, async (req, res) => {
  const postulaciones = await prisma.postulacion.findMany({
    where: { candidatoId: req.user.id },
    include: { busqueda: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(postulaciones);
});

// Postularse a una búsqueda (o a la base de talentos si no se envía busquedaId).
// candidatoId sale SIEMPRE del token, nunca del body: evita que un candidato
// autenticado cree postulaciones a nombre de otro candidato (IDOR).
router.post('/', requireCandidato, validate(postularSchema), async (req, res) => {
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

// Cambiar el estado de una postulación (pipeline). Solo staff.
// Al pasar a "Entrevista" hace falta fechaEntrevista (obligatoria, se lo pide el
// modal del pipeline en el frontend antes de llamar acá). "mensaje" es un texto
// libre opcional que el reclutador puede agregar, se incluye en el correo si hay.
// El envío de correo es best-effort: si falla, la postulación igual queda
// actualizada — no tiene sentido bloquear el cambio de estado por un problema de
// email, se informa vía "emailEnviado" en la respuesta.
router.patch('/:id', requireRole('ADMIN', 'RECLUTADOR'), validate(cambiarEstadoSchema), async (req, res) => {
  const { estado, fechaEntrevista, mensaje } = req.body;

  const postulacion = await prisma.postulacion
    .update({
      where: { id: req.params.id },
      data: {
        estado,
        ...(estado === 'Entrevista' && { fechaEntrevista: new Date(fechaEntrevista) }),
      },
      include: { busqueda: true, candidato: CANDIDATO_PUBLICO },
    })
    .catch(() => null);
  if (!postulacion) return res.status(404).json({ error: 'Postulación no encontrada' });

  logEvent('postulacion.estado_cambiado', { postulacionId: postulacion.id, estado, cambiadoPor: req.user.id });

  let emailEnviado = null;
  if (estado === 'Entrevista' || estado === 'Rechazado') {
    const nombreCompleto = postulacion.candidato.nombre;
    const posicion = postulacion.busqueda?.posicion || null;
    const linkPortal = `${frontendOrigin()}/candidato/portal`;
    const html =
      estado === 'Entrevista'
        ? plantillaEntrevista({ nombre: nombreCompleto, posicion, fecha: postulacion.fechaEntrevista, mensaje, linkPortal })
        : plantillaRechazo({ nombre: nombreCompleto, posicion, mensaje, linkPortal });
    const subject = estado === 'Entrevista' ? 'Te esperamos en tu entrevista — SOCIUS' : 'Novedades sobre tu postulación — SOCIUS';
    emailEnviado = await enviarEmail({ to: postulacion.candidato.email, subject, html });
    logEvent('postulacion.notificacion_email', { postulacionId: postulacion.id, estado, emailEnviado });
  }

  res.json({ ...postulacion, emailEnviado });
});

export default router;
