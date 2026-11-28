// Lista de tiendas. Cada una indica su rubro y cómo se la consulta: la mayoría usa
// un adaptador por plataforma (lib/plataformas.js); unas pocas tienen uno propio.
const {
  vtex, shopify, tiendanube,
  pedirJson, pedirHtml, decodificarHtml, precioAnterior, MAXIMO_POR_SITIO,
} = require('./plataformas');

const RUBROS = [
  { id: 'farmacia', nombre: 'Farmacias' },
  { id: 'super', nombre: 'Supermercados' },
  { id: 'deportes', nombre: 'Deportes y marcas' },
  { id: 'bazar', nombre: 'Bazar y juguetería' },
  { id: 'electro', nombre: 'Electro, tecnología y hogar' },
];

// ---------- Tiendas con adaptador propio ----------

// Drubbit: la plataforma de Farmacia La Esquina.
const drubbit = (id, base) => async function buscar(consulta) {
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
    return [{
      sitio: id,
      nombre: producto.name,
      marca: (producto.brand && producto.brand.name) || '',
      ean: variante.ean || '',
      precio: precio.price,
      precioLista: precio.prevPrice || precio.price,
      stock: !variante.stock || variante.stock.availability === 'InStock',
      url: `${base}/p/${producto.urlName}/${producto.id}`,
      imagen: (foto && foto.fullUrl) || '',
    }];
  });
};

// La Anónima no tiene un servicio de datos público: los productos se leen de la
// misma página de resultados que ve una persona en el navegador.
function atributo(bloque, nombre) {
  const encontrado = bloque.match(new RegExp(`data-${nombre}\\s*=\\s*"([^"]*)"`));
  return encontrado ? decodificarHtml(encontrado[1]) : '';
}

async function buscarLaAnonima(consulta) {
  const base = 'https://www.laanonima.com.ar';
  const html = await pedirHtml(`${base}/buscar/${encodeURIComponent(consulta)}`);
  return html.split('class="producto-item').slice(1, MAXIMO_POR_SITIO + 1).flatMap((bloque) => {
    const precio = Number(atributo(bloque, 'precio'));
    const enlace = bloque.match(/href="(\/[^"]*\/art_\d+\/)"/);
    const imagen = bloque.match(/data-src="(https:\/\/[^"]+)"/);
    const nombre = atributo(bloque, 'nombre');
    if (!nombre || !precio || !enlace) return [];
    // Precio "Plus": "Llevando 2, pagás $6.060 c/u".
    const plus = bloque.match(/class="precio plus"[\s\S]{0,200}?<span>\s*\$\s*([\d.]+)(?:<span class="decimal">,(\d+))?[\s\S]{0,400}?Llevando\s+(\d+)/);
    const precioPlus = plus ? Number(plus[1].replace(/\./g, '') + '.' + (plus[2] || '0')) : 0;
    const promoCantidad = precioPlus && precioPlus < precio
      ? { unidades: Number(plus[3]), precioUnidad: precioPlus, texto: `Llevando ${plus[3]}, pagás $${plus[1]} c/u` }
      : undefined;
    return [{
      sitio: 'laanonima',
      promoCantidad,
      nombre,
      marca: atributo(bloque, 'marca'),
      palabrasClave: atributo(bloque, 'rutacategorias'),
      ean: '', // este sitio no publica el código de barras
      precio,
      precioLista: precioAnterior(atributo(bloque, 'precio_anterior'), precio),
      stock: atributo(bloque, 'existencia-super') !== 'N',
      url: base + enlace[1],
      imagen: imagen ? imagen[1] : '',
    }];
  });
}

// Las Mil Novedades (Santiago del Estero) usa WooCommerce, que trae un buscador
// público. Su "SKU" muchas veces es el código de barras del producto.
const woocommerce = (id, base) => async function buscar(consulta) {
  const datos = await pedirJson(`${base}/wp-json/wc/store/v1/products?search=${encodeURIComponent(consulta)}&per_page=${MAXIMO_POR_SITIO}`);
  return (Array.isArray(datos) ? datos : []).flatMap((producto) => {
    const precios = producto.prices || {};
    const divisor = 10 ** (Number(precios.currency_minor_unit) || 0);
    const precio = Number(precios.price) / divisor;
    if (!precio) return [];
    return [{
      sitio: id,
      nombre: decodificarHtml(producto.name || ''),
      marca: '',
      palabrasClave: decodificarHtml((producto.categories || []).map((c) => c.name).join(' ')),
      ean: producto.sku || '',
      idTienda: producto.id,
      precio,
      precioLista: precioAnterior(Number(precios.regular_price) / divisor, precio),
      stock: producto.is_in_stock !== false,
      url: producto.permalink || base,
      imagen: (producto.images && producto.images[0] && producto.images[0].src) || '',
    }];
  });
};

