// Arma site/datos.json con los números de Meta, las ventas reales de la base (si hay), el gasto por edad y por día,
// las charlas de WhatsApp, el estado del sistema y las notas manuales (site/manual.json).
//   node scripts/armar.js meta.json [ventas.json] [--dias dias.json] [--wsp wsp.json] [--estado estado.json]
// meta.json: la respuesta de ads_get_ad_entities (level ad, date_preset maximum) de las campañas de scripts/config.json.
// ventas.json (opcional): [{clave, pedidos, ventas, cobrado_ars}] que arma tablero-ventas.js. Si falta, se conservan las últimas ventas guardadas.
// dias.json (opcional): ads_get_ad_entities level campaign, breakdowns ["age"], time_increment "1", desde config.inicio hasta hoy.
// wsp.json (opcional): ads_get_ad_entities level ad de la campaña de WhatsApp desde config.whatsappDesde, con cost_per_action_type.
// estado.json (opcional): lo arma scripts/estado.js (chequeos de la web, el servidor y el cobro).
// Lo que falta se conserva de la última corrida, así una consulta que falla no borra el tablero.
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const destino = process.env.DATOS_SALIDA || path.join(raiz, 'site', 'datos.json'); // DATOS_SALIDA solo para pruebas

const pos = [];
const op = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i].indexOf('--') === 0) { op[args[i].slice(2)] = args[i + 1]; i++; } else pos.push(args[i]);
}
const metaArg = pos[0];
const ventasArg = pos[1];
if (!metaArg) { console.error('uso: node scripts/armar.js meta.json [ventas.json] [--dias dias.json] [--wsp wsp.json] [--estado estado.json]'); process.exit(1); }

function leerLista(archivo) {
  try {
    const m = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    let l = Array.isArray(m) ? m : m.ad_entities;
    if (typeof l === 'string') l = JSON.parse(l);
    return Array.isArray(l) ? l : null;
  } catch (e) { return null; }
}

const n = (v) => (v == null ? 0 : typeof v === 'object' ? Number(v.value) || 0 : Number(String(v).replace('%', '').replace(',', '.')) || 0);

const lista = leerLista(metaArg);
if (!lista || !lista.length) { console.error('meta.json no trae anuncios'); process.exit(1); }
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

// ── Gasto por día y por edad ────────────────────────────────────────────────────────────────────
const tipoDe = (nombre) => (/whatsapp/i.test(nombre) ? 'whatsapp' : /retargeting/i.test(nombre) ? 'retargeting' : /ugc/i.test(nombre) ? 'ugc' : 'web');
const vacio = () => ({ gasto: 0, visitas: 0, carritos: 0, inicios: 0, compras: 0 });
const sumar = (a, m) => { a.gasto += m.gasto; a.visitas += m.visitas; a.carritos += m.carritos; a.inicios += m.inicios; a.compras += m.compras; return a; };
const redondear = (m) => ({ gasto: +m.gasto.toFixed(2), visitas: m.visitas, carritos: m.carritos, inicios: m.inicios, compras: m.compras });
const ORDEN_EDAD = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'Sin dato'];

