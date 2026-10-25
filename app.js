const { createClient } = supabase;
const cfg = window.APP_CONFIG;
const db = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const CONDITIONS = { bom: "Bom", reparo: "Precisa de reparo", inutilizavel: "Inutilizável" };

let me = null;
let spaces = [];
let families = [];
let people = [];
let rates = { socio: 30, convidado: 50 };
let current = null;

const show = (id, on) => $(id).classList.toggle("hidden", !on);
const say = (id, text) => { $(id).textContent = text || ""; };
const VIEWS = ["inventory", "people", "agenda", "rates"];
const setView = (name) => VIEWS.forEach((v) => show(v, v === name));
const setActive = (match) =>
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", match(b)));

async function init() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return showLogin();
  const email = session.user.email.toLowerCase();
  const { data, error } = await db.from("allowed_users").select("*").eq("email", email).maybeSingle();
  if (error || !data) {
    $("denied-email").textContent = email;
    show("login", false); show("app", false); show("denied", true);
    return;
  }
  me = data;
  const [{ data: sp }, { data: fam }, { data: ppl }, { data: rt }] = await Promise.all([
    db.from("spaces").select("*").order("sort"),
    db.from("families").select("*").order("name"),
    db.rpc("list_people"),
    db.rpc("get_rates"),
  ]);
  spaces = sp || [];
  families = fam || [];
  people = ppl || [];
  for (const r of rt || []) rates[r.key.replace("rate_", "")] = Number(r.value);
  show("login", false); show("denied", false); show("app", true);
  $("who").textContent = me.name || me.email;
  renderNav();
  showAgenda();
}

function showLogin() {
  show("app", false); show("denied", false); show("login", true);
}

function canEdit(space) {
  if (!me || !space) return false;
  if (space.kind === "common") return me.is_admin;
  return me.is_responsible && me.family_id === space.family_id;
}

function renderNav() {
  const nav = $("spaces");
  nav.innerHTML = "";
  const agenda = document.createElement("button");
  agenda.id = "nav-agenda";
  agenda.textContent = "📅 Agenda";
  agenda.onclick = showAgenda;
  nav.append(agenda);
  for (const [title, kind] of [["Casa comunitária", "common"], ["Quartos pessoais", "personal"]]) {
    const h = document.createElement("h3");
    h.textContent = title;
    nav.append(h);
    for (const s of spaces.filter((x) => x.kind === kind)) {
      const b = document.createElement("button");
      b.textContent = s.name;
      b.dataset.id = s.id;
      b.onclick = () => selectSpace(s);
      nav.append(b);
    }
  }
  if (me.is_admin) {
    const h = document.createElement("h3");
    h.textContent = "Administração";
    const peopleBtn = document.createElement("button");
    peopleBtn.textContent = "Pessoas";
    peopleBtn.id = "nav-people";
    peopleBtn.onclick = showPeople;
    const rt = document.createElement("button");
    rt.textContent = "Valores";
    rt.id = "nav-rates";
    rt.onclick = showRates;
    nav.append(h, peopleBtn, rt);
  }
}

async function selectSpace(space) {
  current = space;
  setView("inventory");
  setActive((b) => Number(b.dataset.id) === space.id);
  $("space-title").textContent = space.name;
  const edit = canEdit(space);
  show("readonly-badge", !edit);
  show("edit-tools", edit);
  show("form-add", edit);
  await loadItems();
}

async function loadItems() {
  const space = current;
  const { data, error } = await db.from("items").select("*").eq("space_id", space.id).order("description");
  if (space !== current) return;
  if (error) return say("app-msg", error.message);
  say("app-msg", "");
  const edit = canEdit(space);
  const tbody = $("items");
  tbody.innerHTML = "";
  $("item-count").textContent = `${data.length} ${data.length === 1 ? "item" : "itens"}`;
  if (!data.length) {
    const tr = document.createElement("tr");
    const c = td("Nenhum item cadastrado neste espaço.", "empty");
    c.colSpan = 5;
    tr.append(c);
    tbody.append(tr);
  }
  for (const it of data) tbody.append(edit ? editableRow(it) : readonlyRow(it));
}

function td(content, cls, label) {
  const c = document.createElement("td");
  if (cls) c.className = cls;
  if (label) c.dataset.label = label;
  if (content instanceof Node) c.append(content); else c.textContent = content ?? "";
  return c;
}

