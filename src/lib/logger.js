// Logging de eventos sensibles. Nunca recibe password ni JWT crudos como argumento.
export function logEvent(evento, detalle = {}) {
  const safe = { ...detalle };
  delete safe.password;
  delete safe.token;
  delete safe.passwordHash;
  console.log(`[auth] ${new Date().toISOString()} ${evento}`, safe);
}
