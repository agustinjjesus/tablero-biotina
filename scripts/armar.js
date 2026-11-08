// Arma site/datos.json con los números de Meta (y las ventas reales de la base, si hay).
//   node scripts/armar.js meta.json [ventas.json]
// meta.json: la respuesta de ads_get_ad_entities (level ad, date_preset maximum) de las campañas de scripts/config.json.
// ventas.json (opcional): [{clave, pedidos, ventas, cobrado_ars}] que arma tablero-ventas.js. Si falta, se conservan las últimas ventas guardadas.
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const destino = path.join(raiz, 'site', 'datos.json');
const [metaArg, ventasArg] = process.argv.slice(2);
if (!metaArg) { console.error('uso: node scripts/armar.js meta.json [ventas.json]'); process.exit(1); }

let meta = JSON.parse(fs.readFileSync(metaArg, 'utf8'));
let lista = Array.isArray(meta) ? meta : meta.ad_entities;
if (typeof lista === 'string') lista = JSON.parse(lista);
if (!Array.isArray(lista) || !lista.length) { console.error('meta.json no trae anuncios'); process.exit(1); }

const n = (v) => (v == null ? 0 : typeof v === 'object' ? Number(v.value) || 0 : Number(String(v).replace('%', '').replace(',', '.')) || 0);
const anuncios = lista
  .filter((r) => !cfg.campanas.length || cfg.campanas.includes(String(r.campaign_id)))
  .map((r) => ({
    id: String(r.id), anuncio: r.name, campana: r.campaign_name, campana_id: String(r.campaign_id), estado: r.effective_status,
    creado: String(r.created_time || '').slice(0, 10), gasto: n(r.amount_spent), impresiones: n(r.impressions), frecuencia: n(r.frequency),
    clics: n(r.link_click), ctr: n(r.ctr), visitas: n(r.landing_page_view), carritos: n(r.omni_add_to_cart),
    inicios: n(r.omni_initiated_checkout), compras_meta: n(r.omni_purchase),
  }));
if (!anuncios.length) { console.error('ningún anuncio es de las campañas de config.json'); process.exit(1); }

let previo = {};
try { previo = JSON.parse(fs.readFileSync(destino, 'utf8')); } catch (e) { /* primera vez */ }
const ahora = new Date().toISOString();
let ventas = previo.ventas || null, ventasAct = previo.ventas_actualizadas || null;
if (ventasArg && fs.existsSync(ventasArg)) {
  try {
    const v = JSON.parse(fs.readFileSync(ventasArg, 'utf8'));
    if (Array.isArray(v)) { ventas = v; ventasAct = ahora; }
  } catch (e) { console.error('ventas.json ilegible: se conservan las ventas anteriores'); }
}

const datos = { actualizado: ahora, inicio: cfg.inicio, reglas: cfg.reglas, claves: cfg.claves, anuncios, ventas, ventas_actualizadas: ventasAct };
fs.writeFileSync(destino, JSON.stringify(datos, null, 1));
const gasto = anuncios.reduce((s, a) => s + a.gasto, 0);
console.log('anuncios ' + anuncios.length + ' · gasto US$ ' + gasto.toFixed(2) + ' · ventas ' + (ventas ? ventas.reduce((s, v) => s + Number(v.ventas || 0), 0) : 'sin cargar'));
