// Un "adaptador" por sitio: cada uno sabe cómo preguntarle a su tienda por un
// producto y devuelve los resultados en un formato común:
//   { sitio, nombre, marca, ean, precio, precioLista, stock, url, imagen }

const NAVEGADOR =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
const ESPERA_MAXIMA_MS = 12000;
const MAXIMO_POR_SITIO = 24;

async function pedirJson(url, opciones = {}) {
  const respuesta = await fetch(url, {
    ...opciones,
    headers: { 'User-Agent': NAVEGADOR, Accept: 'application/json', ...(opciones.headers || {}) },
    signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
  });
  if (!respuesta.ok) throw new Error(`El sitio respondió con error ${respuesta.status}`);
  return respuesta.json();
}

// Farmacity, Farmalife, Farmaonline, MásOnline y Vea usan la misma plataforma
// (VTEX), así que comparten el mismo código y solo cambia la dirección.
function buscadorVtex(id, base) {
  return async function (consulta) {
    // Se usa la búsqueda del catálogo y no la "inteligente" de VTEX, porque esa
    // última a veces redirige a una categoría y devuelve cero productos.
    const url =
      `${base}/api/catalog_system/pub/products/search` +
      `?ft=${encodeURIComponent(consulta)}&_from=0&_to=${MAXIMO_POR_SITIO - 1}`;
    const datos = await pedirJson(url);
    return (Array.isArray(datos) ? datos : []).flatMap((producto) => {
      const item = (producto.items || [])[0];
      const oferta = item && item.sellers && item.sellers[0] && item.sellers[0].commertialOffer;
      if (!oferta) return [];
      const imagen = item.images && item.images[0] && item.images[0].imageUrl;
      const link = producto.link || '';
      return [
        {
          sitio: id,
          nombre: producto.productName,
          marca: producto.brand || '',
          ean: item.ean || '',
          precio: oferta.Price,
          // Algunos sitios cargan un "precio anterior" sin sentido (Vea llega a
          // mostrar 80 veces el precio real). Si no es creíble, se ignora.
          precioLista: oferta.ListPrice > oferta.Price && oferta.ListPrice <= oferta.Price * 3 ? oferta.ListPrice : oferta.Price,
          stock: oferta.AvailableQuantity > 0,
          url: link.startsWith('http') ? link : base + link,
          imagen: imagen || '',
        },
      ];
    });
  };
}

async function buscarLaEsquina(consulta) {
  const base = 'https://farmacialaesquina.com.ar';
  const datos = await pedirJson(`${base}/api/catalog/shop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filters: ['shop'], page: 1, limit: MAXIMO_POR_SITIO, search: consulta }),
  });
  const productos = (datos.data && datos.data.shop && datos.data.shop.products) || [];
  return productos.flatMap((producto) => {
    const variante = (producto.variants || [])[0];
    const precio = variante && variante.pvPrice;
    if (!precio) return [];
    const imagen = producto.images && producto.images[0];
    const foto = imagen && (imagen.square || imagen.thumb);
    return [
      {
        sitio: 'laesquina',
        nombre: producto.name,
        marca: (producto.brand && producto.brand.name) || '',
        ean: variante.ean || '',
        precio: precio.price,
        precioLista: precio.prevPrice || precio.price,
        stock: !variante.stock || variante.stock.availability === 'InStock',
        url: `${base}/p/${producto.urlName}/${producto.id}`,
        imagen: (foto && foto.fullUrl) || '',
      },
    ];
  });
}

async function buscarEnaSport(consulta) {
  const base = 'https://www.enasport.com';
  const url =
    `${base}/search/suggest.json?q=${encodeURIComponent(consulta)}` +
    '&resources[type]=product&resources[limit]=10';
  const datos = await pedirJson(url);
  const productos = (datos.resources && datos.resources.results && datos.resources.results.products) || [];
  return productos.map((producto) => {
    const precio = Number(producto.price_min || producto.price);
    const lista = Number(producto.compare_at_price_min) || precio;
    return {
      sitio: 'enasport',
      nombre: producto.title,
      marca: producto.vendor || '',
      // Acá los nombres son de fantasía ("Truemade Whey Protein"); la categoría y las
      // etiquetas permiten encontrarlos buscando "proteina".
      palabrasClave: [producto.type, ...(producto.tags || [])].join(' '),
      ean: '', // este sitio no informa el código de barras
      precio,
      precioLista: Math.max(lista, precio),
      // Cuando hay varios tamaños o sabores, el precio mostrado es el más bajo.
      desde: Number(producto.price_max) > precio,
      stock: producto.available !== false,
      url: base + String(producto.url || '').split('?')[0],
      imagen: producto.image || '',
    };
  });
}

// La Anónima no tiene un servicio de datos público: los productos se leen de la
// misma página de resultados que ve una persona en el navegador.
function atributo(bloque, nombre) {
  const encontrado = bloque.match(new RegExp(`data-${nombre}\\s*=\\s*"([^"]*)"`));
  return encontrado ? decodificarHtml(encontrado[1]).trim() : '';
}

