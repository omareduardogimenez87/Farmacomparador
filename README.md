# Ahorra+Sgo

Las mejores ofertas están acá.

(Antes se llamó Farmacomparador, Seco y furioso y Precio Pirata. El repositorio, el proyecto de Vercel y la dirección web conservan ese nombre.)

App para el celular que busca un producto y muestra el precio en varias farmacias y supermercados online a la vez.

## Tiendas incluidas

13 tiendas, agrupadas por rubro. Se puede buscar en todas o en un solo rubro.

| Rubro | Tiendas |
| --- | --- |
| Farmacias | La Esquina, Farmacity, Farmalife, Farmaonline |
| Supermercados | MásOnline, Vea, La Anónima |
| Deportes | ENA Sport |
| Bazar y juguetería | Las Mil Novedades (precios mayoristas; compra online mínima de $80.000) |
| Electro, tecnología y hogar | Easy, Electronorte, Maxtecno, Import Cell Sgo (precio minorista; compra mínima de $50.000) |

**No incluidas:** Frávega (su web rechaza las consultas automáticas, error 403), Megatone (su buscador no se pudo leer) y Pixis (su tienda usa un sistema propio que la app no puede leer).

Antes la app llegó a tener 71 tiendas (deportes, moda, perfumería y mayoristas). Edu decidió dejar solo 9 y después sumó las de electro y hogar. Las demás están en el historial de GitHub y en la planilla `Tiendas Ahorra+Sgo.xlsx`, por si se quieren volver a sumar.

Las tiendas se consultan por plataforma (`lib/plataformas.js`). Hay adaptadores para VTEX, Shopify, Tiendanube, Magento, Salesforce, PrestaShop y Odoo, y en `lib/sitios.js` para WooCommerce y Drubbit. Para sumar una tienda de esas plataformas alcanza con agregar una línea en `lib/sitios.js`.

## Cómo compara

- Le hace la misma búsqueda a cada tienda al mismo tiempo.
- **Ordena por lo que rinde**: si los productos dicen cuánto traen (litros, kilos o metros), la app calcula el precio por litro, por kilo o por metro y ordena de lo que más rinde a lo que menos. Cuenta los packs ("4 x 30 m" son 120 metros, "pack x 6 de 1,5 l" son 9 litros). Los rollos de cocina se comparan por **paño**, y también por unidad los pañales, toallitas, servilletas, saquitos, cápsulas y comprimidos. En papel higiénico y rollos de cocina, la hoja doble cuenta como el doble de rendimiento que la simple, y la triple como el triple (es una estimación). En rollos de cocina, "40 paños 3 u" se toma como 3 rollos de 40, y de 100 paños para arriba ("120 paños 3 u") se toma como el total del paquete. Los packs de más de 24 unidades no se multiplican, porque suelen ser la caja para comercios. Los productos que no dicen su medida van al final.
- Si dos tiendas publican el **mismo código de barras (EAN)**, la app los junta en una sola tarjeta y marca el más barato. Es la única forma confiable de saber que es exactamente el mismo producto.
- Lo que no se puede emparejar por código (por ejemplo, todo ENA Sport y La Anónima) aparece en una tarjeta propia.
- Tocando la etiqueta de una tienda se ven solo sus productos.
- MásOnline (envía a domicilio en Santiago y tiene retiro en tienda), Vea y La Anónima pueden tener precios distintos según la sucursal o la zona. La app muestra el precio que cada sitio muestra por defecto, sin elegir sucursal.
- Los precios son los publicados en la web. No incluyen promociones bancarias, de obra social ni del tipo 2x1 o "segunda unidad".

## Guía de reputación

La pestaña **Tiendas** muestra la confianza de cada tienda, del 1 al 10, con una barra de color (4 = rojo, 10 = verde) y el motivo del puntaje. El mismo puntaje aparece junto a cada precio en los resultados.

- **Fuente de datos:** `public/reputacion-tiendas.json` (nombre, url, grupo, rubro, puntaje y motivo). La app no inventa puntajes: las tiendas que no están en ese archivo aparecen sin puntaje.
- **Para vincular una tienda del buscador con la guía**, su nombre en `lib/sitios.js` tiene que coincidir con el de la guía, o indicarse con `{ reputacion: 'Nombre en la guía' }`.
- **Criterio para tiendas nuevas:**
  - 9-10: tienda o marca oficial, o cadena grande con envío al interior confirmado por escrito.
  - 8: oficial con algún dato a confirmar, o mayorista con buenas reseñas verificables.
  - 7: buena reputación sin señales de alerta, o cadena con reclamos en el promedio de su rubro.
  - 6: confiable pero con poca información (sin reseñas online o web que no se pudo leer).
  - 5: comprar con cuidado: baja resolución de reclamos u opiniones mixtas.
  - Si un dato de reputación no está verificado, se le pregunta a Edu antes de asignar el puntaje.
- Estimación con datos públicos al 19/11/2026, no es una calificación oficial.

## Funciones

