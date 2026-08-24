import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/auth.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { crearUsuarioSchema, editarUsuarioSchema } from '../lib/schemas.js';
import { logEvent } from '../lib/logger.js';

const router = Router();

function serialize(usuario) {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
    activo: usuario.activo,
    createdAt: usuario.createdAt,
  };
}

router.use(authenticate, requireRole('ADMIN'));

router.get('/', async (req, res) => {
  const usuarios = await prisma.usuario.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(usuarios.map(serialize));
});

router.post('/', validate(crearUsuarioSchema), async (req, res) => {
  const { nombre, email, password, rol } = req.body;
  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) return res.status(409).json({ error: 'Ya existe un usuario con ese correo' });

  const passwordHash = await hashPassword(password);
  const usuario = await prisma.usuario.create({ data: { nombre, email, passwordHash, rol } });
  logEvent('usuario.creado', { usuarioId: usuario.id, rol, creadoPor: req.user.id });
  res.status(201).json(serialize(usuario));
});

router.patch('/:id', validate(editarUsuarioSchema), async (req, res) => {
  const { nombre, rol, activo, password } = req.body;
  const data = {};
  if (nombre !== undefined) data.nombre = nombre;
  if (rol !== undefined) data.rol = rol;
  if (activo !== undefined) data.activo = activo;
  if (password) data.passwordHash = await hashPassword(password);

  const usuario = await prisma.usuario.update({ where: { id: req.params.id }, data }).catch(() => null);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  logEvent('usuario.editado', { usuarioId: usuario.id, editadoPor: req.user.id });
  res.json(serialize(usuario));
});

// Soft-delete: desactiva la cuenta en vez de borrarla (preserva historial de auditoría).
router.delete('/:id', async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'No podés desactivar tu propia cuenta' });
  }
  const usuario = await prisma.usuario.update({ where: { id: req.params.id }, data: { activo: false } }).catch(() => null);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  logEvent('usuario.desactivado', { usuarioId: usuario.id, desactivadoPor: req.user.id });
  res.json({ ok: true });
});

export default router;
