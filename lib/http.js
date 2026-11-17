// Utilidades compartidas por las funciones de /api.
const Anthropic = require('@anthropic-ai/sdk');
const { IaNoConfigurada, IaRechazo } = require('./ia');

const TAMANO_MAXIMO = 4 * 1024 * 1024;

function responder(res, estado, datos) {
  res.statusCode = estado;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(datos));
}

// En Vercel el cuerpo ya llega leído; en el servidor local hay que leerlo.
async function leerJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  let texto = '';
  for await (const parte of req) {
    texto += parte;
    if (texto.length > TAMANO_MAXIMO) throw new Error('La foto es demasiado grande.');
  }
  return JSON.parse(texto || '{}');
}

// La app es pública: la clave evita que cualquiera con el enlace gaste el saldo de la IA.
// Publicada en Vercel, sin CLAVE_IA configurada la IA queda apagada.
function revisarClave(req, res) {
  const clave = process.env.CLAVE_IA;
  if (!clave) {
    if (!process.env.VERCEL) return true; // en la computadora, para probar
    responder(res, 503, { error: 'Falta configurar la clave del asistente (CLAVE_IA) en Vercel.' });
    return false;
  }
  if (req.headers['x-clave'] === clave) return true;
  responder(res, 401, { error: 'La clave del asistente no es correcta.' });
  return false;
}

function errorDeIa(res, error) {
  if (error instanceof IaNoConfigurada) {
    return responder(res, 503, { error: 'El asistente todavía no está configurado (falta la clave de la API de Claude).' });
  }
  if (error instanceof IaRechazo) {
    return responder(res, 200, { error: 'El asistente no puede responder esa consulta. Probá preguntarlo de otra forma.' });
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return responder(res, 503, { error: 'La clave de la API de Claude no es válida. Revisala en Vercel.' });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return responder(res, 429, { error: 'El asistente está ocupado. Probá de nuevo en un minuto.' });
  }
  if (error instanceof Anthropic.APIError) {
    // Sin saldo en la cuenta de la API, o un problema momentáneo del servicio.
    console.error('Error de la API de Claude', error.status, error.message);
    return responder(res, 502, { error: 'El asistente no respondió. Si sigue pasando, revisá el saldo de la cuenta de la API de Claude.' });
  }
  console.error(error);
  return responder(res, 500, { error: 'Algo falló en el asistente. Probá de nuevo.' });
}

module.exports = { responder, leerJson, revisarClave, errorDeIa };
