// Select reutilizable para incluir datos de Candidato en otras queries sin
// arrastrar passwordHash (o cualquier otro campo sensible futuro) al JSON de salida.
export const CANDIDATO_PUBLICO = {
  select: {
    id: true,
    nombre: true,
    apellido: true,
    email: true,
    telefono: true,
    region: true,
    experienciaRango: true,
    disponibilidadPresencial: true,
    cvArchivo: true,
    cvNombreOriginal: true,
  },
};