- **Buscar** por nombre, o por **código de barras** (escribiendo los números o con la cámara).
- **Micrófono**: buscar o preguntar hablando. Usa el reconocimiento de voz del navegador, sin costo.
- **Cámara**: se saca una foto del producto. Si se ve el código de barras, el celular lo lee al instante (Chrome en Android). Si no, la IA reconoce el producto en la foto.
- **Asistente**: un chat con la IA de Claude que consulta las tiendas y responde, por escrito o en voz alta.
- **Promos**: descuentos, reintegros y cuotas por día de la semana, con filtro por banco o tarjeta. Solo muestra las que valen en Santiago del Estero: oculta las que nombran otras provincias o ciudades sin incluir a Santiago, y las de bancos provinciales de otras provincias. Se leen de las páginas oficiales de La Anónima y Farmacity; para Vea y MásOnline hay un enlace a su página, porque sus promos se cargan de una forma que la app no puede leer. No usa IA y no tiene costo. No hay cupones: las tiendas no los publican en un lugar que se pueda leer.
- **Mercado Libre como referencia**: en cada búsqueda hay un botón que abre la misma búsqueda en Mercado Libre, ordenada del precio más bajo al más alto. Además, cada producto tiene el enlace "Comparar este producto en Mercado Libre", que busca su tipo, marca y código de modelo (por ejemplo "taladro daewoo daid750bx"). Es solo para comparar. La app no lee sus precios porque Mercado Libre rechaza las consultas automáticas (error 403); su API oficial exige registrarse como desarrollador.
- **Mi lista (carrito)**: el botón +🛒 de cada precio agrega el producto a una lista guardada en el celular, agrupada por tienda, con totales que cuentan las promos por cantidad. En MásOnline, Farmacity, Farmalife, Farmaonline y Easy, el botón "Pasar todo al carrito" abre la tienda con los productos ya cargados (enlace de carrito de VTEX). En Las Mil Novedades se agregan uno por uno con un toque (WooCommerce). En el resto, incluida Vea, se abre la página de cada producto. La app nunca entra a la cuenta del usuario ni paga.
- **Logos** de cada tienda, descargados de su propio sitio y guardados en `public/logos/`.

## Activar la inteligencia artificial

El asistente y el reconocimiento por foto usan la API de Claude, que se paga aparte de la suscripción a Claude (es una cuenta distinta, en console.anthropic.com). Sin configurarla, el resto de la app funciona igual.

1. Crear una clave de API en https://console.anthropic.com (Settings → API Keys) y cargar saldo. Conviene fijar un límite de gasto mensual.
2. En Vercel: proyecto `farmacomparador` → **Settings → Environment Variables**, agregar:
   - `ANTHROPIC_API_KEY`: la clave de API.
   - `CLAVE_IA`: una clave inventada para la familia. La app la pide la primera vez que se usa la IA en cada celular. Sin ella, la IA queda apagada para que nadie con el enlace gaste el saldo.
3. Volver a publicar (**Deployments → … → Redeploy**).

Usa **Claude Haiku 5.5**, el modelo más económico de Claude, con esfuerzo bajo: US$ 0,10 por millón de tokens enviados y US$ 0,50 por millón de respuesta. Estimación: alrededor de una décima de centavo de dólar por pregunta.

## Probarla en la computadora

Hace falta tener instalado [Node.js](https://nodejs.org) versión 20 o superior.

```
npm start
```

Después abrir `http://localhost:3000` en el navegador.

Para correr las pruebas automáticas: `npm test`.

## Publicarla para usarla desde el celular

La app necesita un servidor: el navegador del celular no puede consultar directamente a las tiendas. El proyecto está preparado para [Vercel](https://vercel.com), que tiene plan gratuito:

1. Crear una cuenta en vercel.com entrando con GitHub.
2. Elegir **Add New → Project** e importar el repositorio `Farmacomparador`.
3. Dejar todas las opciones como vienen y tocar **Deploy**.
4. Vercel entrega una dirección del tipo `https://farmacomparador-xxxx.vercel.app`.
5. Abrirla en el celular y, desde el menú del navegador, elegir **Agregar a pantalla de inicio**. Queda con ícono propio, como una app.

## Organización del código

- `public/index.html`: la pantalla que se ve en el celular.
- `api/buscar.js`: recibe la búsqueda de la pantalla y devuelve los resultados.
- `lib/sitios.js`: la lista de tiendas con su rubro y cómo se consulta cada una.
- `lib/plataformas.js`: un adaptador por plataforma de comercio electrónico.
- `lib/promos.js`: lee las promociones bancarias de las tiendas y detecta qué días valen.
- `lib/comparar.js`: filtra resultados que no corresponden, agrupa por código de barras y busca por código.
- `lib/ia.js`: el asistente y el reconocimiento de fotos con Claude.
- `api/chat.js` y `api/foto.js`: reciben los pedidos de la IA desde la pantalla.
- `server.js`: servidor para probar en la computadora.
- `test/`: pruebas automáticas.
