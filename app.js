/* QAQC Paneles — lógica de la app (ES/中文)
   Todos los datos (GRUPOS, MASTER por defecto, HEADER_FIELDS, SIGNERS, columnas de Maestro)
   se inyectan desde index.html en window.__QAQC_*__ para mantener este archivo legible. */
(function(){
  "use strict";

  /* Versión de la app. Cada vez que se publique un cambio en GitHub hay que subir
     este número Y el CACHE_NAME de sw.js -- así cada registro queda marcado con la
     versión con la que se capturó, y los celulares con una versión vieja reciben
     el aviso de actualización. Formato: mayor.menor.corrección */
  const APP_VERSION = "3.4.0";

  const GRUPOS = window.__QAQC_GRUPOS__;                 // [{es,zh,items:[{es,zh},...],nota?}, ...]
  const MASTER_DEFAULT = window.__QAQC_MASTER_DEFAULT__;  // {PANELES:[...], ...}
  const HEADER_FIELDS = window.__QAQC_HEADER_FIELDS__;
  const SIGNERS = window.__QAQC_SIGNERS__;
  const MAESTRO_COLUMNS = window.__QAQC_MAESTRO_COLUMNS__;
  const PANEL_TIPO_DEFAULT = window.__QAQC_PANEL_TIPO_DEFAULT__ || {};   // Labor(nombre) -> STOPE/UPPER
  const PANEL_FASE_DEFAULT = window.__QAQC_PANEL_FASE_DEFAULT__ || {};   // Labor(nombre) -> "Producción / 生产" | "Preparación / 准备"
  const PDF_FONT_B64 = window.__QAQC_PDF_FONT_B64__ || "";               // fuente china (subset) para el PDF, ver fonts/

  /* ============================================================
     Utilidades generales
     ============================================================ */
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function todayISO(){
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }
  // Fecha "de negocio" para el turno: turno día 06:00-18:00, turno noche
  // 18:00-05:59. Entre medianoche y las 5:59am se sigue considerando parte
  // del turno noche que empezó la noche anterior, así que la fecha por
  // defecto NO salta al día siguiente a las 00:00 -- se queda en el día en
  // que arrancó el turno noche hasta las 6:00am.
  function businessDateISO(){
    const d = new Date();
    if (d.getHours() < 6) d.setDate(d.getDate() - 1);
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }
  function genId(){
    const d = new Date();
    const ymd = d.getFullYear() + String(d.getMonth()+1).padStart(2,"0") + String(d.getDate()).padStart(2,"0");
    const hms = String(d.getHours()).padStart(2,"0") + String(d.getMinutes()).padStart(2,"0") + String(d.getSeconds()).padStart(2,"0");
    return "INS-" + ymd + "-" + hms;
  }
  function nowStamp(){
    const d = new Date();
    return todayISO() + " " + String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0");
  }
  function toast(msg, ms){
    const t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._h);
    toast._h = setTimeout(()=>t.classList.remove("show"), ms || 2800);
  }
  function stripAccents(s){
    return String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"");
  }
  /* ============================================================
     Ventana de tiempo del turno, para "Completar firmas pendientes".
     Turno día: 06:00-17:59. Turno noche: 18:00-05:59 (del día siguiente).
     Pasada esa ventana ya NO se puede completar una firma pendiente de ese
     registro -- la firma pierde sentido fuera del turno al que pertenece.
     ============================================================ */
  function turnoEsNoche(turno){
    const t = stripAccents(String(turno||"")).toLowerCase();
    return t.indexOf("noche") !== -1 || t.indexOf("night") !== -1;
  }
  function shiftWindowForRecord(header){
    const fecha = header && header.fecha;
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
    const [y, m, d] = fecha.split("-").map(Number);
    let start, end;
    if (turnoEsNoche(header.turno)){
      start = new Date(y, m-1, d, 18, 0, 0);
      end = new Date(y, m-1, d+1, 5, 59, 0);
    } else {
      start = new Date(y, m-1, d, 6, 0, 0);
      end = new Date(y, m-1, d, 17, 59, 0);
    }
    return {start, end};
  }
  function canCompleteSignatures(rec){
    const win = shiftWindowForRecord(rec.header);
    if (!win) return true; // fecha no reconocible: no bloqueamos por seguridad
    return new Date() <= win.end;
  }
  function normHeader(s){
    let t = String(s||"").split("/")[0]; // quita sufijo bilingüe "... / 中文"
    t = stripAccents(t).toUpperCase().replace(/[_\s]+/g," ").trim();
    return t;
  }
  // Resolución mínima aceptada para una foto de evidencia (lado más corto, en px).
  // La app nunca amplía una foto: si llega más pequeña que esto (reenviada por
  // WhatsApp, miniatura, captura recortada), así quedaría en el registro y el PDF,
  // así que se rechaza y se obliga a tomarla o cargarla de nuevo.
  const FOTO_MIN_LADO = 200;

  // opts.minSide   -> rechaza (err.code = "LOWRES") si el lado más corto es menor.
  // opts.watermark -> texto que se estampa en una franja inferior de la foto.
  function compressImage(file, maxDim, quality, opts){
    opts = opts || {};
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => { img.onload = () => {
        if (opts.minSide && Math.min(img.width, img.height) < opts.minSide){
          const err = new Error("LOWRES");
          err.code = "LOWRES"; err.w = img.width; err.h = img.height;
          reject(err); return;
        }
        let w = img.width, h = img.height;
        if (w > h && w > maxDim){ h = Math.round(h * maxDim / w); w = maxDim; }
        else if (h >= w && h > maxDim){ w = Math.round(w * maxDim / h); h = maxDim; }
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        if (opts.watermark) drawWatermark(ctx, w, h, opts.watermark);
        resolve(c.toDataURL("image/jpeg", quality || 0.6));
      }; img.onerror = reject; img.src = reader.result; };
      reader.readAsDataURL(file);
    });
  }

  // Marca de agua: franja semitransparente en la parte inferior con el ID del
  // registro, la labor, el número del ítem y su nombre -- para que la foto siga
  // siendo trazable aunque se comparta suelta, fuera del registro o del PDF.
  function drawWatermark(ctx, w, h, text){
    const fontSize = Math.max(12, Math.round(w * 0.026));
    const padX = Math.round(fontSize * 0.6), padY = Math.round(fontSize * 0.45);
    const barH = fontSize + padY * 2;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, h - barH, w, barH);
    ctx.font = "bold " + fontSize + "px Arial, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#FFFFFF";
    // Si el texto no cabe, se recorta con "…" en vez de comprimir las letras.
    let t = String(text), maxW = w - padX * 2;
    if (ctx.measureText(t).width > maxW){
      while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
      t += "…";
    }
    ctx.fillText(t, padX, h - barH / 2);
  }

  function evidenceWatermark(state){
    const labor = (headerState.labor || "").trim();
    return [headerState.id, labor, "#" + (state.gi + 1) + "." + state.idx + " " + state.es]
      .filter(Boolean).join(" | ");
  }

  // Alarma bloqueante (pantalla completa) con botón para cerrarla.
  function showBlockingAlert(titleHtml, bodyHtml, onClose){
    const prev = document.getElementById("qaqcBlockingAlert");
    if (prev) prev.remove();
    const ov = document.createElement("div");
    ov.id = "qaqcBlockingAlert";
    ov.setAttribute("role", "alertdialog");
    ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box";
    ov.innerHTML = '<div style="background:var(--surface,#1A2733);color:var(--ink,#E8ECEF);border:2px solid var(--bad,#E74C3C);border-radius:12px;padding:18px 20px;width:100%;max-width:440px;max-height:85vh;overflow:auto">'
      + '<div style="color:var(--bad-ink,#FFB3A7);font-size:16px;font-weight:700;margin-bottom:10px">' + titleHtml + '</div>'
      + bodyHtml
      + '<button type="button" data-role="close" style="margin-top:14px;width:100%;padding:12px;border:0;border-radius:8px;background:var(--accent,#F2701D);color:var(--accent-ink,#2A1200);font-weight:700;font-size:15px">Entendido / 明白</button>'
      + '</div>';
    document.body.appendChild(ov);
    ov.querySelector('[data-role="close"]').addEventListener("click", () => { ov.remove(); if (onClose) onClose(); });
  }

  /* ============================================================
     Maestro: carga desde localStorage o valores de ejemplo
     ============================================================ */
  function loadMaster(){
    try {
      const saved = JSON.parse(localStorage.getItem("qaqc_maestro") || "null");
      if (saved) return Object.assign({}, MASTER_DEFAULT, saved);
    } catch(e){}
    return Object.assign({}, MASTER_DEFAULT);
  }
  function getMaestroMeta(){
    try { return JSON.parse(localStorage.getItem("qaqc_maestro_meta") || "null"); } catch(e){ return null; }
  }
  let MASTER = loadMaster();

  // Deriva Categoría de explotación (STOPE/UPPER) y Fase a partir de la Labor/Panel elegida,
  // cuando el maestro cargado trae esa relación (ver importMaestroFile -> tryParseRealMaestro).
  function loadPanelDerive(){
    try {
      const saved = JSON.parse(localStorage.getItem("qaqc_maestro_derive") || "null");
      if (saved) return saved;
    } catch(e){}
    return {tipo: Object.assign({}, PANEL_TIPO_DEFAULT), fase: Object.assign({}, PANEL_FASE_DEFAULT)};
  }
  let PANEL_DERIVE = loadPanelDerive();

  // Filtro de Actividad por Fase (Preparación/Producción), cuando el maestro cargado trae
  // esas dos listas separadas (ver importMaestroFile -> tryParseRealMaestro). Si no hay datos
  // (maestro de ejemplo, formato anterior de una sola lista, o formato plantilla), queda null
  // y el campo Actividad muestra la lista combinada completa, como siempre.
  function loadActividadFase(){
    try {
      const saved = JSON.parse(localStorage.getItem("qaqc_maestro_actividad_fase") || "null");
      if (saved) return saved;
    } catch(e){}
    return null;
  }
  let ACTIVIDAD_FASE = loadActividadFase();

  /* ============================================================
     v3.3 · Ciclos productivos y semanas (igual que la app de Inspección v4.5)
     El Maestro trae tblCiclos (Mes_Productivo, Anio, Mes_Num, Inicio_Ciclo,
     Fin_Ciclo) y tblConfig (Meses_Atras, Actualizado_Por, Fecha_Actualizacion).
     Nada va fijo en el código: con cada Maestro nuevo la app recalcula
       - el mes productivo y las semanas del ciclo de la fecha del registro, y
       - qué paneles de tblFronts se muestran (Active = TRUE y Month dentro de
         los últimos "Meses_Atras" meses productivos, contando el vigente).
     Sin tblCiclos se usa la regla 26 -> 25 (enero: 1 a 25; diciembre: 26-nov a 31-dic).
     ============================================================ */
  const MESES_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const MESES_ABR = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  function soloFecha(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function sumaDias(d, n){ const x = new Date(d); x.setDate(x.getDate() + n); return soloFecha(x); }
  function isoDe(d){ return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); }
  function deIso(s){ const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s||"")); return m ? new Date(+m[1], +m[2]-1, +m[3]) : null; }
  function fmtCorta(d){ return String(d.getDate()).padStart(2,"0") + " " + MESES_ABR[d.getMonth()]; }
  function fmtFechaDMY(d){ return String(d.getDate()).padStart(2,"0") + "/" + String(d.getMonth()+1).padStart(2,"0") + "/" + d.getFullYear(); }
  // Fecha tal como llega de SheetJS: número de serie de Excel, Date o texto (aaaa-mm-dd / dd/mm/aaaa).
  function fechaMaestro(v){
    if (v == null || v === "") return null;
    if (v instanceof Date) return isNaN(v) ? null : soloFecha(v);
    if (typeof v === "number"){ const d = new Date(Date.UTC(1899,11,30) + Math.round(v)*86400000); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
    const t = String(v).trim(); let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t))) return new Date(+m[1], +m[2]-1, +m[3]);
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t))) return new Date(+m[3], +m[2]-1, +m[1]);
    return null;
  }
  function loadCiclos(){
    try {
      const saved = JSON.parse(localStorage.getItem("qaqc_maestro_ciclos") || "null");
      if (saved && saved.length) return saved.map(c => ({mes:c.mes, mesNum:c.mesNum, anio:c.anio, ini:deIso(c.ini), fin:deIso(c.fin)})).filter(c => c.ini && c.fin);
    } catch(e){}
    return [];
  }
  function loadCicloCfg(){
    try {
      const saved = JSON.parse(localStorage.getItem("qaqc_maestro_config") || "null");
      if (saved) return {mesesAtras: saved.mesesAtras || 3, actualizadoPor: saved.actualizadoPor || "", fechaAct: deIso(saved.fechaAct)};
    } catch(e){}
    return {mesesAtras:3, actualizadoPor:"", fechaAct:null};
  }
  let CICLOS = loadCiclos();
  let CICLO_CFG = loadCicloCfg();

  // Lee tblCiclos / tblConfig por encabezado (sin posiciones fijas) de la hoja ya convertida a filas.
  function leerCiclosMaestro(rows){
    const head = (rows && rows[0]) || [], col = {};
    head.forEach((h, i) => { const k = h == null ? "" : String(h).toLowerCase().trim(); if (k && col[k] == null) col[k] = i; });
    const ciclos = [];
    if (col["inicio_ciclo"] != null && col["fin_ciclo"] != null && col["mes_productivo"] != null){
      for (let r=1; r<rows.length; r++){
        const row = rows[r]; if (!row) continue;
        const ini = fechaMaestro(row[col["inicio_ciclo"]]), fin = fechaMaestro(row[col["fin_ciclo"]]);
        const mes = row[col["mes_productivo"]];
        if (!ini || !fin || !mes) continue;
        ciclos.push({mes:String(mes).trim(), ini, fin, mesNum:fin.getMonth()+1, anio:fin.getFullYear()});
      }
      ciclos.sort((a,b) => a.ini - b.ini);
    }
    const cfg = {mesesAtras:3, actualizadoPor:"", fechaAct:null};
    if (col["meses_atras"] != null && rows[1]){ const n = parseInt(rows[1][col["meses_atras"]], 10); if (n > 0 && n < 13) cfg.mesesAtras = n; }
    if (col["actualizado_por"] != null && rows[1] && rows[1][col["actualizado_por"]]) cfg.actualizadoPor = String(rows[1][col["actualizado_por"]]).trim();
    if (col["fecha_actualizacion"] != null && rows[1]) cfg.fechaAct = fechaMaestro(rows[1][col["fecha_actualizacion"]]);
    return {ciclos, cfg};
  }
  function guardarCiclos(ciclos, cfg){
    localStorage.setItem("qaqc_maestro_ciclos", JSON.stringify(ciclos.map(c => ({mes:c.mes, mesNum:c.mesNum, anio:c.anio, ini:isoDe(c.ini), fin:isoDe(c.fin)}))));
    localStorage.setItem("qaqc_maestro_config", JSON.stringify({mesesAtras:cfg.mesesAtras, actualizadoPor:cfg.actualizadoPor, fechaAct: cfg.fechaAct ? isoDe(cfg.fechaAct) : ""}));
  }

  // Ciclo productivo de una fecha. vencido = el Maestro trae ciclos pero ninguno cubre la fecha.
  function cicloDeFecha(fecha){
    const f = soloFecha(fecha);
    for (let i=0; i<CICLOS.length; i++){
      if (f >= CICLOS[i].ini && f <= CICLOS[i].fin) return {ciclo:CICLOS[i], vencido:false};
    }
    const y = f.getFullYear(), m = f.getMonth()+1, d = f.getDate();
    let mp, ini, fin;
    if (m === 1 && d <= 25){ mp = 1; ini = new Date(y,0,1); fin = new Date(y,0,25); }
    else if ((m === 11 && d >= 26) || m === 12){ mp = 12; ini = new Date(y,10,26); fin = new Date(y,11,31); }
    else if (d >= 26){ mp = m + 1; ini = new Date(y, m-1, 26); fin = new Date(y, m, 25); }
    else { mp = m; ini = new Date(y, m-2, 26); fin = new Date(y, m-1, 25); }
    return {ciclo:{mes:MESES_EN[mp-1], mesNum:mp, anio:fin.getFullYear(), ini, fin}, vencido: CICLOS.length > 0};
  }

  // Semanas dom-sáb. Parcial inicial de 4 días o menos se une a la siguiente; parcial final de
  // 4 días o menos se une a la anterior; de 5-6 días queda como semana corta (misma regla que el
  // calendario tblCalendar del Maestro y que la app de Inspección).
  function semanasDelCiclo(ini, fin){
    const bl = []; let s = ini;
    while (s <= fin){
      let e = sumaDias(s, (6 - s.getDay() + 7) % 7);
      if (e > fin) e = fin;
      bl.push([s, e]); s = sumaDias(e, 1);
    }
    if (bl.length > 1){
      const l0 = Math.round((bl[0][1]-bl[0][0])/86400000)+1;
      if (l0 <= 4 && bl[0][0].getDay() !== 0){ bl[1][0] = bl[0][0]; bl.shift(); }
    }
    if (bl.length > 1){
      const last = bl[bl.length-1], ll = Math.round((last[1]-last[0])/86400000)+1;
      if (ll <= 4 && last[1].getDay() !== 6){ bl[bl.length-2][1] = last[1]; bl.pop(); }
    }
    return bl;
  }

  // Meses productivos (en inglés, como la columna Month de tblFronts) que se muestran: el vigente y los anteriores.
  function mesesVentana(){
    const info = cicloDeFecha(new Date()), n = CICLO_CFG.mesesAtras || 3, out = [];
    for (let k=0; k<n; k++) out.push(MESES_EN[((info.ciclo.mesNum-1-k)%12+12)%12]);
    return out;
  }

  // Paneles a mostrar a partir de las filas de tblFronts guardadas: Active = TRUE y Month dentro de la
  // ventana de meses. Si ninguno cae en la ventana (Maestro sin actualizar o meses escritos distinto),
  // se muestran todos los activos, como antes, y se avisa.
  function panelesDesdeFrentes(frentes){
    const ventana = mesesVentana().map(m => m.toLowerCase());
    const activos = frentes.filter(f => f.active);
    const conMes = activos.some(f => f.month);
    let lista = conMes ? activos.filter(f => ventana.includes(String(f.month).toLowerCase())) : activos;
    const fueraDeVentana = conMes && !lista.length && activos.length > 0;
    if (fueraDeVentana) lista = activos;
    // el mes más reciente de la ventana manda para Fase/Tipo si un panel aparece en varios meses
    const rank = m => { const i = ventana.indexOf(String(m||"").toLowerCase()); return i === -1 ? 99 : i; };
    lista = lista.slice().sort((a,b) => rank(b.month) - rank(a.month));
    const seen = new Set(), PANELES = [], tipo = {}, fase = {};
    lista.forEach(f => {
      if (!seen.has(f.name)){ seen.add(f.name); }
      if (/_ST_/i.test(f.name)) tipo[f.name] = "STOPE";
      else if (/_UP_/i.test(f.name)) tipo[f.name] = "UPPER";
      else if (/stope/i.test(f.type||"")) tipo[f.name] = "STOPE";
      else if (/upper/i.test(f.type||"")) tipo[f.name] = "UPPER";
      if (f.fase) fase[f.name] = f.fase;
    });
    // orden de aparición original (vigente primero ya resuelto arriba para tipo/fase)
    frentes.forEach(f => { if (seen.has(f.name) && !PANELES.includes(f.name)) PANELES.push(f.name); });
    return {PANELES, tipo, fase, ventana: mesesVentana(), fueraDeVentana};
  }
  function loadFrentes(){
    try { const s = JSON.parse(localStorage.getItem("qaqc_maestro_frentes") || "null"); return Array.isArray(s) ? s : null; } catch(e){ return null; }
  }
  // Al abrir la app (y al cargar un Maestro) se recalcula la lista de paneles según la fecha de hoy,
  // así el cambio de mes productivo se refleja solo, sin tener que volver a cargar el Maestro.
  let CICLO_PANELES_INFO = null;
  function aplicarCicloAPaneles(){
    const frentes = loadFrentes();
    if (!frentes || !frentes.length){ CICLO_PANELES_INFO = null; return; }
    const res = panelesDesdeFrentes(frentes);
    if (res.PANELES.length){
      MASTER.PANELES = res.PANELES;
      PANEL_DERIVE = {tipo: Object.assign({}, res.tipo), fase: Object.assign({}, res.fase)};
    }
    CICLO_PANELES_INFO = res;
  }
  aplicarCicloAPaneles();

  function updateMaestroBadges(){
    const meta = getMaestroMeta();
    const pillEl = document.getElementById("maestroPillText");
    const pill = document.getElementById("maestroPill");
    const statusEl = document.getElementById("maestroStatusText");
    const statusBadge = document.getElementById("maestroStatusBadge");
    if (meta){
      const txt = `Maestro: ${esc(meta.filename)} (${meta.updatedAt ? meta.updatedAt.slice(0,10) : ""})`;
      pillEl.textContent = txt; pill.className = "badge on";
      statusEl.textContent = txt; statusBadge.className = "badge on";
    } else {
      pillEl.textContent = "Maestro: datos de ejemplo"; pill.className = "badge off";
      statusEl.textContent = "Usando datos de ejemplo — carga tu maestro real"; statusBadge.className = "badge off";
    }
  }

  function renderMaestroPreview(){
    const wrap = document.getElementById("maestroPreview");
    let html = `<table class="maestro-table"><thead><tr><th>Lista / 列表</th><th>Cantidad / 数量</th><th>Valores / 值</th></tr></thead><tbody>`;
    MAESTRO_COLUMNS.forEach(col => {
      const vals = MASTER[col.key] || [];
      html += `<tr><td>${esc(col.es)}<br><span style="color:var(--ink-soft);font-size:11px">${esc(col.zh)}</span></td>` +
              `<td class="maestro-count">${vals.length}</td>` +
              `<td>${vals.slice(0,6).map(esc).join(", ")}${vals.length>6 ? " …" : ""}</td></tr>`;
    });
    html += `</tbody></table>`;
    wrap.innerHTML = html;
  }

  /* ============================================================
     Render: campos de encabezado
     ============================================================ */
  const headerState = {};

  // v3.3: llena "Semana" con las semanas del ciclo de la fecha del registro, preselecciona la que
  // contiene esa fecha, y escribe el "Mes productivo". Debajo muestra el ciclo y quién actualizó el Maestro.
  function refreshSemana(){
    const sel = document.querySelector('#headerFields [data-key="semana"]');
    const mpEl = document.querySelector('#headerFields [data-key="mesProductivo"]');
    const inf = document.getElementById("cicloInfo");
    const f = deIso(headerState.fecha) || soloFecha(new Date());
    const info = cicloDeFecha(f), semanas = semanasDelCiclo(info.ciclo.ini, info.ciclo.fin);
    if (sel){
      sel.innerHTML = semanas.map((b, i) => `<option value="${i+1}">Semana ${i+1} (${fmtCorta(b[0])} - ${fmtCorta(b[1])})</option>`).join("");
      const idx = semanas.findIndex(b => f >= b[0] && f <= b[1]);
      sel.value = String(idx === -1 ? 1 : idx + 1);
      headerState.semana = sel.value;
    }
    const mp = info.ciclo.anio + "-" + String(info.ciclo.mesNum).padStart(2,"0") + " " + info.ciclo.mes;
    if (mpEl){ mpEl.value = mp; }
    headerState.mesProductivo = mp;
    if (inf){
      let txt = "Ciclo " + info.ciclo.mes + " " + info.ciclo.anio + ": " + fmtFechaDMY(info.ciclo.ini) + " a " + fmtFechaDMY(info.ciclo.fin);
      if (CICLO_CFG.actualizadoPor || CICLO_CFG.fechaAct){
        txt += " · Maestro actualizado" + (CICLO_CFG.actualizadoPor ? " por " + CICLO_CFG.actualizadoPor : "") + (CICLO_CFG.fechaAct ? " el " + fmtFechaDMY(CICLO_CFG.fechaAct) : "");
      }
      if (CICLO_PANELES_INFO){
        txt += " · Paneles de: " + CICLO_PANELES_INFO.ventana.join(", ");
      }
      inf.style.color = "";
      if (info.vencido){
        txt += " · ⚠ El Maestro no trae el ciclo de esta fecha: cargue el Maestro actualizado / 主数据表缺少此日期的周期";
        inf.style.color = "var(--bad-ink, #c0392b)";
      } else if (CICLO_PANELES_INFO && CICLO_PANELES_INFO.fueraDeVentana){
        txt += " · ⚠ Ningún panel activo es del mes vigente: se muestran todos los activos. Actualice tblFronts / 没有当前月份的面板";
        inf.style.color = "var(--bad-ink, #c0392b)";
      }
      inf.textContent = txt;
    }
  }

  function buildHeaderFields(){
    const wrap = document.getElementById("headerFields");
    wrap.innerHTML = HEADER_FIELDS.map(f => {
      let control;
      if (f.type === "select"){
        const opts = (MASTER[f.list]||[]).map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
        // v3.2: opciones fijas adicionales (p.ej. "No aplica (NA)" / "No definido" para
        // Operador y Código de equipo), siempre disponibles aunque el maestro no las traiga.
        const extra = (f.extraOptions||[]).filter(v => !(MASTER[f.list]||[]).includes(v))
          .map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
        control = `<select data-key="${f.key}">${opts}${extra}</select>`;
      } else if (f.type === "date"){
        control = `<input type="date" data-key="${f.key}" value="${businessDateISO()}">`;
      } else if (f.type === "week"){
        // v3.3: semanas del ciclo productivo de la fecha elegida (ver refreshSemana)
        control = `<select data-key="${f.key}"></select>`;
      } else if (f.type === "readonly"){
        control = `<input type="text" data-key="${f.key}" readonly tabindex="-1" style="opacity:.85">`;
      } else if (f.type === "text_list"){
        const listId = "dl_" + f.key;
        const opts = (MASTER[f.list]||[]).map(v => `<option value="${esc(v)}">`).join("");
        control = `<input type="text" list="${listId}" data-key="${f.key}" placeholder="${esc(f.placeholder||"")}">
                   <datalist id="${listId}">${opts}</datalist>`;
      } else {
        control = `<input type="text" data-key="${f.key}" placeholder="${esc(f.placeholder||"")}">`;
      }
      return `<div class="field"><label>${esc(f.es)}<span class="zh">${esc(f.zh)}</span></label>${control}</div>`;
    }).join("") + `<div class="field"><label>ID Registro<span class="zh">记录ID</span></label><div class="readonly-val" id="idRegistroVal"></div></div>`
      + `<div id="cicloInfo" style="grid-column:1/-1;font-size:11px;color:var(--ink-soft);margin-top:-4px"></div>`;

    wrap.querySelectorAll("[data-key]").forEach(el => {
      headerState[el.dataset.key] = el.value;
      el.addEventListener("input", () => { headerState[el.dataset.key] = el.value; syncSignerNames(); });
    });
    headerState.id = genId();
    document.getElementById("idRegistroVal").textContent = headerState.id;

    // v3.3: Semana y Mes productivo según la fecha (se recalculan al cambiar la fecha)
    const fechaEl = wrap.querySelector('[data-key="fecha"]');
    if (fechaEl) fechaEl.addEventListener("change", refreshSemana);
    const semanaEl = wrap.querySelector('[data-key="semana"]');
    if (semanaEl) semanaEl.addEventListener("change", () => { headerState.semana = semanaEl.value; });
    refreshSemana();

    // Actividad filtrada por Fase: si el maestro cargado trae las listas de Preparación y
    // Producción separadas (ver tryParseRealMaestro -> actividadPorFase), el campo Actividad
    // (datalist) solo sugiere las de la Fase actualmente elegida. Sin esos datos (maestro de
    // ejemplo, o un maestro con el formato anterior de una sola lista), sigue mostrando todas.
    function refreshActividadOptions(){
      const dl = document.getElementById("dl_actividad");
      if (!dl) return;
      const faseVal = headerState.fase;
      const lista = (ACTIVIDAD_FASE && ACTIVIDAD_FASE[faseVal] && ACTIVIDAD_FASE[faseVal].length)
        ? ACTIVIDAD_FASE[faseVal]
        : (MASTER.ACTIVIDADES || []);
      dl.innerHTML = lista.map(v => `<option value="${esc(v)}">`).join("");
    }
    refreshActividadOptions();

    const faseEl = wrap.querySelector('[data-key="fase"]');
    if (faseEl){
      faseEl.addEventListener("change", () => { headerState.fase = faseEl.value; refreshActividadOptions(); refreshSubfase(); });
    }

    // v3.2: Subfase (p.ej. Recuperación) -- solo se habilita cuando la Fase es Preparación.
    // En cualquier otra fase queda fija en "N/A". Al elegir Recuperación se bloquean en N/A
    // los grupos que no aplican (ver applySubfaseLock).
    const subfaseEl = wrap.querySelector('[data-key="subfase"]');
    function refreshSubfase(){
      if (!subfaseEl) return;
      const esPrep = /preparaci/i.test(stripAccents(headerState.fase || ""));
      if (!esPrep){
        const naOpt = [...subfaseEl.options].find(o => !/recuperaci/i.test(stripAccents(o.value)));
        if (naOpt) subfaseEl.value = naOpt.value;
        headerState.subfase = subfaseEl.value;
      }
      subfaseEl.disabled = !esPrep;
      applySubfaseLock();
    }
    if (subfaseEl){
      subfaseEl.addEventListener("change", () => { headerState.subfase = subfaseEl.value; applySubfaseLock(); });
    }
    refreshSubfase();

    // Al elegir la Labor/Panel, autocompletar Categoría de explotación y Fase si el maestro
    // trae esa relación (deriva de la columna Name / Category del Maestro_Paneles real).
    const laborEl = wrap.querySelector('[data-key="labor"]');
    if (laborEl){
      laborEl.addEventListener("change", () => {
        const name = laborEl.value;
        const tipo = PANEL_DERIVE.tipo && PANEL_DERIVE.tipo[name];
        const fase = PANEL_DERIVE.fase && PANEL_DERIVE.fase[name];
        if (tipo){
          const el = wrap.querySelector('[data-key="categoriaExplotacion"]');
          if (el && [...el.options].some(o => o.value === tipo)){ el.value = tipo; headerState.categoriaExplotacion = tipo; }
        }
        if (fase){
          const el = wrap.querySelector('[data-key="fase"]');
          if (el && [...el.options].some(o => o.value === fase)){ el.value = fase; headerState.fase = fase; refreshActividadOptions(); refreshSubfase(); }
          // v3.2: si el maestro marca el panel como Recuperación, es Preparación + Subfase Recuperación
          else if (el && /recuperaci/i.test(stripAccents(fase))){
            const prep = [...el.options].find(o => /preparaci/i.test(stripAccents(o.value)));
            if (prep){ el.value = prep.value; headerState.fase = prep.value; refreshActividadOptions(); refreshSubfase(); }
            const rec = subfaseEl && [...subfaseEl.options].find(o => /recuperaci/i.test(stripAccents(o.value)));
            if (rec){ subfaseEl.value = rec.value; headerState.subfase = rec.value; applySubfaseLock(); }
          }
        }
      });
    }
  }

  /* ============================================================
     Contador de pasos (podómetro) — para estimar la distancia entre el
     ingreso a la labor y una condición subestándar reportada.
     100% offline: usa el sensor de movimiento del propio teléfono
     (DeviceMotionEvent), sin librerías externas ni conexión a internet.
     No existe un "conteo de pasos" nativo del sistema operativo expuesto
     a una página web -- se detectan los pasos a partir de picos en la
     magnitud de la aceleración (acelerómetro), con un filtro simple y un
     tiempo mínimo entre pasos para no contar de más. Por eso el número
     siempre queda editable a mano por ítem: es una ayuda, no un valor
     exacto, y el inspector puede corregirlo con su propio criterio
     (igual que hacía antes contando mentalmente).
     ============================================================ */
  let stepCounterActive = false;   // true entre "Iniciar" y "Detener"
  let stepListening = false;         // true mientras devicemotion está realmente escuchando (false = pausado)
  let stepSetupOK = false;           // true si el sensor quedó correctamente inicializado (permiso ok, soportado)
  let stepCount = 0;                 // pasos acumulados desde "Iniciar ingreso a labor"
  let stepSensorOK = false;          // true si devicemotion realmente está entregando datos
  let stepBaseline = null;           // línea base de la aceleración "en reposo" (gravedad), se adapta lento
  let stepInPeak = false;            // true mientras seguimos "dentro" del mismo pico (evita contar 2 veces)
  let stepPendingConfirm = false;    // true si ya vimos 1 muestra sobre el umbral, esperando una 2a seguida para confirmar
  let stepLastTs = 0;                // timestamp del último paso contado (para el "debounce")
  const STEP_MIN_INTERVAL_MS = 350;  // ~<=2.85 pasos/seg, evita contar el mismo paso 2 veces
  // Umbral de aceleración por encima de la línea base que cuenta como paso. Empezó en 1.15 (muy
  // sensible: contaba solo con sostener el teléfono en la mano), se subió a 3.2 tras el primer
  // reporte de campo (demasiado -- ya no detectaba pasos reales de forma confiable), y queda aquí
  // en un punto intermedio mientras se calibra con datos reales del sensor de cada teléfono (ver
  // el indicador "pico reciente" en pantalla, junto al contador, que muestra en vivo qué tan
  // fuerte detecta el sensor cada movimiento -- compararlo parado quieto vs. caminando es lo que
  // permite ajustar este número con precisión en vez de adivinar).
  const STEP_PEAK_THRESHOLD = 2.0;
  const STEP_BASELINE_ALPHA = 0.08;  // qué tan rápido se adapta la línea base (bajo = más lento/estable)
  let stepDebugMaxDelta = 0;         // mayor "mag - baseline" visto en la ventana reciente (para el indicador en pantalla)
  let stepDebugTimer = null;         // intervalo que refresca el indicador de sensibilidad en pantalla

  /* v3.4 -- Mejoras traídas del contador de Inspección de Labores (v4.1):
     - Punto de referencia elegible: la distancia se mide desde un lugar identificable.
     - Detector medido en TIEMPO (no en número de lecturas): igual en teléfonos de 60 o 200 lecturas/seg.
     - Velocidad > 2 m/s => conteo marcado como dudoso (vibración de equipos o carrera).
     - Factor m/paso POR INSPECTOR, calibrado caminando una distancia conocida con EPP y
       validado con rangos normales de marcha (largo de paso y cadencia).
     - Aviso flotante con el conteo (y la pausa) visible en todo el formulario.
     La lista de puntos de referencia se edita aquí abajo (puntosReferencia). */
  const PASOS_CFG = {
    umbral: STEP_PEAK_THRESHOLD,  // m/s2 sobre la línea base para considerar un pico
    intervaloMinMs: 400,          // tiempo mínimo entre pasos (tope 150 pasos/min)
    confirmacionMs: 30,           // el pico debe sostenerse este tiempo para contar
    constanteBaseMs: 300,         // rapidez con que la línea base sigue la gravedad/postura
    velocidadMax: 2.0,            // m/s: por encima, el conteo se marca como dudoso
    rangoFactor: [0.45, 0.90],    // largo de paso aceptable (m)
    rangoCadencia: [70, 140],     // pasos/min aceptables al calibrar
    factorDefecto: 0.70,          // respaldo si el inspector no ha calibrado
    puntosReferencia: [
      "Ingreso al panel / acceso",
      "Intersección más cercana",
      "Última estación topográfica",
      "Caja eléctrica / nicho"
    ]
  };
  let stepMode = null;               // null | "conteo" | "calibracion"
  let stepPrevT = null;              // tiempo de la lectura anterior (línea base en tiempo)
  let stepOverSince = null;          // desde cuándo la señal está sobre el umbral (confirmación)
  let stepRecentTimes = [];          // tiempos de los últimos pasos (para la velocidad)
  let stepVelAlerts = 0;             // veces que el conteo superó la velocidad máxima
  let stepDudosoNow = false;         // velocidad actual por encima de la máxima
  let stepCalib = null;              // {pasos, t0, t1} durante la calibración

  function stepNow(){ return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function stepInspector(){ return (headerState.inspector || "").trim(); }
  function stepProfiles(){ try{ return JSON.parse(localStorage.getItem("qaqc_step_profiles") || "{}"); }catch(e){ return {}; } }
  function stepProfile(){ const i = stepInspector(); return i ? (stepProfiles()[i] || null) : null; }
  function saveStepProfile(dato){
    const i = stepInspector(); if (!i) return;
    const all = stepProfiles(); all[i] = dato;
    try{ localStorage.setItem("qaqc_step_profiles", JSON.stringify(all)); }catch(e){}
  }
  // Factor y de dónde sale: calibración/manual del inspector, o el factor del dispositivo como respaldo.
  function stepFactorInfo(){
    const p = stepProfile();
    if (p && p.f) return {f: p.f, origen: p.origen === "manual" ? "manual del inspector" : "calibrado por el inspector"};
    const saved = parseFloat(localStorage.getItem("qaqc_step_factor"));
    if (!isNaN(saved) && saved > 0) return {f: saved, origen: "factor del dispositivo (sin calibrar)"};
    return {f: PASOS_CFG.factorDefecto, origen: "respaldo (sin calibrar)"};
  }
  function stepRefActual(){
    const sel = document.getElementById("stepRefSelect");
    if (!sel) return "";
    if (sel.value === "__otro"){
      const t = (document.getElementById("stepRefOtro").value || "").trim();
      return t || "Punto de referencia";
    }
    return sel.value;
  }
  function refreshAllItemDistances(){
    document.querySelectorAll('.item-row').forEach(row => row.dispatchEvent(new CustomEvent("qaqc:refreshdist")));
  }

  function getCalibrationFactor(){
    // v3.4: el factor es del INSPECTOR (su calibración); si no ha calibrado, se usa el del dispositivo.
    return stepFactorInfo().f;
  }

  function fmtDist(steps){
    const factor = getCalibrationFactor();
    return (steps * factor).toFixed(1);
  }

  // Refresca dos veces por segundo el indicador "pico reciente" (más fácil de leer que un
  // número que cambia 30-60 veces/seg) y lo vuelve a poner en 0 para la siguiente ventana.
  function updateStepDebugDisplay(){
    const val = document.getElementById("stepDebugVal");
    if (val) val.textContent = stepDebugMaxDelta.toFixed(2);
    stepDebugMaxDelta = 0;
  }

  function updateStepCounterUI(){
    const display = document.getElementById("stepCounterDisplay");
    const val = document.getElementById("stepCountVal");
    const dist = document.getElementById("stepDistVal");
    const pausedBadge = document.getElementById("stepPausedBadge");
    const resumeBtn = document.getElementById("btnStepResume");
    if (!display) return;
    display.hidden = !stepCounterActive && stepCount === 0;
    val.textContent = String(stepCount);
    dist.textContent = "≈ " + fmtDist(stepCount) + " m";
    document.getElementById("btnStepStart").hidden = stepCounterActive;
    document.getElementById("btnStepStop").hidden = !stepCounterActive;
    // "Reanudar" solo tiene sentido si el sensor quedó bien inicializado
    // (si nunca funcionó -- sin soporte o permiso denegado -- no hay nada que reanudar).
    const paused = stepCounterActive && stepSetupOK && !stepListening;
    resumeBtn.hidden = !paused;
    pausedBadge.hidden = !paused;
    // v3.4
    const calibrando = stepMode === "calibracion";
    const startBtn = document.getElementById("btnStepStart");
    startBtn.hidden = stepCounterActive || calibrando;
    // Solo se redibuja si cambia: redibujarlo durante un toque hace que ese toque se pierda.
    const startMode = stepCount > 0 ? "nuevo" : "inicio";
    if (startBtn.dataset.mode !== startMode){
      startBtn.dataset.mode = startMode;
      startBtn.innerHTML = startMode === "nuevo"
        ? '↺ Nuevo conteo desde otro punto <span style="opacity:.8;font-weight:500">/ 从新参考点重新计数</span>'
        : '▶ Iniciar en el punto de referencia <span style="opacity:.8;font-weight:500">/ 从参考点开始</span>';
    }
    const dud = document.getElementById("stepDudosoBadge");
    if (dud) dud.hidden = !stepDudosoNow;
    const fi = stepFactorInfo();
    const ft = document.getElementById("stepFactorTxt");
    if (ft) ft.textContent = fi.f.toFixed(2);
    const fin = document.getElementById("stepFactorInput");
    if (fin && document.activeElement !== fin) fin.value = fi.f.toFixed(2);
    const info = document.getElementById("stepCalibInfo");
    if (info){
      const insp = stepInspector(), p = stepProfile();
      info.innerHTML = !insp ? "Selecciona el inspector para ver y calibrar su paso. <span class=\"zh\">请先选择检查员。</span>"
        : esc(insp.split(" ")[0]) + ": <b>" + fi.f.toFixed(2) + " m/paso</b> — " + esc(fi.origen)
          + (p && p.fecha ? " (" + new Date(p.fecha).toLocaleDateString("es-CO") + (p.cadencia ? ", " + p.cadencia + " pasos/min" : "") + ")" : "");
    }
    document.getElementById("btnCalibStart").hidden = calibrando || stepCounterActive;
    document.getElementById("btnCalibEnd").hidden = !calibrando;
    const cc = document.getElementById("stepCalibCount");
    cc.hidden = !calibrando;
    if (calibrando) cc.textContent = stepCalib.pasos + " pasos…";
    // Aviso flotante: visible en todo el formulario mientras se cuenta o está en pausa
    let pill = document.getElementById("stepPill");
    if (!pill){
      pill = document.createElement("div");
      pill.id = "stepPill"; pill.className = "step-pill";
      pill.addEventListener("click", () => {
        if (stepCounterActive && stepSetupOK && !stepListening) resumeStepCounter();
        else document.getElementById("stepCounterCard").scrollIntoView({behavior:"smooth", block:"center"});
      });
      document.body.appendChild(pill);
    }
    const enNuevo = document.body.getAttribute("data-local-tab") === "nuevo";
    pill.hidden = !(stepCounterActive || calibrando) || !enNuevo;
    pill.classList.toggle("pausa", paused);
    pill.textContent = paused ? "📍 EN PAUSA · toca para reanudar / 暂停·点击继续"
      : calibrando ? "📍 " + stepCalib.pasos + " pasos (calibrando)"
      : "📍 " + stepCount + " pasos ≈ " + fmtDist(stepCount) + " m" + (stepDudosoNow ? " ⚠" : "");
  }

  // Detección de pasos a partir del acelerómetro: magnitud del vector de
  // aceleración (incluyendo gravedad, disponible en más dispositivos que
  // la aceleración "pura"). Se compara contra una línea base que se adapta
  // lentamente (para seguir la gravedad/postura, no el propio pico), con
  // histéresis: un paso cuenta cuando la señal sube claramente por encima
  // de la línea base (flanco de subida) y no se vuelve a contar hasta que
  // la señal baja de nuevo cerca de la línea base -- así una sola zancada
  // no se cuenta varias veces aunque lleguen muchas muestras del sensor
  // mientras dura el pico. Además hay un tiempo mínimo entre pasos.
  // Además, se exige que DOS muestras seguidas superen el umbral antes de
  // contar el paso (no solo una) -- esto filtra picos de una sola muestra
  // causados por ruido/vibración puntual, que de otra forma se contaban
  // como pasos aunque el teléfono estuviera quieto.
  // v3.4: detector medido en TIEMPO (igual que Inspección v4.1). Un paso cuenta cuando la
  // aceleración sube sobre la línea base más que el umbral y se SOSTIENE al menos
  // confirmacionMs; no se cuenta otro hasta que la señal baje (histéresis) y pase
  // intervaloMinMs desde el paso anterior. La línea base sigue lento a la gravedad/postura
  // y no se mueve mientras la señal está sobre el umbral (así el propio pico no la arrastra).
  function handleDeviceMotion(ev){
    const a = ev.accelerationIncludingGravity || ev.acceleration;
    if (!a || a.x == null) return;
    stepSensorOK = true;
    const mag = Math.sqrt((a.x||0)**2 + (a.y||0)**2 + (a.z||0)**2);
    const t = stepNow();
    const c = PASOS_CFG;
    if (stepBaseline == null){ stepBaseline = mag; stepPrevT = t; return; }
    const dt = Math.max(0, t - stepPrevT); stepPrevT = t;
    const delta = mag - stepBaseline;
    if (Math.abs(delta) > stepDebugMaxDelta) stepDebugMaxDelta = Math.abs(delta);
    if (stepInPeak){
      if (delta < c.umbral * 0.4) stepInPeak = false;
      return;
    }
    if (delta <= c.umbral) stepBaseline += (1 - Math.exp(-dt / c.constanteBaseMs)) * (mag - stepBaseline);
    if ((mag - stepBaseline) > c.umbral){
      if (stepOverSince == null) stepOverSince = t;
      if (t - stepOverSince >= c.confirmacionMs){
        stepInPeak = true; stepOverSince = null;
        if (t - stepLastTs > c.intervaloMinMs){
          stepLastTs = t;
          onStepDetected(t);
        }
        // pico dentro del intervalo mínimo: 2º golpe del mismo paso -> se consume sin contar
      }
    } else {
      stepOverSince = null;
    }
  }

  function onStepDetected(t){
    if (stepMode === "calibracion" && stepCalib){
      if (stepCalib.pasos === 0) stepCalib.t0 = t;
      stepCalib.pasos++; stepCalib.t1 = t;
      updateStepCounterUI();
      return;
    }
    stepCount++;
    // Velocidad sobre los últimos pasos: > velocidadMax => conteo dudoso
    stepRecentTimes.push(t); if (stepRecentTimes.length > 8) stepRecentTimes.shift();
    if (stepRecentTimes.length >= 6){
      const seg = (stepRecentTimes[stepRecentTimes.length-1] - stepRecentTimes[0]) / 1000;
      const v = seg > 0 ? ((stepRecentTimes.length - 1) * getCalibrationFactor()) / seg : 99;
      const dudoso = v > PASOS_CFG.velocidadMax;
      if (dudoso && !stepDudosoNow) stepVelAlerts++;
      stepDudosoNow = dudoso;
    }
    updateStepCounterUI();
  }

  // Pide el permiso del sensor (iOS lo exige desde un toque). Devuelve true si se puede usar.
  async function stepRequestSensor(noteEl){
    if (typeof DeviceMotionEvent === "undefined") return false;
    if (typeof DeviceMotionEvent.requestPermission === "function"){
      try{ return (await DeviceMotionEvent.requestPermission()) === "granted"; }catch(e){ return false; }
    }
    return true;
  }

  // ── Calibración por inspector (distancia conocida, con EPP) ──
  async function calibStart(){
    if (stepCounterActive){ toast("Detén el conteo antes de calibrar / 请先停止计数"); return; }
    if (!stepInspector()){ toast("Selecciona primero el inspector / 请先选择检查员"); return; }
    const m = parseFloat(document.getElementById("stepCalibMetros").value);
    if (!(m >= 10)){ toast("Indica la distancia conocida (mínimo 10 m) / 至少10米"); return; }
    if (!(await stepRequestSensor())){ toast("El sensor no está disponible: usa el factor manual / 传感器不可用"); return; }
    stepBaseline = null; stepInPeak = false; stepOverSince = null; stepLastTs = -1e9;
    stepCalib = {pasos: 0, t0: null, t1: null};
    stepMode = "calibracion";
    window.addEventListener("devicemotion", handleDeviceMotion);
    updateStepCounterUI();
    toast("Camina " + m + " m a tu paso normal y toca Terminar al llegar / 行走" + m + "米后点击结束");
  }
  function calibEnd(){
    window.removeEventListener("devicemotion", handleDeviceMotion);
    const c = stepCalib || {pasos: 0}; stepCalib = null; stepMode = null;
    const cfg = PASOS_CFG;
    const m = parseFloat(document.getElementById("stepCalibMetros").value);
    const p = c.pasos;
    updateStepCounterUI();
    if (p < 8){ toast("Solo se contaron " + p + " pasos. Repite con el teléfono en la mano o en el bolsillo del pecho."); return; }
    const f = Math.round(m / p * 100) / 100;
    const cad = (c.t1 > c.t0) ? Math.round((p - 1) / ((c.t1 - c.t0) / 60000)) : 0;
    if (f < cfg.rangoFactor[0] || f > cfg.rangoFactor[1]){
      toast("Paso de " + f + " m fuera de lo normal (" + cfg.rangoFactor.join("–") + " m). " +
            (f < cfg.rangoFactor[0] ? "Se contaron pasos de más (vibración)." : "Se perdieron pasos.") + " Repite.");
      return;
    }
    if (cad && (cad < cfg.rangoCadencia[0] || cad > cfg.rangoCadencia[1])){
      toast("Cadencia de " + cad + " pasos/min fuera de lo normal (" + cfg.rangoCadencia.join("–") + "). Repite a ritmo normal.");
      return;
    }
    saveStepProfile({f, fecha: new Date().toISOString(), metros: m, pasos: p, cadencia: cad, origen: "calibración"});
    refreshAllItemDistances();
    updateStepCounterUI();
    toast("Calibrado: " + p + " pasos en " + m + " m → " + f + " m/paso ✓ / 校准完成");
  }

  async function startStepCounter(){
    if (stepMode === "calibracion"){ toast("Termina primero la calibración / 请先完成校准"); return; }
    if (!stepInspector()){
      toast("Selecciona primero el inspector (el factor de paso es personal) / 请先选择检查员");
      const el = document.querySelector('[data-key="inspector"]');
      if (el) el.scrollIntoView({behavior:"smooth", block:"center"});
      return;
    }
    if (stepCount > 0 && !confirm("¿Reiniciar el conteo desde cero en un nuevo punto de referencia?\n\n是否从新的参考点重新计数？")) return;
    stepRecentTimes = []; stepVelAlerts = 0; stepDudosoNow = false; stepOverSince = null; stepPrevT = null; stepMode = "conteo";
    stepCount = 0; stepBaseline = null; stepInPeak = false; stepPendingConfirm = false; stepLastTs = -1e9; stepSensorOK = false;
    stepCounterActive = true; stepListening = false; stepSetupOK = false;
    updateStepCounterUI();
    const noteEl = document.getElementById("stepCounterPermNote");
    noteEl.hidden = true; noteEl.classList.remove("perm-warn");

    if (typeof DeviceMotionEvent === "undefined"){
      noteEl.hidden = false; noteEl.classList.add("perm-warn");
      noteEl.innerHTML = "Este dispositivo/navegador no expone el sensor de movimiento -- el conteo automático no está disponible. Puedes escribir los pasos a mano en cada ítem.<span class=\"zh\">此设备/浏览器不提供运动传感器 -- 无法自动计数。可以在每项中手动输入步数。</span>";
      updateStepCounterUI();
      return;
    }
    // iOS 13+ exige pedir permiso explícito, y solo funciona si se llama
    // directamente desde un toque del usuario (por eso va aquí, dentro
    // del propio click de "Iniciar ingreso a labor").
    if (typeof DeviceMotionEvent.requestPermission === "function"){
      try{
        const res = await DeviceMotionEvent.requestPermission();
        if (res !== "granted"){
          noteEl.hidden = false; noteEl.classList.add("perm-warn");
          noteEl.innerHTML = "Permiso de sensor de movimiento denegado -- el conteo automático no funcionará. Puedes escribir los pasos a mano en cada ítem, o habilitar el permiso en Ajustes del teléfono y volver a intentar.<span class=\"zh\">运动传感器权限被拒绝 -- 无法自动计数。可以在每项中手动输入步数，或在手机设置中开启权限后重试。</span>";
          updateStepCounterUI();
          return;
        }
      } catch(e){
        noteEl.hidden = false; noteEl.classList.add("perm-warn");
        noteEl.innerHTML = "No se pudo solicitar el permiso del sensor -- el conteo automático no está disponible. Puedes escribir los pasos a mano en cada ítem.<span class=\"zh\">无法请求传感器权限 -- 无法自动计数。可以在每项中手动输入步数。</span>";
        updateStepCounterUI();
        return;
      }
    }
    stepSetupOK = true;
    window.addEventListener("devicemotion", handleDeviceMotion);
    stepListening = true;
    updateStepCounterUI();
    const debugRow = document.getElementById("stepDebugRow");
    const debugThreshold = document.getElementById("stepDebugThreshold");
    if (debugThreshold) debugThreshold.textContent = STEP_PEAK_THRESHOLD.toFixed(2);
    if (debugRow) debugRow.hidden = false;
    stepDebugMaxDelta = 0;
    if (stepDebugTimer) clearInterval(stepDebugTimer);
    stepDebugTimer = setInterval(updateStepDebugDisplay, 500);
    toast("Conteo iniciado en: " + stepRefActual() + " / 计数已开始");
  }

  function stopStepCounter(){
    stepCounterActive = false; stepListening = false; stepMode = null; stepDudosoNow = false;
    window.removeEventListener("devicemotion", handleDeviceMotion);
    updateStepCounterUI();
    const debugRow = document.getElementById("stepDebugRow");
    if (debugRow) debugRow.hidden = true;
    if (stepDebugTimer){ clearInterval(stepDebugTimer); stepDebugTimer = null; }
    toast("Conteo de pasos detenido (" + stepCount + " pasos) / 步数计数已停止");
  }

  // Pausa automática: se llama justo al tocar Cámara/Galería (antes de abrir la
  // foto), para que el manejo del teléfono al detenerse a documentar un hallazgo
  // NO sume pasos falsos. El conteo NO se reanuda solo -- requiere que el
  // inspector toque "Reanudar conteo" cuando retome la caminata, para que la
  // distancia guardada en cada ítem sea confiable.
  function pauseStepCounter(){
    if (!stepCounterActive || !stepListening) return;
    stepListening = false;
    window.removeEventListener("devicemotion", handleDeviceMotion);
    updateStepCounterUI();
  }

  function resumeStepCounter(){
    if (!stepCounterActive || stepListening || !stepSetupOK) return;
    // se reinicia la línea base al reanudar -- la orientación/posición del
    // teléfono pudo cambiar mientras se manejaba para tomar la foto.
    stepBaseline = null; stepInPeak = false; stepPendingConfirm = false;
    stepOverSince = null; stepPrevT = null; stepRecentTimes = []; stepDudosoNow = false; stepMode = "conteo";
    window.addEventListener("devicemotion", handleDeviceMotion);
    stepListening = true;
    updateStepCounterUI();
    toast("Conteo de pasos reanudado / 步数计数已继续");
  }

  function initStepCounter(){
    const savedFactor = localStorage.getItem("qaqc_step_factor");
    if (savedFactor) document.getElementById("stepFactorInput").value = savedFactor;
    // v3.4: el factor manual se guarda para el INSPECTOR seleccionado (validado); sin
    // inspector se conserva el comportamiento anterior (factor del dispositivo).
    document.getElementById("stepFactorInput").addEventListener("change", (e) => {
      const v = parseFloat(e.target.value);
      if (!(v >= PASOS_CFG.rangoFactor[0] && v <= PASOS_CFG.rangoFactor[1])){
        toast("Factor entre " + PASOS_CFG.rangoFactor.join(" y ") + " m/paso / 系数范围");
        updateStepCounterUI(); return;
      }
      if (stepInspector()) saveStepProfile({f: Math.round(v*100)/100, fecha: new Date().toISOString(), origen: "manual"});
      else localStorage.setItem("qaqc_step_factor", String(v));
      updateStepCounterUI();
      refreshAllItemDistances();
    });
    const refSel = document.getElementById("stepRefSelect");
    refSel.innerHTML = PASOS_CFG.puntosReferencia.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("")
      + '<option value="__otro">Otro (escribir) / 其他…</option>';
    refSel.addEventListener("change", () => {
      document.getElementById("stepRefOtro").hidden = refSel.value !== "__otro";
      if (stepCount > 0) toast("Nuevo punto: toca 'Nuevo conteo' al pararte en él / 新参考点");
    });
    document.getElementById("btnCalibStart").addEventListener("click", calibStart);
    document.getElementById("btnCalibEnd").addEventListener("click", calibEnd);
    const inspEl = document.querySelector('[data-key="inspector"]');
    if (inspEl) inspEl.addEventListener("change", () => { updateStepCounterUI(); refreshAllItemDistances(); });
    document.querySelectorAll(".tab-btn").forEach(b => b.addEventListener("click", () => setTimeout(updateStepCounterUI, 0)));
    document.getElementById("btnStepStart").addEventListener("click", startStepCounter);
    document.getElementById("btnStepStop").addEventListener("click", stopStepCounter);
    document.getElementById("btnStepResume").addEventListener("click", resumeStepCounter);
    updateStepCounterUI();
  }

  /* ============================================================
     Render: grupos e ítems
     ============================================================ */
  const itemState = []; // {uid, grupoEs, grupoZh, gi, idx, es, zh, status, obs, photo, steps, stepsManual}
  function buildGroups(){
    itemState.length = 0;
    const wrap = document.getElementById("groupsContainer");
    let html = "";
    GRUPOS.forEach((g, gi) => {
      html += `<div class="group" data-gi="${gi}">
        <div class="group-head">
          <div class="group-head-titles"><h3>${esc(g.es)}</h3><div class="zh">${esc(g.zh)}</div></div>
          <span class="group-progress" data-progress="${gi}">0/${g.items.length}</span>
        </div>`;
      if (g.nota){
        html += `<div class="group-note">${esc(g.nota.es)}<span class="zh">${esc(g.nota.zh)}</span></div>`;
      }
      g.items.forEach((it, ii) => {
        const uid = gi + "_" + ii;
        itemState.push({uid, grupoEs:g.es, grupoZh:g.zh, gi, idx:ii+1, es:it.es, zh:it.zh, status:"", obs:"", photo:"", steps:0, stepsManual:false, measureCm:null, measureLabel:""});
        html += `
        <div class="item-row" data-uid="${uid}">
          <div class="item-num">${ii+1}</div>
          <div class="item-text"><div class="t-es">${esc(it.es)}</div><div class="t-zh">${esc(it.zh)}</div></div>
          <div class="item-controls">
            <div class="status-group" role="radiogroup">
              <button type="button" class="status-btn status-ok" data-val="Cumple" aria-pressed="false">Cumple<span class="zh">符合</span></button>
              <button type="button" class="status-btn status-bad" data-val="No Cumple" aria-pressed="false">No cumple<span class="zh">不符合</span></button>
              <button type="button" class="status-btn status-na" data-val="N/A" aria-pressed="false">N/A<span class="zh">不适用</span></button>
            </div>
            <textarea data-role="obs" rows="1" placeholder="Observaciones / 备注 (opcional)"></textarea>
            <div class="evidence-row" data-role="evrow">
              <button type="button" class="ev-btn" data-role="camerabtn"><svg><use href="#ic-camera"/></svg>Cámara / 相机</button>
              <button type="button" class="ev-btn" data-role="gallerybtn"><svg><use href="#ic-gallery"/></svg>Galería / 相册</button>
              <input type="file" accept="image/*" capture="environment" hidden data-role="camerainput">
              <input type="file" accept="image/*" hidden data-role="galleryinput">
            </div>
            <div class="dist-row" data-role="distrow" hidden>
              <label>📍 Pasos desde el ingreso <span class="zh">距入口步数</span></label>
              <input type="number" min="0" step="1" inputmode="numeric" placeholder="0" data-role="stepsinput">
              <span class="dist-m" data-role="distm"></span>
            </div>
            <div class="measure-row" data-role="measurerow" hidden>
              <button type="button" class="ev-btn" data-role="measurebtn">📏 Medir en la foto <span class="zh">在照片中测量</span></button>
              <span class="measure-result-mini" data-role="measureresultmini"></span>
            </div>
          </div>
        </div>`;
      });
      html += `</div>`;
    });
    wrap.innerHTML = html;
    wireGroupEvents(wrap);
  }

  function wireGroupEvents(wrap){
    wrap.querySelectorAll(".item-row").forEach(row => {
      const uid = row.dataset.uid;
      const state = itemState.find(s => s.uid === uid);

      row.querySelectorAll(".status-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          if (state.locked) return; // v3.2: grupo en N/A automático (Subfase Recuperación)
          const val = btn.dataset.val;
          state.status = (state.status === val) ? "" : val;
          row.querySelectorAll(".status-btn").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.val === state.status)));
          row.classList.remove("answered-ok","answered-bad","answered-na");
          if (state.status === "Cumple") row.classList.add("answered-ok");
          if (state.status === "No Cumple") row.classList.add("answered-bad");
          if (state.status === "N/A") row.classList.add("answered-na");
          const obsEl = row.querySelector('[data-role="obs"]');
          obsEl.placeholder = state.status === "No Cumple"
            ? "Observación obligatoria / 必填备注"
            : "Observaciones / 备注 (opcional)";
          updateGroupProgress(row.closest(".group"));
        });
      });

      row.querySelector('[data-role="obs"]').addEventListener("input", e => { state.obs = e.target.value; });

      // Distancia (contador de pasos): el input queda oculto hasta que el
      // ítem tenga evidencia fotográfica adjunta (para no llenar de ruido
      // los ítems "Cumple"), pero el estado se puede seguir corrigiendo a
      // mano en cualquier momento -- incluso si nunca se usó el sensor.
      const distRow = row.querySelector('[data-role="distrow"]');
      const stepsInput = row.querySelector('[data-role="stepsinput"]');
      const distM = row.querySelector('[data-role="distm"]');
      function refreshDistDisplay(){
        distM.textContent = state.steps ? "≈ " + fmtDist(state.steps) + " m desde " + (state.stepsRef || stepRefActual()) + (state.stepsDudoso ? " ⚠ dudoso" : "") : "";
        updateThumbCaption(row, state);
      }
      stepsInput.addEventListener("input", () => {
        state.steps = parseInt(stepsInput.value, 10) || 0;
        state.stepsManual = true;
        state.stepsRef = state.stepsRef || stepRefActual();   // v3.4
        state.stepsDudoso = false;                            // corregido a mano por el inspector
        refreshDistDisplay();
      });
      row.addEventListener("qaqc:refreshdist", refreshDistDisplay);

      // Medición sobre la foto (regla de referencia: ducto/malla/otro).
      const measureRow = row.querySelector('[data-role="measurerow"]');
      row.querySelector('[data-role="measurebtn"]').addEventListener("click", () => {
        pauseStepCounter();
        openMeasureModal(row, state);
      });

      const camIn = row.querySelector('[data-role="camerainput"]');
      const galIn = row.querySelector('[data-role="galleryinput"]');
      // Pausar el conteo de pasos justo al TOCAR el botón (antes de que se abra
      // la cámara/galería) -- así todo el manejo del teléfono para documentar
      // el hallazgo (encuadrar, tomar la foto, esperar a que cargue) queda
      // fuera del conteo, y no se suman pasos falsos por estar detenido.
      row.querySelector('[data-role="camerabtn"]').addEventListener("click", () => { pauseStepCounter(); camIn.click(); });
      row.querySelector('[data-role="gallerybtn"]').addEventListener("click", () => { pauseStepCounter(); galIn.click(); });
      [camIn, galIn].forEach(inp => inp.addEventListener("change", async () => {
        if (!inp.files || !inp.files[0]) return;
        try {
          const dataUrl = await compressImage(inp.files[0], 900, 0.62,
            {minSide: FOTO_MIN_LADO, watermark: evidenceWatermark(state)});
          state.photo = dataUrl;
          renderThumb(row, state);
          // Al tomar/adjuntar la evidencia -- el momento en que el inspector
          // "para" en la condición -- se guarda automáticamente el conteo de
          // pasos acumulado hasta ahora, si el contador está corriendo y el
          // inspector aún no corrigió el valor a mano.
          if (!state.stepsManual && (stepCounterActive || stepCount > 0)){
            state.steps = stepCount;
            state.stepsRef = stepRefActual();          // v3.4
            state.stepsDudoso = stepVelAlerts > 0;     // v3.4
            stepsInput.value = state.steps || "";
          }
          distRow.hidden = false;
          refreshDistDisplay();
          measureRow.hidden = false;
          updateMeasureRowUI(row, state);
          toast("Evidencia adjuntada / 已附加证据");
        } catch(e){
          if (e && e.code === "LOWRES"){
            showBlockingAlert("⚠ FOTO NO VÁLIDA / 照片无效",
              '<div style="font-size:13px;margin-bottom:8px">Ítem ' + (state.gi + 1) + '.' + state.idx + ': ' + esc(state.es) + '</div>'
              + '<div style="font-size:13px;margin-bottom:6px">La foto es muy pequeña (' + e.w + '×' + e.h + ' px) y no sirve como evidencia. <b>Debes tomarla o cargarla de nuevo.</b> No uses fotos reenviadas por WhatsApp ni capturas de pantalla.</div>'
              + '<div style="font-size:12px;color:var(--ink-soft,#93A2AD)">照片太小（' + e.w + '×' + e.h + ' 像素），不能作为证据。<b>请重新拍摄或上传。</b>不要使用微信/WhatsApp转发的照片或截图。</div>');
          } else {
            toast("No se pudo procesar la imagen / 无法处理图片");
          }
        }
        inp.value = "";
      }));
    });
  }

  function renderThumb(row, state){
    const evrow = row.querySelector('[data-role="evrow"]');
    let thumb = evrow.querySelector(".thumb-wrap");
    if (!thumb){
      thumb = document.createElement("div");
      thumb.className = "thumb-wrap";
      thumb.innerHTML = `<img alt="Evidencia"><button type="button" class="thumb-remove" title="Quitar">×</button>`;
      evrow.prepend(thumb);
      thumb.querySelector(".thumb-remove").addEventListener("click", () => {
        state.photo = ""; thumb.remove();
      });
    }
    thumb.querySelector("img").src = state.photo;
    updateThumbCaption(row, state);
  }

  // Pie de foto: muestra la distancia estimada superpuesta sobre la propia
  // miniatura de la evidencia (no solo en el campito aparte), para que quede
  // inseparable de la foto a simple vista -- sin tocar el texto libre de
  // "Observaciones".
  function updateThumbCaption(row, state){
    const thumb = row.querySelector(".thumb-wrap");
    if (!thumb) return;
    let cap = thumb.querySelector(".thumb-caption");
    if (state.steps){
      if (!cap){
        cap = document.createElement("div");
        cap.className = "thumb-caption";
        thumb.appendChild(cap);
      }
      cap.textContent = "📍≈" + fmtDist(state.steps) + "m";
    } else if (cap){
      cap.remove();
    }
  }

  function updateMeasureRowUI(row, state){
    if (!row) return;
    const btn = row.querySelector('[data-role="measurebtn"]');
    const mini = row.querySelector('[data-role="measureresultmini"]');
    if (!btn || !mini) return;
    if (state.measureCm){
      const lbl = state.measureLabel ? state.measureLabel + ": " : "";
      mini.textContent = "📏 " + lbl + "≈" + state.measureCm + " cm";
      btn.innerHTML = '✏️ Editar medida <span class="zh">编辑测量</span>';
    } else {
      mini.textContent = "";
      btn.innerHTML = '📏 Medir en la foto <span class="zh">在照片中测量</span>';
    }
  }

  /* ============================================================
     Medir en la foto (regla de referencia): a partir de un objeto de
     medida YA CONOCIDA que aparece en la propia foto (ducto de
     ventilación, cuadrícula de malla, u otro objeto que el inspector
     escriba), se calcula una escala aproximada de esa foto y con ella
     la medida de lo que se quiera (ancho de grieta, altura de un
     desprendimiento, etc.). 100% offline -- es solo geometría sobre
     <canvas>, sin ningún servicio externo.
     La lista de referencias conocidas (ducto=90cm, malla=10cm, etc.) se
     alimenta desde la pestaña Maestro / 主表 (columna REFERENCIAS_MEDIDA,
     formato "Nombre = centímetros" por fila) -- así se pueden agregar o
     afinar referencias propias de cada operación sin tocar el código.
     IMPORTANTE (limitación real, no de la implementación): solo es
     confiable si el objeto de referencia y lo medido están más o menos
     en el mismo plano/distancia de la cámara y la foto es de frente,
     no en ángulo -- igual que la técnica de campo con el martillo.
     ============================================================ */
  function parseMeasureRefs(){
    const raw = (MASTER && MASTER.REFERENCIAS_MEDIDA) || [];
    const list = [];
    raw.forEach(line => {
      const m = String(line || "").split("=");
      if (m.length < 2) return;
      const label = m[0].trim();
      const cm = parseFloat(m.slice(1).join("=").trim());
      if (label && !isNaN(cm) && cm > 0) list.push({key: "ref" + list.length, label, cm});
    });
    return list;
  }

  let measureRowEl = null;     // <div class="item-row"> que se está midiendo
  let measureItemState = null; // itemState entry correspondiente
  let measureImg = null;
  let measurePoints = [];        // puntos del par que se está marcando ahora mismo
  let measureRefPoints = null;   // par ya confirmado (referencia)
  let measureRefPxDist = null;
  let measureTargetPoints = null; // par ya confirmado (lo que se mide)

  function buildMeasureRefOptions(){
    const wrap = document.getElementById("measureRefs");
    const prevChecked = (document.querySelector('input[name="measureRef"]:checked') || {}).value;
    const refs = parseMeasureRefs();
    let html = refs.map((r, i) => `
      <label class="measure-ref-opt"><input type="radio" name="measureRef" value="${esc(r.key)}" data-cm="${r.cm}" ${i===0 ? "checked":""}>
        ${esc(r.label)} — ${r.cm} cm</label>`).join("");
    html += `<label class="measure-ref-opt"><input type="radio" name="measureRef" value="otro"> Otro objeto / medida personalizada <span class="zh">其他/自定义</span></label>`;
    wrap.innerHTML = html;
    // restaura la selección previa si sigue existiendo (ej. al reabrir el modal)
    if (prevChecked && wrap.querySelector(`input[value="${CSS.escape(prevChecked)}"]`)){
      wrap.querySelector(`input[value="${CSS.escape(prevChecked)}"]`).checked = true;
    }
    wrap.querySelectorAll('input[name="measureRef"]').forEach(r => r.addEventListener("change", () => {
      updateMeasureRefExtraVisibility();
      if (measureTargetPoints) showMeasureResult();
    }));
  }
  function currentMeasureRefKey(){
    const el = document.querySelector('input[name="measureRef"]:checked');
    return el ? el.value : "otro";
  }
  function currentMeasureRefBaseCm(){
    const el = document.querySelector('input[name="measureRef"]:checked');
    if (!el || el.value === "otro") return parseFloat(document.getElementById("measureOtroCm").value) || 0;
    return parseFloat(el.dataset.cm) || 0;
  }
  function currentMeasureRefCm(){
    const key = currentMeasureRefKey();
    const base = currentMeasureRefBaseCm();
    if (key === "otro") return base; // el multiplicador no aplica a "otro": ahí ya se escribe la medida exacta
    const mult = parseFloat(document.getElementById("measureMultInput").value) || 1;
    return base * mult;
  }
  function updateMeasureRefExtraVisibility(){
    const ref = currentMeasureRefKey();
    document.getElementById("measureMultExtra").hidden = ref === "otro";
    document.getElementById("measureOtroExtra").hidden = ref !== "otro";
  }
  function updateMeasureInstruction(){
    const el = document.getElementById("measureInstruction");
    if (!measureRefPoints){
      el.innerHTML = 'Paso 1: toca los DOS extremos de la referencia en la foto.<span class="zh">第1步：在照片中点击参照物的两端。</span>';
    } else if (!measureTargetPoints){
      el.innerHTML = 'Paso 2: toca los DOS extremos de lo que quieres medir.<span class="zh">第2步：点击要测量物体的两端。</span>';
    } else {
      el.innerHTML = 'Listo -- puedes guardar, o "Rehacer puntos" para repetir.<span class="zh">完成 -- 可以保存，或点击"重新标记"重新开始。</span>';
    }
  }
  function pxDist(a, b){ return Math.hypot(a.x - b.x, a.y - b.y); }

  function redrawMeasureCanvas(){
    const canvas = document.getElementById("measureCanvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (measureImg) ctx.drawImage(measureImg, 0, 0, canvas.width, canvas.height);
    function drawPair(pts, color){
      if (!pts || !pts.length) return;
      ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 2;
      pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI*2); ctx.fill(); });
      if (pts.length === 2){ ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.stroke(); }
    }
    drawPair(measureRefPoints, "#F2701D");
    drawPair(measureTargetPoints, "#4FD1C5");
    if (!measureRefPoints) drawPair(measurePoints, "#F2701D");
    else if (!measureTargetPoints) drawPair(measurePoints, "#4FD1C5");
  }

  function showMeasureResult(){
    const refCm = currentMeasureRefCm();
    const resEl = document.getElementById("measureResult");
    if (!refCm || refCm <= 0 || !measureRefPxDist || !measureTargetPoints){ resEl.hidden = true; return; }
    const targetPxDist = pxDist(measureTargetPoints[0], measureTargetPoints[1]);
    const cmPerPx = refCm / measureRefPxDist;
    const resultCm = targetPxDist * cmPerPx;
    resEl.hidden = false;
    resEl.textContent = "Medida estimada: ≈ " + resultCm.toFixed(1) + " cm";
    resEl.dataset.cm = resultCm.toFixed(1);
    document.getElementById("measureLabelRow").hidden = false;
    document.getElementById("measureModalSave").disabled = false;
  }

  function handleMeasureCanvasClick(ev){
    if (measureTargetPoints) return; // ya se marcaron ambos pares
    const canvas = document.getElementById("measureCanvas");
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    const x = (ev.clientX - rect.left) * scaleX;
    const y = (ev.clientY - rect.top) * scaleY;
    measurePoints.push({x, y});
    if (measurePoints.length === 2){
      if (!measureRefPoints){
        measureRefPoints = measurePoints;
        measureRefPxDist = pxDist(measureRefPoints[0], measureRefPoints[1]);
      } else {
        measureTargetPoints = measurePoints;
        showMeasureResult();
      }
      measurePoints = [];
    }
    updateMeasureInstruction();
    redrawMeasureCanvas();
  }

  function resetMeasurePoints(){
    measurePoints = []; measureRefPoints = null; measureRefPxDist = null; measureTargetPoints = null;
    document.getElementById("measureResult").hidden = true;
    document.getElementById("measureLabelRow").hidden = true;
    document.getElementById("measureModalSave").disabled = true;
    updateMeasureInstruction();
    redrawMeasureCanvas();
  }

  function openMeasureModal(row, state){
    measureRowEl = row; measureItemState = state;
    resetMeasurePoints();
    document.getElementById("measureLabelInput").value = state.measureLabel || "";
    buildMeasureRefOptions();
    updateMeasureRefExtraVisibility();
    const canvas = document.getElementById("measureCanvas");
    measureImg = new Image();
    measureImg.onload = () => {
      const wrapEl = canvas.parentElement;
      const maxW = Math.min(560, (wrapEl && wrapEl.clientWidth) || 320) || 320;
      const scale = Math.min(1, maxW / measureImg.width);
      canvas.width = Math.max(1, Math.round(measureImg.width * scale));
      canvas.height = Math.max(1, Math.round(measureImg.height * scale));
      redrawMeasureCanvas();
    };
    measureImg.src = state.photo;
    document.getElementById("measureModalBackdrop").hidden = false;
  }

  function closeMeasureModal(){
    document.getElementById("measureModalBackdrop").hidden = true;
    measureRowEl = null; measureItemState = null; measureImg = null;
  }

  function initMeasureModal(){
    buildMeasureRefOptions();
    document.getElementById("measureMultInput").addEventListener("input", () => { if (measureTargetPoints) showMeasureResult(); });
    document.getElementById("measureOtroCm").addEventListener("input", () => { if (measureTargetPoints) showMeasureResult(); });
    document.getElementById("measureCanvas").addEventListener("click", handleMeasureCanvasClick);
    document.getElementById("measureUndo").addEventListener("click", resetMeasurePoints);
    document.getElementById("measureModalClose").addEventListener("click", closeMeasureModal);
    document.getElementById("measureModalCancel").addEventListener("click", closeMeasureModal);
    document.getElementById("measureModalSave").addEventListener("click", () => {
      if (!measureItemState) return;
      const resEl = document.getElementById("measureResult");
      measureItemState.measureCm = parseFloat(resEl.dataset.cm) || null;
      measureItemState.measureLabel = document.getElementById("measureLabelInput").value.trim();
      updateMeasureRowUI(measureRowEl, measureItemState);
      toast("Medida guardada / 测量已保存");
      closeMeasureModal();
    });
  }

  /* ============================================================
     v3.2 · Subfase Recuperación (dentro de Preparación)
     Solo se diligencian los grupos de Ventilación/Servicios auxiliares,
     Eléctricos (energía) y Sostenimiento; los demás quedan en N/A
     automático y bloqueados. Si se cambia la subfase o la fase, los
     grupos se desbloquean y recuperan el estado que tenían antes.
     ============================================================ */
  const RECUP_GRUPOS_HABILITADOS = [/VENTILACI/i, /SERVICIOS/i, /ELECTRIC/i, /ENERG/i, /SOSTENIMIENTO/i];
  function isRecuperacion(){
    return /preparaci/i.test(stripAccents(headerState.fase || "")) && /recuperaci/i.test(stripAccents(headerState.subfase || ""));
  }
  function grupoHabilitadoEnRecuperacion(g){
    const n = stripAccents(g.es || "");
    return RECUP_GRUPOS_HABILITADOS.some(r => r.test(n));
  }
  function paintStatus(row, state){
    row.querySelectorAll(".status-btn").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.val === state.status)));
    row.classList.remove("answered-ok","answered-bad","answered-na");
    if (state.status === "Cumple") row.classList.add("answered-ok");
    if (state.status === "No Cumple") row.classList.add("answered-bad");
    if (state.status === "N/A") row.classList.add("answered-na");
  }
  function applySubfaseLock(){
    const container = document.getElementById("groupsContainer");
    if (!container) return;
    const recup = isRecuperacion();
    container.querySelectorAll(".group").forEach(groupEl => {
      const g = GRUPOS[+groupEl.dataset.gi];
      if (!g) return;
      const lock = recup && !grupoHabilitadoEnRecuperacion(g);
      groupEl.classList.toggle("group-locked", lock);
      let note = groupEl.querySelector(".group-lock-note");
      if (lock && !note){
        note = document.createElement("div");
        note.className = "group-lock-note";
        note.innerHTML = 'Subfase Recuperación: este grupo no aplica — N/A automático<span class="zh">回采子阶段：此检查组不适用 — 自动填写N/A</span>';
        groupEl.querySelector(".group-head").insertAdjacentElement("afterend", note);
      } else if (!lock && note){
        note.remove();
      }
      groupEl.querySelectorAll(".item-row").forEach(row => {
        const state = itemState.find(x => x.uid === row.dataset.uid);
        if (!state) return;
        if (lock && !state.locked){
          state.prevStatus = state.status;
          state.status = "N/A";
          state.locked = true;
        } else if (!lock && state.locked){
          state.status = state.prevStatus || "";
          state.prevStatus = "";
          state.locked = false;
        }
        row.querySelectorAll("button, textarea, input").forEach(el => { el.disabled = !!state.locked; });
        paintStatus(row, state);
      });
      updateGroupProgress(groupEl);
    });
  }

  function updateGroupProgress(groupEl){
    const gi = groupEl.dataset.gi;
    const rows = groupEl.querySelectorAll(".item-row");
    let answered = 0;
    rows.forEach(r => { const s = itemState.find(x => x.uid === r.dataset.uid); if (s.status) answered++; });
    groupEl.querySelector(`[data-progress="${gi}"]`).textContent = answered + "/" + rows.length;
  }

  /* ============================================================
     Render: firmas
     ============================================================ */
  const sigState = {}; // key -> {name, dataUrl, ts}
  function buildSignatures(){
    const wrap = document.getElementById("sigGrid");
    wrap.innerHTML = SIGNERS.map(s => `
      <div class="sig-card" data-signer="${s.key}">
        <h4>${esc(s.es)}${s.optional ? ' <span class="sig-optional">(opcional / 可选)</span>' : ""}</h4><div class="zh">${esc(s.zh)}</div>
        <div class="sig-name" data-role="signame">—</div>
        <div class="sig-pad-wrap"><canvas class="sig-pad"></canvas></div>
        <div class="sig-actions">
          <button type="button" class="sig-btn" data-role="clear">Limpiar</button>
          <button type="button" class="sig-btn confirm" data-role="confirm">Confirmar</button>
        </div>
        <div class="sig-status" data-role="sigstatus">Sin firmar / 未签名</div>
      </div>
    `).join("");

    SIGNERS.forEach(s => {
      const card = wrap.querySelector(`[data-signer="${s.key}"]`);
      const canvas = card.querySelector("canvas");
      setupPad(canvas);
      sigState[s.key] = {name:"", dataUrl:"", ts:""};

      card.querySelector('[data-role="clear"]').addEventListener("click", () => {
        clearPad(canvas); sigState[s.key].dataUrl = ""; sigState[s.key].ts = "";
        card.querySelector('[data-role="sigstatus"]').textContent = "Sin firmar / 未签名";
        card.querySelector('[data-role="sigstatus"]').classList.remove("done");
      });
      card.querySelector('[data-role="confirm"]').addEventListener("click", () => {
        if (canvas.dataset.blank !== "false"){ toast("Dibuje la firma antes de confirmar"); return; }
        sigState[s.key].dataUrl = canvas.toDataURL("image/png");
        sigState[s.key].name = headerState[s.nameField] || "";
        sigState[s.key].ts = nowStamp();
        const st = card.querySelector('[data-role="sigstatus"]');
        st.textContent = "Firmado " + sigState[s.key].ts; st.classList.add("done");
        toast(s.es + " confirmada");
      });
    });
    syncSignerNames();
  }

  function syncSignerNames(){
    SIGNERS.forEach(s => {
      const el = document.querySelector(`.sig-card[data-signer="${s.key}"] [data-role="signame"]`);
      if (el) el.textContent = headerState[s.nameField] || "Seleccione en Datos generales";
    });
  }

  function setupPad(canvas){
    function fit(){
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = rect.width * ratio; canvas.height = rect.height * ratio;
      const ctx = canvas.getContext("2d");
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue("--ink");
    }
    fit();
    canvas.dataset.blank = "true";
    let drawing = false, last = null;
    const ctx = canvas.getContext("2d");
    function pos(e){
      const r = canvas.getBoundingClientRect();
      return {x: e.clientX - r.left, y: e.clientY - r.top};
    }
    canvas.addEventListener("pointerdown", e => {
      drawing = true; canvas.setPointerCapture(e.pointerId); last = pos(e); canvas.dataset.blank = "false";
    });
    canvas.addEventListener("pointermove", e => {
      if (!drawing) return;
      const p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p;
    });
    ["pointerup","pointerleave","pointercancel"].forEach(ev => canvas.addEventListener(ev, () => drawing = false));
    window.addEventListener("resize", () => { if (canvas.dataset.blank === "true") fit(); });
  }
  function clearPad(canvas){
    const ctx = canvas.getContext("2d");
    ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,canvas.width,canvas.height); ctx.restore();
    canvas.dataset.blank = "true";
  }

  /* ============================================================
     Persistencia: localStorage puro (sin backend)
     ============================================================ */
  function getRecords(){
    try { return JSON.parse(localStorage.getItem("qaqc_records") || "[]"); } catch(e){ return []; }
  }
  function setRecords(arr){ localStorage.setItem("qaqc_records", JSON.stringify(arr)); }

  function collectRecord(){
    const groups = GRUPOS.map((g, gi) => ({
      es: g.es, zh: g.zh, nota: g.nota,
      items: g.items.map((it, ii) => {
        const s = itemState.find(x => x.uid === gi + "_" + ii);
        const distanceM = s.steps ? +(s.steps * getCalibrationFactor()).toFixed(1) : null;
        return {es: it.es, zh: it.zh, status:s.status, obs:s.obs, photo:s.photo, steps:s.steps||0, distanceM,
                stepsRef: s.steps ? (s.stepsRef || "") : "", stepsDudoso: !!(s.steps && s.stepsDudoso),
                measureCm: s.measureCm || null, measureLabel: s.measureLabel || ""};
      })
    }));
    const answered = itemState.filter(s => s.status);
    const cumple = itemState.filter(s => s.status === "Cumple").length;
    const noCumple = itemState.filter(s => s.status === "No Cumple").length;
    const na = itemState.filter(s => s.status === "N/A").length;
    const denom = (cumple + noCumple);
    const pct = denom ? Math.round((cumple/denom)*1000)/10 : null;
    return {
      id: headerState.id,
      header: Object.assign({}, headerState),
      groups,
      totals: {total: itemState.length, answered: answered.length, cumple, noCumple, na, pct},
      signatures: Object.assign({}, sigState),
      capturedAt: nowStamp(),
      appVersion: APP_VERSION,
      pasos: (function(){ const fi = stepFactorInfo();   // v3.4: resumen del contador
        return {referencia: stepRefActual(), factor: fi.f, origenFactor: fi.origen, total: stepCount, alertasVelocidad: stepVelAlerts}; })()
    };
  }

  function recordCardHTML(rec){
    const pct = rec.totals.pct;
    const ruleClass = pct == null ? "mid" : (pct >= 90 ? "ok" : pct >= 70 ? "mid" : "bad");
    const h = rec.header;
    const detailGroups = rec.groups.map(g => {
      const rows = g.items.map(it => {
        const pillClass = it.status === "Cumple" ? "ok" : it.status === "No Cumple" ? "bad" : it.status === "N/A" ? "na" : "blank";
        const pillTxt = it.status || "—";
        const distCaption = it.photo && it.steps ? `<div class="thumb-caption">📍≈${it.distanceM}m</div>` : "";
        const img = it.photo ? `<div class="detail-img-wrap">${distCaption}<img src="${it.photo}" alt="evidencia"></div>` : "";
        const obs = it.obs ? `<span class="dobs">${esc(it.obs)}</span>` : "";
        const dist = it.steps ? (it.stepsRef
          ? `<span class="dobs">📍 ${it.steps} pasos ≈ ${it.distanceM} m desde ${esc(it.stepsRef)} / 距参考点约${it.distanceM}米${it.stepsDudoso ? " ⚠ conteo dudoso / 计数可疑" : ""}</span>`
          : `<span class="dobs">📍 ${it.steps} pasos ≈ ${it.distanceM} m desde el ingreso / 距入口约${it.distanceM}米</span>`) : "";
        const meas = it.measureCm ? `<span class="dobs">📏 ${it.measureLabel ? esc(it.measureLabel) + ": " : ""}≈ ${it.measureCm} cm / 约${it.measureCm}厘米</span>` : "";
        return `<div class="detail-item"><span class="pill ${pillClass}">${esc(pillTxt)}</span><span class="dtext">${esc(it.es)}${obs}${dist}${meas}</span>${img}</div>`;
      }).join("");
      return `<div class="detail-group"><h5>${esc(g.es)} <span style="color:var(--ink-soft);font-weight:400">${esc(g.zh)}</span></h5>${rows}</div>`;
    }).join("");
    // v3.2: la firma del operador es opcional -- no cuenta como "pendiente" ni vence,
    // pero si la ventana del turno sigue abierta se puede agregar desde "Completar firmas".
    const unsignedSigners = SIGNERS.filter(s => !(rec.signatures[s.key] && rec.signatures[s.key].dataUrl));
    const pendingSigners = unsignedSigners.filter(s => !s.optional);
    const sigWindowOpen = canCompleteSignatures(rec);
    const sigStrip = SIGNERS.map(s => {
      const sd = rec.signatures[s.key] || {};
      const img = sd.dataUrl ? `<img src="${sd.dataUrl}">`
        : `<div style="width:120px;height:44px;background:var(--surface-2);border:1px solid var(--border-soft);border-radius:6px"></div>`;
      const optTxt = (!sd.dataUrl && s.optional) ? " · opcional / 可选" : "";
      return `<div class="sigmini">${img}<div>${esc(s.es)}${sd.name ? " — " + esc(sd.name) : ""}${sd.ts ? " · " + esc(sd.ts) : ""}${optTxt}</div></div>`;
    }).join("");

    return `<div class="record-card" data-record-id="${esc(rec.id)}">
      <div class="record-head">
        <div class="record-rule ${ruleClass}"></div>
        <div class="record-main">
          <div class="record-top">
            <span class="record-id">${esc(rec.id)}</span>
            <span class="record-pct">${pct == null ? "—" : pct + "%"} cumplimiento</span>
            ${pendingSigners.length ? (sigWindowOpen ? `<span class="pill bad">Firma pendiente / 待签名</span>` : `<span class="pill na">Firma vencida / 签名已过期</span>`) : ""}
          </div>
          <div class="record-title">${esc(h.labor || "Labor s/d")} · ${esc(h.categoriaExplotacion || "")}</div>
          <div class="record-meta">
            <span><b>Fecha:</b> ${esc(h.fecha||"—")}</span>
            <span><b>Turno:</b> ${esc(h.turno||"—")}</span>
            <span><b>Guardia:</b> ${esc(h.guardia||"—")}</span>
            ${h.semana ? `<span><b>Semana:</b> ${esc(h.semana)} · ${esc(h.mesProductivo||"")}</span>` : ""}
            <span><b>Fase:</b> ${esc(h.fase||"—")}${h.subfase && /recuperaci/i.test(stripAccents(h.subfase)) ? " · " + esc(h.subfase) : ""}</span>
            <span><b>Inspector:</b> ${esc(h.inspector||"—")}</span>
            <span><b>Ítems:</b> ${rec.totals.cumple} cumple / ${rec.totals.noCumple} no cumple / ${rec.totals.na} n/a</span>
            <span><b>App:</b> ${rec.appVersion ? "v" + esc(rec.appVersion) : '<span class="pill na">anterior a v3.1 / 旧版本</span>'}</span>
          </div>
        </div>
      </div>
      <details><summary>Ver detalle de los ${GRUPOS.length} grupos y firmas / 查看${GRUPOS.length}个检查组和签名详情</summary>
        ${detailGroups}
        <div class="sig-strip">${sigStrip}</div>
        <div class="record-actions">
          <button type="button" class="btn btn-primary btn-sm" data-act="export-pdf" data-id="${esc(rec.id)}">Descargar PDF <span style="opacity:.8;font-weight:500">/ 下载PDF</span></button>
          ${unsignedSigners.length ? (sigWindowOpen
            ? `<button type="button" class="btn btn-ghost btn-sm" data-act="complete-sig" data-id="${esc(rec.id)}">Completar firmas (${unsignedSigners.length}) <span style="opacity:.8;font-weight:500">/ 补签(${unsignedSigners.length})</span></button>`
            : (pendingSigners.length ? `<button type="button" class="btn btn-ghost btn-sm" disabled title="El turno de este registro ya terminó / 该记录所属班次已结束">Firma vencida (${pendingSigners.length}) <span style="opacity:.8;font-weight:500">/ 签名已过期</span></button>` : "")
          ) : ""}
          <button type="button" class="btn btn-ghost btn-sm" data-act="export-xlsx" data-id="${esc(rec.id)}">Descargar Excel</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="export-csv" data-id="${esc(rec.id)}">CSV</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="delete" data-id="${esc(rec.id)}">Eliminar</button>
        </div>
      </details>
    </div>`;
  }

  function resetForm(){
    itemState.forEach(s => { s.status=""; s.obs=""; s.photo=""; s.steps=0; s.stepsManual=false; s.stepsRef=""; s.stepsDudoso=false; s.measureCm=null; s.measureLabel=""; });
    closeMeasureModal();
    if (stepCounterActive) stopStepCounter();
    stepCount = 0; stepSetupOK = false; stepSensorOK = false;
    stepVelAlerts = 0; stepDudosoNow = false; stepRecentTimes = []; stepMode = null; stepCalib = null;   // v3.4
    { const rs = document.getElementById("stepRefSelect"); if (rs){ rs.selectedIndex = 0; document.getElementById("stepRefOtro").value = ""; document.getElementById("stepRefOtro").hidden = true; } }
    updateStepCounterUI();
    const permNote = document.getElementById("stepCounterPermNote");
    if (permNote){ permNote.hidden = true; permNote.classList.remove("perm-warn"); }
    buildGroups();
    applySubfaseLock(); // v3.2: conservar el N/A automático si sigue elegida la Subfase Recuperación
    SIGNERS.forEach(s => sigState[s.key] = {name:"", dataUrl:"", ts:""});
    buildSignatures();
    headerState.id = genId();
    document.getElementById("idRegistroVal").textContent = headerState.id;
  }

  document.getElementById("btnReset").addEventListener("click", () => {
    if (confirm("¿Limpiar todo el formulario actual? / 清空当前表单？")) resetForm();
  });

  document.getElementById("btnSubmit").addEventListener("click", () => {
    const warn = document.getElementById("submitWarn");
    // Todo "No cumple" debe llevar observación y evidencia fotográfica:
    // si falta alguna de las dos, NO se guarda el registro.
    const ncSinObs  = itemState.filter(s => s.status === "No Cumple" && !(s.obs || "").trim());
    const ncSinFoto = itemState.filter(s => s.status === "No Cumple" && !s.photo);
    if (ncSinObs.length || ncSinFoto.length){
      const lista = (arr) => arr.slice(0, 8).map(s =>
        '<div style="font-size:12px;padding:2px 0">• ' + (s.gi + 1) + '.' + s.idx + ' — ' + esc(s.es) + '</div>').join("")
        + (arr.length > 8 ? '<div style="font-size:12px;color:var(--ink-soft,#93A2AD)">… y ' + (arr.length - 8) + ' más / 还有 ' + (arr.length - 8) + ' 项</div>' : "");
      let body = "";
      if (ncSinFoto.length){
        body += '<div style="font-size:13px;font-weight:700;margin:6px 0 4px">📷 Sin evidencia fotográfica / 缺少照片证据 (' + ncSinFoto.length + ')</div>' + lista(ncSinFoto);
      }
      if (ncSinObs.length){
        body += '<div style="font-size:13px;font-weight:700;margin:10px 0 4px">✏️ Sin observación / 缺少备注 (' + ncSinObs.length + ')</div>' + lista(ncSinObs);
      }
      body = '<div style="font-size:13px;margin-bottom:6px">Todo ítem marcado <b>No cumple</b> debe tener foto y observación. Complétalos para poder guardar.</div>'
        + '<div style="font-size:12px;color:var(--ink-soft,#93A2AD);margin-bottom:6px">所有“不符合”项必须附有照片和备注，补全后才能保存。</div>' + body;
      const primero = (ncSinFoto[0] && ncSinObs[0])
        ? ((ncSinFoto[0].gi * 1000 + ncSinFoto[0].idx) <= (ncSinObs[0].gi * 1000 + ncSinObs[0].idx) ? ncSinFoto[0] : ncSinObs[0])
        : (ncSinFoto[0] || ncSinObs[0]);
      showBlockingAlert("⚠ NO CUMPLE INCOMPLETO / 不符合项不完整", body, () => {
        const row = document.querySelector('.item-row[data-uid="' + primero.uid + '"]');
        if (row) row.scrollIntoView({behavior: "smooth", block: "center"});
      });
      return;
    }

    const unanswered = itemState.filter(s => !s.status).length;
    if (unanswered > 0 && !confirm(`${unanswered} ítem(s) sin diligenciar. ¿Enviar de todas formas? / 还有 ${unanswered} 项未填写，仍要提交吗？`)) return;

    const rec = collectRecord();
    warn.textContent = "";
    const recs = getRecords();
    recs.unshift(rec);
    setRecords(recs);
    // v3.2: la firma del supervisor/líder puede completarse después, dentro del turno (día/noche).
    const supPend = SIGNERS.filter(s => !s.optional && !(rec.signatures[s.key] && rec.signatures[s.key].dataUrl));
    const win = shiftWindowForRecord(rec.header);
    if (supPend.length && win){
      const hasta = win.end.getFullYear() + "-" + String(win.end.getMonth()+1).padStart(2,"0") + "-" + String(win.end.getDate()).padStart(2,"0")
        + " " + String(win.end.getHours()).padStart(2,"0") + ":" + String(win.end.getMinutes()).padStart(2,"0");
      toast("Registro guardado. " + supPend.map(s => s.es).join(", ") + " pendiente(s): complétala(s) en Archivo hasta " + hasta + " / 记录已保存，请在 " + hasta + " 前补签", 6000);
    } else {
      toast("Registro guardado en el archivo / 记录已保存");
    }
    resetForm();
    renderArchive();
    setLocalTab("archivo");
  });

  /* ============================================================
     Completar firmas pendientes de un registro YA guardado.
     No permite tocar el resto del registro (checklist, encabezado,
     firmas ya confirmadas) -- solo agrega las firmas que faltaban,
     pensado para el caso de un inspector que registra varias fichas
     bajo tierra sin señal, y solo al llegar a superficie (con la
     persona indicada presente) completa la firma que faltaba.
     ============================================================ */
  let completeSigState = {};
  let completeSigRecordId = null;

  function openCompleteSignaturesModal(rec){
    if (!canCompleteSignatures(rec)){
      toast("El turno de este registro ya terminó -- no se puede firmar fuera de su ventana de tiempo / 该记录所属班次已结束，无法在时间窗口外签名", 4000);
      return;
    }
    const pending = SIGNERS.filter(s => !(rec.signatures[s.key] && rec.signatures[s.key].dataUrl));
    if (!pending.length){ toast("Este registro ya tiene todas las firmas / 该记录已完成全部签名"); return; }

    completeSigRecordId = rec.id;
    completeSigState = {};

    const body = document.getElementById("sigModalBody");
    body.innerHTML = pending.map(s => `
      <div class="sig-card" data-signer="${esc(s.key)}">
        <h4>${esc(s.es)}${s.optional ? ' <span class="sig-optional">(opcional / 可选)</span>' : ""}</h4><div class="zh">${esc(s.zh)}</div>
        <div class="sig-name">${esc(rec.header[s.nameField] || "—")}</div>
        <div class="sig-pad-wrap"><canvas class="sig-pad"></canvas></div>
        <div class="sig-actions">
          <button type="button" class="sig-btn" data-role="clear">Limpiar</button>
          <button type="button" class="sig-btn confirm" data-role="confirm">Confirmar</button>
        </div>
        <div class="sig-status" data-role="sigstatus">Sin firmar / 未签名</div>
      </div>
    `).join("");

    pending.forEach(s => {
      const card = body.querySelector(`[data-signer="${s.key}"]`);
      const canvas = card.querySelector("canvas");
      setupPad(canvas);
      completeSigState[s.key] = {name:"", dataUrl:"", ts:""};

      card.querySelector('[data-role="clear"]').addEventListener("click", () => {
        clearPad(canvas); completeSigState[s.key] = {name:"", dataUrl:"", ts:""};
        const st = card.querySelector('[data-role="sigstatus"]');
        st.textContent = "Sin firmar / 未签名"; st.classList.remove("done");
      });
      card.querySelector('[data-role="confirm"]').addEventListener("click", () => {
        if (canvas.dataset.blank !== "false"){ toast("Dibuje la firma antes de confirmar"); return; }
        completeSigState[s.key] = {
          name: rec.header[s.nameField] || "",
          dataUrl: canvas.toDataURL("image/png"),
          ts: nowStamp()
        };
        const st = card.querySelector('[data-role="sigstatus"]');
        st.textContent = "Firmado " + completeSigState[s.key].ts; st.classList.add("done");
        toast(s.es + " confirmada");
      });
    });

    document.getElementById("sigModalBackdrop").hidden = false;
  }

  function closeCompleteSignaturesModal(){
    document.getElementById("sigModalBackdrop").hidden = true;
    document.getElementById("sigModalBody").innerHTML = "";
    completeSigState = {};
    completeSigRecordId = null;
  }

  document.getElementById("sigModalClose").addEventListener("click", closeCompleteSignaturesModal);
  document.getElementById("sigModalCancel").addEventListener("click", closeCompleteSignaturesModal);
  document.getElementById("sigModalBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "sigModalBackdrop") closeCompleteSignaturesModal();
  });
  document.getElementById("sigModalSave").addEventListener("click", () => {
    const newlySigned = Object.keys(completeSigState).filter(k => completeSigState[k].dataUrl);
    if (!newlySigned.length){ toast("No hay firmas nuevas para guardar / 没有新的签名可保存"); return; }
    const recs = getRecords();
    const idx = recs.findIndex(r => r.id === completeSigRecordId);
    if (idx === -1){ toast("No se encontró el registro / 未找到该记录"); closeCompleteSignaturesModal(); return; }
    newlySigned.forEach(k => { recs[idx].signatures[k] = completeSigState[k]; });
    setRecords(recs);
    renderArchive();
    toast(newlySigned.length + " firma(s) guardada(s) / 已保存签名");
    closeCompleteSignaturesModal();
  });

  /* ============================================================
     Archivo: listado + estadísticas + acciones por registro
     ============================================================ */
  /* ============================================================
     Aviso de capacidad de almacenamiento del dispositivo.
     Todo el archivo (fichas + fotos + firmas en base64) vive en el
     almacenamiento local del navegador de ese celular/tablet -- no hay una
     "carpeta" con un tamaño fijo, pero ese almacenamiento sí tiene un límite
     práctico en el dispositivo. Usamos navigator.storage.estimate() cuando
     el navegador lo soporta (da el uso/cupo real de ese origen); si no está
     disponible, se calcula un estimado aproximado a partir del tamaño de lo
     guardado en localStorage.
     ============================================================ */
  async function checkStorageUsage(){
    const box = document.getElementById("storageWarning");
    let pct = null;
    try{
      if (navigator.storage && navigator.storage.estimate){
        const {usage, quota} = await navigator.storage.estimate();
        if (quota) pct = Math.round((usage / quota) * 1000) / 10;
      }
    } catch(e){ /* estimate no disponible en este navegador */ }

    if (pct == null){
      // Estimado aproximado de respaldo: tamaño de lo guardado en
      // localStorage contra un cupo conservador de 5MB (mínimo típico
      // garantizado en navegadores móviles para este tipo de almacenamiento).
      try{
        let bytes = 0;
        for (let i = 0; i < localStorage.length; i++){
          const k = localStorage.key(i);
          bytes += (k.length + (localStorage.getItem(k)||"").length) * 2; // UTF-16 ~2 bytes/char
        }
        pct = Math.round((bytes / (5*1024*1024)) * 1000) / 10;
      } catch(e){ pct = null; }
    }

    if (pct == null || pct < 70){ box.hidden = true; box.innerHTML = ""; return; }

    const critical = pct >= 90;
    box.hidden = false;
    box.className = "storage-warning " + (critical ? "critical" : "warn");
    box.innerHTML = `<span class="sw-icon">${critical ? "⛔" : "⚠️"}</span>
      <span>El almacenamiento de este dispositivo está aproximadamente al <b>${pct}%</b>.
      Exporta (PDF/Excel) los registros que necesites y luego usa "Eliminar" o "Eliminar todos los registros" para liberar espacio y no perder información.
      <span class="zh">此设备的存储空间大约已使用 ${pct}%。请导出（PDF/Excel）所需的记录，然后使用"删除"或"删除全部记录"释放空间，避免信息丢失。</span></span>`;
  }

  function renderArchive(){
    checkStorageUsage();
    const recs = getRecords();
    const list = document.getElementById("recordsList");
    const statsRow = document.getElementById("statsRow");
    if (!recs.length){
      list.innerHTML = `<div class="empty-state">Aún no hay registros en el archivo.<br>Diligencia uno en la pestaña "Nuevo" y envíalo.
        <br><span style="opacity:.8">尚无记录，请在"新建"标签中填写并提交一条记录。</span></div>`;
    } else {
      list.innerHTML = recs.map(recordCardHTML).join("");
      list.querySelectorAll("[data-act]").forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.id;
          const act = btn.dataset.act;
          if (act === "delete"){
            if (!confirm("¿Eliminar este registro? / 删除这条记录？")) return;
            setRecords(getRecords().filter(r => r.id !== id));
            renderArchive();
            return;
          }
          const rec = getRecords().find(r => r.id === id);
          if (!rec) return;
          if (act === "export-pdf") downloadRecordPDF(rec);
          if (act === "export-xlsx") exportOneXLSX(rec);
          if (act === "export-csv") downloadCSV(buildRegistroRows([rec]), fileBase(rec) + ".csv");
          if (act === "complete-sig") openCompleteSignaturesModal(rec);
        });
      });
    }
    let sum = 0, count = 0;
    recs.forEach(r => { if (r.totals.pct != null){ sum += r.totals.pct; count++; } });
    const avg = count ? Math.round((sum/count)*10)/10 : null;
    statsRow.innerHTML = `
      <div class="stat"><div class="num mono">${recs.length}</div><div class="lbl">Registros / 记录</div></div>
      <div class="stat"><div class="num mono">${avg == null ? "—" : avg + "%"}</div><div class="lbl">Cumplim. promedio / 平均合格率</div></div>
      <div class="stat"><div class="num mono">${recs.reduce((a,r)=>a+r.totals.noCumple,0)}</div><div class="lbl">Hallazgos NC / 不符合项</div></div>
      <div class="stat"><div class="num mono">${getMaestroMeta() ? "Real" : "Ejemplo"}</div><div class="lbl">Maestro / 主数据</div></div>
    `;
  }

  /* ============================================================
     Tabs
     ============================================================ */
  function setLocalTab(tab){ document.body.dataset.localTab = tab; }
  document.querySelectorAll(".tab-btn").forEach(b => b.addEventListener("click", () => setLocalTab(b.dataset.tab)));
  setLocalTab("nuevo");

  /* ============================================================
     SheetJS diferido (solo si hay internet) + CSV manual
     ============================================================ */
  let xlsxLoadPromise = null;
  function ensureXLSX(){
    if (typeof XLSX !== "undefined") return Promise.resolve(true);
    if (!navigator.onLine) return Promise.resolve(false);
    if (xlsxLoadPromise) return xlsxLoadPromise;
    xlsxLoadPromise = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = () => resolve(typeof XLSX !== "undefined");
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return xlsxLoadPromise;
  }

  function parseCSV(text){
    const rows = [];
    let row = [], field = "", inQuotes = false;
    text = text.replace(/^﻿/, "");
    for (let i=0;i<text.length;i++){
      const c = text[i];
      if (inQuotes){
        if (c === '"'){
          if (text[i+1] === '"'){ field += '"'; i++; } else inQuotes = false;
        } else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ","){ row.push(field); field = ""; }
        else if (c === "\n"){ row.push(field); rows.push(row); row = []; field = ""; }
        else if (c === "\r"){ /* skip */ }
        else field += c;
      }
    }
    if (field.length || row.length){ row.push(field); rows.push(row); }
    return rows.filter(r => r.some(v => String(v).trim() !== ""));
  }

  function csvField(v){
    v = String(v == null ? "" : v);
    if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g,'""') + '"';
    return v;
  }
  function rowsToCSV(rows){
    return rows.map(r => r.map(csvField).join(",")).join("\r\n");
  }
  function downloadCSV(rows, filename){
    const csv = "﻿" + rowsToCSV(rows);
    const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function autoCols(rows){
    return rows[0].map((_,ci) => ({wch: Math.min(Math.max(10, rows.reduce((m,r)=>Math.max(m, String(r[ci]==null?"":r[ci]).length), 0)) + 2, 45)}));
  }

  /* ============================================================
     Exportación: BD_Registros (ancho) + Hallazgos_NC
     ============================================================ */
  function fileBase(rec){
    return "QAQC_" + (rec.header.labor||"labor").replace(/\s+/g,"_") + "_" + (rec.header.fecha||"sf");
  }

  function buildRegistroRows(recs){
    const meta = ["ID Registro","Fecha","Turno","Guardia","Empresa","Labor (panel)","Categoria explotacion","Fase",
                  "Codigo equipo","Inspector","Supervisor","Operador de equipo","Actividad",
                  "% Cumplimiento","Cumple","No Cumple","N/A","Capturado"];
    let itemCols = [];
    if (recs.length){
      recs[0].groups.forEach((g, gi) => {
        g.items.forEach((it, ii) => {
          itemCols.push(`G${gi+1}.${ii+1} Estado`);
          itemCols.push(`G${gi+1}.${ii+1} Obs`);
        });
      });
    }
    const header = meta.concat(itemCols).concat(["Version app", "Subfase", "Mes productivo", "Semana ciclo"]);
    const rows = [header];
    recs.forEach(rec => {
      const h = rec.header;
      const row = [rec.id, h.fecha||"", h.turno||"", h.guardia||"", h.empresa||"", h.labor||"", h.categoriaExplotacion||"",
                   h.fase||"", h.codigoEquipo||"", h.inspector||"", h.supervisor||"", h.operadorEquipo||"", h.actividad||"",
                   rec.totals.pct==null?"":rec.totals.pct, rec.totals.cumple, rec.totals.noCumple, rec.totals.na, rec.capturedAt||""];
      rec.groups.forEach(g => g.items.forEach(it => { row.push(it.status||""); row.push(it.obs||""); }));
      row.push(rec.appVersion || "anterior a 3.1");
      row.push(h.subfase || "");
      row.push(h.mesProductivo || ""); row.push(h.semana || "");   // v3.3
      rows.push(row);
    });
    return rows;
  }

  function buildHallazgosRows(recs){
    const header = ["ID Hallazgo","ID Registro","Fecha","Labor (panel)","Turno","Guardia","Inspector",
                     "Grupo","Estandar (No Cumple)","标准 (不符合)","Observacion","Foto","Estado cierre",
                     "Pasos desde ingreso","Distancia estimada (m)","Medida en foto (cm)","Que se midio","Version app","Punto de referencia","Conteo dudoso"];
    const rows = [header];
    let seq = 0;
    const hallazgosConFoto = [];
    recs.forEach(rec => {
      rec.groups.forEach(g => {
        g.items.forEach(it => {
          if (it.status === "No Cumple"){
            seq++;
            const ncId = "NC-" + String(seq).padStart(4,"0");
            rows.push([ncId, rec.id, rec.header.fecha||"", rec.header.labor||"", rec.header.turno||"",
                       rec.header.guardia||"", rec.header.inspector||"", g.es, it.es, it.zh, it.obs||"",
                       it.photo ? "FOTO_ADJUNTA" : "Sin foto", "PENDIENTE",
                       it.steps || "", it.distanceM == null ? "" : it.distanceM,
                       it.measureCm == null ? "" : it.measureCm, it.measureLabel || "",
                       rec.appVersion || "anterior a 3.1",
                       it.steps ? (it.stepsRef || "Ingreso (versión anterior)") : "",
                       it.steps ? (it.stepsDudoso ? "SI" : "NO") : ""]);
            if (it.photo) hallazgosConFoto.push({ncId, foto: it.photo, rowIdx: rows.length-1});
          }
        });
      });
    });
    return {rows, hallazgosConFoto};
  }

  async function exportAllXLSX(){
    const recs = getRecords();
    if (!recs.length){ toast("No hay registros / 没有记录"); return; }
    const ok = await ensureXLSX();
    const regRows = buildRegistroRows(recs);
    const {rows: ncRows, hallazgosConFoto} = buildHallazgosRows(recs);
    const fname = "BD_QAQC_Paneles_" + todayISO();
    if (ok){
      try{
        const wb = XLSX.utils.book_new();
        const ws1 = XLSX.utils.aoa_to_sheet(regRows);
        ws1["!cols"] = autoCols(regRows);
        XLSX.utils.book_append_sheet(wb, ws1, "BD_Registros");

        const ws2 = XLSX.utils.aoa_to_sheet(ncRows);
        ws2["!cols"] = ncRows[0].map((h,i)=>({wch: i===8||i===9?38 : i===10?32 : Math.min(24, String(h).length+6)}));
        if (!ws2["!images"]) ws2["!images"] = [];
        hallazgosConFoto.forEach(h => {
          try{
            const b64 = h.foto.replace(/^data:image\/\w+;base64,/, "");
            const ext = h.foto.indexOf("png") !== -1 ? "png" : "jpeg";
            ws2["!images"].push({"!pos":{r:h.rowIdx, c:11}, "!datatype":"base64", "!data":b64, "!ext":ext, "!w":80, "!h":60});
          } catch(e){}
        });
        XLSX.utils.book_append_sheet(wb, ws2, "Hallazgos_NC");
        XLSX.writeFile(wb, fname + ".xlsx");
        toast("Excel descargado: " + recs.length + " registro(s) / Excel已下载");
        return;
      } catch(e){ console.warn("XLSX falló, usando CSV:", e); }
    }
    downloadCSV(regRows, fname + ".csv");
    toast("Sin conexión — se descargó como CSV (ábrelo en Excel)");
  }

  async function exportOneXLSX(rec){
    const ok = await ensureXLSX();
    const regRows = buildRegistroRows([rec]);
    const {rows: ncRows, hallazgosConFoto} = buildHallazgosRows([rec]);
    const base = fileBase(rec);
    if (ok){
      try{
        const wb = XLSX.utils.book_new();
        const ws1 = XLSX.utils.aoa_to_sheet(regRows);
        ws1["!cols"] = autoCols(regRows);
        XLSX.utils.book_append_sheet(wb, ws1, "Registro");
        if (ncRows.length > 1){
          const ws2 = XLSX.utils.aoa_to_sheet(ncRows);
          if (!ws2["!images"]) ws2["!images"] = [];
          hallazgosConFoto.forEach(h => {
            try{
              const b64 = h.foto.replace(/^data:image\/\w+;base64,/, "");
              const ext = h.foto.indexOf("png") !== -1 ? "png" : "jpeg";
              ws2["!images"].push({"!pos":{r:h.rowIdx, c:11}, "!datatype":"base64", "!data":b64, "!ext":ext, "!w":80, "!h":60});
            } catch(e){}
          });
          XLSX.utils.book_append_sheet(wb, ws2, "Hallazgos_NC");
        }
        XLSX.writeFile(wb, base + ".xlsx");
        toast("Excel descargado / Excel已下载");
        return;
      } catch(e){ console.warn("XLSX falló, usando CSV:", e); }
    }
    downloadCSV(regRows, base + ".csv");
    toast("Sin conexión — se descargó como CSV");
  }

  /* ============================================================
     PDF del entregable (por visita) — jsPDF cargado diferido desde
     cdnjs, igual que SheetJS. La app no depende de PDF para nada
     offline: solo hace falta conexión la primera vez que se genera
     uno (el navegador cachea la librería después).
     El texto chino se dibuja con una fuente TrueType incrustada
     (WenQuanYi Zen Hei, recortada solo a los caracteres que usa esta
     ficha — ver fonts/wqy-zenhei-subset.b64.js) porque las fuentes
     estándar de PDF (Helvetica) no traen glifos CJK. El texto en
     español (incluido lo que escriba el inspector: observaciones,
     nombres, etc.) usa Helvetica normal, que sí cubre acentos/ñ.
     ============================================================ */
  let pdfLoadPromise = null;
  function ensurePDF(){
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(true);
    if (!navigator.onLine) return Promise.resolve(false);
    if (pdfLoadPromise) return pdfLoadPromise;
    pdfLoadPromise = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload = () => resolve(!!(window.jspdf && window.jspdf.jsPDF));
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return pdfLoadPromise;
  }

  const PDF_STATUS_COLOR = {"Cumple":[27,142,74], "No Cumple":[192,57,43], "N/A":[127,140,141]};
  const PDF_STATUS_LABEL = {"Cumple":"CUMPLE", "No Cumple":"NO CUMPLE", "N/A":"N/A"};

  function buildRecordPDF(rec){
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({unit:"mm", format:"a4"});
    const hasZh = !!PDF_FONT_B64;
    if (hasZh){
      doc.addFileToVFS("WQYZenHei.ttf", PDF_FONT_B64);
      doc.addFont("WQYZenHei.ttf", "WQYZenHei", "normal");
    }

    const M = 14, PW = 210, PH = 297, CW = PW - M*2;
    let y = M;
    let currentGroupForContinuation = null;

    function setEs(size, style){ doc.setFont("helvetica", style || "normal"); doc.setFontSize(size); }
    function setZh(size){ doc.setFont(hasZh ? "WQYZenHei" : "helvetica", "normal"); doc.setFontSize(size); }

    // Algunos valores del maestro (Turno, Fase) vienen como un solo string bilingüe
    // "Día / 白班". Helvetica no tiene glifos chinos -- hay que partir el string y
    // dibujar cada tramo con su fuente, en vez de mandar todo el texto con un solo font.
    const PDF_CJK_RE = /[㐀-鿿豈-﫿＀-￯]/;
    function splitEsZh(s){
      s = String(s == null ? "" : s);
      const m = PDF_CJK_RE.exec(s);
      if (!m) return {es: s, zh: ""};
      const idx = s.lastIndexOf("/", m.index);
      if (idx === -1) return {es: s.slice(0, m.index).trim(), zh: s.slice(m.index).trim()};
      return {es: s.slice(0, idx).trim(), zh: s.slice(idx+1).trim()};
    }
    function drawMixedText(s, x, yy, size, opts){
      opts = opts || {};
      const {es, zh} = splitEsZh(s);
      const color = opts.color || [20,30,38];
      if (!zh){
        setEs(size, opts.style);
        doc.setTextColor(color[0], color[1], color[2]);
        doc.text(es, x, yy, opts.align ? {align: opts.align} : undefined);
        return;
      }
      const esTxt = es ? es + "  " : "";
      if (opts.align === "right"){
        setZh(size); const zhW = doc.getTextWidth(zh);
        setEs(size, opts.style); const esW = doc.getTextWidth(esTxt);
        const startX = x - (esW + zhW);
        doc.setTextColor(color[0], color[1], color[2]);
        doc.text(esTxt, startX, yy);
        setZh(size); doc.text(zh, startX + esW, yy);
      } else {
        setEs(size, opts.style); doc.setTextColor(color[0], color[1], color[2]);
        doc.text(esTxt, x, yy);
        const esW = doc.getTextWidth(esTxt);
        setZh(size); doc.text(zh, x + esW, yy);
      }
    }
    function hr(color){
      doc.setDrawColor.apply(doc, color || [210,216,220]);
      doc.setLineWidth(0.2);
      doc.line(M, y, PW - M, y);
    }
    function drawGroupHeader(g){
      doc.setFillColor(242,244,246);
      doc.rect(M, y, CW, 8, "F");
      setEs(10, "bold"); doc.setTextColor(20,30,38);
      doc.text(g.es, M+2, y+5.5);
      if (hasZh){
        const esW = doc.getTextWidth(g.es);
        setZh(8); doc.setTextColor(120,130,138);
        doc.text(g.zh, M+2+esW+4, y+5.5);
      }
      y += 8;
      if (g.nota){
        // se dibuja la línea ES y la línea ZH por separado (no concatenadas en un solo
        // string) porque cada una necesita su propia fuente -- Helvetica no tiene glifos chinos
        setEs(7.6, "italic"); doc.setTextColor(178,110,20);
        const esLines = doc.splitTextToSize(g.nota.es, CW-4);
        doc.text(esLines, M+2, y+3.6);
        y += 3.6 + esLines.length*3.5;
        if (hasZh && g.nota.zh){
          setZh(7); doc.setTextColor(178,110,20);
          const zhLines = doc.splitTextToSize("(" + g.nota.zh + ")", CW-4);
          doc.text(zhLines, M+2, y);
          y += zhLines.length*3.2;
        }
        y += 2;
      }
      y += 2;
    }
    function ensureSpace(h, group){
      if (y + h > PH - M){
        doc.addPage();
        y = M;
        if (group){
          drawGroupHeader(group);
          drawMixedText("(continúa) / (续)", M+2, y-0.5, 7.2, {style:"italic", color:[150,158,165]});
          y += 2;
        }
      }
    }

    // ---- Encabezado / título ----
    setEs(16, "bold"); doc.setTextColor(20,30,38);
    doc.text("INFORME DE INSPECCIÓN QAQC PANELES", M, y+6);
    setZh(10); doc.setTextColor(90,100,110);
    doc.text("QAQC矿房检查报告", M, y+12);
    setEs(9); doc.setTextColor(120,130,138);
    doc.text("Explotación · Taladros Largos (Long Hole Stoping)", M, y+17);
    setEs(10, "bold"); doc.setTextColor(214,93,15);
    doc.text(rec.id, PW-M, y+6, {align:"right"});
    drawMixedText((rec.header.fecha || "—") + "   " + (rec.header.turno || ""), PW-M, y+11, 9, {align:"right", color:[90,100,110]});
    const pctTxt = rec.totals.pct == null ? "Cumplimiento: —" : "Cumplimiento: " + rec.totals.pct + "%";
    setEs(11, "bold"); doc.setTextColor(20,30,38);
    doc.text(pctTxt, PW-M, y+17, {align:"right"});
    y += 21;
    hr([214,93,15]);
    y += 6;

    // ---- Datos generales ----
    setEs(11, "bold"); doc.setTextColor(20,30,38);
    doc.text("DATOS GENERALES", M, y);
    if (hasZh){ setZh(8); doc.setTextColor(140,148,155); doc.text("基本信息", M+52, y); }
    y += 5;

    const fieldPairs = HEADER_FIELDS.map(f => ({es: f.es, zh: f.zh, val: rec.header[f.key] || "—"}));
    const colW = CW/3, rowH = 12.5;
    fieldPairs.forEach((f, i) => {
      const col = i % 3, row = Math.floor(i/3);
      const x = M + col*colW;
      const fy = y + row*rowH;
      setEs(7.3, "bold"); doc.setTextColor(120,130,138);
      const labelEs = f.es.toUpperCase();
      doc.text(labelEs, x, fy);
      if (hasZh){
        const w = doc.getTextWidth(labelEs);
        setZh(6.6); doc.setTextColor(150,158,165);
        doc.text(f.zh, x + w + 2, fy);
      }
      setEs(9.3, "normal");
      const valLines = doc.splitTextToSize(String(f.val), colW-4).slice(0,2);
      valLines.forEach((line, li) => drawMixedText(line, x, fy+4.6+li*4.2, 9.3, {color:[20,30,38]}));
    });
    y += Math.ceil(fieldPairs.length/3)*rowH + 3;
    hr();
    y += 5;

    setEs(9, "normal"); doc.setTextColor(20,30,38);
    doc.text(`Cumple: ${rec.totals.cumple}    No cumple: ${rec.totals.noCumple}    N/A: ${rec.totals.na}    Sin responder: ${rec.totals.total - rec.totals.answered}`, M, y);
    y += 8;

    // ---- Grupos de verificación ----
    ensureSpace(12);
    setEs(11, "bold"); doc.setTextColor(20,30,38);
    doc.text("GRUPOS DE VERIFICACIÓN", M, y);
    if (hasZh){ setZh(8); doc.setTextColor(140,148,155); doc.text("检查项目组", M+62, y); }
    y += 6;

    rec.groups.forEach(g => {
      // reserva el alto del encabezado + al menos un ítem corto, para que el título del
      // grupo nunca quede "huérfano" solo al final de una página
      ensureSpace(g.nota ? 42 : 32);
      currentGroupForContinuation = g;
      drawGroupHeader(g);

      g.items.forEach((it, ii) => {
        setEs(9);
        const esLines = doc.splitTextToSize(it.es, CW-32);
        let zhLines = [];
        if (hasZh){ setZh(7.6); zhLines = doc.splitTextToSize(it.zh, CW-32); }
        let obsLines = [];
        if (it.obs){ setEs(8); obsLines = doc.splitTextToSize("Obs / 备注: " + it.obs, CW-32); }
        let distLines = [];
        if (it.steps){ setEs(8); distLines = doc.splitTextToSize(it.stepsRef
          ? `Distancia desde ${it.stepsRef} / 距参考点距离: ${it.steps} pasos ~= ${it.distanceM} m${it.stepsDudoso ? " (conteo dudoso / 计数可疑)" : ""}`
          : `Distancia desde el ingreso / 距入口距离: ${it.steps} pasos ~= ${it.distanceM} m`, CW-32); }
        let measLines = [];
        if (it.measureCm){ setEs(8); measLines = doc.splitTextToSize(`Medida en la foto / 照片测量: ${it.measureLabel ? it.measureLabel + " " : ""}~= ${it.measureCm} cm`, CW-32); }

        const textH = 3.8 + esLines.length*4.2 + zhLines.length*3.6 + (obsLines.length ? obsLines.length*3.8+1.5 : 0) + (distLines.length ? distLines.length*3.8+1.5 : 0) + (measLines.length ? measLines.length*3.8+1.5 : 0);
        // la foto se dibuja DEBAJO del texto (no al lado), así que su alto se suma, no se
        // toma el máximo -- si no, la siguiente fila arranca antes de que termine la imagen
        const photoH = it.photo ? 19.5 + 2 : 0;
        const neededH = textH + photoH + 5;

        ensureSpace(neededH, currentGroupForContinuation);
        const top = y;

        const st = it.status || "";
        const color = PDF_STATUS_COLOR[st] || [190,195,199];
        doc.setFillColor(color[0], color[1], color[2]);
        doc.roundedRect(M, top, 22, 5, 1, 1, "F");
        setEs(6.6, "bold"); doc.setTextColor(255,255,255);
        doc.text(PDF_STATUS_LABEL[st] || "SIN DATO", M+11, top+3.4, {align:"center"});

        setEs(9, "normal"); doc.setTextColor(20,30,38);
        doc.text(String(ii+1) + ".", M+25, top+3.8);
        doc.text(esLines, M+30, top+3.8);
        let ly = top + 3.8 + esLines.length*4.2;

        if (zhLines.length){
          setZh(7.6); doc.setTextColor(120,130,138);
          doc.text(zhLines, M+30, ly);
          ly += zhLines.length*3.6;
        }
        if (obsLines.length){
          setEs(8, "italic"); doc.setTextColor(90,100,110);
          doc.text(obsLines, M+30, ly+1.5);
          ly += obsLines.length*3.8 + 1.5;
        }
        if (distLines.length){
          setEs(8, "bold"); doc.setTextColor(214,93,15);
          doc.text(distLines, M+30, ly+1.5);
          ly += distLines.length*3.8 + 1.5;
        }
        if (measLines.length){
          setEs(8, "bold"); doc.setTextColor(20,140,130);
          doc.text(measLines, M+30, ly+1.5);
          ly += measLines.length*3.8 + 1.5;
        }
        if (it.photo){
          try{
            const fmt = /^data:image\/png/i.test(it.photo) ? "PNG" : "JPEG";
            doc.addImage(it.photo, fmt, M+30, ly+1, 26, 19.5);
          } catch(e){ /* imagen no soportada: se omite, el resto del PDF sigue */ }
        }

        y = top + neededH;
        doc.setDrawColor(230,233,236); doc.setLineWidth(0.15);
        doc.line(M, y-2, PW-M, y-2);
      });
      y += 3;
    });

    // ---- Firmas ----
    ensureSpace(44);
    setEs(11, "bold"); doc.setTextColor(20,30,38);
    doc.text("FIRMAS DE VALIDACIÓN", M, y);
    if (hasZh){ setZh(8); doc.setTextColor(140,148,155); doc.text("验证签名", M+58, y); }
    y += 6;

    const gap = 8, sigW = (CW - gap*2)/3;
    SIGNERS.forEach((s, i) => {
      const x = M + i*(sigW+gap);
      const sd = rec.signatures[s.key] || {};
      doc.setDrawColor(210,216,220); doc.setLineWidth(0.2);
      doc.roundedRect(x, y, sigW, 34, 1.5, 1.5);
      setEs(8.3, "bold"); doc.setTextColor(20,30,38);
      const nameLines = doc.splitTextToSize(s.es, sigW-6);
      doc.text(nameLines.slice(0,1), x+3, y+5.5);
      if (hasZh){ setZh(6.8); doc.setTextColor(140,148,155); doc.text(s.zh, x+3, y+9); }
      if (sd.dataUrl){
        try{ doc.addImage(sd.dataUrl, "PNG", x+3, y+11, sigW-6, 13.5); } catch(e){}
      } else {
        setEs(8); doc.setTextColor(190,195,199);
        doc.text(s.optional ? "No firmado (opcional)" : "Sin firmar / 未签名", x+3, y+20);
      }
      setEs(7.4, "normal"); doc.setTextColor(90,100,110);
      const ownerLines = doc.splitTextToSize(sd.name || "—", sigW-6);
      doc.text(ownerLines.slice(0,1), x+3, y+28.5);
      if (sd.ts){ setEs(6.6); doc.setTextColor(150,158,165); doc.text(sd.ts, x+3, y+32); }
    });
    y += 38;

    // ---- Pie de página (todas las páginas) ----
    const pageCount = doc.internal.getNumberOfPages();
    for (let p=1; p<=pageCount; p++){
      doc.setPage(p);
      setEs(7.4, "normal"); doc.setTextColor(160,167,173);
      doc.text(`Página ${p} / ${pageCount}`, PW-M, PH-8, {align:"right"});
      doc.text(`QAQC Paneles · Capturado con app v${rec.appVersion || "anterior a 3.1"} · Generado ${nowStamp()}`, M, PH-8);
    }

    return doc;
  }

  async function downloadRecordPDF(rec){
    const ok = await ensurePDF();
    if (!ok){
      toast("Necesitas conexión a internet para generar el PDF la primera vez / 首次生成PDF需要联网");
      return;
    }
    try{
      const doc = buildRecordPDF(rec);
      doc.save(fileBase(rec) + ".pdf");
      toast("PDF descargado / PDF已下载");
    } catch(e){
      console.error(e);
      toast("No se pudo generar el PDF / 无法生成PDF");
    }
  }

  /* ============================================================
     JSZip diferido (solo si hay internet), igual que SheetJS/jsPDF --
     se usa para empaquetar varios PDF en un solo .zip (flujo típico:
     el inspector registra 3-4 fichas bajo tierra sin señal, y ya en
     superficie, con señal, descarga todos los PDF de una sola vez
     para compartirlos por correo).
     ============================================================ */
  let zipLoadPromise = null;
  function ensureZIP(){
    if (typeof JSZip !== "undefined") return Promise.resolve(true);
    if (!navigator.onLine) return Promise.resolve(false);
    if (zipLoadPromise) return zipLoadPromise;
    zipLoadPromise = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      s.onload = () => resolve(typeof JSZip !== "undefined");
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return zipLoadPromise;
  }

  async function downloadAllRecordsPDF(){
    const recs = getRecords();
    if (!recs.length){ toast("No hay registros / 没有记录"); return; }

    toast("Generando " + recs.length + " PDF... / 正在生成" + recs.length + "个PDF");
    const [okPdf, okZip] = await Promise.all([ensurePDF(), ensureZIP()]);
    if (!okPdf || !okZip){
      toast("Necesitas conexión a internet para generar los PDF la primera vez / 首次生成PDF需要联网");
      return;
    }

    try{
      const zip = new JSZip();
      const usedNames = {};
      for (const rec of recs){
        const doc = buildRecordPDF(rec);
        let name = fileBase(rec) + ".pdf";
        if (usedNames[name] != null){
          usedNames[name]++;
          name = fileBase(rec) + "_" + usedNames[name] + ".pdf";
        } else {
          usedNames[name] = 0;
        }
        zip.file(name, doc.output("arraybuffer"));
      }
      const blob = await zip.generateAsync({type:"blob"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "QAQC_Paneles_PDFs_" + todayISO() + ".zip";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast(recs.length + " PDF descargados en un .zip / " + recs.length + "个PDF已打包下载");
    } catch(e){
      console.error(e);
      toast("No se pudo generar el paquete de PDF / 无法生成PDF压缩包");
    }
  }

  document.getElementById("btnExportAllPdf").addEventListener("click", downloadAllRecordsPDF);
  document.getElementById("btnExportAllXlsx").addEventListener("click", exportAllXLSX);
  document.getElementById("btnExportAllCsv").addEventListener("click", () => {
    const recs = getRecords();
    if (!recs.length){ toast("No hay registros / 没有记录"); return; }
    downloadCSV(buildRegistroRows(recs), "BD_QAQC_Paneles_" + todayISO() + ".csv");
  });
  document.getElementById("btnDeleteAll").addEventListener("click", () => {
    const recs = getRecords();
    if (!recs.length){ toast("No hay registros / 没有记录"); return; }
    if (!confirm(
      `¿Eliminar los ${recs.length} registros guardados en este dispositivo? Asegúrate de haberlos exportado antes (PDF/Excel) -- esta acción no se puede deshacer.\n` +
      `确定删除本设备上保存的 ${recs.length} 条记录吗？请确认已导出（PDF/Excel）-- 此操作无法撤销。`
    )) return;
    setRecords([]);
    renderArchive();
    toast("Registros eliminados / 记录已删除");
  });

  /* ============================================================
     Maestro: plantilla + importación
     ============================================================ */
  function templateRows(){
    const header = MAESTRO_COLUMNS.map(c => c.key);
    const width = Math.max(...MAESTRO_COLUMNS.map(c => (MASTER_DEFAULT[c.key]||[]).length));
    const rows = [header];
    for (let i=0;i<width;i++){
      rows.push(MAESTRO_COLUMNS.map(c => (MASTER_DEFAULT[c.key]||[])[i] || ""));
    }
    return rows;
  }

  document.getElementById("btnDownloadTemplateCsv").addEventListener("click", () => {
    downloadCSV(templateRows(), "Plantilla_Maestro_QAQC_Paneles.csv");
    toast("Plantilla CSV descargada / 模板已下载");
  });
  document.getElementById("btnDownloadTemplateXlsx").addEventListener("click", async () => {
    const ok = await ensureXLSX();
    const rows = templateRows();
    if (ok){
      try{
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws["!cols"] = autoCols(rows);
        XLSX.utils.book_append_sheet(wb, ws, "Hoja Maestro");
        XLSX.writeFile(wb, "Plantilla_Maestro_QAQC_Paneles.xlsx");
        toast("Plantilla Excel descargada / 模板已下载");
        return;
      } catch(e){ console.warn(e); }
    }
    downloadCSV(rows, "Plantilla_Maestro_QAQC_Paneles.csv");
    toast("Sin conexión — se descargó como CSV");
  });

  document.getElementById("btnResetMaestro").addEventListener("click", () => {
    if (!confirm("¿Restablecer a los datos de ejemplo? Se perderá el maestro cargado. / 恢复为示例数据？已上传的主数据将丢失。")) return;
    localStorage.removeItem("qaqc_maestro");
    localStorage.removeItem("qaqc_maestro_meta");
    localStorage.removeItem("qaqc_maestro_derive");
    localStorage.removeItem("qaqc_maestro_actividad_fase");
    localStorage.removeItem("qaqc_maestro_ciclos");   // v3.3
    localStorage.removeItem("qaqc_maestro_config");   // v3.3
    localStorage.removeItem("qaqc_maestro_frentes");  // v3.3
    CICLOS = loadCiclos(); CICLO_CFG = loadCicloCfg(); CICLO_PANELES_INFO = null;
    MASTER = loadMaster();
    PANEL_DERIVE = loadPanelDerive();
    ACTIVIDAD_FASE = loadActividadFase();
    buildHeaderFields();
    syncSignerNames();
    updateMaestroBadges();
    renderMaestroPreview();
    toast("Maestro restablecido a datos de ejemplo");
  });

  /* ------------------------------------------------------------------
     Formato real "Maestro_Paneles.xlsx": no es una lista simple por
     columna -- trae dos sub-tablas lado a lado. La de la derecha
     (Month/Contractor/System/Level/Heading/Name/Category/Active) es la
     que define los paneles/labores reales: el nombre (columna Name)
     incluye el sufijo "_ST_"/"_UP_" (STOPE/UPPER) y la columna Category
     trae la fase (Producción/Preparación) de ese panel en ese momento;
     Active filtra los planes vigentes. La de la izquierda
     (Activity/Inspector/Shift/Contractor/Guard/Supervisor/Machine
     name/Codigo/Operator name/Range) sólo aporta listas de valores
     (no está relacionada fila a fila con los paneles).
     Se detecta este formato por la presencia de columnas Name+Category;
     si no aparecen, se usa el parser genérico (plantilla de esta app).
     ------------------------------------------------------------------ */
  function findColIndex(headerRow, aliases){
    const norm = aliases.map(normHeader);
    for (let i=0;i<headerRow.length;i++){
      if (norm.includes(headerRow[i])) return i;
    }
    return -1;
  }

  function tryParseRealMaestro(rows, headerRow){
    const idxName = findColIndex(headerRow, ["Name"]);
    const idxCategory = findColIndex(headerRow, ["Category"]);
    if (idxName === -1 || idxCategory === -1) return null; // no es este formato

    const idxActive = findColIndex(headerRow, ["Active"]);
    // Formato anterior: una sola columna "Activity" con todas las actividades juntas.
    const idxActivity = findColIndex(headerRow, ["Activity","Actividad"]);
    // Formato reorganizado (tblPreparation / tblProduction): dos listas separadas por fase,
    // cada una en su propia tabla con nombre -- se usan para filtrar el desplegable de
    // Actividad según la Fase ya elegida/derivada (ver actividadPorFase más abajo).
    const idxPrepActivity = findColIndex(headerRow, ["Preparation Activity"]);
    const idxProdActivity = findColIndex(headerRow, ["Production Activity"]);
    const idxInspector = findColIndex(headerRow, ["Inspector"]);
    const idxShift = findColIndex(headerRow, ["Shift"]);
    const idxContractor = findColIndex(headerRow, ["Contractor"]);
    const idxGuard = findColIndex(headerRow, ["Guard"]);
    const idxSupervisor = findColIndex(headerRow, ["Supervisor"]);
    const idxMachine = findColIndex(headerRow, ["Machine name","Machine"]);
    // "Codigo" (formato anterior) o "Machine Codigo" (tblMachine en el maestro reorganizado).
    const idxCodigo = findColIndex(headerRow, ["Codigo","Código","Machine Codigo","Machine Código"]);
    const idxOperator = findColIndex(headerRow, ["Operator name","Operator"]);
    const idxRange = findColIndex(headerRow, ["Range"]);
    // v3.3: la hoja tiene dos columnas "Month" (la del calendario y la de tblFronts) y dos "Contractor";
    // la de tblFronts es la última "Month" que está a la izquierda de "Name".
    let idxMonth = -1;
    for (let i=0; i<idxName; i++){ if (headerRow[i] === "MONTH") idxMonth = i; }
    let idxType = -1;
    for (let i=idxName+1; i<headerRow.length; i++){ if (headerRow[i] === "TYPE"){ idxType = i; break; } }

    function cleanVal(v){ return v == null ? "" : String(v).replace(/ /g," ").replace(/\s+/g," ").trim(); }

    function uniqCol(idx, transform){
      if (idx === -1) return [];
      const seen = new Set(); const out = [];
      for (let r=1;r<rows.length;r++){
        let v = cleanVal(rows[r][idx]);
        if (transform) v = transform(v);
        if (v && !seen.has(v)){ seen.add(v); out.push(v); }
      }
      return out;
    }
    function uniqCombo(idxA, idxB, sep){
      if (idxA === -1) return [];
      const seen = new Set(); const out = [];
      for (let r=1;r<rows.length;r++){
        const a = cleanVal(rows[r][idxA]);
        const b = idxB === -1 ? "" : cleanVal(rows[r][idxB]);
        if (!a) continue;
        const combo = b ? (a + sep + b) : a;
        if (!seen.has(combo)){ seen.add(combo); out.push(combo); }
      }
      return out;
    }
    const TURNO_MAP = {"DAY":"Día / 白班","NIGHT":"Noche / 夜班"};
    function normTurno(v){ return TURNO_MAP[v.toUpperCase()] || v; }
    function normFase(v){
      if (/preparaci/i.test(v)) return "Preparación / 准备";
      if (/producci/i.test(v)) return "Producción / 生产";
      if (/recuperaci/i.test(v)) return "Recuperación / 回采"; // v3.2: subfase de Preparación
      return v;
    }
    function isActiveVal(v){
      if (v === true || v === 1) return true;
      return /^(true|1|si|sí|x|activo)$/i.test(String(v==null?"":v).trim());
    }

    const panelSeen = new Set();
    const PANELES = [];
    const tipo = {};
    const fase = {};
    for (let r=1;r<rows.length;r++){
      const name = cleanVal(rows[r][idxName]);
      if (!name) continue;
      if (idxActive !== -1 && !isActiveVal(rows[r][idxActive])) continue;
      if (!panelSeen.has(name)){ panelSeen.add(name); PANELES.push(name); }
      if (/_ST_/i.test(name)) tipo[name] = "STOPE";
      else if (/_UP_/i.test(name)) tipo[name] = "UPPER";
      const cat = cleanVal(rows[r][idxCategory]);
      if (cat) fase[name] = normFase(cat);
    }

    // v3.3: todas las filas de tblFronts (activas o no), para recalcular la lista de paneles
    // según el mes productivo vigente cada vez que se abre la app.
    const frentes = [];
    for (let r=1;r<rows.length;r++){
      const name = cleanVal(rows[r][idxName]);
      if (!name) continue;
      const cat = cleanVal(rows[r][idxCategory]);
      frentes.push({
        name,
        month: idxMonth !== -1 ? cleanVal(rows[r][idxMonth]) : "",
        active: idxActive === -1 ? true : isActiveVal(rows[r][idxActive]),
        fase: cat ? normFase(cat) : "",
        type: idxType !== -1 ? cleanVal(rows[r][idxType]) : ""
      });
    }

    // Actividades: si el maestro trae las dos listas separadas (Preparación/Producción),
    // se usan para filtrar el desplegable de Actividad según la Fase ya elegida/derivada;
    // ACTIVIDADES sigue guardando la unión de ambas (compatibilidad con plantilla/vista previa).
    // Si el archivo trae el formato anterior (una sola columna "Activity"), no hay filtro por
    // fase disponible y se usa esa lista combinada tal cual, como hasta ahora.
    let actividadPorFase = null;
    let actividadesUnion;
    if (idxPrepActivity !== -1 || idxProdActivity !== -1){
      const prep = uniqCol(idxPrepActivity);
      const prod = uniqCol(idxProdActivity);
      actividadPorFase = {
        "Preparación / 准备": prep,
        "Producción / 生产": prod,
      };
      const seenAct = new Set();
      actividadesUnion = [];
      prep.concat(prod).forEach(v => { if (!seenAct.has(v)){ seenAct.add(v); actividadesUnion.push(v); } });
    } else {
      actividadesUnion = uniqCol(idxActivity);
    }

    const master = {
      PANELES,
      TIPO_PANEL: ["STOPE","UPPER"],
      TURNOS: uniqCol(idxShift, normTurno),
      GUARDIAS: uniqCol(idxGuard),
      INSPECTORES: uniqCol(idxInspector),
      SUPERVISORES: uniqCol(idxSupervisor),
      EMPRESAS: uniqCol(idxContractor),
      OPERADORES_EQUIPO: uniqCombo(idxOperator, idxRange, " — "),
      CODIGOS_EQUIPO: uniqCombo(idxMachine, idxCodigo, " — "),
      FASES: ["Producción / 生产","Preparación / 准备"],
      ACTIVIDADES: actividadesUnion,
    };
    const found = Object.keys(master).filter(k => (master[k]||[]).length);
    if (!found.length) return null;
    return {master, found, tipo, fase, actividadPorFase, frentes};
  }

  async function importMaestroFile(file){
    const name = file.name || "";
    const isCSV = /\.csv$/i.test(name);
    let rows = null;
    try{
      if (isCSV){
        const text = await file.text();
        rows = parseCSV(text);
      } else {
        const ok = await ensureXLSX();
        if (!ok){
          toast("Necesitas conexión a internet para leer un .xlsx la primera vez — o sube un .csv / 首次读取.xlsx需要联网，或上传.csv文件");
          return;
        }
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(buf), {type:"array"});
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:""});
      }
    } catch(e){
      console.error(e);
      toast("No se pudo leer el archivo / 无法读取文件");
      return;
    }
    if (!rows || rows.length < 1){ toast("Archivo vacío"); return; }

    const headerRow = rows[0].map(normHeader);

    // 1) Intentar el formato real Maestro_Paneles.xlsx (dos sub-tablas, columnas Name/Category/Active...)
    const real = tryParseRealMaestro(rows, headerRow);
    let newMaster, found, mode;
    if (real){
      // sólo pisar las listas que sí se pudieron derivar del archivo; el resto conserva su valor anterior
      newMaster = Object.assign({}, MASTER);
      real.found.forEach(k => { newMaster[k] = real.master[k]; });
      found = real.found;
      mode = "real";
    } else {
      // 2) Formato genérico: plantilla de esta app, una lista por columna
      const colIndex = {};
      MAESTRO_COLUMNS.forEach(col => {
        const aliasesNorm = col.aliases.map(normHeader);
        const idx = headerRow.findIndex(h => aliasesNorm.includes(h));
        if (idx !== -1) colIndex[col.key] = idx;
      });
      found = Object.keys(colIndex);
      if (!found.length){
        toast("No se reconoció ninguna columna esperada — revisa los encabezados / 未识别任何预期列");
        return;
      }
      newMaster = Object.assign({}, MASTER);
      found.forEach(key => {
        const idx = colIndex[key];
        const vals = [];
        const seen = new Set();
        for (let r=1;r<rows.length;r++){
          const v = String(rows[r][idx] == null ? "" : rows[r][idx]).trim();
          if (v && !seen.has(v)){ seen.add(v); vals.push(v); }
        }
        if (vals.length) newMaster[key] = vals;
      });
      mode = "plantilla";
    }

    // v3.3: ciclos productivos y configuración (tblCiclos / tblConfig), en cualquier formato de Maestro
    const cic = leerCiclosMaestro(rows);
    if (cic.ciclos.length){ CICLOS = cic.ciclos; CICLO_CFG = cic.cfg; guardarCiclos(cic.ciclos, cic.cfg); }

    localStorage.setItem("qaqc_maestro", JSON.stringify(newMaster));
    localStorage.setItem("qaqc_maestro_meta", JSON.stringify({filename:name, updatedAt:new Date().toISOString(), columnsFound:found, mode}));
    if (mode === "real"){
      const derive = {tipo: real.tipo, fase: real.fase};
      localStorage.setItem("qaqc_maestro_derive", JSON.stringify(derive));
      PANEL_DERIVE = derive;
      if (real.actividadPorFase){
        localStorage.setItem("qaqc_maestro_actividad_fase", JSON.stringify(real.actividadPorFase));
        ACTIVIDAD_FASE = real.actividadPorFase;
      } else {
        localStorage.removeItem("qaqc_maestro_actividad_fase");
        ACTIVIDAD_FASE = null;
      }
    } else {
      localStorage.removeItem("qaqc_maestro_derive");
      PANEL_DERIVE = loadPanelDerive();
      localStorage.removeItem("qaqc_maestro_actividad_fase");
      ACTIVIDAD_FASE = null;
    }
    MASTER = newMaster;
    // v3.3: paneles según el mes productivo vigente (Active + Month de tblFronts)
    if (mode === "real" && real.frentes && real.frentes.some(f => f.month)){
      localStorage.setItem("qaqc_maestro_frentes", JSON.stringify(real.frentes));
    } else {
      localStorage.removeItem("qaqc_maestro_frentes");
    }
    aplicarCicloAPaneles();

    buildHeaderFields();
    syncSignerNames();
    updateMaestroBadges();
    renderMaestroPreview();
    if (cic.ciclos.length){
      const ult = cic.ciclos[cic.ciclos.length-1];
      setTimeout(() => toast(`Ciclos cargados hasta ${ult.mes} ${ult.anio}` + (CICLO_PANELES_INFO ? ` · ${MASTER.PANELES.length} panel(es) de ${CICLO_PANELES_INFO.ventana.join(", ")}` : "") + " / 周期已加载", 4500), 4600);
    }

    const notFound = (mode === "real" ? Object.keys(newMaster) : MAESTRO_COLUMNS.map(c=>c.key)).filter(k => !found.includes(k));
    if (mode === "real"){
      toast(`Maestro real reconocido: ${found.length} lista(s) actualizadas, ${PANEL_DERIVE.tipo ? Object.keys(PANEL_DERIVE.tipo).length : 0} paneles con tipo/fase derivados / 已识别真实主数据表`, 4500);
    } else if (notFound.length){
      toast(`Maestro cargado. No se hallaron: ${notFound.join(", ")} (se conservan sus valores anteriores)`, 4500);
    } else {
      toast("Maestro cargado correctamente / 主数据表已成功加载");
    }
  }

  document.getElementById("maestroFile").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importMaestroFile(file);
    e.target.value = "";
  });

  /* ============================================================
     PIN de seguridad (bloqueo de la app) -- 100% local al dispositivo,
     igual que el resto de la app: no hay servidor ni cuenta de usuario.
     Cada quien crea su propio PIN de 4 dígitos la primera vez que abre la
     app en su celular; se vuelve a pedir tras 15 minutos sin actividad
     (tocar/hacer clic/teclear). Si se olvida, la única salida es
     "Olvidé mi PIN": borra el maestro y los registros de ESTE dispositivo
     (los que no se hayan exportado se pierden) y deja crear un PIN nuevo
     -- no hay forma de recuperarlo sin borrar, porque no existe backend
     que guarde una copia del PIN ni de los datos.
     ============================================================ */
  const PIN_KEY = "qaqc_pin";
  const PIN_LAST_ACTIVE_KEY = "qaqc_pin_last_active";
  const PIN_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutos de inactividad
  let pinBuffer = "";
  let pinMode = "";        // "set" | "confirm" | "unlock"
  let pinFirstEntry = "";

  function pinSaved(){ return !!localStorage.getItem(PIN_KEY); }
  function pinMatches(p){ return localStorage.getItem(PIN_KEY) === p; }
  function pinTouchActivity(){ localStorage.setItem(PIN_LAST_ACTIVE_KEY, Date.now().toString()); }

  function pinCheckTimeout(){
    if (!pinSaved()) return;
    if (document.getElementById("pinOverlay")) return; // ya está bloqueada
    const last = parseInt(localStorage.getItem(PIN_LAST_ACTIVE_KEY) || "0", 10);
    if (Date.now() - last > PIN_TIMEOUT_MS) showPinScreen("unlock");
  }

  function pinWipeDeviceData(){
    setRecords([]);
    localStorage.removeItem("qaqc_maestro");
    localStorage.removeItem("qaqc_maestro_meta");
    localStorage.removeItem("qaqc_maestro_derive");
    localStorage.removeItem("qaqc_maestro_actividad_fase");
    localStorage.removeItem(PIN_KEY);
    localStorage.removeItem(PIN_LAST_ACTIVE_KEY);
    localStorage.removeItem("qaqc_maestro_ciclos");   // v3.3
    localStorage.removeItem("qaqc_maestro_config");   // v3.3
    localStorage.removeItem("qaqc_maestro_frentes");  // v3.3
    CICLOS = loadCiclos(); CICLO_CFG = loadCicloCfg(); CICLO_PANELES_INFO = null;
    MASTER = loadMaster();
    PANEL_DERIVE = loadPanelDerive();
    ACTIVIDAD_FASE = loadActividadFase();
    buildHeaderFields();
    syncSignerNames();
    updateMaestroBadges();
    renderMaestroPreview();
    renderArchive();
  }

  function showPinScreen(mode){
    pinMode = mode;
    pinBuffer = "";
    if (mode === "set") pinFirstEntry = "";

    const prev = document.getElementById("pinOverlay");
    if (prev) prev.remove();

    const subs = {
      set: "Elige un PIN de 4 dígitos para proteger la app / 选择4位PIN码保护应用",
      confirm: "Vuelve a escribir el mismo PIN para confirmar / 请再次输入相同的PIN码以确认",
      unlock: "La app está bloqueada. Ingresa tu PIN / 应用已锁定，请输入PIN码",
    };

    const ov = document.createElement("div");
    ov.id = "pinOverlay";
    ov.className = "pin-overlay";
    ov.innerHTML = `
      <div class="pin-logo">⛏ QAQC PANELES / 面板质量检查</div>
      <div class="pin-sub">${subs[mode]}</div>
      <input id="pinInput" type="tel" inputmode="numeric" pattern="[0-9]*" maxlength="4"
        placeholder="••••" autocomplete="off" class="pin-input">
      <button id="pinBtn" class="pin-btn" type="button">Confirmar / 确认</button>
      <div class="pin-error" id="pinError"></div>
      ${mode === "unlock" ? '<button id="pinForgotBtn" type="button" class="pin-hint">¿Olvidaste tu PIN? / 忘记PIN码？</button>' : ""}
    `;
    document.body.appendChild(ov);

    const inp = document.getElementById("pinInput");
    document.getElementById("pinBtn").addEventListener("click", pinConfirm);
    inp.addEventListener("input", () => {
      inp.value = inp.value.replace(/\D/g, "").slice(0, 4);
      pinBuffer = inp.value;
    });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") pinConfirm(); });
    setTimeout(() => inp.focus(), 350);

    const forgotBtn = document.getElementById("pinForgotBtn");
    if (forgotBtn){
      forgotBtn.addEventListener("click", () => {
        const ok = confirm(
          "Esto borrará el Maestro cargado y TODOS los registros guardados en este dispositivo que no hayas exportado, y te dejará crear un PIN nuevo. No se puede deshacer.\n\n" +
          "这将清除本设备上已加载的主数据表和所有未导出的记录，且无法撤销。\n\n¿Seguro que quieres continuar?"
        );
        if (!ok) return;
        pinWipeDeviceData();
        showPinScreen("set");
        toast("Datos borrados. Crea tu nuevo PIN / 数据已清除，请设置新PIN码", 4000);
      });
    }
  }

  function pinConfirm(){
    pinTouchActivity();
    const err = document.getElementById("pinError");
    const inp = document.getElementById("pinInput");
    if (err) err.textContent = "";
    if (inp) pinBuffer = inp.value.replace(/\D/g, "").slice(0, 4);

    if (pinBuffer.length < 4){
      if (err) err.textContent = "Ingresa 4 dígitos / 请输入4位数字";
      return;
    }

    if (pinMode === "set"){
      pinFirstEntry = pinBuffer;
      showPinScreen("confirm");
    } else if (pinMode === "confirm"){
      if (pinBuffer !== pinFirstEntry){
        toast("Los PIN no coinciden, vuelve a intentar / 两次输入不一致，请重试", 3200);
        showPinScreen("set");
        return;
      }
      localStorage.setItem(PIN_KEY, pinBuffer);
      pinTouchActivity();
      const ov = document.getElementById("pinOverlay");
      if (ov) ov.remove();
      toast("PIN configurado correctamente / PIN码设置成功");
    } else if (pinMode === "unlock"){
      if (pinMatches(pinBuffer)){
        pinTouchActivity();
        const ov = document.getElementById("pinOverlay");
        if (ov) ov.remove();
      } else {
        pinBuffer = "";
        if (inp){ inp.value = ""; inp.focus(); }
        if (err) err.textContent = "PIN incorrecto. Intenta de nuevo / 密码错误，请重试";
      }
    }
  }

  function initPinLock(){
    document.addEventListener("touchstart", pinTouchActivity);
    document.addEventListener("click", pinTouchActivity);
    document.addEventListener("keydown", pinTouchActivity);
    setInterval(pinCheckTimeout, 60000);

    document.getElementById("btnCambiarPin").addEventListener("click", () => showPinScreen("set"));

    if (!pinSaved()){
      showPinScreen("set");
    } else {
      const last = parseInt(localStorage.getItem(PIN_LAST_ACTIVE_KEY) || "0", 10);
      if (Date.now() - last > PIN_TIMEOUT_MS){
        showPinScreen("unlock");
      } else {
        pinTouchActivity();
      }
    }
  }

  /* ============================================================
     Arranque
     ============================================================ */
  // El PIN se activa primero, antes que cualquier otra cosa: así, aunque algo
  // más adelante en el arranque falle (por ejemplo un registro dañado en el
  // dispositivo), el bloqueo ya quedó activo y no se salta por accidente.
  initPinLock();
  buildHeaderFields();
  initStepCounter();
  initMeasureModal();
  buildGroups();
  buildSignatures();
  updateMaestroBadges();
  renderMaestroPreview();
  renderArchive();

  /* ============================================================
     Versión visible y aviso de actualización.
     - Muestra "App vX.Y.Z" en el encabezado para que el inspector (o quien
       lo revise en campo) vea de un vistazo qué versión tiene.
     - Busca una versión nueva al abrir la app, al recuperar señal y cada
       30 minutos. Cuando el service worker nuevo toma el control, aparece una
       franja fija "Nueva versión disponible" con un botón para actualizar.
     - Si hay un formulario a medio llenar, pide confirmación antes de
       recargar (recargar borra lo que no se haya enviado).
     ============================================================ */
  (function versionAndUpdates(){
    const sub = document.querySelector(".brand .sub");
    if (sub && sub.textContent.indexOf("App v") === -1) sub.textContent += " · App v" + APP_VERSION;

    if (!("serviceWorker" in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;

    function formHasData(){
      if (itemState.some(s => s.status || (s.obs || "").trim() || s.photo)) return true;
      return Object.keys(sigState).some(k => sigState[k] && sigState[k].dataUrl);
    }
    function showUpdateBanner(){
      if (document.getElementById("qaqcUpdateBanner")) return;
      const bar = document.createElement("div");
      bar.id = "qaqcUpdateBanner";
      bar.setAttribute("role", "status");
      bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;background:var(--accent,#F2701D);color:var(--accent-ink,#2A1200);padding:10px 14px calc(10px + env(safe-area-inset-bottom,0px));display:flex;gap:10px;align-items:center;justify-content:space-between;font-size:13px;font-weight:600;box-shadow:0 -4px 14px rgba(0,0,0,.35)";
      bar.innerHTML = '<span>Nueva versión de la app disponible<br><span style="font-weight:500">新版本可用，请更新</span></span>'
        + '<button type="button" style="flex:none;border:0;border-radius:8px;padding:10px 14px;background:var(--paper,#0F1923);color:#fff;font-weight:700">Actualizar / 更新</button>';
      bar.querySelector("button").addEventListener("click", () => {
        if (formHasData() && !confirm("Tienes un formulario sin enviar. Si actualizas ahora se perderá. ¿Actualizar de todas formas?\n\n有未提交的表单，现在更新会丢失。仍要更新吗？")) return;
        location.reload();
      });
      document.body.appendChild(bar);
    }

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // En la primera instalación no hay versión anterior: no se avisa nada.
      if (hadController) showUpdateBanner();
    });
    navigator.serviceWorker.ready.then(reg => {
      const check = () => { if (navigator.onLine) reg.update().catch(() => {}); };
      check();
      window.addEventListener("online", check);
      setInterval(check, 30 * 60 * 1000);
    }).catch(() => {});
  })();
})();
