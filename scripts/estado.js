// Chequea que cada pieza de la venta esté en pie y escribe estado.json (no se sube: está en .gitignore).
//   node scripts/estado.js [salida.json]
// Solo hace pedidos de lectura (GET y OPTIONS). No manda datos ni crea pedidos.
const fs = require('fs');
const path = require('path');
const salida = process.argv[2] || path.join(__dirname, '..', 'estado.json');
const ORIGEN = 'https://productoscapilarespg.com';

async function pedir(url, opciones, ms) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(ms || 12000), redirect: 'follow' }, opciones || {}));
    const cuerpo = (opciones && opciones.method === 'OPTIONS') ? '' : await r.text();
    return { estado: r.status, seg: (Date.now() - t0) / 1000, cuerpo };
  } catch (e) {
    return { estado: 0, seg: (Date.now() - t0) / 1000, cuerpo: '', error: String(e && e.message || e).slice(0, 80) };
  }
}

(async () => {
  const [web, srv, wk, mp, capi] = await Promise.all([
    pedir(ORIGEN + '/biotina-pura.html'),
    pedir('https://n8n.productoscapilarespg.com/healthz', null, 8000),
    pedir('https://biotina-pago.productopg.workers.dev/', { method: 'OPTIONS', headers: { Origin: ORIGEN } }, 8000),
    pedir('https://mpago.la/1j3ch15', { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' } }),
    pedir('https://biotina-capi.productopg.workers.dev/', { method: 'OPTIONS', headers: { Origin: ORIGEN } }, 8000),
  ]);
  const items = [
    { clave: 'web', nombre: 'Página de venta', ok: web.estado === 200,
      detalle: web.estado === 200 ? 'Carga bien (' + web.seg.toFixed(1) + ' s).' : 'No carga (' + (web.estado || web.error) + ').' },
    { clave: 'mp_link', nombre: 'Pago con link de Mercado Pago', ok: mp.estado === 200 && mp.cuerpo.indexOf('Biotina Pura') >= 0,
      detalle: mp.estado === 200 && mp.cuerpo.indexOf('Biotina Pura') >= 0 ? 'El link del pedido x3 abre con el producto y el precio.' : 'El link de pago no abre bien (' + (mp.estado || mp.error) + ').' },
    { clave: 'cobro', nombre: 'Cobro integrado (datos de la clienta a Mercado Pago)', ok: wk.estado === 204,
      detalle: wk.estado === 204 ? 'Activo.' : 'Sin activar: la web usa los links fijos de Mercado Pago. Falta cargar el Worker en Cloudflare.' },
    { clave: 'servidor', nombre: 'Servidor de pedidos, avisos y bot de WhatsApp', ok: srv.estado === 200,
      detalle: srv.estado === 200 ? 'En pie.' : 'No responde: no se registran pedidos ni avisos, el bot no contesta y Meta no recibe las compras.' },
    { clave: 'capi', nombre: 'Eventos de la web a Meta (Worker)', ok: capi.estado === 204,
      detalle: capi.estado === 204 ? 'Responde.' : 'No responde (' + (capi.estado || capi.error) + ').' },
  ];
  fs.writeFileSync(salida, JSON.stringify({ chequeado: new Date().toISOString(), items }, null, 1));
  console.log(items.map((i) => (i.ok ? 'OK ' : 'MAL ') + i.clave).join(' · '));
})();