let hoy = previo.hoy || null, dias = previo.dias || null, campanas = previo.campanas || null, edades = previo.edades || null;
let diasAct = previo.dias_actualizados || null;
// Las filas por día y por edad se guardan en datos.json (filas_dia): cada corrida pide a Meta solo los últimos días
// y pisa esas fechas; lo anterior se conserva. Así el historial desde el inicio no depende de una consulta enorme.
// Lo guardado de campañas que ya no están en config.json se descarta (así sale del tablero lo que dejamos de usar).
const enConfig = (id) => !cfg.campanas.length || cfg.campanas.includes(String(id));
let filasDia = (Array.isArray(previo.filas_dia) ? previo.filas_dia : []).filter((f) => enConfig(f.id));
const filasNuevas = op.dias ? leerLista(op.dias) : null;
if (filasNuevas && filasNuevas.length) {
  const mapa = new Map(filasDia.map((f) => [f.f + '|' + f.id + '|' + f.a, f]));
  for (const r of filasNuevas) {
    if (!r.date_start) continue;
    let edad = String(r.age == null ? '' : r.age);
    if (!edad || edad === 'null' || edad === 'Unknown') edad = 'Sin dato';
    const f = { f: r.date_start, id: String(r.id), nombre: r.name, a: edad, estado: r.effective_status, presupuesto: n(r.daily_budget),
      gasto: n(r.amount_spent), visitas: n(r.landing_page_view), carritos: n(r.omni_add_to_cart), inicios: n(r.omni_initiated_checkout), compras: n(r.omni_purchase) };
    mapa.set(f.f + '|' + f.id + '|' + f.a, f);
  }
  filasDia = [...mapa.values()].filter((f) => f.f >= String(cfg.inicio).slice(0, 10)).sort((x, y) => (x.f < y.f ? -1 : x.f > y.f ? 1 : 0));
  diasAct = ahora;
} else if (op.dias) {
  console.error('dias.json ilegible o vacío: se conservan los datos por día y por edad anteriores');
}
if (filasDia.length) {
  const porCamp = new Map(), porDia = new Map(), edadTot = new Map(), edadHoy = new Map();
  let ultima = '';
  for (const f of filasDia) if (f.f > ultima) ultima = f.f;
  for (const f of filasDia) {
    const m = { gasto: f.gasto, visitas: f.visitas, carritos: f.carritos, inicios: f.inicios, compras: f.compras };
    if (!porCamp.has(f.id)) porCamp.set(f.id, { id: f.id, nombre: f.nombre, tipo: tipoDe(f.nombre || ''), estado: f.estado, presupuesto: f.presupuesto, total: vacio(), hoy: vacio(), _f: '' });
    const c = porCamp.get(f.id);
    if (f.f >= c._f) { c._f = f.f; c.estado = f.estado; c.presupuesto = f.presupuesto; c.nombre = f.nombre; }
    sumar(c.total, m);
    if (f.f === ultima) sumar(c.hoy, m);
    if (!porDia.has(f.f)) porDia.set(f.f, vacio());
    sumar(porDia.get(f.f), m);
    for (const [mapa, vale] of [[edadTot, true], [edadHoy, f.f === ultima]]) {
      if (!vale) continue;
      if (!mapa.has(f.id)) mapa.set(f.id, new Map());
      const e = mapa.get(f.id);
      if (!e.has(f.a)) e.set(f.a, vacio());
      sumar(e.get(f.a), m);
    }
  }
  const aLista = (e) => [...e.entries()].sort((a, b) => ORDEN_EDAD.indexOf(a[0]) - ORDEN_EDAD.indexOf(b[0])).map(([edad, m]) => Object.assign({ edad }, redondear(m)));
  campanas = [...porCamp.values()].map((c) => ({ id: c.id, nombre: c.nombre, tipo: c.tipo, estado: c.estado, presupuesto: c.presupuesto, total: redondear(c.total), hoy: redondear(c.hoy) }));
  dias = [...porDia.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([fecha, m]) => Object.assign({ fecha }, redondear(m)));
  hoy = Object.assign({ fecha: ultima }, redondear(porDia.get(ultima) || vacio()));
  edades = {
    fecha_hoy: ultima,
    por_campana: [...porCamp.values()].map((c) => ({ id: c.id, nombre: c.nombre, tipo: c.tipo, total: aLista(edadTot.get(c.id) || new Map()), hoy: aLista(edadHoy.get(c.id) || new Map()) })),
  };
} else {
  // Sin filas de las campañas actuales: no dejar números viejos de campañas que ya no se muestran.
  hoy = null; dias = null; campanas = null; edades = null;
}

// ── WhatsApp: charlas = gasto / costo por charla (Meta no da la cantidad suelta) ─────────────────────────────
let wsp = Array.isArray(previo.wsp) ? previo.wsp.filter((w) => (cfg.campanasWhatsapp || []).includes(String(w.campana_id))) : null, wspAct = previo.wsp_actualizado || null;
const filasWsp = op.wsp ? leerLista(op.wsp) : null;
if (filasWsp && filasWsp.length) {
  const CH = 'cost_per_action_type:onsite_conversion.messaging_conversation_started_7d';
  const RE = 'cost_per_action_type:onsite_conversion.messaging_first_reply';
  wsp = filasWsp.filter((r) => !(cfg.campanasWhatsapp || []).length || cfg.campanasWhatsapp.includes(String(r.campaign_id))).map((r) => {
    const gasto = n(r.amount_spent), cCharla = n(r[CH]), cResp = n(r[RE]);
    return { id: String(r.id), campana_id: String(r.campaign_id || ''), anuncio: r.name, estado: r.effective_status, gasto, charlas: cCharla > 0 ? Math.round(gasto / cCharla) : (gasto > 0 ? 0 : null),
      respondidas: cResp > 0 ? Math.round(gasto / cResp) : (gasto > 0 ? 0 : null), compras_meta: n(r.omni_purchase) };
  }).sort((a, b) => b.gasto - a.gasto);
  wspAct = ahora;
} else if (op.wsp) {
  console.error('wsp.json ilegible o vacío: se conservan las charlas anteriores');
}

