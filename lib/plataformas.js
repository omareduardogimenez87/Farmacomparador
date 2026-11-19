// Adaptadores por plataforma de comercio electrónico. Muchas tiendas usan la misma
// plataforma (VTEX, Shopify, Tiendanube, Magento o Salesforce), así que un mismo
// adaptador sirve para todas ellas: solo cambia la dirección de la tienda.
// Todos devuelven productos en el formato común de la app:
//   { sitio, nombre, marca, ean, eans, precio, precioLista, stock, url, imagen }

const NAVEGADOR =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
const ESPERA_MAXIMA_MS = 12000;
const MAXIMO_POR_SITIO = 24;

async function pedir(url, opciones = {}, tipo = 'json') {
  const respuesta = await fetch(url, {
    ...opciones,
    headers: {
      'User-Agent': NAVEGADOR,
      Accept: tipo === 'json' ? 'application/json' : 'text/html',
      ...(opciones.headers || {}),
    },
    signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
  });
  if (!respuesta.ok) throw new Error(`El sitio respondió con error ${respuesta.status}`);
  return tipo === 'json' ? respuesta.json() : respuesta.text();
}
const pedirJson = (url, opciones) => pedir(url, opciones, 'json');
const pedirHtml = (url, opciones) => pedir(url, opciones, 'html');

function decodificarHtml(texto) {
  return String(texto || '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// Algunos sitios cargan un "precio anterior" sin sentido (Vea llega a mostrar
// 80 veces el precio real). Si no es creíble, se usa el precio actual.
function precioAnterior(anterior, precio) {
  const valor = Number(anterior);
  return valor > precio && valor <= precio * 3 ? valor : precio;
}

function absoluta(base, direccion) {
  if (!direccion) return '';
  if (direccion.startsWith('//')) return 'https:' + direccion;
  if (/^https?:\/\//.test(direccion)) return direccion;
  return base + (direccion.startsWith('/') ? '' : '/') + direccion;
}

// ---------- Promos por cantidad (2x1, 3x2, 2da al 50%...) ----------
// Las tiendas VTEX arman colecciones con nombres como "Ofertas 2x1" o "PROMO 2DA AL 70".
// Los nombres que empiezan con "Hasta" no sirven: no dicen cuánto aplica a cada producto.
function unidadesDePromo(nombreColeccion) {
  const t = String(nombreColeccion || '').toLowerCase();
  if (/^\s*hasta\b/.test(t)) return 0;
  const nxm = t.match(/\b([2-6])\s*x\s*([1-5])\b(?!\s*(?:cm|mm|m|ml|lt?|kg|gr?|cc)\b)/); // "6x4 cm" es una medida, no una promo
  if (nxm && Number(nxm[2]) < Number(nxm[1])) return Number(nxm[1]);
  if (/\b(2\s*d[oa]|segund[oa])\b|\b2da\s*\d|\b2do\s*\d/.test(t)) return 2;
  return 0;
}

// El simulador de carrito de VTEX devuelve el precio final de N unidades con las
// promos ya aplicadas. Es la forma segura de saber si la promo existe de verdad.
async function precioPorUnidadSimulado(base, item, vendedor, cantidad) {
  const respuesta = await fetch(`${base}/api/checkout/pub/orderForms/simulation`, {
    method: 'POST',
    headers: { 'User-Agent': NAVEGADOR, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ id: item, quantity: cantidad, seller: vendedor }], country: 'ARG' }),
    signal: AbortSignal.timeout(6000),
  });
  if (!respuesta.ok) return null;
  const datos = await respuesta.json();
  if (!datos.items || !datos.items.length) return null;
  const totales = Object.fromEntries((datos.totals || []).map((t) => [t.id, t.value / 100]));
  const total = (totales.Items || 0) + (totales.Discounts || 0);
  return total > 0 ? total / cantidad : null;
}

const SIMULACIONES_POR_TIENDA = 8;