function readonlyRow(it) {
  const tr = document.createElement("tr");
  const tag = document.createElement("span");
  tag.className = `tag ${it.condition}`;
  tag.textContent = CONDITIONS[it.condition];
  tr.append(td(it.description, "ro", "Descrição"), td(it.quantity, "num ro", "Qtd"),
    td(tag, "ro", "Estado"), td(it.notes, "ro", "Observações"), td(""));
  return tr;
}

function editableRow(it) {
  const tr = document.createElement("tr");
  const save = async (patch) => {
    const { error } = await db.from("items").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", it.id);
    say("app-msg", error ? error.message : "Salvo.");
  };
  const text = (value, field, type = "text") => {
    const i = document.createElement("input");
    i.type = type; i.value = value ?? "";
    if (field === "notes") i.placeholder = "Observações";
    if (field === "quantity") i.placeholder = "Qtd";
    if (type === "number") i.min = 0;
    i.onchange = () => {
      let v = i.value.trim();
      if (type === "number") v = v === "" ? null : parseInt(v, 10);
      if (field === "description" && !v) { i.value = it.description; return; }
      if (field === "notes" && v === "") v = null;
      save({ [field]: v });
    };
    return i;
  };
  const sel = document.createElement("select");
  for (const [k, label] of Object.entries(CONDITIONS)) {
    const o = new Option(label, k, false, k === it.condition);
    sel.append(o);
  }
  sel.className = `cond-${it.condition}`;
  sel.onchange = () => { sel.className = `cond-${sel.value}`; save({ condition: sel.value }); };
  const del = document.createElement("button");
  del.className = "danger"; del.textContent = "✕"; del.title = "Excluir";
  del.onclick = async () => {
    if (!confirm(`Excluir "${it.description}"?`)) return;
    const { error } = await db.from("items").delete().eq("id", it.id);
    if (error) say("app-msg", error.message); else loadItems();
  };
  tr.append(td(text(it.description, "description"), "", "Descrição"),
    td(text(it.quantity, "quantity", "number"), "num", "Qtd"),
    td(sel, "", "Estado"), td(text(it.notes, "notes"), "", "Observações"), td(del));
  return tr;
}

$("form-add").onsubmit = async (e) => {
  e.preventDefault();
  const q = $("add-qty").value;
  const { error } = await db.from("items").insert({
    space_id: current.id,
    description: $("add-desc").value.trim(),
    quantity: q === "" ? null : parseInt(q, 10),
  });
  if (error) return say("app-msg", error.message);
  e.target.reset();
  loadItems();
};

