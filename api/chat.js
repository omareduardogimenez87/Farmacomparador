// Asistente: recibe la conversación y devuelve la respuesta de la IA.
// POST /api/chat  { historial: [{ rol: 'usuario' | 'asistente', texto }] }
const { conversar } = require('../lib/ia');
const { responder, leerJson, revisarClave, errorDeIa } = require('../lib/http');

const TURNOS_MAXIMOS = 12;

module.exports = async function chat(req, res) {
  if (req.method !== 'POST') return responder(res, 405, { error: 'Usá POST.' });
  if (!revisarClave(req, res)) return;

  let historial;
  try {
    const cuerpo = await leerJson(req);
    historial = (Array.isArray(cuerpo.historial) ? cuerpo.historial : [])
      .filter((t) => t && (t.rol === 'usuario' || t.rol === 'asistente') && typeof t.texto === 'string' && t.texto.trim())
      .map((t) => ({ rol: t.rol, texto: t.texto.trim().slice(0, 2000) }))
      .slice(-TURNOS_MAXIMOS);
    // La conversación tiene que empezar y terminar con un mensaje de la persona.
    while (historial.length && historial[0].rol !== 'usuario') historial.shift();
  } catch {
    return responder(res, 400, { error: 'El mensaje no se pudo leer.' });
  }
  if (!historial.length || historial[historial.length - 1].rol !== 'usuario') {
    return responder(res, 400, { error: 'Escribí o decí una pregunta.' });
  }

  try {
    responder(res, 200, await conversar(historial));
  } catch (error) {
    errorDeIa(res, error);
  }
};
