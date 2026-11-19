// Servidor para probar la app en tu computadora: `npm start` y abrir http://localhost:3000
// (Publicada en Vercel este archivo no se usa: Vercel sirve /public y /api por su cuenta.)
const http = require('http');
const fs = require('fs');
const path = require('path');
const buscar = require('./api/buscar');
const promos = require('./api/promos');
const chat = require('./api/chat');
const foto = require('./api/foto');

const PUBLICO = path.join(__dirname, 'public');
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

const servidor = http.createServer((req, res) => {
  const ruta = new URL(req.url, 'http://localhost').pathname;
  if (ruta === '/api/buscar') return buscar(req, res);
  if (ruta === '/api/promos') return promos(req, res);
  if (ruta === '/api/chat') return chat(req, res);
  if (ruta === '/api/foto') return foto(req, res);

  const archivo = path.join(PUBLICO, ruta === '/' ? 'index.html' : path.normalize(ruta));
  if (!archivo.startsWith(PUBLICO)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(archivo, (error, contenido) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
      return;
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' }).end(contenido);
  });
});

const puerto = process.env.PORT || 3000;
servidor.listen(puerto, () => console.log(`Seco y furioso listo en http://localhost:${puerto}`));
