// Promociones bancarias y reintegros que las tiendas publican en su web.
// Solo se leen las páginas oficiales de cada tienda; no se usan sitios de cupones.
const NAVEGADOR =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
const ESPERA_MAXIMA_MS = 15000;
// Las promos cambian poco en el día: se guardan 6 horas para no consultar de más.
const DURACION_CACHE_MS = 6 * 60 * 60 * 1000;

const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

function sinAcentos(texto) {
  return String(texto || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function decodificarHtml(texto) {
  return String(texto || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// Devuelve los números de día (0 = domingo) que menciona un texto.
// "Todos los días" o ningún día mencionado se toman como válidos toda la semana.
function diasDelTexto(texto) {
  const t = sinAcentos(texto);
  if (/todos los dias|de lunes a domingo/.test(t)) return [0, 1, 2, 3, 4, 5, 6];
  const rango = t.match(/de (lunes|martes|miercoles|jueves|viernes|sabado|domingo) a (lunes|martes|miercoles|jueves|viernes|sabado|domingo)/);
  if (rango) {
    const desde = DIAS.indexOf(rango[1]);
    const hasta = DIAS.indexOf(rango[2]);
    const dias = [];
    for (let d = desde; ; d = (d + 1) % 7) {
      dias.push(d);
      if (d === hasta || dias.length > 7) break;
    }
    return dias;
  }
  const dias = DIAS.map((dia, i) => (new RegExp(`\\b${dia}s?\\b`).test(t) ? i : -1)).filter((i) => i >= 0);
  return dias.length ? dias : [0, 1, 2, 3, 4, 5, 6];
}

// Solo se muestran las promos que valen en Santiago del Estero.
// Se descartan las que nombran otras ciudades o provincias sin incluir a Santiago,
// y las de bancos o billeteras provinciales de otras provincias.
const RESTRINGIDA_A_UNA_ZONA = new RegExp([
  'solo (en|para)',
  'en las regiones',
  'en las provincias',
  'en la provincia de',
  'pcia\\.? de',
  'exclusiva para las provincias',
  'sucursales( fisicas)?( ubicadas?)? en(?! del pais| todo el pais)',
].join('|'));
const BANCO_DE_OTRA_PROVINCIA = /\bbanco (de |del )?(la )?(santa cruz|santa fe|san juan|chubut|tierra del fuego|cordoba|la pampa|neuquen|entre rios|corrientes|chaco|formosa|la rioja|misiones|salta|jujuy|mendoza|san luis|rio negro|catamarca|tucuman)\b|\bbancor\b|cuenta dni|\bbanco provincia\b/;

function valeEnSantiago(promo) {
  const texto = sinAcentos(`${promo.titulo} ${promo.detalle}`);
  if (/\bsantiago\b|\bsgo\b/.test(texto)) return true;
  if (BANCO_DE_OTRA_PROVINCIA.test(texto)) return false;
  return !RESTRINGIDA_A_UNA_ZONA.test(texto);
}

async function pedirPagina(url) {
  const respuesta = await fetch(url, {
    headers: { 'User-Agent': NAVEGADOR, Accept: 'text/html' },
    signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
  });
  if (!respuesta.ok) throw new Error(`El sitio respondió con error ${respuesta.status}`);
  return respuesta.text();
}

// La Anónima: cada promo es una tarjeta con título, días y condiciones.
function leerLaAnonima(html) {
  return html
    .split('class="promo-card"')
    .slice(1)
    .flatMap((bloque) => {
      const titulo = decodificarHtml((bloque.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1]);
      if (!titulo) return [];
      const botones = [...bloque.matchAll(/rounded-btn"[^>]*>\s*<strong>([^<]+)<\/strong>/g)].map((m) => m[1]);
      const detalle = decodificarHtml((bloque.match(/promo-card-legal[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/) || [])[1]);
      return [{ titulo, detalle, dias: diasDelTexto(botones.length ? botones.join(' ') : `${titulo} ${detalle}`) }];
    });
}

// Farmacity: la página de medios de pago trae una lista con banco, tarjeta y promoción.
function leerFarmacity(html) {
  const texto = html.replace(/\\u002F/g, '/').replace(/\\"/g, '"').replace(/\\n/g, ' ');
  const vistas = new Set();
  return [...texto.matchAll(/\{[^{}]*"Promoción"\s*:\s*"[^"]+"[^{}]*\}/g)].flatMap((m) => {
    let datos;
    try {
      datos = JSON.parse(m[0]);
    } catch {
      return [];
    }
    const promocion = decodificarHtml(datos['Promoción']);
    const medio = [datos.Banco, datos.Tarjeta, datos.Nombre].filter((x) => x && String(x).trim()).map((x) => String(x).trim());
    const clave = `${medio.join('|')}|${promocion}`;
    if (!promocion || vistas.has(clave)) return [];
    vistas.add(clave);
    const donde = datos.Tienda ? ` (${String(datos.Tienda).toLowerCase()})` : '';
    return [{
      titulo: `${[...new Set(medio)].join(' · ') || 'Promoción'}${donde}`,
      detalle: promocion,
      dias: diasDelTexto(promocion),
    }];
  });
}

// Tiendas con promos que la app puede leer, y enlaces oficiales para las demás.
const FUENTES = [
  { id: 'laanonima', nombre: 'La Anónima', url: 'https://www.laanonima.com.ar/empresa/promociones-y-descuentos', leer: leerLaAnonima },
  { id: 'farmacity', nombre: 'Farmacity', url: 'https://www.farmacity.com/farmacity/medios-de-pago', leer: leerFarmacity },
  { id: 'vea', nombre: 'Vea', url: 'https://www.vea.com.ar/descuentos-del-dia' },
  { id: 'masonline', nombre: 'MásOnline', url: 'https://www.masonline.com.ar/promociones-bancarias' },
];

let cache = null;

async function obtenerPromos() {
  if (cache && Date.now() - cache.momento < DURACION_CACHE_MS) return cache.datos;
  const tiendas = await Promise.all(
    FUENTES.map(async (fuente) => {
      const base = { id: fuente.id, nombre: fuente.nombre, url: fuente.url };
      if (!fuente.leer) return { ...base, legible: false, promos: [] };
      try {
        const vistas = new Set();
        const promos = fuente.leer(await pedirPagina(fuente.url)).filter((promo) => {
          const clave = `${promo.titulo}|${promo.detalle}`;
          if (vistas.has(clave)) return false;
          vistas.add(clave);
          return true;
        });
        const enSantiago = promos.filter(valeEnSantiago);
        return { ...base, legible: true, ok: true, promos: enSantiago, deOtrasZonas: promos.length - enSantiago.length };
      } catch (error) {
        return { ...base, legible: true, ok: false, error: error.name === 'TimeoutError' ? 'El sitio tardó demasiado en responder' : error.message, promos: [] };
      }
    })
  );
  const datos = { actualizado: new Date().toISOString(), tiendas };
  // Solo se guarda si todas las tiendas legibles respondieron bien.
  if (tiendas.every((t) => !t.legible || t.ok)) cache = { momento: Date.now(), datos };
  return datos;
}

// Día de la semana en Argentina (0 = domingo), sin depender del reloj del servidor.
function hoyEnArgentina() {
  const nombre = new Intl.DateTimeFormat('es-AR', { weekday: 'long', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  return DIAS.indexOf(sinAcentos(nombre));
}

module.exports = { obtenerPromos, hoyEnArgentina, diasDelTexto, leerLaAnonima, leerFarmacity, valeEnSantiago, DIAS };
