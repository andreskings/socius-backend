// Logging de eventos sensibles. Nunca recibe password ni JWT crudos como argumento.
// req es opcional: cuando se pasa, agrega ip y user-agent para poder correlacionar
// actividad sospechosa (ej. muchos login_fallido desde la misma IP).
export function logEvent(evento, detalle = {}, req) {
  const safe = { ...detalle };
  delete safe.password;
  delete safe.token;
  delete safe.passwordHash;
  if (req) {
    safe.ip = req.ip;
    safe.userAgent = req.get?.('user-agent') || undefined;
  }
  console.log(`[auth] ${new Date().toISOString()} ${evento}`, safe);
}
