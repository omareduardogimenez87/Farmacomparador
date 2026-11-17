// Asistente con Claude: conversa con la persona y, cuando hace falta un precio,
// usa el mismo comparador que la pantalla de búsqueda. También identifica
// productos a partir de una foto.
const Anthropic = require('@anthropic-ai/sdk');
const { betaTool } = require('@anthropic-ai/sdk/helpers/beta/json-schema');
const { comparar } = require('./comparar');

const MODELO = 'claude-opus-5-5';
// Si el modelo rechaza una consulta, la API la reintenta sola con el modelo de respaldo recomendado.
const RESPALDO = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
const MAXIMO_GRUPOS_PARA_IA = 12;

class IaNoConfigurada extends Error {}
class IaRechazo extends Error {}

function cliente() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new IaNoConfigurada('El asistente todavía no está configurado.');
  }
  return new Anthropic();
}

const INSTRUCCIONES = `Sos el asistente de "Seco y furioso", una app que compara precios entre tiendas online de Argentina, pensada para una familia de Santiago del Estero.

Tiendas: La Esquina, Farmacity, Farmalife y Farmaonline (farmacias), ENA Sport (suplementos deportivos), MásOnline, Vea y La Anónima (supermercados) y Las Mil Novedades (bazar, juguetería, librería, cotillón y electrónica, con precios mayoristas y compra online mínima de $80.000).

Cómo trabajar:
- Para cualquier precio usá la herramienta buscar_precios. Nunca inventes ni estimes precios.
- Buscá con pocas palabras clave: marca y producto, y la presentación si importa (por ejemplo "playadito 1 kg"). Si la primera búsqueda no trae lo que buscan, probá otra variante.
- Dos productos son el mismo con seguridad solo cuando la herramienta los agrupa en la misma tarjeta (mismo código de barras). Si comparás productos de tarjetas distintas, aclaralo.
- Los precios son los que cada web muestra por defecto. En supermercados pueden variar según la sucursal, y no incluyen promociones bancarias ni de obra social.
- Si piden algo que no sea comparar precios o aconsejar sobre compras, respondé brevemente y volvé al tema. No des indicaciones médicas sobre medicamentos: para eso, sugerí consultar al farmacéutico.

Cómo responder:
- En español rioplatense, tuteando, claro y breve: tus respuestas también se escuchan en voz alta.
- Texto plano, sin tablas, sin negritas y sin enlaces; la persona ve los enlaces en la pantalla de búsqueda.
- Precios en pesos con punto de miles, por ejemplo $4.239.`;

// Resume el resultado del comparador para que el modelo lo lea sin gastar de más.
function resumirParaIa(resultado) {
  const tiendas = Object.fromEntries(resultado.sitios.map((s) => [s.id, s.nombre]));
  return JSON.stringify({
    tiendas_que_no_respondieron: resultado.sitios.filter((s) => !s.ok).map((s) => s.nombre),
    productos: resultado.grupos.slice(0, MAXIMO_GRUPOS_PARA_IA).map((grupo) => ({
      producto: grupo.nombre,
      marca: grupo.marca || undefined,
      codigo_de_barras: grupo.ean || undefined,
      precios: grupo.ofertas.map((oferta) => ({
        tienda: tiendas[oferta.sitio] || oferta.sitio,
        nombre_en_la_tienda: oferta.nombre !== grupo.nombre ? oferta.nombre : undefined,
        precio: oferta.precio,
        precio_anterior: oferta.precioLista > oferta.precio ? oferta.precioLista : undefined,
        sin_stock: oferta.stock ? undefined : true,
        precio_minimo_desde: oferta.desde ? true : undefined,
      })),
    })),
    productos_no_mostrados: Math.max(0, resultado.grupos.length - MAXIMO_GRUPOS_PARA_IA),
  });
}

function textoDe(mensaje) {
  if (mensaje.stop_reason === 'refusal') {
    throw new IaRechazo('El asistente no puede responder esa consulta.');
  }
  return mensaje.content
    .filter((bloque) => bloque.type === 'text')
    .map((bloque) => bloque.text)
    .join('\n')
    .trim();
}

// historial: [{ rol: 'usuario' | 'asistente', texto }]. Devuelve la respuesta y
// las búsquedas que hizo, para que la pantalla pueda mostrarlas.
async function conversar(historial) {
  const ia = cliente();
  const busquedas = [];
  const buscarPrecios = betaTool({
    name: 'buscar_precios',
    description:
      'Busca un producto en todas las tiendas de la app y devuelve los precios actuales agrupados por producto. ' +
      'Los productos con el mismo código de barras aparecen juntos, ordenados del más barato al más caro.',
    strict: true,
    inputSchema: {
      type: 'object',
      properties: {
        consulta: {
          type: 'string',
          description: 'Palabras clave del producto, por ejemplo "yerba playadito 1 kg", o un código de barras.',
        },
      },
      required: ['consulta'],
      additionalProperties: false,
    },
    run: async ({ consulta }) => {
      busquedas.push(consulta);
      return resumirParaIa(await comparar(consulta));
    },
  });

  const mensajes = historial.map((turno) => ({
    role: turno.rol === 'asistente' ? 'assistant' : 'user',
    content: turno.texto,
  }));

  const final = await ia.beta.messages.toolRunner({
    model: MODELO,
    max_tokens: 16000,
    output_config: { effort: 'low' },
    system: INSTRUCCIONES,
    tools: [buscarPrecios],
    messages: mensajes,
    max_iterations: 6,
    thread: false,
    ...RESPALDO,
  });
  return { respuesta: textoDe(final), busquedas };
}

const ESQUEMA_FOTO = {
  type: 'object',
  properties: {
    reconocido: { type: 'boolean' },
    producto: { type: 'string' },
    busqueda: { type: 'string' },
    codigo_de_barras: { type: 'string' },
  },
  required: ['reconocido', 'producto', 'busqueda', 'codigo_de_barras'],
  additionalProperties: false,
};

// Recibe una foto (JPEG en base64) y devuelve qué producto es y qué buscar.
async function identificarFoto(imagenBase64) {
  const ia = cliente();
  const mensaje = await ia.beta.messages.create({
    model: MODELO,
    max_tokens: 16000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA_FOTO } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imagenBase64 } },
          {
            type: 'text',
            text:
              'Esta foto la sacó una persona en Argentina para buscar el precio de un producto. Identificá el producto.\n' +
              '- producto: nombre completo como figura en el envase (marca, producto, variedad y tamaño).\n' +
              '- busqueda: entre 2 y 4 palabras clave para buscarlo en una tienda online, sin el tamaño, por ejemplo "yerba playadito suave".\n' +
              '- codigo_de_barras: los números del código de barras si se leen completos y con seguridad; si no, cadena vacía.\n' +
              '- reconocido: false si la foto no muestra un producto identificable; en ese caso, producto y busqueda vacíos.',
          },
        ],
      },
    ],
    ...RESPALDO,
  });
  const datos = JSON.parse(textoDe(mensaje));
  return {
    reconocido: Boolean(datos.reconocido && datos.busqueda),
    producto: datos.producto,
    busqueda: datos.busqueda,
    codigo: /^\d{8,14}$/.test(datos.codigo_de_barras) ? datos.codigo_de_barras : '',
  };
}

module.exports = { conversar, identificarFoto, IaNoConfigurada, IaRechazo, resumirParaIa };
