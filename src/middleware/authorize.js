// Requiere que req.user sea un Usuario staff con alguno de los roles dados.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || req.user.tipo !== 'usuario' || !roles.includes(req.user.rol)) {
      return res.status(403).json({ error: 'No tenés permisos para esta acción' });
    }
    next();
  };
}

// Requiere que req.user sea un Candidato autenticado.
export function requireCandidato(req, res, next) {
  if (!req.user || req.user.tipo !== 'candidato') {
    return res.status(403).json({ error: 'No tenés permisos para esta acción' });
  }
  next();
}

// Permite el acceso al propio candidato dueño del recurso (por :id de la ruta),
// o a cualquier staff (ADMIN/RECLUTADOR). Nunca confía en el body, solo en el token.
export function requireOwnCandidatoOrStaff(paramName = 'id') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (req.user.tipo === 'usuario' && ['ADMIN', 'RECLUTADOR'].includes(req.user.rol)) {
      return next();
    }
    if (req.user.tipo === 'candidato' && req.user.id === req.params[paramName]) {
      return next();
    }
    return res.status(403).json({ error: 'No tenés permisos para esta acción' });
  };
}