function decodificarHtml(texto) {
  return texto
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

async function buscarLaAnonima(consulta) {
  const base = 'https://www.laanonima.com.ar';
  const respuesta = await fetch(`${base}/buscar/${encodeURIComponent(consulta)}`, {
    headers: { 'User-Agent': NAVEGADOR, Accept: 'text/html' },
    signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
  });
  if (!respuesta.ok) throw new Error(`El sitio respondió con error ${respuesta.status}`);
  const html = await respuesta.text();
  return html
    .split('class="producto-item')
    .slice(1, MAXIMO_POR_SITIO + 1)
    .flatMap((bloque) => {
      const precio = Number(atributo(bloque, 'precio'));
      const enlace = bloque.match(/href="(\/[^"]*\/art_\d+\/)"/);
      const imagen = bloque.match(/data-src="(https:\/\/[^"]+)"/);
      const nombre = atributo(bloque, 'nombre');
      if (!nombre || !precio || !enlace) return [];
      const anterior = Number(atributo(bloque, 'precio_anterior'));
      return [
        {
          sitio: 'laanonima',
          nombre,
          marca: atributo(bloque, 'marca'),
          palabrasClave: atributo(bloque, 'rutacategorias'),
          ean: '', // este sitio no publica el código de barras
          precio,
          precioLista: anterior > precio && anterior <= precio * 3 ? anterior : precio,
          stock: atributo(bloque, 'existencia-super') !== 'N',
          url: base + enlace[1],
          imagen: imagen ? imagen[1] : '',
        },
      ];
    });
}

// Las Mil Novedades (Santiago del Estero) usa WooCommerce, que trae un buscador
// público. Su "SKU" muchas veces es el código de barras del producto.
async function buscarLasMilNovedades(consulta) {
  const base = 'https://lasmilnovedades.com';
  const datos = await pedirJson(
    `${base}/wp-json/wc/store/v1/products?search=${encodeURIComponent(consulta)}&per_page=${MAXIMO_POR_SITIO}`
  );
  return (Array.isArray(datos) ? datos : []).flatMap((producto) => {
    const precios = producto.prices || {};
    const divisor = 10 ** (Number(precios.currency_minor_unit) || 0);
    const precio = Number(precios.price) / divisor;
    const lista = Number(precios.regular_price) / divisor;
    if (!precio) return [];
    const categorias = (producto.categories || []).map((c) => c.name).join(' ');
    return [
      {
        sitio: 'lasmilnovedades',
        nombre: decodificarHtml(producto.name || ''),
        marca: '',
        palabrasClave: decodificarHtml(categorias),
        ean: producto.sku || '',
        precio,
        precioLista: lista > precio && lista <= precio * 3 ? lista : precio,
        stock: producto.is_in_stock !== false,
        url: producto.permalink || base,
        imagen: (producto.images && producto.images[0] && producto.images[0].src) || '',
      },
    ];
  });
}

const SITIOS = [
  { id: 'laesquina', nombre: 'La Esquina', buscar: buscarLaEsquina },
  { id: 'farmacity', nombre: 'Farmacity', buscar: buscadorVtex('farmacity', 'https://www.farmacity.com') },
  { id: 'farmalife', nombre: 'Farmalife', buscar: buscadorVtex('farmalife', 'https://www.farmalife.com.ar') },
  { id: 'farmaonline', nombre: 'Farmaonline', buscar: buscadorVtex('farmaonline', 'https://www.farmaonline.com') },
  { id: 'enasport', nombre: 'ENA Sport', buscar: buscarEnaSport },
  { id: 'masonline', nombre: 'MásOnline', buscar: buscadorVtex('masonline', 'https://www.masonline.com.ar') },
  { id: 'vea', nombre: 'Vea', buscar: buscadorVtex('vea', 'https://www.vea.com.ar') },
  { id: 'laanonima', nombre: 'La Anónima', buscar: buscarLaAnonima },
  { id: 'lasmilnovedades', nombre: 'Las Mil Novedades', buscar: buscarLasMilNovedades },
];

module.exports = { SITIOS };