// CSV simples: Descrição,Qtd (aceita ; ou , e aspas)
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const sep = (text.split("\n")[0].match(/;/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

$("csv-file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const rows = parseCsv((await file.text()).replace(/^\uFEFF/, ""));
  const first = (rows[0]?.[0] || "").trim().toLowerCase();
  const data = first.startsWith("descri") ? rows.slice(1) : rows;
  const items = data.map((r) => {
    const n = parseInt((r[1] || "").trim(), 10);
    return { space_id: current.id, description: (r[0] || "").trim(), quantity: Number.isNaN(n) ? null : n };
  }).filter((x) => x.description);
  if (!items.length) return say("app-msg", "Nenhum item encontrado no arquivo.");
  if (!confirm(`Importar ${items.length} itens em "${current.name}"?`)) return;
  const { error } = await db.from("items").insert(items);
  say("app-msg", error ? error.message : `${items.length} itens importados.`);
  if (!error) loadItems();
};

// ---- Administração de pessoas ----
async function showPeople() {
  current = null;
  setView("people");
  setActive((b) => b.id === "nav-people");
  const sel = $("p-family");
  if (!sel.options.length) {
    sel.append(new Option("Família…", ""));
    families.forEach((f) => sel.append(new Option(f.name, f.id)));
  }
  await loadPeople();
}

async function loadPeople() {
  const { data, error } = await db.from("allowed_users").select("*").order("name");
  if (error) return say("people-msg", error.message);
  say("people-msg", "");
  $("people-count").textContent = `${data.length} ${data.length === 1 ? "pessoa" : "pessoas"}`;
  const tbody = $("people-list");
  tbody.innerHTML = "";
  for (const p of data) tbody.append(personRow(p));
}

function personRow(p) {
  const tr = document.createElement("tr");
  const isMe = p.email === me.email;
  const save = async (patch) => {
    const { error } = await db.from("allowed_users").update(patch).eq("email", p.email);
    say("people-msg", error ? error.message : "Salvo.");
    if (error) loadPeople();
  };
  const name = document.createElement("input");
  name.value = p.name ?? "";
  name.onchange = () => save({ name: name.value.trim() || null });
  const fam = document.createElement("select");
  fam.append(new Option("—", ""));
  families.forEach((f) => fam.append(new Option(f.name, f.id, false, f.id === p.family_id)));
  fam.onchange = () => save({ family_id: fam.value ? Number(fam.value) : null });
  const flag = (field, disabled) => {
    const c = document.createElement("input");
    c.type = "checkbox"; c.checked = p[field]; c.disabled = disabled;
    c.onchange = () => save({ [field]: c.checked });
    return c;
  };
  const del = document.createElement("button");
  del.className = "danger"; del.textContent = "✕"; del.title = isMe ? "Você não pode remover a si mesmo" : "Remover acesso";
  del.disabled = isMe;
  del.onclick = async () => {
    if (!confirm(`Remover o acesso de ${p.name || p.email}?`)) return;
    const { error } = await db.from("allowed_users").delete().eq("email", p.email);
    if (error) say("people-msg", error.message); else loadPeople();
  };
  tr.append(td(name, "", "Nome"), td(p.email, "ro", "E-mail"), td(fam, "", "Família"),
    td(flag("is_responsible", false), "chk", "Responsável"),
    td(flag("is_admin", isMe), "chk", "Admin"), td(del));
  return tr;
}

$("form-person").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await db.from("allowed_users").insert({
    email: $("p-email").value.trim().toLowerCase(),
    name: $("p-name").value.trim(),
    family_id: Number($("p-family").value),
    is_responsible: $("p-resp").checked,
    is_admin: $("p-admin").checked,
  });
  if (error) return say("people-msg", error.code === "23505" ? "Esse e-mail já está cadastrado." : error.message);
  e.target.reset();
  loadPeople();
};

// ---- Valores ----
function showRates() {
  current = null;
  setView("rates");
  setActive((b) => b.id === "nav-rates");
  $("r-socio").value = rates.socio;
  $("r-convidado").value = rates.convidado;
  say("rates-msg", "");
}

$("form-rates").onsubmit = async (e) => {
  e.preventDefault();
  const socio = Number($("r-socio").value);
  const convidado = Number($("r-convidado").value);
  const { error } = await db.from("settings").upsert([
    { key: "rate_socio", value: socio },
    { key: "rate_convidado", value: convidado },
  ]);
  if (error) return say("rates-msg", error.message);
  rates = { socio, convidado };
  say("rates-msg", "Valores salvos.");
};

// ---- Agenda ----
const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const nightsBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);
const brDate = (s) => parseDate(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const money = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const personName = (email) => people.find((p) => p.email === email)?.name || email;
const TYPES = { socio: "Sócio", convidado: "Convidado" };
const reservableRooms = () => spaces.filter((s) => s.kind === "common" && s.reservable);
const canManage = (r) => me.is_admin || r.created_by === me.email;

let agMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let monthRes = [];
let agRoom = null;

function renderRoomChips() {
  const box = $("ag-rooms");
  box.innerHTML = "";
  for (const room of reservableRooms()) {
    const b = document.createElement("button");
    b.className = "chip" + (room.id === agRoom ? " active" : "");
    b.textContent = room.name;
    b.onclick = () => { agRoom = room.id; renderRoomChips(); renderGantt(); renderResList(); };
    box.append(b);
  }
}

async function showAgenda() {
  if (!reservableRooms().some((r) => r.id === agRoom)) agRoom = reservableRooms()[0]?.id ?? null;
  renderRoomChips();
  current = null;
  setView("agenda");
  setActive((b) => b.id === "nav-agenda");
  await loadMonth();
}

const chargeRate = (g) => {
  const c = Array.isArray(g.guest_charges) ? g.guest_charges[0] : g.guest_charges;
  return c ? Number(c.rate) : null;
};

async function loadMonth() {
  const y = agMonth.getFullYear(), m = agMonth.getMonth();
  $("ag-label").textContent = agMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const { data, error } = await db.from("reservations")
    .select("*, reservation_guests(*, guest_charges(rate))")
    .eq("status", "confirmed")
    .lt("check_in", fmtDate(new Date(y, m + 1, 1)))
    .gt("check_out", fmtDate(new Date(y, m, 1)))
    .order("check_in");
  if (error) return say("agenda-msg", error.message);
  say("agenda-msg", "");
  monthRes = data;
  renderGantt();
  renderResList();
}

function barLabel(r) {
  if (r.kind === "block") return "Aluguel";
  const names = r.reservation_guests.map((g) => g.name.split(" ")[0]);
  return names.length ? names.join(", ") : personName(r.created_by);
}

function renderGantt() {
  const y = agMonth.getFullYear(), m = agMonth.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  const next = new Date(y, m + 1, 1);
  const today = fmtDate(new Date());
  const el = $("gantt");
  el.innerHTML = "";
  el.style.setProperty("--days", days);
  const put = (node, col, row) => { node.style.gridColumn = col; node.style.gridRow = row; el.append(node); return node; };
  const div = (cls, text) => { const d = document.createElement("div"); d.className = cls; if (text != null) d.textContent = text; return d; };

  put(div("g-head g-room"), 1, 1);
  for (let d = 1; d <= days; d++) {
    const dow = new Date(y, m, d).toLocaleDateString("pt-BR", { weekday: "narrow" });
    put(div("g-head", `${d}\n${dow}`), `${2 * d} / span 2`, 1);
  }
  reservableRooms().filter((r) => r.id === agRoom).forEach((room, i) => {
    const row = i + 2;
    put(div("g-room", room.name), 1, row);
    for (let d = 1; d <= days; d++) {
      const date = new Date(y, m, d);
      const cell = div("g-cell" + ([0, 6].includes(date.getDay()) ? " we" : "") + (fmtDate(date) === today ? " today" : ""));
      cell.title = `${room.name} – ${date.toLocaleDateString("pt-BR")}`;
      cell.onclick = () => openReservation(null, { space_id: room.id, check_in: fmtDate(date) });
      put(cell, `${2 * d} / span 2`, row);
    }
    for (const r of monthRes.filter((x) => x.space_id === room.id)) {
      // a barra vai do meio do dia de entrada ao meio do dia de saída
      const inD = parseDate(r.check_in), outD = parseDate(r.check_out);
      const s = inD < new Date(y, m, 1) ? 2 : 2 * inD.getDate() + 1;
      const e = outD >= next ? 2 * days + 2 : 2 * outD.getDate() + 1;
      const bar = div("bar" + (r.kind === "block" ? " block" : "") + (r.created_by === me.email ? " mine" : ""), barLabel(r));
      bar.title = `${barLabel(r)} (${brDate(r.check_in)} → ${brDate(r.check_out)})`;
      bar.onclick = () => openReservation(r);
      put(bar, `${s} / ${e}`, row);
    }
  });
}

function reservationTotal(r) {
  const nights = nightsBetween(r.check_in, r.check_out);
  let total = 0;
  for (const g of r.reservation_guests) {
    if (g.exempt) continue;
    const rate = chargeRate(g);
    if (rate == null) return null;
    total += rate * nights;
  }
  return total;
}

function renderResList() {
  const box = $("res-list");
  box.innerHTML = "";
  const list = monthRes.filter((r) => r.space_id === agRoom);
  if (!list.length) {
    box.innerHTML = '<p class="empty">Nenhuma reserva neste mês.</p>';
    return;
  }
  for (const r of list) {
    const room = spaces.find((s) => s.id === r.space_id);
    const nights = nightsBetween(r.check_in, r.check_out);
    const card = document.createElement("div");
    card.className = "res-card";
    const head = document.createElement("div");
    head.className = "res-head";
    head.innerHTML = "";
    const title = document.createElement("b");
    title.textContent = `${room?.name ?? "?"} · ${brDate(r.check_in)} → ${brDate(r.check_out)}`;
    const meta = document.createElement("span");
    meta.className = "count";
    meta.textContent = `${nights} ${nights === 1 ? "noite" : "noites"}`;
    head.append(title, meta);
    const body = document.createElement("div");
    body.className = "res-body";
    if (r.kind === "block") body.textContent = "Aluguel por plataforma" + (r.note ? ` – ${r.note}` : "");
    else {
      body.textContent = r.reservation_guests.map((g) => g.name).join(", ") + ` · por ${personName(r.created_by)}`;
      if (canManage(r)) {
        const t = reservationTotal(r);
        if (t != null) {
          const tt = document.createElement("span");
          tt.className = "tag bom";
          tt.textContent = money(t);
          body.append(" ", tt);
        }
      }
    }
    card.append(head, body);
    card.onclick = () => openReservation(r);
    box.append(card);
  }
}

$("ag-prev").onclick = () => { agMonth = new Date(agMonth.getFullYear(), agMonth.getMonth() - 1, 1); loadMonth(); };
$("ag-next").onclick = () => { agMonth = new Date(agMonth.getFullYear(), agMonth.getMonth() + 1, 1); loadMonth(); };
$("ag-new").onclick = () => openReservation(null, { space_id: agRoom });

// ---- Formulário de reserva ----
let editing = null;
let formGuests = [];
let removedIds = [];
let readOnly = false;

function openReservation(r, preset = {}) {
  editing = r;
  readOnly = !!r && !canManage(r);
  removedIds = [];
  const isNew = !r;
  $("res-title").textContent = isNew ? "Nova reserva" : readOnly ? "Reserva" : "Editar reserva";
  const sel = $("r-space");
  sel.innerHTML = "";
  reservableRooms().forEach((s) => sel.append(new Option(s.name, s.id)));
  sel.value = r?.space_id ?? preset.space_id ?? reservableRooms()[0]?.id;
  $("r-in").value = r?.check_in ?? preset.check_in ?? "";
  $("r-out").value = r?.check_out ?? (preset.check_in ? fmtDate(new Date(parseDate(preset.check_in).getTime() + 864e5)) : "");
  $("r-note").value = r?.note ?? "";
  show("r-block-wrap", me.is_admin && !readOnly);
  $("r-block").checked = r?.kind === "block";
  formGuests = (r?.reservation_guests ?? []).map((g) => ({
    id: g.id, name: g.name, user_email: g.user_email, type: g.type, exempt: g.exempt, rate: chargeRate(g),
  }));
  $("people-names").innerHTML = "";
  people.forEach((p) => $("people-names").append(new Option(p.name)));
  say("r-msg", "");
  show("r-delete", !isNew && !readOnly);
  show("r-save", !readOnly);
  show("g-add-row", !readOnly);
  for (const id of ["r-space", "r-in", "r-out", "r-note", "r-block"]) $(id).disabled = readOnly;
  refreshForm();
  $("res-dialog").showModal();
}

function refreshForm() {
  const block = $("r-block").checked;
  show("r-guests-wrap", !block);
  const nights = $("r-in").value && $("r-out").value ? nightsBetween($("r-in").value, $("r-out").value) : 0;
  say("r-nights", nights > 0 ? `${nights} ${nights === 1 ? "noite" : "noites"}` : nights < 0 ? "A saída deve ser depois da entrada." : "");
  const box = $("r-guests");
  box.innerHTML = "";
  formGuests.forEach((g, i) => {
    const row = document.createElement("div");
    row.className = "guest-row";
    const name = document.createElement("span");
    name.className = "g-name";
    name.textContent = g.name;
    const type = document.createElement("select");
    Object.entries(TYPES).forEach(([k, v]) => type.append(new Option(v, k, false, k === g.type)));
    type.disabled = readOnly;
    type.onchange = () => { g.type = type.value; if (g.id) g.rate = null; refreshForm(); };
    const ex = document.createElement("label");
    ex.className = "check";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = g.exempt; cb.disabled = readOnly;
    cb.onchange = () => { g.exempt = cb.checked; refreshForm(); };
    ex.append(cb, " Isento");
    row.append(name, type, ex);
    if (!readOnly) {
      const del = document.createElement("button");
      del.type = "button"; del.className = "danger"; del.textContent = "✕";
      del.onclick = () => { if (g.id) removedIds.push(g.id); formGuests.splice(i, 1); refreshForm(); };
      row.append(del);
    }
    box.append(row);
  });
  const manage = !editing || canManage(editing);
  if (!manage || block || nights <= 0) return say("r-total", "");
  let total = 0, estimated = false;
  for (const g of formGuests) {
    if (g.exempt) continue;
    const stored = g.id && g.rate != null && !(editing && g.type !== editing.reservation_guests.find((x) => x.id === g.id)?.type);
    total += (stored ? g.rate : rates[g.type]) * nights;
    if (!stored) estimated = true;
  }
  say("r-total", `Total: ${money(total)}${estimated ? " (valores atuais)" : ""}`);
}

function addGuest() {
  const name = $("g-name").value.trim();
  if (!name) return;
  const person = people.find((p) => p.name?.toLowerCase() === name.toLowerCase());
  formGuests.push({
    name: person?.name ?? name, user_email: person?.email ?? null,
    type: $("g-type").value, exempt: $("g-exempt").checked,
  });
  $("g-name").value = "";
  $("g-exempt").checked = false;
  refreshForm();
}

$("g-add").onclick = addGuest;
$("g-name").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addGuest(); } };
$("g-name").onchange = () => {
  const name = $("g-name").value.trim().toLowerCase();
  $("g-type").value = people.some((p) => p.name?.toLowerCase() === name) ? "socio" : "convidado";
};
$("r-block").onchange = refreshForm;
$("r-in").onchange = () => {
  const i = $("r-in").value;
  if (i && (!$("r-out").value || $("r-out").value <= i)) $("r-out").value = fmtDate(new Date(parseDate(i).getTime() + 864e5));
  refreshForm();
};
$("r-out").onchange = refreshForm;
$("r-close").onclick = () => $("res-dialog").close();