// Devuelve los productos sin los datos internos que solo sirven para simular.
async function sumarPromosPorCantidad(base, internos) {
  const candidatos = internos.filter((x) => x.producto.stock && x.unidades).slice(0, SIMULACIONES_POR_TIENDA);
  await Promise.all(candidatos.map(async (x) => {
    try {
      const porUnidad = await precioPorUnidadSimulado(base, x.item, x.vendedor, x.unidades);
      // Solo cuenta si de verdad baja el precio (al menos un 1%).
      if (porUnidad && porUnidad < x.producto.precio * 0.99) {
        x.producto.promoCantidad = { unidades: x.unidades, precioUnidad: Math.round(porUnidad * 100) / 100, texto: x.texto };
      }
    } catch {
      // Sin simulación no se muestra la promo: mejor no prometer un precio que no está confirmado.
    }
  }));
  return internos.map((x) => x.producto);
}

// ---------- VTEX ----------
// Farmacity, Vea, Sporting, Topper y muchas más. Se usa la búsqueda del catálogo y
// no la "inteligente", porque esa a veces redirige a una categoría y no trae nada.
// Primero se usa la "búsqueda inteligente", la misma que usa la página de cada tienda:
// entiende mejor qué se busca ("leche" trae leches y no alfajores de dulce de leche).
// Si no trae nada (a veces redirige a una categoría, como "actron" en Farmacity) o la
// tienda no la tiene, se usa la búsqueda del catálogo.
async function productosVtex(base, consulta) {
  try {
    const inteligente = await pedirJson(
      `${base}/api/io/_v/api/intelligent-search/product_search/?query=${encodeURIComponent(consulta)}&count=${MAXIMO_POR_SITIO}&page=1&locale=es-AR`
    );
    if (inteligente && Array.isArray(inteligente.products) && inteligente.products.length) return inteligente.products;
  } catch {
    // Sin búsqueda inteligente: se sigue con la del catálogo.
  }
  const catalogo = await pedirJson(`${base}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(consulta)}&_from=0&_to=${MAXIMO_POR_SITIO - 1}`);
  return Array.isArray(catalogo) ? catalogo : [];
}

// Las dos búsquedas devuelven las colecciones en formatos distintos.
function nombresDeColecciones(colecciones) {
  if (Array.isArray(colecciones)) return colecciones.map((c) => (c && c.name) || '').filter(Boolean);
  return Object.values(colecciones || {});
}

// Talles con stock. La búsqueda inteligente los trae como
// variations: [{ name: 'Talle', values: ['S'] }] y la del catálogo como
// variations: ['Talle'] más item.Talle = ['S'].
function tallesDisponibles(items) {
  const talles = new Set();
  for (const { item, oferta } of items) {
    if (!(oferta.AvailableQuantity > 0)) continue;
    for (const v of item.variations || []) {
      const nombre = typeof v === 'string' ? v : v && v.name;
      const valores = typeof v === 'string' ? item[v] : v && v.values;
      if (!/talle/i.test(nombre || '')) continue;
      for (const valor of valores || []) talles.add(normalizarTalle(valor));
    }
  }
  return talles.size ? [...talles] : undefined;
}

