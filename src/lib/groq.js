const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

const VEREDICTOS_VALIDOS = ['Cumple los requisitos', 'Cumple parcialmente', 'No cumple los requisitos'];

// Analiza el CV de un candidato como lo haría un filtro ATS: contra los requisitos
// concretos de las búsquedas activas (no una impresión general del CV). El contexto
// recuperado (búsquedas reales del sistema, con su descripción de requisitos) se
// inyecta en el prompt para que el modelo compare contra opciones reales en vez de
// inventar un cargo o evaluar "en el aire". Esto es una sugerencia para que un
// reclutador revise, nunca un filtro automático que descarte candidatos.
export async function analizarCv({ cvTexto, busquedas }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY no está configurada en el servidor');
  }

  const listaBusquedas = busquedas
    .map(
      (b) =>
        `- id: ${b.id} | posición: ${b.posicion} | práctica: ${b.practica}\n  requisitos: ${
          b.descripcionCarga || '(el reclutador no describió requisitos específicos para esta búsqueda)'
        }`
    )
    .join('\n');

  const prompt = `Actuás como un filtro ATS (Applicant Tracking System) de una plataforma de
reclutamiento. Tenés el texto de un CV y una lista de búsquedas laborales abiertas,
cada una con sus requisitos. Tu tarea es evaluar, como lo haría un reclutador
técnico exigente, si el candidato cumple los requisitos de la búsqueda a la que
mejor encaja — no una impresión general, una evaluación puntual contra requisitos.

Búsquedas abiertas:
${listaBusquedas || '(no hay búsquedas abiertas actualmente)'}

CV del candidato:
"""
${cvTexto}
"""

Pasos a seguir:
1. Elegí la búsqueda a la que el candidato encaja mejor (o ninguna, si no encaja con nada).
2. Si esa búsqueda tiene requisitos descritos, compará explícitamente los requisitos
   contra lo que aparece en el CV (habilidades, años de experiencia, tecnologías,
   certificaciones, etc.). Si no tiene requisitos descritos, evaluá contra lo
   esperable para ese tipo de posición según su práctica/área.
3. Definí un veredicto: "Cumple los requisitos" (encaja bien, sin gaps importantes),
   "Cumple parcialmente" (encaja pero con gaps relevantes), o "No cumple los
   requisitos" (no encaja o los gaps son excluyentes).

Respondé ÚNICAMENTE con un JSON con esta forma exacta, sin texto adicional:
{"busquedaSugeridaId": "<id de la búsqueda de la lista, o null si ninguna encaja>", "puntaje": <entero 0-100, afinidad con la búsqueda sugerida, 0 si no hay ninguna>, "veredicto": "<uno de: Cumple los requisitos | Cumple parcialmente | No cumple los requisitos>", "resumen": "<texto en español, tono profesional, con esta estructura en líneas separadas por \\n: 'Coincide: ' seguido de 2-4 puntos clave que sí cumple; 'Falta: ' seguido de lo que no cumple o no se pudo confirmar (si no falta nada, decilo); y una última línea con la justificación del veredicto en 1 frase>"}

Es una sugerencia para que un reclutador humano revise, nunca una decisión
automática. No inventes búsquedas que no estén en la lista de arriba. Sé concreto
y basate solo en lo que efectivamente aparece en el CV, no asumas.`;

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

  // Nunca confiar ciegamente en lo que devuelve el modelo: si alucinó un id que no
  // está en la lista de búsquedas provistas, o un veredicto fuera del set permitido,
  // se descarta/normaliza en vez de guardarlo tal cual.
  const busquedaValida = busquedas.some((b) => b.id === parsed.busquedaSugeridaId);
  const veredictoValido = VEREDICTOS_VALIDOS.includes(parsed.veredicto);

  return {
    busquedaSugeridaId: busquedaValida ? parsed.busquedaSugeridaId : null,
    puntaje: Number.isInteger(parsed.puntaje) ? Math.max(0, Math.min(100, parsed.puntaje)) : 0,
    veredicto: veredictoValido ? parsed.veredicto : null,
    resumen: typeof parsed.resumen === 'string' ? parsed.resumen.slice(0, 1500) : '',
  };
}