// Charlas del día (WhatsApp): gasto de hoy / costo por charla, anuncio por anuncio. wsp_hoy.json = {"fecha":"AAAA-MM-DD","ad_entities":[...]}.
// Una lista vacía quiere decir "hoy todavía no gastó nada": son 0 charlas. Si el archivo falta, se conserva lo último guardado.
let wspHoy = previo.wsp_hoy || null;
if (op.wsphoy && fs.existsSync(op.wsphoy)) {
  try {
    const crudo = JSON.parse(fs.readFileSync(op.wsphoy, 'utf8'));
    const filasHoy = leerLista(op.wsphoy);
    if (filasHoy && /^\d{4}-\d{2}-\d{2}$/.test(String(crudo.fecha))) {
      const CHH = 'cost_per_action_type:onsite_conversion.messaging_conversation_started_7d';
      const REH = 'cost_per_action_type:onsite_conversion.messaging_first_reply';
      let g = 0, c = 0, rp = 0;
      for (const r of filasHoy) {
        if ((cfg.campanasWhatsapp || []).length && !cfg.campanasWhatsapp.includes(String(r.campaign_id))) continue;
        const gasto = n(r.amount_spent), cc = n(r[CHH]), cr = n(r[REH]);
        g += gasto; c += cc > 0 ? Math.round(gasto / cc) : 0; rp += cr > 0 ? Math.round(gasto / cr) : 0;
      }
      wspHoy = { fecha: String(crudo.fecha), gasto: +g.toFixed(2), charlas: c, respondidas: rp, actualizado: ahora };
    } else console.error('wsp_hoy.json sin fecha o ilegible: se conserva lo anterior');
  } catch (e) { console.error('wsp_hoy.json ilegible: se conserva lo anterior'); }
}

// ── Estado del sistema y notas manuales ───────────────────────────────────────────────────────────
let estado = previo.estado || null;
if (op.estado && fs.existsSync(op.estado)) {
  try { estado = JSON.parse(fs.readFileSync(op.estado, 'utf8')); } catch (e) { console.error('estado.json ilegible: se conserva el estado anterior'); }
}
let manual = previo.manual || null;
try { manual = JSON.parse(fs.readFileSync(path.join(raiz, 'privado', 'manual.json'), 'utf8')); } catch (e) { /* sin notas */ }

// Campañas de una cuenta restringida (ya no se pueden consultar): se muestran con su historial pero NO como andando.
const caidas = (cfg.campanasCaidas || []).map(String);
if (caidas.length) {
  if (campanas) campanas.forEach((c) => { if (caidas.includes(String(c.id))) c.estado = 'ACCOUNT_RESTRICTED'; });
  if (wsp) wsp.forEach((w) => { if (caidas.includes(String(w.campana_id))) w.estado = 'ACCOUNT_RESTRICTED'; });
}

const datos = {
  actualizado: ahora, inicio: cfg.inicio, whatsapp_desde: cfg.whatsappDesde || null, reglas: cfg.reglas, claves: cfg.claves, anuncios,
  ventas, ventas_actualizadas: ventasAct,
  hoy, dias, campanas, edades, dias_actualizados: diasAct, filas_dia: filasDia,
  wsp, wsp_actualizado: wspAct, wsp_hoy: wspHoy, estado, manual,
};
fs.writeFileSync(destino, JSON.stringify(datos, null, 1));

// ── Cifrado con PIN ────────────────────────────────────────────────────────────────────────────────
// Lo que se sube a GitHub es site/datos.enc.json (AES-256-GCM, clave derivada del PIN con PBKDF2). El PIN está en
// scripts/pin.txt (no se sube: .gitignore) o en la variable PIN_TABLERO. site/datos.json queda solo en esta PC.
// Ojo: un PIN de 4 números frena a quien mira de curioso, no a alguien que quiera adivinarlo con un programa.
let cifradoOk = false;
try {
  const crypto = require('crypto');
  const pin = (process.env.PIN_TABLERO || (fs.existsSync(path.join(__dirname, 'pin.txt')) ? fs.readFileSync(path.join(__dirname, 'pin.txt'), 'utf8') : '')).trim();
  if (pin) {
    const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), iter = 200000;
    const clave = crypto.pbkdf2Sync(pin, salt, iter, 32, 'sha256');
    const c = crypto.createCipheriv('aes-256-gcm', clave, iv);
    const cuerpo = Buffer.concat([c.update(JSON.stringify(datos), 'utf8'), c.final()]);
    const sobre = { v: 1, iter, salt: salt.toString('base64'), iv: iv.toString('base64'), data: Buffer.concat([cuerpo, c.getAuthTag()]).toString('base64') };
    fs.writeFileSync(process.env.DATOS_ENC_SALIDA || path.join(raiz, 'site', 'datos.enc.json'), JSON.stringify(sobre));
    cifradoOk = true;
  } else {
    console.error('Sin PIN (scripts/pin.txt): no se generó datos.enc.json');
  }
} catch (e) { console.error('No se pudo cifrar: ' + e.message); }
const gasto = anuncios.reduce((s, a) => s + a.gasto, 0);
console.log('anuncios ' + anuncios.length + ' · gasto US$ ' + gasto.toFixed(2) + ' · ventas ' + (ventas ? ventas.reduce((s, v) => s + Number(v.ventas || 0), 0) : 'sin cargar') +
  ' · hoy ' + (hoy ? 'US$ ' + hoy.gasto.toFixed(2) : 'sin datos') + ' · charlas WhatsApp ' + (wsp ? wsp.reduce((s, w) => s + (w.charlas || 0), 0) : 'sin datos') +
  ' · estado ' + (estado ? estado.items.filter((i) => i.ok === false).length + ' con problema' : 'sin chequeo') + ' · cifrado ' + (cifradoOk ? 'sí' : 'NO'));
