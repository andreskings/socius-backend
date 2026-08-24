// Valida req.body contra un schema de Zod. En éxito reemplaza req.body por los
// datos ya parseados/normalizados (trim, coerción), así las rutas no repiten
// chequeos de presencia/tipo/longitud.
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error.issues[0].message });
    }
    req.body = result.data;
    next();
  };
}