// Import Cell Sgo (Santiago del Estero): tienda propia, sin https. Su buscador devuelve
// cada producto con 4 precios; precio4 es el minorista. stock es el del depósito y
// stock2 el de la sucursal de La Banda.
async function buscarImportCell(consulta) {
  const base = 'http://importcellsgo.ddns.net/tienda';
  const datos = await pedirJson(`${base}/search.php?query=${encodeURIComponent(consulta)}`);
  return (Array.isArray(datos) ? datos : []).slice(0, MAXIMO_POR_SITIO).flatMap((p) => {
    const precio = Number(p.precio4);
    if (!precio || !p.descripcion) return [];
    const codigo = String(p.codigo1 || '');
    return [{
      sitio: 'importcell',
      nombre: decodificarHtml(p.descripcion).replace(/\s*\(GARANT[IÍ]A:[^)]*\)\s*$/i, ''),
      marca: '',
      ean: /^\d{8,14}$/.test(codigo) ? codigo : '',
      precio,
      precioLista: precio,
      stock: (Number(p.stock) || 0) + (Number(p.stock2) || 0) > 0,
      // "?c=" abre la ficha de ese producto en su tienda.
      url: codigo ? `${base}/index.php?c=${encodeURIComponent(codigo)}` : `${base}/index.php`,
      imagen: '',
    }];
  });
}

// ---------- Lista de tiendas ----------
// [id, nombre, rubro, adaptador, extras]
// extras.reputacion: nombre de la tienda en public/reputacion-tiendas.json, cuando difiere.
// extras.aviso: texto que se muestra junto a cada precio de esa tienda.
const T = (id, nombre, rubro, buscar, extras = {}) => ({ id, nombre, rubro, buscar, ...extras });

const SITIOS = [
  // Farmacias
  T('laesquina', 'La Esquina', 'farmacia', drubbit('laesquina', 'https://farmacialaesquina.com.ar'), { reputacion: 'Farmacia La Esquina' }),
  T('farmacity', 'Farmacity', 'farmacia', vtex('farmacity', 'https://www.farmacity.com')),
  T('farmalife', 'Farmalife', 'farmacia', vtex('farmalife', 'https://www.farmalife.com.ar')),
  T('farmaonline', 'Farmaonline', 'farmacia', vtex('farmaonline', 'https://www.farmaonline.com')),
  // Supermercados
  T('masonline', 'MásOnline', 'super', vtex('masonline', 'https://www.masonline.com.ar')),
  T('vea', 'Vea', 'super', vtex('vea', 'https://www.vea.com.ar')),
  T('laanonima', 'La Anónima', 'super', buscarLaAnonima),
  // Bazar y juguetería
  T('lasmilnovedades', 'Las Mil Novedades', 'bazar', woocommerce('lasmilnovedades', 'https://lasmilnovedades.com'), { aviso: 'Mayorista: compra online mínima de $80.000' }),
  // Electro, tecnología y hogar
  T('easy', 'Easy', 'electro', vtex('easy', 'https://www.easy.com.ar')),
  T('electronorte', 'Electronorte', 'electro', tiendanube('electronorte', 'https://electronortelb.com')),
  T('maxtecno', 'Maxtecno', 'electro', woocommerce('maxtecno', 'https://maxtecno.com.ar')),
  T('importcell', 'Import Cell Sgo', 'electro', buscarImportCell, { aviso: 'Precio minorista. Su web informa compra mínima de $50.000' }),
  // Deportes y marcas oficiales
  T('enasport', 'ENA Sport', 'deportes', shopify('enasport', 'https://www.enasport.com')),
];

module.exports = { SITIOS, RUBROS };
