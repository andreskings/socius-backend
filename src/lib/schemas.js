import { z } from 'zod';

const textoOpcional = (max) => z.string().trim().max(max).optional().or(z.literal(''));
const password = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200);

export const registroCandidatoSchema = z.object({
  nombre: z.string().trim().min(1, 'nombre es requerido').max(100),
  apellido: z.string().trim().min(1, 'apellido es requerido').max(100),
  email: z.string().trim().email('email inválido').max(200),
  password,
  telefono: textoOpcional(30),
  region: textoOpcional(100),
  disponibilidadPresencial: textoOpcional(200),
  experienciaRango: textoOpcional(100),
  mensaje: textoOpcional(2000),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('email inválido'),
  actor: z.enum(['candidato', 'usuario']),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'token es requerido'),
  password,
});

export const crearBusquedaSchema = z.object({
  posicion: z.string().trim().min(1, 'posicion es requerida').max(150),
  practica: z.string().trim().min(1, 'practica es requerida').max(100),
  prioridad: z.string().trim().min(1, 'prioridad es requerida').max(50),
  solicitante: z.string().trim().min(1, 'solicitante es requerido').max(150),
  descripcionCarga: textoOpcional(5000),
});

export const crearUsuarioSchema = z.object({
  nombre: z.string().trim().min(1, 'nombre es requerido').max(100),
  email: z.string().trim().email('email inválido').max(200),
  password,
  rol: z.enum(['ADMIN', 'RECLUTADOR']),
});

export const editarUsuarioSchema = z.object({
  nombre: z.string().trim().min(1).max(100).optional(),
  rol: z.enum(['ADMIN', 'RECLUTADOR']).optional(),
  activo: z.boolean().optional(),
  password: password.optional(),
});

export const actualizarPerfilCandidatoSchema = z.object({
  telefono: textoOpcional(30),
  region: textoOpcional(100),
  disponibilidadPresencial: textoOpcional(200),
  experienciaRango: textoOpcional(100),
  mensaje: textoOpcional(2000),
});

export const postularSchema = z.object({
  busquedaId: z.string().trim().min(1).optional().nullable(),
});

export function estadoPostulacionSchema(estados) {
  return z
    .object({
      estado: z.enum(estados),
      fechaEntrevista: z.string().datetime().optional(),
      mensaje: textoOpcional(2000),
    })
    .refine((data) => data.estado !== 'Entrevista' || !!data.fechaEntrevista, {
      message: 'fechaEntrevista es requerida para pasar a Entrevista',
      path: ['fechaEntrevista'],
    });
}