// "L (9-12 meses)" -> "L"; "s" -> "S"; "38" -> "38".
function normalizarTalle(valor) {
  return String(valor || '').trim().split(/[\s(]/)[0].toUpperCase();
}

function vtex(id, base) {
  return async function buscar(consulta) {
    const datos = await productosVtex(base, consulta);
    const internos = datos.flatMap((producto) => {
      // Cada talle o presentación es un "item" con su propio código de barras.
      // Se toma el precio más bajo entre los que tienen stock.
      const items = (producto.items || [])
        .map((item) => ({ item, oferta: item.sellers && item.sellers[0] && item.sellers[0].commertialOffer }))
        .filter((x) => x.oferta && x.oferta.Price > 0);
      if (!items.length) return [];
      const conStock = items.filter((x) => x.oferta.AvailableQuantity > 0);
      const elegido = (conStock.length ? conStock : items).reduce((a, b) => (b.oferta.Price < a.oferta.Price ? b : a));
      const imagen = elegido.item.images && elegido.item.images[0] && elegido.item.images[0].imageUrl;
      const precios = new Set(items.map((x) => x.oferta.Price));
      const promo = nombresDeColecciones(producto.productClusters).map((n) => [n, unidadesDePromo(n)]).find(([, u]) => u > 0);
      return [{
        item: elegido.item.itemId,
        vendedor: (elegido.item.sellers[0] && elegido.item.sellers[0].sellerId) || '1',
        unidades: promo ? promo[1] : 0,
        texto: promo ? promo[0].trim() : '',
        producto: {
        sitio: id,
        nombre: producto.productName,
        marca: producto.brand || '',
        // Las categorías ayudan a saber qué es: "/Indumentaria/Remeras/Mujer/".
        palabrasClave: (producto.categories || []).join(' ').replace(/\//g, ' '),
        talles: tallesDisponibles(items),
        ean: elegido.item.ean || '',
        // Para unir el mismo producto entre tiendas se usan los códigos de las variantes
        // con el mismo precio (talles de ropa). Las de otro precio son otro tamaño
        // (un perfume de 50 ml y uno de 100 ml) y no se mezclan.
        eans: items.filter((x) => x.oferta.Price === elegido.oferta.Price).map((x) => x.item.ean).filter(Boolean),
        precio: elegido.oferta.Price,
        precioLista: precioAnterior(elegido.oferta.ListPrice, elegido.oferta.Price),
        desde: precios.size > 1,
        stock: conStock.length > 0,
        url: absoluta(base, producto.link || ''),
        imagen: imagen || '',
        },
      }];
    });
    return sumarPromosPorCantidad(base, internos);
  };
}

// ---------- Shopify ----------
// ENA Sport, Crocs, Kappa, Decathlon, Columbia, Marathon, Reebok y Briganti.
function shopify(id, base) {
  return async function buscar(consulta) {
    const url = `${base}/search/suggest.json?q=${encodeURIComponent(consulta)}&resources[type]=product&resources[limit]=10`;
    const datos = await pedirJson(url);
    const productos = (datos.resources && datos.resources.results && datos.resources.results.products) || [];
    return productos.flatMap((producto) => {
      const precio = Number(producto.price_min || producto.price);
      if (!precio) return [];
      return [{
        sitio: id,
        nombre: decodificarHtml(producto.title),
        marca: producto.vendor || '',
        // Algunas tiendas usan nombres de fantasía: la categoría y las etiquetas ayudan a encontrarlos.
        palabrasClave: [producto.type, ...(producto.tags || [])].join(' '),
        ean: '',
        precio,
        precioLista: precioAnterior(producto.compare_at_price_min, precio),
        desde: Number(producto.price_max) > precio,
        stock: producto.available !== false,
        url: base + String(producto.url || '').split('?')[0],
        imagen: absoluta(base, producto.image || ''),
      }];
    });
  };
}

// ---------- Fichas estándar de producto (schema.org) ----------
// Tiendanube y Puma incluyen en la página de resultados una ficha de cada producto
// en un formato estándar que también leen Google y otros buscadores.
function leerFichasDeProducto(html) {
  const fichas = [];
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let datos;
    try {
      datos = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const pendientes = Array.isArray(datos) ? [...datos] : [datos];
    while (pendientes.length) {
      const x = pendientes.shift();
      if (!x || typeof x !== 'object') continue;
      if (x['@type'] === 'Product') fichas.push(x);
      if (Array.isArray(x['@graph'])) pendientes.push(...x['@graph']);
      if (Array.isArray(x.itemListElement)) pendientes.push(...x.itemListElement.map((e) => e.item || e));
    }
  }
  return fichas;
}

function fichas(id, base, rutaBusqueda) {
  return async function buscar(consulta) {
    const html = await pedirHtml(`${base}${rutaBusqueda}${encodeURIComponent(consulta)}`);
    return leerFichasDeProducto(html).slice(0, MAXIMO_POR_SITIO).flatMap((ficha) => {
      const oferta = Array.isArray(ficha.offers) ? ficha.offers[0] : ficha.offers || {};
      const precio = Number(oferta.price || oferta.lowPrice);
      if (!precio || !ficha.name) return [];
      const imagen = Array.isArray(ficha.image) ? ficha.image[0] : ficha.image;
      const marca = typeof ficha.brand === 'object' && ficha.brand ? ficha.brand.name : ficha.brand;
      return [{
        sitio: id,
        nombre: decodificarHtml(ficha.name),
        marca: marca || '',
        ean: ficha.gtin13 || ficha.gtin || '',
        precio,
        precioLista: precio,
        stock: !/OutOfStock/i.test(oferta.availability || ''),
        url: absoluta(base, ficha.url || oferta.url || ''),
        imagen: absoluta(base, typeof imagen === 'object' && imagen ? imagen.url : imagen || ''),
      }];
    });
  };
}
const tiendanube = (id, base) => fichas(id, base, '/search/?q=');

// ---------- Magento ----------
// Con servicio de consultas público (DC Shoes, Burgues, Go Store).
function magento(id, base) {
  const campos =
    'items{name sku url_key url_suffix stock_status small_image{url} ' +
    'price_range{minimum_price{final_price{value} regular_price{value}}}}';
  return async function buscar(consulta) {
    const busqueda = `{products(search:${JSON.stringify(consulta)},pageSize:${MAXIMO_POR_SITIO}){${campos}}}`;
    const datos = await pedirJson(`${base}/graphql?query=${encodeURIComponent(busqueda)}`, { headers: { 'Content-Type': 'application/json' } });
    const items = (datos.data && datos.data.products && datos.data.products.items) || [];
    return items.flatMap((p) => {
      const precios = p.price_range && p.price_range.minimum_price;
      const precio = precios && precios.final_price && Number(precios.final_price.value);
      if (!precio) return [];
      return [{
        sitio: id,
        nombre: decodificarHtml(p.name),
        marca: '',
        ean: p.sku || '',
        precio,
        precioLista: precioAnterior(precios.regular_price && precios.regular_price.value, precio),
        stock: p.stock_status !== 'OUT_OF_STOCK',
        url: `${base}/${p.url_key}${p.url_suffix || ''}`,
        imagen: (p.small_image && p.small_image.url) || '',
      }];
    });
  };
}

// Sin servicio de consultas: se lee la página de resultados (Solo Urbano, Solo Deportes).
function magentoPagina(id, base) {
  return async function buscar(consulta) {
    const html = await pedirHtml(`${base}/catalogsearch/result/?q=${encodeURIComponent(consulta)}`);
    return html.split('class="product-item-info').slice(1, MAXIMO_POR_SITIO + 1).flatMap((bloque) => {
      const enlace = bloque.match(/class="product-item-link"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const final = bloque.match(/data-price-amount="([\d.]+)"\s+data-price-type="finalPrice"/);
      if (!enlace || !final) return [];
      const anterior = bloque.match(/data-price-amount="([\d.]+)"\s+data-price-type="oldPrice"/);
      const imagen = bloque.match(/class="product-image-photo"[^>]*src="([^"]+)"/);
      const sku = bloque.match(/data-product-sku="([^"]+)"/);
      const precio = Number(final[1]);
      return [{
        sitio: id,
        nombre: decodificarHtml(enlace[2]),
        marca: '',
        ean: sku ? sku[1] : '',
        precio,
        precioLista: precioAnterior(anterior && anterior[1], precio),
        stock: !/out-of-stock|agotado/i.test(bloque.slice(0, 4000)),
        url: enlace[1],
        imagen: imagen ? decodificarHtml(imagen[1]) : '',
      }];
    });
  };
}

// ---------- Salesforce Commerce Cloud ----------
// Grupo Dexter (Dexter, Moov, Stock Center) y New Balance: se lee la página de resultados.
function salesforce(id, base, rutaBusqueda = '/buscar?q=') {
  return async function buscar(consulta) {
    const html = await pedirHtml(`${base}${rutaBusqueda}${encodeURIComponent(consulta)}`);
    return html.split('class="product-tile').slice(1, MAXIMO_POR_SITIO + 1).flatMap((bloque) => {
      const enlace = bloque.match(/class="link"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const venta = bloque.match(/class="sales">\s*<span class="value"\s+content="([\d.]+)"/);
      if (!enlace || !venta) return [];
      const lista = bloque.match(/strike-through list">\s*<span class="value"\s+content="([\d.]+)"/);
      const imagen = bloque.match(/class="tile-image[^"]*"[^>]*?src="([^"]+)"/) || bloque.match(/<img[^>]+src="([^"]+\.(?:jpe?g|png|webp)[^"]*)"/i);
      const precio = Number(venta[1]);
      return [{
        sitio: id,
        nombre: decodificarHtml(enlace[2]),
        marca: '',
        ean: '',
        precio,
        precioLista: precioAnterior(lista && lista[1], precio),
        stock: !/agotado|sin stock/i.test(bloque.slice(0, 6000)),
        url: absoluta(base, decodificarHtml(enlace[1])),
        imagen: absoluta(base, imagen ? decodificarHtml(imagen[1]) : ''),
      }];
    });
  };
}

// ---------- PrestaShop ----------
// Encanto Importaciones: la búsqueda devuelve los productos en formato de datos.
function prestashop(id, base) {
  return async function buscar(consulta) {
    const datos = await pedirJson(`${base}/busqueda?s=${encodeURIComponent(consulta)}&resultsPerPage=${MAXIMO_POR_SITIO}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    return (datos.products || []).flatMap((p) => {
      const precio = Number(p.price_amount);
      if (!precio) return [];
      const imagen = p.cover && (p.cover.medium || p.cover.small || p.cover.large);
      return [{
        sitio: id,
        nombre: decodificarHtml(p.name),
        marca: p.manufacturer_name || '',
        palabrasClave: p.category_name || '',
        ean: p.ean13 || '',
        precio,
        precioLista: precioAnterior(p.regular_price_amount, precio),
        stock: p.add_to_cart_url !== null && p.quantity !== 0,
        url: p.url || base,
        imagen: (imagen && imagen.url) || '',
      }];
    });
  };
}

// ---------- Odoo ----------
// Ximaro: se lee la página de resultados de su tienda.
function odoo(id, base) {
  return async function buscar(consulta) {
    const html = await pedirHtml(`${base}/shop?search=${encodeURIComponent(consulta)}`);
    return html.split('oe_product_cart').slice(1, MAXIMO_POR_SITIO + 1).flatMap((bloque) => {
      const nombre = bloque.match(/itemprop="name"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const precio = bloque.match(/itemprop="price"[^>]*>([\d.]+)</);
      if (!nombre || !precio) return [];
      const imagen = bloque.match(/<img[^>]+src="([^"]+)"/);
      return [{
        sitio: id,
        nombre: decodificarHtml(nombre[2]),
        marca: '',
        ean: '',
        precio: Number(precio[1]),
        precioLista: Number(precio[1]),
        stock: !/agotado|sin stock|out of stock/i.test(bloque),
        url: absoluta(base, decodificarHtml(nombre[1]).split('?')[0]),
        imagen: imagen ? absoluta(base, decodificarHtml(imagen[1])) : '',
      }];
    });
  };
}

module.exports = {
  prestashop, odoo,
  normalizarTalle,
  unidadesDePromo,
  vtex, shopify, tiendanube, fichas, magento, magentoPagina, salesforce,
  pedirJson, pedirHtml, decodificarHtml, precioAnterior, leerFichasDeProducto,
  NAVEGADOR, ESPERA_MAXIMA_MS, MAXIMO_POR_SITIO,
};
