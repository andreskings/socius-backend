const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

// Analiza el CV de un candidato contra las búsquedas activas usando Groq.
// El contexto recuperado (búsquedas reales del sistema) se inyecta en el prompt
// para que el modelo elija entre opciones concretas en vez de inventar un cargo.
// Esto es una sugerencia para que un reclutador revise, nunca un filtro automático.
export async function analizarCv({ cvTexto, busquedas }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY no está configurada en el servidor');
  }

  const listaBusquedas = busquedas
    .map(
      (b) =>
        `- id: ${b.id} | posición: ${b.posicion} | práctica: ${b.practica}${
          b.descripcionCarga ? ` | descripción: ${b.descripcionCarga}` : ''
        }`
    )
    .join('\n');

  const prompt = `Sos un asistente de reclutamiento. Tenés el texto de un CV y una lista de
búsquedas laborales abiertas. Tu tarea es sugerir a cuál búsqueda encaja mejor este
candidato, o indicar que ninguna encaja bien.

Búsquedas abiertas:
${listaBusquedas || '(no hay búsquedas abiertas actualmente)'}

CV del candidato:
"""
${cvTexto}
"""

Respondé ÚNICAMENTE con un JSON con esta forma exacta, sin texto adicional:
{"busquedaSugeridaId": "<id de la búsqueda de la lista, o null si ninguna encaja>", "puntaje": <entero 0-100, afinidad con la búsqueda sugerida, 0 si no hay ninguna>, "resumen": "<2-3 frases en español, tono profesional, explicando por qué>"}

Es una sugerencia para que un reclutador humano revise, no una decisión automática.
No inventes búsquedas que no estén en la lista de arriba.`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq respondió ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const contenido = data.choices?.[0]?.message?.content;
  if (!contenido) throw new Error('Respuesta de Groq sin contenido');

  let parsed;
  try {
    parsed = JSON.parse(contenido);
  } catch {
    throw new Error('Groq devolvió un JSON inválido');
  }

  // Nunca confiar ciegamente en el id que devuelve el modelo: si alucinó un id que
  // no está en la lista de búsquedas provistas, se descarta.
  const busquedaValida = busquedas.some((b) => b.id === parsed.busquedaSugeridaId);

  return {
    busquedaSugeridaId: busquedaValida ? parsed.busquedaSugeridaId : null,
    puntaje: Number.isInteger(parsed.puntaje) ? Math.max(0, Math.min(100, parsed.puntaje)) : 0,
    resumen: typeof parsed.resumen === 'string' ? parsed.resumen.slice(0, 1000) : '',
  };
}
