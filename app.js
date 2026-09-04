/* QAQC Paneles — lógica de la app (ES/中文)
   Todos los datos (GRUPOS, MASTER por defecto, HEADER_FIELDS, SIGNERS, columnas de Maestro)
   se inyectan desde index.html en window.__QAQC_*__ para mantener este archivo legible. */
(function(){
  "use strict";

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
  function compressImage(file, maxDim, quality){
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => { img.onload = () => {
        let w = img.width, h = img.height;
        if (w > h && w > maxDim){ h = Math.round(h * maxDim / w); w = maxDim; }
        else if (h >= w && h > maxDim){ w = Math.round(w * maxDim / h); h = maxDim; }
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", quality || 0.6));
      }; img.onerror = reject; img.src = reader.result; };
      reader.readAsDataURL(file);
    });
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
  function buildHeaderFields(){
    const wrap = document.getElementById("headerFields");
    wrap.innerHTML = HEADER_FIELDS.map(f => {
      let control;
      if (f.type === "select"){
        const opts = (MASTER[f.list]||[]).map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
        control = `<select data-key="${f.key}">${opts}</select>`;
      } else if (f.type === "date"){
        control = `<input type="date" data-key="${f.key}" value="${businessDateISO()}">`;
      } else if (f.type === "text_list"){
        const listId = "dl_" + f.key;
        const opts = (MASTER[f.list]||[]).map(v => `<option value="${esc(v)}">`).join("");
        control = `<input type="text" list="${listId}" data-key="${f.key}" placeholder="${esc(f.placeholder||"")}">
                   <datalist id="${listId}">${opts}</datalist>`;
      } else {
        control = `<input type="text" data-key="${f.key}" placeholder="${esc(f.placeholder||"")}">`;
      }
      return `<div class="field"><label>${esc(f.es)}<span class="zh">${esc(f.zh)}</span></label>${control}</div>`;
    }).join("") + `<div class="field"><label>ID Registro<span class="zh">记录ID</span></label><div class="readonly-val" id="idRegistroVal"></div></div>`;

    wrap.querySelectorAll("[data-key]").forEach(el => {
      headerState[el.dataset.key] = el.value;
      el.addEventListener("input", () => { headerState[el.dataset.key] = el.value; syncSignerNames(); });
    });
    headerState.id = genId();
    document.getElementById("idRegistroVal").textContent = headerState.id;

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
          if (el && [...el.options].some(o => o.value === fase)){ el.value = fase; headerState.fase = fase; }
        }
      });
    }
  }

  /* ============================================================
     Render: grupos e ítems
     ============================================================ */
  const itemState = []; // {uid, grupoEs, grupoZh, gi, idx, es, zh, status, obs, photo}
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
        itemState.push({uid, grupoEs:g.es, grupoZh:g.zh, gi, idx:ii+1, es:it.es, zh:it.zh, status:"", obs:"", photo:""});
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
          const val = btn.dataset.val;
          state.status = (state.status === val) ? "" : val;
          row.querySelectorAll(".status-btn").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.val === state.status)));
          row.classList.remove("answered-ok","answered-bad","answered-na");
          if (state.status === "Cumple") row.classList.add("answered-ok");
          if (state.status === "No Cumple") row.classList.add("answered-bad");
          if (state.status === "N/A") row.classList.add("answered-na");
          updateGroupProgress(row.closest(".group"));
        });
      });

      row.querySelector('[data-role="obs"]').addEventListener("input", e => { state.obs = e.target.value; });

      const camIn = row.querySelector('[data-role="camerainput"]');
      const galIn = row.querySelector('[data-role="galleryinput"]');
      row.querySelector('[data-role="camerabtn"]').addEventListener("click", () => camIn.click());
      row.querySelector('[data-role="gallerybtn"]').addEventListener("click", () => galIn.click());
      [camIn, galIn].forEach(inp => inp.addEventListener("change", async () => {
        if (!inp.files || !inp.files[0]) return;
        try {
          const dataUrl = await compressImage(inp.files[0], 900, 0.62);
          state.photo = dataUrl;
          renderThumb(row, state);
          toast("Evidencia adjuntada / 已附加证据");
        } catch(e){ toast("No se pudo procesar la imagen"); }
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
        <h4>${esc(s.es)}</h4><div class="zh">${esc(s.zh)}</div>
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
        return {es: it.es, zh: it.zh, status:s.status, obs:s.obs, photo:s.photo};
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
      capturedAt: nowStamp()
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
        const img = it.photo ? `<img src="${it.photo}" alt="evidencia">` : "";
        const obs = it.obs ? `<span class="dobs">${esc(it.obs)}</span>` : "";
        return `<div class="detail-item"><span class="pill ${pillClass}">${esc(pillTxt)}</span><span class="dtext">${esc(it.es)}${obs}</span>${img}</div>`;
      }).join("");
      return `<div class="detail-group"><h5>${esc(g.es)} <span style="color:var(--ink-soft);font-weight:400">${esc(g.zh)}</span></h5>${rows}</div>`;
    }).join("");
    const pendingSigners = SIGNERS.filter(s => !(rec.signatures[s.key] && rec.signatures[s.key].dataUrl));
    const sigWindowOpen = canCompleteSignatures(rec);
    const sigStrip = SIGNERS.map(s => {
      const sd = rec.signatures[s.key] || {};
      const img = sd.dataUrl ? `<img src="${sd.dataUrl}">`
        : `<div style="width:120px;height:44px;background:var(--surface-2);border:1px solid var(--border-soft);border-radius:6px"></div>`;
      return `<div class="sigmini">${img}<div>${esc(s.es)}${sd.name ? " — " + esc(sd.name) : ""}${sd.ts ? " · " + esc(sd.ts) : ""}</div></div>`;
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
            <span><b>Fase:</b> ${esc(h.fase||"—")}</span>
            <span><b>Inspector:</b> ${esc(h.inspector||"—")}</span>
            <span><b>Ítems:</b> ${rec.totals.cumple} cumple / ${rec.totals.noCumple} no cumple / ${rec.totals.na} n/a</span>
          </div>
        </div>
      </div>
      <details><summary>Ver detalle de los ${GRUPOS.length} grupos y firmas / 查看${GRUPOS.length}个检查组和签名详情</summary>
        ${detailGroups}
        <div class="sig-strip">${sigStrip}</div>
        <div class="record-actions">
          <button type="button" class="btn btn-primary btn-sm" data-act="export-pdf" data-id="${esc(rec.id)}">Descargar PDF <span style="opacity:.8;font-weight:500">/ 下载PDF</span></button>
          ${pendingSigners.length ? (sigWindowOpen
            ? `<button type="button" class="btn btn-ghost btn-sm" data-act="complete-sig" data-id="${esc(rec.id)}">Completar firmas (${pendingSigners.length}) <span style="opacity:.8;font-weight:500">/ 补签(${pendingSigners.length})</span></button>`
            : `<button type="button" class="btn btn-ghost btn-sm" disabled title="El turno de este registro ya terminó / 该记录所属班次已结束">Firma vencida (${pendingSigners.length}) <span style="opacity:.8;font-weight:500">/ 签名已过期</span></button>`
          ) : ""}
          <button type="button" class="btn btn-ghost btn-sm" data-act="export-xlsx" data-id="${esc(rec.id)}">Descargar Excel</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="export-csv" data-id="${esc(rec.id)}">CSV</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="delete" data-id="${esc(rec.id)}">Eliminar</button>
        </div>
      </details>
    </div>`;
  }

  function resetForm(){
    itemState.forEach(s => { s.status=""; s.obs=""; s.photo=""; });
    buildGroups();
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
    const unanswered = itemState.filter(s => !s.status).length;
    if (unanswered > 0 && !confirm(`${unanswered} ítem(s) sin diligenciar. ¿Enviar de todas formas? / 还有 ${unanswered} 项未填写，仍要提交吗？`)) return;

    const rec = collectRecord();
    warn.textContent = "";
    const recs = getRecords();
    recs.unshift(rec);
    setRecords(recs);
    toast("Registro guardado en el archivo / 记录已保存");
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
        <h4>${esc(s.es)}</h4><div class="zh">${esc(s.zh)}</div>
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
    const header = meta.concat(itemCols);
    const rows = [header];
    recs.forEach(rec => {
      const h = rec.header;
      const row = [rec.id, h.fecha||"", h.turno||"", h.guardia||"", h.empresa||"", h.labor||"", h.categoriaExplotacion||"",
                   h.fase||"", h.codigoEquipo||"", h.inspector||"", h.supervisor||"", h.operadorEquipo||"", h.actividad||"",
                   rec.totals.pct==null?"":rec.totals.pct, rec.totals.cumple, rec.totals.noCumple, rec.totals.na, rec.capturedAt||""];
      rec.groups.forEach(g => g.items.forEach(it => { row.push(it.status||""); row.push(it.obs||""); }));
      rows.push(row);
    });
    return rows;
  }

  function buildHallazgosRows(recs){
    const header = ["ID Hallazgo","ID Registro","Fecha","Labor (panel)","Turno","Guardia","Inspector",
                     "Grupo","Estandar (No Cumple)","标准 (不符合)","Observacion","Foto","Estado cierre"];
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
                       it.photo ? "FOTO_ADJUNTA" : "Sin foto", "PENDIENTE"]);
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

        const textH = 3.8 + esLines.length*4.2 + zhLines.length*3.6 + (obsLines.length ? obsLines.length*3.8+1.5 : 0);
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
        doc.text("Sin firmar / 未签名", x+3, y+20);
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
      doc.text(`QAQC Paneles · Generado ${nowStamp()}`, M, PH-8);
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
    MASTER = loadMaster();
    PANEL_DERIVE = loadPanelDerive();
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
    const idxActivity = findColIndex(headerRow, ["Activity"]);
    const idxInspector = findColIndex(headerRow, ["Inspector"]);
    const idxShift = findColIndex(headerRow, ["Shift"]);
    const idxContractor = findColIndex(headerRow, ["Contractor"]);
    const idxGuard = findColIndex(headerRow, ["Guard"]);
    const idxSupervisor = findColIndex(headerRow, ["Supervisor"]);
    const idxMachine = findColIndex(headerRow, ["Machine name","Machine"]);
    const idxCodigo = findColIndex(headerRow, ["Codigo","Código"]);
    const idxOperator = findColIndex(headerRow, ["Operator name","Operator"]);
    const idxRange = findColIndex(headerRow, ["Range"]);

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
      ACTIVIDADES: uniqCol(idxActivity),
    };
    const found = Object.keys(master).filter(k => (master[k]||[]).length);
    if (!found.length) return null;
    return {master, found, tipo, fase};
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

    localStorage.setItem("qaqc_maestro", JSON.stringify(newMaster));
    localStorage.setItem("qaqc_maestro_meta", JSON.stringify({filename:name, updatedAt:new Date().toISOString(), columnsFound:found, mode}));
    if (mode === "real"){
      const derive = {tipo: real.tipo, fase: real.fase};
      localStorage.setItem("qaqc_maestro_derive", JSON.stringify(derive));
      PANEL_DERIVE = derive;
    } else {
      localStorage.removeItem("qaqc_maestro_derive");
      PANEL_DERIVE = loadPanelDerive();
    }
    MASTER = newMaster;

    buildHeaderFields();
    syncSignerNames();
    updateMaestroBadges();
    renderMaestroPreview();

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
     Arranque
     ============================================================ */
  buildHeaderFields();
  buildGroups();
  buildSignatures();
  updateMaestroBadges();
  renderMaestroPreview();
  renderArchive();
})();