$("r-delete").onclick = async () => {
  if (!confirm("Cancelar esta reserva?")) return;
  const { error } = await db.from("reservations").delete().eq("id", editing.id);
  if (error) return say("r-msg", error.message);
  $("res-dialog").close();
  loadMonth();
};

$("res-form").onsubmit = async (e) => {
  e.preventDefault();
  if (readOnly) return;
  const block = $("r-block").checked;
  const check_in = $("r-in").value, check_out = $("r-out").value;
  if (nightsBetween(check_in, check_out) <= 0) return say("r-msg", "A saída deve ser depois da entrada.");
  if (!block && !formGuests.length) return say("r-msg", "Adicione ao menos uma pessoa.");
  const payload = {
    space_id: Number($("r-space").value), check_in, check_out,
    kind: block ? "block" : "stay", note: $("r-note").value.trim() || null, status: "confirmed",
  };
  $("r-save").disabled = true;
  try {
    let id;
    if (editing) {
      const { error } = await db.from("reservations").update(payload).eq("id", editing.id);
      if (error) throw error;
      id = editing.id;
    } else {
      const { data, error } = await db.from("reservations").insert({ ...payload, created_by: me.email }).select("id").single();
      if (error) throw error;
      id = data.id;
    }
    if (block) removedIds = (editing?.reservation_guests ?? []).map((g) => g.id);
    if (removedIds.length) {
      const { error } = await db.from("reservation_guests").delete().in("id", removedIds);
      if (error) throw error;
    }
    const guests = block ? [] : formGuests;
    const fresh = guests.filter((g) => !g.id).map((g) => ({
      reservation_id: id, name: g.name, user_email: g.user_email, type: g.type, exempt: g.exempt,
    }));
    if (fresh.length) {
      const { error } = await db.from("reservation_guests").insert(fresh);
      if (error) throw error;
    }
    for (const g of guests.filter((x) => x.id)) {
      const { error } = await db.from("reservation_guests").update({ name: g.name, type: g.type, exempt: g.exempt }).eq("id", g.id);
      if (error) throw error;
    }
    $("res-dialog").close();
    loadMonth();
  } catch (err) {
    say("r-msg", err.code === "23P01" ? "Esse quarto já está reservado em parte desse período." : err.message);
  } finally {
    $("r-save").disabled = false;
  }
};

$("btn-google").onclick = () =>
  db.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });

$("form-magic").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await db.auth.signInWithOtp({
    email: $("magic-email").value.trim(),
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  say("login-msg", error ? error.message : "Link enviado. Verifique seu e-mail.");
};

const logout = async () => { await db.auth.signOut(); location.reload(); };
$("btn-logout").onclick = logout;
$("btn-logout-denied").onclick = logout;

db.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_IN" && session && me?.email !== session.user.email.toLowerCase()) init();
  if (event === "SIGNED_OUT") location.reload();
});
init();
