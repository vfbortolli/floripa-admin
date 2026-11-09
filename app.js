const { createClient } = supabase;
const cfg = window.APP_CONFIG;
const db = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const CONDITIONS = { bom: "Bom", reparo: "Precisa de reparo", inutilizavel: "Inutilizável" };

let me = null;
let spaces = [];
let families = [];
let people = [];
let rates = {};
let current = null;
let inventoryItems = [];
let myReservationIds = new Set();

const show = (id, on) => $(id).classList.toggle("hidden", !on);
const say = (id, text) => { $(id).textContent = text || ""; };
const canManageFinance = () => Boolean(me?.is_admin);
const PAYMENT_PROOFS_BUCKET = "payment-proofs";
const PAYMENT_PROOF_TYPES = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
]);
const PAYMENT_PROOF_MAX_SIZE = 10 * 1024 * 1024;
const VIEWS = ["inventory", "people", "agenda", "rates", "billing", "dashboard", "finance", "history"];
const setView = (name) => VIEWS.forEach((v) => show(v, v === name));
const setActive = (match) => {
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", match(b)));
  document.querySelectorAll("nav .nav-group").forEach((group) =>
    group.classList.toggle("has-active", !!group.querySelector(".nav-item.active")));
};

async function init() {
  me = null;
  people = [];
  rates = {};
  myReservationIds = new Set();
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

async function uploadPaymentProof(file) {
  const extension = PAYMENT_PROOF_TYPES.get(file.type);
  if (!extension) return { error: "Use um comprovante em PDF, JPG ou PNG." };
  if (!file.size || file.size > PAYMENT_PROOF_MAX_SIZE) {
    return { error: "O arquivo deve ter até 10 MB." };
  }
  const objectPath = `${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await db.storage.from(PAYMENT_PROOFS_BUCKET)
    .upload(objectPath, file, { contentType: file.type, upsert: false });
  if (uploadError) return { error: uploadError.message };

  const originalName = file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120) || "comprovante";
  const { data, error } = await db.from("payment_receipts")
    .insert({ object_path: objectPath, original_name: originalName })
    .select("id, object_path, original_name, uploaded_at")
    .single();
  if (error) {
    const { error: cleanupError } = await db.storage.from(PAYMENT_PROOFS_BUCKET).remove([objectPath]);
    return { error: cleanupError
      ? `${error.message} O arquivo enviado não pôde ser removido do armazenamento: ${cleanupError.message}`
      : error.message };
  }
  return { data };
}

async function cleanupUnlinkedPaymentProof(receipt) {
  const { error: recordError } = await db.from("payment_receipts").delete().eq("id", receipt.id);
  const { error: fileError } = await db.storage.from(PAYMENT_PROOFS_BUCKET).remove([receipt.object_path]);
  return [recordError, fileError].filter(Boolean).map((error) => error.message);
}

async function openPaymentProof(receipt, messageId) {
  const tab = window.open("about:blank", "_blank");
  if (!tab) return say(messageId, "Permita abrir uma nova aba para visualizar o comprovante.");
  tab.opener = null;
  const { data, error } = await db.storage.from(PAYMENT_PROOFS_BUCKET)
    .createSignedUrl(receipt.object_path, 60);
  if (error) {
    tab.close();
    return say(messageId, error.message);
  }
  tab.location.href = data.signedUrl;
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
  const addGroup = (title, icon, id, onToggle) => {
    const group = document.createElement("section");
    group.className = "nav-group";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nav-group-toggle";
    if (id === "nav-agenda") toggle.id = "nav-agenda";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", `${id}-items`);
    const symbol = document.createElement("span");
    symbol.className = "nav-icon";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = icon;
    const label = document.createElement("span");
    label.textContent = title;
    if (id === "nav-agenda") {
      const count = document.createElement("span");
      count.id = "nav-agenda-count";
      count.className = "badge hidden";
      count.setAttribute("aria-label", "Solicitações pendentes");
      label.append(" ", count);
    }
    const chevron = document.createElement("span");
    chevron.className = "nav-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "⌄";
    toggle.append(symbol, label, chevron);
    const items = document.createElement("div");
    items.id = `${id}-items`;
    items.className = "nav-group-items hidden";
    toggle.onclick = () => {
      const expanded = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(expanded));
      items.classList.toggle("hidden", !expanded);
      onToggle?.();
    };
    group.append(toggle, items);
    nav.append(group);
    return items;
  };

  const agendaItems = addGroup("Agenda", "📅", "nav-agenda", showAgenda);
  for (const room of reservableRooms()) {
    const b = document.createElement("button");
    b.className = "nav-item";
    b.textContent = room.name;
    b.dataset.agendaRoom = room.id;
    b.onclick = () => {
      agRoom = room.id;
      showAgenda();
    };
    agendaItems.append(b);
  }

  for (const [title, kind, icon, id] of [
    ["Casa comunitária", "common", "🏠", "nav-common"],
    ["Quartos pessoais", "personal", "🛏️", "nav-personal"],
  ]) {
    const items = addGroup(title, icon, id);
    for (const s of spaces.filter((x) => x.kind === kind)) {
      const b = document.createElement("button");
      b.className = "nav-item";
      b.textContent = s.name;
      b.dataset.id = s.id;
      b.onclick = () => selectSpace(s);
      items.append(b);
    }
  }
  const financeItems = addGroup("Financeiro", "💰", "nav-finance-group");
  const dashboard = document.createElement("button");
  dashboard.className = "nav-item";
  dashboard.textContent = "Painel financeiro";
  dashboard.id = "nav-dashboard";
  dashboard.onclick = showFinanceDashboard;
  const finance = document.createElement("button");
  finance.className = "nav-item";
  finance.textContent = "Detalhamento";
  finance.id = "nav-finance";
  finance.onclick = showFinance;
  financeItems.append(dashboard, finance);

  if (me.is_admin) {
    const items = addGroup("Administração", "⚙️", "nav-admin");
    const peopleBtn = document.createElement("button");
    peopleBtn.className = "nav-item";
    peopleBtn.textContent = "Pessoas";
    peopleBtn.id = "nav-people";
    peopleBtn.onclick = showPeople;
    const rt = document.createElement("button");
    rt.className = "nav-item";
    rt.textContent = "Valores";
    rt.id = "nav-rates";
    rt.onclick = showRates;
    const bl = document.createElement("button");
    bl.className = "nav-item";
    bl.textContent = "Cobrança";
    bl.id = "nav-billing";
    bl.onclick = showBilling;
    items.append(peopleBtn, bl, rt);
    const hs = document.createElement("button");
    hs.className = "nav-item";
    hs.textContent = "Histórico";
    hs.id = "nav-history";
    hs.onclick = showHistory;
    items.append(hs);
  }
}

async function selectSpace(space) {
  current = space;
  inventoryItems = [];
  $("item-search").value = "";
  $("items").replaceChildren();
  $("item-count").textContent = "";
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
  inventoryItems = data;
  renderItems();
}

function normalizeSearch(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function renderItems() {
  const query = normalizeSearch($("item-search").value.trim());
  const filteredItems = inventoryItems.filter((it) =>
    normalizeSearch(`${it.description} ${it.notes} ${CONDITIONS[it.condition]}`).includes(query));
  const tbody = $("items");
  tbody.innerHTML = "";
  const count = filteredItems.length;
  const total = inventoryItems.length;
  $("item-count").textContent = count === total
    ? `${count} ${count === 1 ? "item" : "itens"}`
    : `${count} de ${total} ${total === 1 ? "item" : "itens"}`;
  if (!filteredItems.length) {
    const tr = document.createElement("tr");
    const message = total ? "Nenhum item encontrado." : "Nenhum item cadastrado neste espaço.";
    const c = td(message, "empty");
    c.colSpan = 5;
    tr.append(c);
    tbody.append(tr);
  }
  for (const it of filteredItems) tbody.append(canEdit(current) ? editableRow(it) : readonlyRow(it));
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
    if (error) return say("app-msg", error.message);
    Object.assign(it, patch);
    say("app-msg", "Salvo.");
    renderItems();
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

$("item-search").addEventListener("input", renderItems);

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
  const phone = document.createElement("input");
  phone.type = "tel"; phone.value = p.phone ?? "";
  phone.onchange = () => save({ phone: phone.value.trim() || null });
  tr.append(td(name, "", "Nome"), td(p.email, "ro", "E-mail"), td(phone, "", "Telefone"), td(fam, "", "Família"),
    td(flag("is_responsible", false), "chk", "Responsável"),
    td(flag("is_admin", isMe), "chk", "Admin"), td(del));
  return tr;
}

$("form-person").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await db.from("allowed_users").insert({
    email: $("p-email").value.trim().toLowerCase(),
    name: $("p-name").value.trim(),
    phone: $("p-phone").value.trim() || null,
    family_id: Number($("p-family").value),
    is_responsible: $("p-resp").checked,
    is_admin: $("p-admin").checked,
  });
  if (error) return say("people-msg", error.code === "23505" ? "Esse e-mail já está cadastrado." : error.message);
  e.target.reset();
  loadPeople();
};

// ---- Valores ----
$("btn-backup").onclick = async () => {
  say("backup-msg", "Gerando…");
  const { data, error } = await db.rpc("export_backup");
  if (error) return say("backup-msg", error.message);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = `backup-casa-de-praia-${fmtDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  say("backup-msg", "Backup baixado.");
};

// ---- Histórico ----
const HS_PAGE = 50;
let hsRows = [];

const HS_TABLES = {
  items: "Item", reservations: "Reserva", reservation_guests: "Pessoa da reserva",
  allowed_users: "Pessoa", settings: "Valor", guest_charges: "Cobrança",
  finance_categories: "Categoria financeira", finance_memberships: "Mensalidade",
  finance_membership_rates: "Valor anual da mensalidade",
  finance_transactions: "Lançamento financeiro", finance_daily_adjustments: "Ajuste de diárias",
};
const HS_FIELDS = {
  description: "descrição", quantity: "quantidade", condition: "estado", notes: "observações",
  space_id: "quarto", check_in: "entrada", check_out: "saída", kind: "tipo", status: "situação", note: "observação",
  name: "nome", type: "tipo", exempt: "isento", is_admin: "admin", is_responsible: "responsável",
  family_id: "família", value: "valor", paid: "pago", user_email: "e-mail", rate: "valor/noite",
  active: "ativa", period_month: "mês", year: "ano", expected_amount: "previsto", received_amount: "recebido",
  paid_at: "data do pagamento", category_id: "categoria", transaction_date: "data", amount: "valor",
};
const HS_VALUES = {
  bom: "Bom", reparo: "Precisa de reparo", inutilizavel: "Inutilizável",
  socio: "Sócio", convidado: "Convidado", confirmed: "Confirmada", pending: "Pendente", rejected: "Recusada",
  stay: "Estadia", block: "Bloqueio",
  income: "Receita", expense: "Despesa",
};

function hsValue(field, v) {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (field === "space_id") return roomById(v)?.name ?? v;
  if (field === "family_id") return families.find((f) => f.id === v)?.name ?? v;
  return HS_VALUES[v] ?? v;
}

function hsText(r) {
  const op = { INSERT: "criou", UPDATE: "alterou", DELETE: "removeu" }[r.op];
  const head = `${op} ${HS_TABLES[r.tbl]?.toLowerCase() ?? r.tbl} “${r.label ?? r.row_id ?? ""}”`;
  if (r.op !== "UPDATE") return head;
  const changes = Object.keys(r.new_data ?? {}).map(
    (k) => `${HS_FIELDS[k] ?? k}: ${hsValue(k, r.old_data?.[k])} → ${hsValue(k, r.new_data[k])}`);
  return `${head} (${changes.join("; ")})`;
}

async function showHistory() {
  current = null;
  setView("history");
  setActive((b) => b.id === "nav-history");
  hsRows = [];
  $("hs-list").innerHTML = "";
  await loadHistory();
}

async function loadHistory() {
  let q = db.from("audit_log").select("*").order("id", { ascending: false }).range(hsRows.length, hsRows.length + HS_PAGE - 1);
  if ($("hs-filter").value) q = q.eq("tbl", $("hs-filter").value);
  const { data, error } = await q;
  if (error) return say("hs-msg", error.message);
  say("hs-msg", "");
  hsRows = hsRows.concat(data);
  show("hs-more", data.length === HS_PAGE);
  for (const r of data) {
    const card = document.createElement("div");
    card.className = "res-card hs-card";
    const head = document.createElement("div");
    head.className = "res-head";
    const who = document.createElement("b");
    who.textContent = r.actor === "sistema" ? "Sistema" : personName(r.actor);
    const when = document.createElement("span");
    when.className = "count";
    when.textContent = new Date(r.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    head.append(who, when);
    const body = document.createElement("div");
    body.className = "res-body";
    body.textContent = hsText(r);
    card.append(head, body);
    $("hs-list").append(card);
  }
  if (!hsRows.length) $("hs-list").innerHTML = '<p class="empty">Nenhuma alteração registrada.</p>';
}

$("hs-filter").onchange = () => { hsRows = []; $("hs-list").innerHTML = ""; loadHistory(); };
$("hs-more").onclick = loadHistory;

// ---- Cobrança ----
let blMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let blRows = [];
let blSelected = new Set();

async function showBilling() {
  current = null;
  setView("billing");
  setActive((b) => b.id === "nav-billing");
  await loadBilling();
}

async function loadBilling() {
  const y = blMonth.getFullYear(), m = blMonth.getMonth();
  $("bl-label").textContent = blMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const { data, error } = await db.from("reservations")
    .select("id, space_id, check_in, check_out, reservation_guests(id, name, type, exempt, guest_charges(rate, paid))")
    .eq("status", "confirmed").eq("kind", "stay")
    .gte("check_out", fmtDate(new Date(y, m, 1)))
    .lt("check_out", fmtDate(new Date(y, m + 1, 1)))
    .order("check_out");
  if (error) return say("bl-msg", error.message);
  say("bl-msg", "");
  blSelected = new Set();
  blRows = [];
  for (const r of data) {
    const nights = nightsBetween(r.check_in, r.check_out);
    for (const g of r.reservation_guests) {
      const c = Array.isArray(g.guest_charges) ? g.guest_charges[0] : g.guest_charges;
      if (g.exempt || !c) continue;
      blRows.push({
        guestId: g.id, who: g.name, type: g.type,
        room: roomById(r.space_id)?.name ?? "?", check_in: r.check_in, check_out: r.check_out,
        nights, rate: Number(c.rate), amount: Number(c.rate) * nights, paid: !!c.paid, receipts: [],
      });
    }
  }
  if (blRows.length) {
    const { data: receiptLinks, error: receiptError } = await db.from("payment_receipt_guest_charges")
      .select("guest_id, payment_receipts(id, object_path, original_name, uploaded_at)")
      .in("guest_id", blRows.map((r) => r.guestId));
    if (receiptError) return say("bl-msg", receiptError.message);
    for (const link of receiptLinks ?? []) {
      const receipt = Array.isArray(link.payment_receipts) ? link.payment_receipts[0] : link.payment_receipts;
      const row = blRows.find((r) => r.guestId === link.guest_id);
      if (row && receipt) row.receipts.push(receipt);
    }
  }
  renderBilling();
}

function renderBilling() {
  const sum = (rows) => rows.reduce((t, r) => t + r.amount, 0);
  const paid = sum(blRows.filter((r) => r.paid));
  const total = sum(blRows);
  $("bl-totals").innerHTML = "";
  for (const [label, v, cls] of [["Total", total, ""], ["Pago", paid, "ok"], ["A receber", total - paid, total - paid ? "warn" : ""]]) {
    const d = document.createElement("div");
    d.className = "bl-box " + cls;
    const s = document.createElement("span");
    s.textContent = label;
    const b = document.createElement("b");
    b.textContent = money(v);
    d.append(s, b);
    $("bl-totals").append(d);
  }
  const box = $("bl-list");
  box.innerHTML = "";
  if (!blRows.length) {
    box.innerHTML = '<p class="empty">Nenhuma cobrança neste mês.</p>';
    return;
  }
  const proofTools = document.createElement("div");
  proofTools.className = "bl-proof-tools";
  const instructions = document.createElement("span");
  instructions.textContent = "Selecione uma ou mais cobranças para anexar o comprovante da transferência e dar baixa em todas.";
  const uploadLabel = document.createElement("label");
  uploadLabel.className = "btn secondary";
  uploadLabel.textContent = "Escolher comprovante";
  const uploadInput = document.createElement("input");
  uploadInput.type = "file";
  uploadInput.accept = "application/pdf,image/jpeg,image/png";
  uploadInput.hidden = true;
  uploadLabel.append(uploadInput);
  const applyProof = document.createElement("button");
  applyProof.type = "button";
  applyProof.textContent = "Anexar comprovante e dar baixa";
  applyProof.disabled = true;
  uploadInput.onchange = () => {
    applyProof.disabled = !uploadInput.files?.length || !blSelected.size;
  };
  const updateSelection = () => {
    applyProof.disabled = !uploadInput.files?.length || !blSelected.size;
    const selectedRows = blRows.filter((r) => blSelected.has(r.guestId));
    applyProof.textContent = selectedRows.some((r) => !r.paid)
      ? "Anexar comprovante e dar baixa"
      : "Anexar comprovante";
  };
  applyProof.onclick = async () => {
    const file = uploadInput.files?.[0];
    const selectedRows = blRows.filter((r) => blSelected.has(r.guestId));
    if (!file || !selectedRows.length) return;
    applyProof.disabled = true;
    say("bl-msg", "Enviando comprovante…");
    const { data: receipt, error: uploadError } = await uploadPaymentProof(file);
    if (uploadError) {
      say("bl-msg", uploadError);
      updateSelection();
      return;
    }
    const { error: linkError } = await db.from("payment_receipt_guest_charges").insert(
      selectedRows.map((r) => ({ receipt_id: receipt.id, guest_id: r.guestId })),
    );
    if (linkError) {
      const cleanupErrors = await cleanupUnlinkedPaymentProof(receipt);
      say("bl-msg", [linkError.message, ...cleanupErrors].join(" "));
      updateSelection();
      return;
    }
    const unpaidRows = selectedRows.filter((r) => !r.paid);
    if (unpaidRows.length) {
      const { error: paidError } = await db.from("guest_charges").update({
        paid: true, paid_at: new Date().toISOString(),
      }).in("guest_id", unpaidRows.map((r) => r.guestId));
      if (paidError) {
        await loadBilling();
        say("bl-msg", `Comprovante anexado, mas não foi possível dar baixa: ${paidError.message}`);
        return;
      }
    }
    uploadInput.value = "";
    blSelected = new Set();
    await loadBilling();
  };
  proofTools.append(instructions, uploadLabel, applyProof);
  box.append(proofTools);
  const groups = new Map();
  for (const r of blRows) groups.set(r.room, [...(groups.get(r.room) ?? []), r]);
  const sortedGroups = [...groups].sort((a, b) => a[0].localeCompare(b[0], "pt-BR", { numeric: true }));
  for (const [room, rows] of sortedGroups) {
    const card = document.createElement("div");
    card.className = "res-card bl-card";
    const head = document.createElement("div");
    head.className = "res-head";
    const name = document.createElement("b");
    name.textContent = room;
    const open = sum(rows.filter((r) => !r.paid));
    const tag = document.createElement("span");
    tag.className = "tag " + (open ? "reparo" : "bom");
    tag.textContent = open ? `Deve ${money(open)}` : "Quitado";
    head.append(name, tag);
    card.append(head);
    for (const r of rows) {
      const line = document.createElement("div");
      line.className = "bl-line";
      const select = document.createElement("input");
      select.type = "checkbox";
      select.checked = blSelected.has(r.guestId);
      select.disabled = r.paid && r.receipts.length > 0;
      select.setAttribute("aria-label", `Selecionar cobrança de ${r.who} para comprovante`);
      select.title = "Selecionar para anexar comprovante";
      select.onchange = () => {
        if (select.checked) blSelected.add(r.guestId);
        else blSelected.delete(r.guestId);
        updateSelection();
      };
      const txt = document.createElement("span");
      txt.textContent = `${r.who} · ${brDate(r.check_in)} → ${brDate(r.check_out)} · ${r.nights}×${money(r.rate)} (${TYPES[r.type]})${r.paid ? " · Pago" : " · Pendente"}`;
      const amt = document.createElement("b");
      amt.textContent = money(r.amount);
      line.append(select, txt, amt);
      card.append(line);
      if (r.receipts.length) {
        const receiptList = document.createElement("div");
        receiptList.className = "bl-receipts";
        for (const receipt of r.receipts) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "secondary";
          button.textContent = `Comprovante: ${receipt.original_name}`;
          button.onclick = () => openPaymentProof(receipt, "bl-msg");
          receiptList.append(button);
        }
        card.append(receiptList);
      } else {
        const noProof = document.createElement("small");
        noProof.className = "bl-no-proof";
        noProof.textContent = r.paid
          ? "Pagamento já registrado antes da exigência de comprovante."
          : "Selecione esta cobrança acima para anexar comprovante.";
        card.append(noProof);
      }
    }
    box.append(card);
  }
}

$("bl-prev").onclick = () => { blMonth = new Date(blMonth.getFullYear(), blMonth.getMonth() - 1, 1); loadBilling(); };
$("bl-next").onclick = () => { blMonth = new Date(blMonth.getFullYear(), blMonth.getMonth() + 1, 1); loadBilling(); };
$("bl-csv").onclick = () => {
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [["Pessoa", "Quarto", "Entrada", "Saída", "Noites", "Tipo", "Valor/noite", "Total", "Pago"]];
  for (const r of blRows) lines.push([r.who, r.room, r.check_in, r.check_out, r.nights, TYPES[r.type], r.rate.toFixed(2), r.amount.toFixed(2), r.paid ? "Sim" : "Não"]);
  const blob = new Blob(["\ufeff" + lines.map((l) => l.map(esc).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cobranca-${fmtDate(blMonth).slice(0, 7)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};

// ---- Financeiro ----
let fnYear = new Date().getFullYear();
let fnMonth = new Date().getMonth();
let fnCategories = [];
let fnMemberships = [];
let fnMembershipReceipts = new Map();
let fnMembershipRate = null;
let fnTransactions = [];
let fnDaily = [];
let fnDailyAdjustments = [];
let fnEditingTransaction = null;

const fnPeriod = () => `${fnYear}-${String(fnMonth + 1).padStart(2, "0")}-01`;
const fnMonthKey = (value) => String(value).slice(0, 7);
async function showFinance() {
  current = null;
  setView("finance");
  setActive((b) => b.id === "nav-finance");
  show("fn-transaction-form", canManageFinance());
  show("fn-category-form", canManageFinance());
  $("fn-date").value = fnPeriod();
  await loadFinance();
}

async function showFinanceDashboard() {
  current = null;
  setView("dashboard");
  setActive((b) => b.id === "nav-dashboard");
  await loadFinance();
}

async function loadFinance() {
  const start = `${fnYear}-01-01`, end = `${fnYear + 1}-01-01`;
  $("fn-year").value = fnYear;
  $("fn-dashboard-year").value = fnYear;
  $("fn-dashboard-year-label").textContent = String(fnYear);
  show("fn-transaction-form", canManageFinance());
  show("fn-category-form", canManageFinance());
  say("fn-msg", ""); say("fn-dashboard-msg", "");
  const [categories, memberships, membershipRate, transactions, daily, adjustments] = await Promise.all([
    db.from("finance_categories").select("*").order("kind").order("name"),
    db.from("finance_memberships").select("*").gte("period_month", start).lt("period_month", end),
    db.from("finance_membership_rates").select("amount").eq("year", fnYear).maybeSingle(),
    db.from("finance_transactions").select("*").gte("transaction_date", start).lt("transaction_date", end).order("transaction_date"),
    db.rpc("get_finance_daily", { p_year: fnYear }),
    db.from("finance_daily_adjustments").select("*").gte("period_month", start).lt("period_month", end),
  ]);
  const failed = [categories, memberships, membershipRate, transactions, daily, adjustments].find((result) => result.error);
  if (failed) {
    say("fn-msg", failed.error.message); say("fn-dashboard-msg", failed.error.message);
    return;
  }
  fnCategories = categories.data ?? [];
  fnMemberships = memberships.data ?? [];
  fnMembershipReceipts = new Map();
  if (canManageFinance() && fnMemberships.length) {
    const { data: links, error: receiptError } = await db.from("payment_receipt_memberships")
      .select("membership_id, payment_receipts(id, object_path, original_name, uploaded_at)")
      .in("membership_id", fnMemberships.map((r) => r.id));
    if (receiptError) {
      say("fn-msg", receiptError.message); say("fn-dashboard-msg", receiptError.message);
      return;
    }
    for (const link of links ?? []) {
      const receipt = Array.isArray(link.payment_receipts) ? link.payment_receipts[0] : link.payment_receipts;
      if (receipt) fnMembershipReceipts.set(link.membership_id, [
        ...(fnMembershipReceipts.get(link.membership_id) ?? []), receipt,
      ]);
    }
  }
  fnMembershipRate = membershipRate.data ? Number(membershipRate.data.amount) : null;
  fnTransactions = transactions.data ?? [];
  fnDaily = daily.data ?? [];
  fnDailyAdjustments = adjustments.data ?? [];
  updateFinanceCategoryOptions();
  renderFinanceDashboard();
  renderFinanceDetails();
  renderFinanceCategories();
}

function fnMonthlyData(monthIndex) {
  const monthKey = `${fnYear}-${String(monthIndex + 1).padStart(2, "0")}`;
  return {
    memberships: new Map(fnMemberships.filter((r) => fnMonthKey(r.period_month) === monthKey)
      .map((r) => [Number(r.family_id), r])),
    daily: fnDaily.filter((r) => fnMonthKey(r.period_month) === monthKey)
      .reduce((map, r) => map.set(Number(r.family_id), (map.get(Number(r.family_id)) ?? 0) + Number(r.amount)), new Map()),
    adjustments: new Map(fnDailyAdjustments.filter((r) => fnMonthKey(r.period_month) === monthKey)
      .map((r) => [Number(r.family_id), r])),
    categoryTotals: fnTransactions.filter((r) => fnMonthKey(r.transaction_date) === monthKey)
      .reduce((map, r) => map.set(String(r.category_id), (map.get(String(r.category_id)) ?? 0) + Number(r.amount)), new Map()),
  };
}

function fnDailyTotal(data) {
  return families.reduce((sum, family) =>
    sum + Number(data.adjustments.get(family.id)?.amount ?? data.daily.get(family.id) ?? 0), 0);
}

function fnFinanceSummary(data) {
  const usedCategories = new Set(fnTransactions.map((r) => String(r.category_id)));
  const categories = fnCategories.filter((c) => c.active || usedCategories.has(String(c.id)));
  const amount = (category) => data.categoryTotals.get(String(category.id)) ?? 0;
  const memberships = [...data.memberships.values()]
    .reduce((sum, row) => sum + Number(row.received_amount), 0);
  const incomeCategories = categories.filter((category) => category.kind === "income");
  const expenseCategories = categories.filter((category) => category.kind === "expense");
  const daily = fnDailyTotal(data);
  const otherIncome = incomeCategories.reduce((sum, category) => sum + amount(category), 0);
  const expenses = expenseCategories.reduce((sum, category) => sum + amount(category), 0);
  return {
    income: memberships + daily + otherIncome,
    expenses,
    balance: memberships + daily + otherIncome - expenses,
    incomeRows: [
      { label: "Mensalidades", amount: memberships },
      { label: "Diárias", amount: daily },
      ...incomeCategories.map((category) => ({ label: category.name, amount: amount(category) })),
    ],
    expenseRows: expenseCategories.map((category) => ({ label: category.name, amount: amount(category) })),
  };
}

function renderFinanceDashboard() {
  const grid = $("fn-annual-grid");
  grid.innerHTML = "";

  const monthly = Array.from({ length: 12 }, (_, i) => fnMonthlyData(i));
  const addMetric = (card, label, value, className) => {
    const metric = document.createElement("span");
    metric.className = `finance-month-metric ${className}`;
    const name = document.createElement("span");
    name.className = "finance-month-metric-label";
    name.textContent = label;
    const total = document.createElement("span");
    total.className = "finance-month-metric-value";
    total.textContent = money(value);
    metric.append(name, total);
    card.append(metric);
  };

  monthly.forEach((data, i) => {
    const monthName = new Date(fnYear, i, 1).toLocaleDateString("pt-BR", { month: "long" });
    const summary = fnFinanceSummary(data);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "finance-month-card";
    card.setAttribute("aria-pressed", String(i === fnMonth));
    card.setAttribute("aria-label", `${monthName}: receitas ${money(summary.income)}, despesas ${money(summary.expenses)}, balanço ${money(summary.balance)}. Ver detalhes.`);
    const title = document.createElement("span");
    title.className = "finance-month-card-title";
    title.textContent = monthName;
    card.append(title);
    addMetric(card, "Receitas", summary.income, "income");
    addMetric(card, "Despesas", summary.expenses, "expense");
    addMetric(card, "Balanço", summary.balance, "balance");
    card.onclick = () => {
      fnMonth = i;
      grid.querySelectorAll(".finance-month-card").forEach((monthCard, index) => {
        monthCard.setAttribute("aria-pressed", String(index === fnMonth));
      });
      renderFinanceDashboardDetails();
      renderFinanceDetails();
      $("fn-dashboard-detail").scrollIntoView({ behavior: "smooth", block: "start" });
    };
    grid.append(card);
  });
  renderFinanceDashboardDetails();
}

function renderFinanceDashboardDetails() {
  const data = fnMonthlyData(fnMonth);
  const summary = fnFinanceSummary(data);
  const label = new Date(fnYear, fnMonth, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  $("fn-dashboard-month-label").textContent = label;
  $("fn-dashboard-balance").textContent = money(summary.balance);
  $("fn-dashboard-income-total").textContent = money(summary.income);
  $("fn-dashboard-expense-total").textContent = money(summary.expenses);

  const renderRows = (target, rows) => {
    target.replaceChildren();
    const nonzeroRows = rows.filter((row) => row.amount !== 0);
    if (!nonzeroRows.length) {
      const empty = document.createElement("p");
      empty.className = "finance-breakdown-empty";
      empty.textContent = "Nenhum lançamento neste mês.";
      target.append(empty);
      return;
    }
    for (const row of nonzeroRows) {
      const line = document.createElement("div");
      line.className = "finance-breakdown-row";
      const name = document.createElement("span");
      name.textContent = row.label;
      const value = document.createElement("strong");
      value.textContent = money(row.amount);
      line.append(name, value);
      target.append(line);
    }
  };
  renderRows($("fn-dashboard-income"), summary.incomeRows);
  renderRows($("fn-dashboard-expenses"), summary.expenseRows);
}

function renderFinanceDetails() {
  const period = fnPeriod();
  $("fn-month-label").textContent = ` — ${new Date(fnYear, fnMonth, 1)
    .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`;
  $("fn-membership-rate-year").textContent = String(fnYear);
  $("fn-membership-rate").value = fnMembershipRate == null ? "" : fnMembershipRate.toFixed(2);
  if (!fnEditingTransaction) $("fn-date").value = period;
  const data = fnMonthlyData(fnMonth);
  renderFinanceMemberships(data, period);
  renderFinanceDaily(data, period);
  renderFinanceTransactions();
}

function renderFinanceMemberships(data, period) {
  const membershipRows = $("fn-memberships");
  membershipRows.innerHTML = "";
  for (const family of families) {
    const saved = data.memberships.get(family.id);
    const expectedAmount = fnMembershipRate ?? Number(saved?.expected_amount ?? 0);
    const row = document.createElement("tr");
    const name = document.createElement("th");
    name.scope = "row"; name.textContent = family.name; row.append(name);
    const expected = document.createElement("td");
    expected.className = "num";
    expected.dataset.label = "Previsto";
    expected.textContent = money(expectedAmount);
    row.append(expected);
    const inputs = [];
    for (const [value, label, fieldLabel] of [
      [saved?.received_amount ?? "0", `Recebido de ${family.name}`, "Recebido"],
      [saved?.paid_at ?? "", `Data do pagamento de ${family.name}`, "Data do pagamento"],
    ]) {
      const cell = document.createElement("td");
      cell.dataset.label = fieldLabel;
      if (canManageFinance()) {
        const input = document.createElement("input");
        input.type = label.startsWith("Data") ? "date" : "number";
        if (input.type === "number") { input.min = "0"; input.step = "0.01"; }
        input.value = value; input.setAttribute("aria-label", label);
        inputs.push(input);
        cell.append(input);
      } else {
        cell.textContent = label.startsWith("Data")
          ? value ? parseDate(value).toLocaleDateString("pt-BR") : "—"
          : money(Number(value));
      }
      row.append(cell);
    }
    const paid = expectedAmount > 0 && Number(saved?.received_amount ?? 0) >= expectedAmount;
    const status = document.createElement("td");
    status.dataset.label = "Status";
    const receipts = saved ? fnMembershipReceipts.get(saved.id) ?? [] : [];
    status.className = paid ? "finance-paid" : "finance-pending";
    status.textContent = paid
      ? canManageFinance() && !receipts.length ? "Pago · sem comprovante" : "Pago"
      : "Pendente";
    row.append(status);
    const proofsCell = document.createElement("td");
    proofsCell.dataset.label = "Comprovantes";
    const proofList = document.createElement("div");
    proofList.className = "finance-proof-list";
    if (canManageFinance()) {
      for (const receipt of receipts) {
        const open = document.createElement("button");
        open.type = "button";
        open.className = "secondary";
        open.textContent = receipt.original_name;
        open.onclick = () => openPaymentProof(receipt, "fn-msg");
        proofList.append(open);
      }
      const proofInput = document.createElement("input");
      proofInput.type = "file";
      proofInput.accept = "application/pdf,image/jpeg,image/png";
      proofInput.multiple = true;
      proofInput.setAttribute("aria-label", `Adicionar comprovantes de ${family.name}`);
      proofsCell.append(proofList, proofInput);
    } else {
      proofsCell.textContent = "Restritos a administradores";
    }
    row.append(proofsCell);
    const action = document.createElement("td");
    action.dataset.label = "Ação";
    if (canManageFinance()) {
      const proofInput = proofsCell.querySelector('input[type="file"]');
      const save = document.createElement("button");
      save.type = "button"; save.className = "secondary"; save.textContent = "Salvar";
      save.onclick = async () => {
        if (inputs[0].value === "" || !Number.isFinite(Number(inputs[0].value)) || Number(inputs[0].value) < 0) {
          say("fn-msg", "Informe um valor recebido válido (zero ou maior).");
          return;
        }
        save.disabled = true;
        const receivedAmount = Number(inputs[0].value);
        const files = [...(proofInput.files ?? [])];
        let membershipId = saved?.id;
        if (!membershipId && files.length) {
          const { data: created, error: createError } = await db.from("finance_memberships").upsert({
            family_id: family.id, period_month: period,
            expected_amount: expectedAmount, received_amount: 0, paid_at: null,
          }, { onConflict: "family_id,period_month" }).select("id").single();
          if (createError) { say("fn-msg", createError.message); save.disabled = false; return; }
          membershipId = created.id;
        }
        if (membershipId) {
          for (const file of files) {
            const { data: receipt, error: uploadError } = await uploadPaymentProof(file);
            if (uploadError) {
              await loadFinance();
              say("fn-msg", `Não foi possível concluir o envio: ${uploadError}`);
              save.disabled = false;
              return;
            }
            const { error: linkError } = await db.from("payment_receipt_memberships")
              .insert({ receipt_id: receipt.id, membership_id: membershipId });
            if (linkError) {
              const cleanupErrors = await cleanupUnlinkedPaymentProof(receipt);
              await loadFinance();
              say("fn-msg", [`Não foi possível vincular o comprovante: ${linkError.message}`, ...cleanupErrors].join(" "));
              save.disabled = false;
              return;
            }
          }
        }
        const availableReceipts = (saved ? fnMembershipReceipts.get(saved.id) ?? [] : []).length + files.length;
        if (receivedAmount > 0 && !availableReceipts) {
          say("fn-msg", `Anexe um comprovante para registrar o recebimento de ${family.name}.`);
          save.disabled = false;
          return;
        }
        const { error } = await db.from("finance_memberships").upsert({
          family_id: family.id, period_month: period,
          expected_amount: expectedAmount, received_amount: receivedAmount,
          paid_at: receivedAmount > 0 ? inputs[1].value || null : null,
        }, { onConflict: "family_id,period_month" });
        if (error) {
          await loadFinance();
          say("fn-msg", `Comprovante(s) anexado(s), mas o recebimento não foi salvo: ${error.message}`);
          save.disabled = false;
          return;
        }
        await loadFinance();
      };
      action.append(save);
    } else {
      action.textContent = "—";
    }
    row.append(action); membershipRows.append(row);
  }
}

$("fn-membership-rate-form").onsubmit = async (event) => {
  event.preventDefault();
  const year = Number($("r-year").value);
  if (!Number.isInteger(year) || year < 1900 || year > 9998) {
    return say("rates-msg", "Informe um ano entre 1900 e 9998.");
  }
  const amount = Number($("fn-membership-rate").value);
  if (!Number.isFinite(amount) || amount < 0) {
    say("rates-msg", "Informe uma mensalidade válida (zero ou maior).");
    return;
  }
  const { error } = await db.from("finance_membership_rates").upsert(
    { year, amount }, { onConflict: "year" },
  );
  if (error) return say("rates-msg", error.message);
  fnYear = year;
  await loadFinance();
  say("rates-msg", `Mensalidade padrão de ${year} salva.`);
};

function renderFinanceDaily(data, period) {
  const dailyRows = $("fn-daily");
  dailyRows.innerHTML = "";
  for (const family of families) {
    const imported = data.daily.get(family.id) ?? 0;
    const adjustment = data.adjustments.get(family.id);
    const row = document.createElement("tr");
    const name = document.createElement("th");
    name.scope = "row"; name.textContent = family.name; row.append(name);
    const source = document.createElement("td");
    source.dataset.label = "Importado das reservas";
    source.className = "num"; source.textContent = money(imported); row.append(source);
    const finalAmount = document.createElement("td");
    finalAmount.dataset.label = "Valor no financeiro";
    finalAmount.className = "num"; finalAmount.textContent = money(adjustment?.amount ?? imported);
    row.append(finalAmount);
    const action = document.createElement("td");
    action.dataset.label = "Ajuste";
    if (!canManageFinance()) {
      action.textContent = adjustment ? `Ajuste: ${money(Number(adjustment.amount))}` : "Sem ajuste";
    } else {
      const input = document.createElement("input");
      input.type = "number"; input.min = "0"; input.step = "0.01"; input.placeholder = "Sem ajuste";
      input.value = adjustment ? adjustment.amount : "";
      input.setAttribute("aria-label", `Ajuste de diárias para ${family.name}`);
      const save = document.createElement("button");
      save.type = "button"; save.className = "secondary"; save.textContent = "Salvar";
      save.onclick = async () => {
        if (input.value !== "" && (!Number.isFinite(Number(input.value)) || Number(input.value) < 0)) {
          say("fn-msg", "O ajuste precisa ser zero ou maior.");
          return;
        }
        save.disabled = true;
        const result = input.value === ""
          ? await db.from("finance_daily_adjustments").delete().eq("family_id", family.id).eq("period_month", period)
          : await db.from("finance_daily_adjustments").upsert({
            family_id: family.id, period_month: period, amount: Number(input.value),
          }, { onConflict: "family_id,period_month" });
        if (result.error) { say("fn-msg", result.error.message); save.disabled = false; return; }
        await loadFinance();
      };
      action.append(input, save);
    }
    row.append(action); dailyRows.append(row);
  }
}

function updateFinanceCategoryOptions() {
  const kind = $("fn-kind").value, select = $("fn-category");
  select.innerHTML = "";
  const editingCategoryId = fnTransactions.find((row) => row.id === fnEditingTransaction)?.category_id;
  for (const category of fnCategories.filter((c) =>
    c.kind === kind && (c.active || String(c.id) === String(editingCategoryId)))) {
    const option = document.createElement("option");
    option.value = category.id; option.textContent = category.name; select.append(option);
  }
  $("fn-transaction-save").disabled = select.options.length === 0;
}

function renderFinanceTransactions() {
  const period = fnPeriod(), list = $("fn-transactions");
  list.innerHTML = "";
  const categoryMap = new Map(fnCategories.map((c) => [String(c.id), c]));
  const rows = fnTransactions.filter((r) => fnMonthKey(r.transaction_date) === period.slice(0, 7));
  for (const transaction of rows) {
    const row = document.createElement("tr"), category = categoryMap.get(String(transaction.category_id));
    for (const [value, label] of [
      [new Date(`${transaction.transaction_date}T12:00:00`).toLocaleDateString("pt-BR"), "Data"],
      [transaction.kind === "income" ? "Receita" : "Despesa", "Tipo"],
      [category?.name ?? "Categoria removida", "Categoria"],
      [transaction.description, "Descrição"],
      [money(Number(transaction.amount)), "Valor"],
    ]) {
      const cell = document.createElement("td");
      cell.dataset.label = label; cell.textContent = value; row.append(cell);
    }
    const actions = document.createElement("td");
    actions.dataset.label = "Ações";
    if (canManageFinance()) {
      const edit = document.createElement("button");
      edit.type = "button"; edit.className = "link"; edit.textContent = "Editar";
      edit.onclick = () => {
        fnEditingTransaction = transaction.id;
        $("fn-kind").value = transaction.kind; updateFinanceCategoryOptions();
        $("fn-date").value = transaction.transaction_date;
        $("fn-category").value = transaction.category_id;
        $("fn-description").value = transaction.description; $("fn-amount").value = transaction.amount;
        $("fn-transaction-save").textContent = "Salvar";
        show("fn-transaction-cancel", true); $("fn-description").focus();
      };
      const remove = document.createElement("button");
      remove.type = "button"; remove.className = "danger-text"; remove.textContent = "Excluir";
      remove.onclick = async () => {
        if (!confirm("Excluir este lançamento financeiro?")) return;
        const { error } = await db.from("finance_transactions").delete().eq("id", transaction.id);
        if (error) return say("fn-msg", error.message);
        await loadFinance();
      };
      actions.append(edit, remove);
    } else {
      actions.textContent = "—";
    }
    row.append(actions); list.append(row);
  }
  if (!rows.length) {
    const row = document.createElement("tr"), cell = document.createElement("td");
    cell.colSpan = 6; cell.className = "empty"; cell.textContent = "Nenhum lançamento neste mês.";
    row.append(cell); list.append(row);
  }
}

function renderFinanceCategories() {
  const box = $("fn-categories");
  box.innerHTML = "";
  for (const category of fnCategories) {
    const row = document.createElement("div");
    row.className = "finance-category";
    const label = document.createElement("span");
    label.textContent = `${category.kind === "income" ? "Receita" : "Despesa"} · ${category.name}${category.active ? "" : " (inativa)"}`;
    if (canManageFinance()) {
      const rename = document.createElement("button");
      rename.type = "button"; rename.className = "secondary"; rename.textContent = "Renomear";
      rename.onclick = async () => {
        const name = prompt("Novo nome da categoria:", category.name)?.trim();
        if (!name || name === category.name) return;
        const { error } = await db.from("finance_categories").update({ name }).eq("id", category.id);
        if (error) return say("fn-msg", error.message);
        await loadFinance();
      };
      const toggle = document.createElement("button");
      toggle.type = "button"; toggle.className = "secondary";
      toggle.textContent = category.active ? "Desativar" : "Ativar";
      toggle.onclick = async () => {
        const { error } = await db.from("finance_categories").update({ active: !category.active }).eq("id", category.id);
        if (error) return say("fn-msg", error.message);
        await loadFinance();
      };
      row.append(label, rename, toggle);
    } else {
      row.append(label);
    }
    box.append(row);
  }
}

$("fn-load").onclick = async () => {
  const year = Number($("fn-year").value);
  if (!Number.isInteger(year) || year < 1900 || year > 9998) return say("fn-msg", "Informe um ano entre 1900 e 9998.");
  fnYear = year;
  await loadFinance();
};
$("fn-dashboard-load").onclick = async () => {
  const year = Number($("fn-dashboard-year").value);
  if (!Number.isInteger(year) || year < 1900 || year > 9998) {
    return say("fn-dashboard-msg", "Informe um ano entre 1900 e 9998.");
  }
  fnYear = year;
  await loadFinance();
};
$("fn-prev").onclick = async () => {
  if (fnYear === 1900 && fnMonth === 0) return;
  if (fnMonth === 0) { fnMonth = 11; fnYear--; } else fnMonth--;
  await loadFinance();
};
$("fn-next").onclick = async () => {
  if (fnYear === 9998 && fnMonth === 11) return;
  if (fnMonth === 11) { fnMonth = 0; fnYear++; } else fnMonth++;
  await loadFinance();
};
$("fn-kind").onchange = updateFinanceCategoryOptions;
$("fn-transaction-form").onsubmit = async (event) => {
  event.preventDefault();
  const payload = {
    kind: $("fn-kind").value, category_id: Number($("fn-category").value),
    transaction_date: $("fn-date").value, description: $("fn-description").value.trim(),
    amount: Number($("fn-amount").value),
  };
  const query = fnEditingTransaction
    ? db.from("finance_transactions").update(payload).eq("id", fnEditingTransaction)
    : db.from("finance_transactions").insert(payload);
  const { error } = await query;
  if (error) return say("fn-msg", error.message);
  fnEditingTransaction = null;
  $("fn-transaction-form").reset();
  $("fn-transaction-save").textContent = "Adicionar"; show("fn-transaction-cancel", false);
  $("fn-date").value = fnPeriod(); updateFinanceCategoryOptions();
  await loadFinance();
};
$("fn-transaction-cancel").onclick = () => {
  fnEditingTransaction = null; $("fn-transaction-form").reset();
  $("fn-transaction-save").textContent = "Adicionar"; show("fn-transaction-cancel", false);
  $("fn-date").value = fnPeriod(); updateFinanceCategoryOptions();
};
$("fn-category-form").onsubmit = async (event) => {
  event.preventDefault();
  const { error } = await db.from("finance_categories").insert({
    kind: $("fn-category-kind").value, name: $("fn-category-name").value.trim(),
  });
  if (error) return say("fn-msg", error.message);
  $("fn-category-form").reset();
  await loadFinance();
};

async function showRates() {
  current = null;
  setView("rates");
  setActive((b) => b.id === "nav-rates");
  say("rates-msg", "");
  const year = new Date().getFullYear();
  $("r-year").value = year;
  await displayRates(year);
}

async function displayRates(year) {
  fnYear = year;
  $("fn-membership-rate-year").textContent = String(year);
  $("r-socio").value = rates.socio ?? "";
  $("r-convidado").value = rates.convidado ?? "";
  const { data, error } = await db.from("finance_membership_rates")
    .select("amount").eq("year", year).maybeSingle();
  if (error) return say("rates-msg", error.message);
  $("fn-membership-rate").value = data?.amount ?? "";
  say("rates-msg", "");
}

$("r-load").onclick = async () => {
  const year = Number($("r-year").value);
  if (!Number.isInteger(year) || year < 1900 || year > 9998) {
    return say("rates-msg", "Informe um ano entre 1900 e 9998.");
  }
  await displayRates(year);
};

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
const reservableRooms = () => spaces.filter((s) => s.reservable);
const roomById = (id) => spaces.find((s) => s.id === id);
const canApprove = (room) => !!room && room.kind === "personal" && (me.is_admin || canEdit(room));
const canManage = (r) => me.is_admin || myReservationIds.has(r.id);
const autoConfirm = (room) => room.kind === "common" || me.is_admin || canEdit(room);
const statusFor = (room, existing) =>
  room.kind === "common" ? "confirmed" : existing?.status === "pending" ? "pending" : autoConfirm(room) ? "confirmed" : "pending";

let agMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let monthRes = [];
let pendingRes = [];
let agRoom = null;

function renderRoomChips() {
  const box = $("ag-rooms");
  box.innerHTML = "";
  for (const room of reservableRooms()) {
    const b = document.createElement("button");
    b.className = "chip" + (room.id === agRoom ? " active" : "") + (room.kind === "personal" ? " personal" : "");
    b.textContent = room.name;
    const n = canApprove(room) ? pendingRes.filter((r) => r.status === "pending" && r.space_id === room.id).length : 0;
    if (n) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = n;
      b.append(badge);
    }
    b.onclick = () => { agRoom = room.id; renderRoomChips(); renderGantt(); renderResList(); };
    box.append(b);
  }
}

async function showAgenda() {
  if (!reservableRooms().some((r) => r.id === agRoom)) agRoom = reservableRooms()[0]?.id ?? null;
  renderRoomChips();
  current = null;
  setView("agenda");
  setActive((b) => b.dataset.agendaRoom
    ? Number(b.dataset.agendaRoom) === agRoom
    : b.id === "nav-agenda" && !agRoom);
  if (!(await loadMyReservationIds())) return;
  await Promise.all([loadMonth(), loadPending()]);
}

async function loadMyReservationIds() {
  const { data, error } = await db.rpc("my_reservation_ids");
  if (error) {
    say("agenda-msg", error.message);
    return false;
  }
  myReservationIds = new Set((data ?? []).map((row) => row.id));
  return true;
}

async function loadPending() {
  const { data, error } = await db.from("reservations")
    .select("id, space_id, check_in, check_out, kind, status, note, created_at, created_by_name, reservation_guests(id, reservation_id, name, type, exempt, guest_charges(rate))")
    .in("status", ["pending", "rejected"])
    .gte("check_out", fmtDate(new Date()))
    .order("check_in");
  if (error) return say("agenda-msg", error.message);
  pendingRes = data.filter((r) => r.status === "pending" || myReservationIds.has(r.id));
  const todo = pendingRes.filter((r) => r.status === "pending" && canApprove(roomById(r.space_id))).length;
  const agendaCount = $("nav-agenda-count");
  agendaCount.textContent = todo;
  agendaCount.classList.toggle("hidden", !todo);
  renderRoomChips();
  renderPendingList();
}

function renderPendingList() {
  const box = $("pending-list");
  box.innerHTML = "";
  show("pending-wrap", pendingRes.length > 0);
  for (const r of pendingRes) {
    const room = roomById(r.space_id);
    const card = document.createElement("div");
    card.className = "res-card";
    const head = document.createElement("div");
    head.className = "res-head";
    const title = document.createElement("b");
    title.textContent = `${room?.name ?? "?"} · ${brDate(r.check_in)} → ${brDate(r.check_out)}`;
    const tag = document.createElement("span");
    tag.className = "tag " + (r.status === "pending" ? "reparo" : "inutilizavel");
    tag.textContent = r.status === "pending" ? (canApprove(room) ? "Aguardando você" : "Pendente") : "Recusada";
    head.append(title, tag);
    const body = document.createElement("div");
    body.className = "res-body";
    body.textContent = r.reservation_guests.map((g) => g.name).join(", ") + ` · por ${r.created_by_name || "Pessoa cadastrada"}`;
    card.append(head, body);
    card.onclick = () => openReservation(r);
    box.append(card);
  }
}

const chargeRate = (g) => {
  const c = Array.isArray(g.guest_charges) ? g.guest_charges[0] : g.guest_charges;
  return c ? Number(c.rate) : null;
};

async function loadMonth() {
  const y = agMonth.getFullYear(), m = agMonth.getMonth();
  $("ag-label").textContent = agMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const { data, error } = await db.from("reservations")
    .select("id, space_id, check_in, check_out, kind, status, note, created_at, created_by_name, reservation_guests(id, reservation_id, name, type, exempt, guest_charges(rate))")
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
  return names.length ? names.join(", ") : r.created_by_name || "Reserva";
}

function renderGantt() {
  const y = agMonth.getFullYear(), m = agMonth.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const today = fmtDate(new Date());
  const el = $("gantt");
  el.innerHTML = "";
  const div = (cls, text) => { const d = document.createElement("div"); d.className = cls; if (text != null) d.textContent = text; return d; };
  const room = spaces.find((s) => s.id === agRoom);
  if (!room) return;
  const list = monthRes.filter((x) => x.space_id === room.id);

  const head = div("cal-head");
  for (const n of ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]) head.append(div("", n));
  el.append(head);

  const start = new Date(y, m, 1 - first.getDay());
  for (let ws = new Date(start); ws <= last; ws.setDate(ws.getDate() + 7)) {
    const week = div("cal-week");
    const wsDate = new Date(ws);
    for (let k = 0; k < 7; k++) {
      const date = new Date(wsDate.getFullYear(), wsDate.getMonth(), wsDate.getDate() + k);
      const out = date.getMonth() !== m;
      const cell = div("cal-day" + (out ? " out" : "") + (fmtDate(date) === today ? " today" : ""));
      cell.append(div("num", date.getDate()));
      cell.title = `${room.name} – ${date.toLocaleDateString("pt-BR")}`;
      if (!out) cell.onclick = () => openReservation(null, { space_id: room.id, check_in: fmtDate(date) });
      cell.style.gridColumn = `${2 * k + 1} / span 2`;
      cell.style.gridRow = "1 / span 2";
      week.append(cell);
    }
    const weekEnd = new Date(wsDate.getFullYear(), wsDate.getMonth(), wsDate.getDate() + 7);
    for (const r of list) {
      const inD = parseDate(r.check_in), outD = parseDate(r.check_out);
      if (inD >= weekEnd || outD < wsDate) continue;
      // a barra vai do meio do dia de entrada ao meio do dia de saída
      const s = inD < wsDate ? 1 : 2 * nightsBetween(fmtDate(wsDate), r.check_in) + 2;
      const e = outD >= weekEnd ? 15 : 2 * nightsBetween(fmtDate(wsDate), r.check_out) + 2;
      if (e <= s) continue;
      const bar = div("bar" + (r.kind === "block" ? " block" : "") + (myReservationIds.has(r.id) ? " mine" : "") + (inD < wsDate ? " cont-l" : "") + (outD >= weekEnd ? " cont-r" : ""), barLabel(r));
      bar.title = `${barLabel(r)} (${brDate(r.check_in)} → ${brDate(r.check_out)})`;
      bar.onclick = (ev) => { ev.stopPropagation(); openReservation(r); };
      bar.style.gridColumn = `${s} / ${e}`;
      bar.style.gridRow = "2";
      week.append(bar);
    }
    el.append(week);
  }
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
      body.textContent = r.reservation_guests.map((g) => g.name).join(", ") + ` · por ${r.created_by_name || "Pessoa cadastrada"}`;
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

function reservationWhatsAppMessage(room, checkIn, checkOut) {
  const guestNames = formGuests.map((guest) => guest.name).join(", ");
  const formatDate = (value) => parseDate(value).toLocaleDateString("pt-BR");
  return [
    `Olá! ${me.name || "Uma pessoa"} solicitou uma reserva para ${room.name}.`,
    `Pessoas: ${guestNames}`,
    `Entrada: ${formatDate(checkIn)}`,
    `Saída: ${formatDate(checkOut)}`,
    "Acesse o sistema para aprovar ou recusar:",
    `${location.origin}${location.pathname}`,
  ].join("\n");
}

function showReservationWhatsApp(targets, message, error) {
  const targetList = $("whatsapp-targets");
  const status = $("whatsapp-dialog-message");
  targetList.replaceChildren();

  if (error) {
    status.textContent = `A solicitação foi salva, mas não foi possível carregar os telefones. Execute supabase/phase2o.sql no Supabase. Detalhe: ${error}`;
  } else if (!targets.length) {
    status.textContent = "A solicitação foi salva, mas não há responsável com telefone cadastrado para receber a mensagem.";
  } else {
    let invalidPhones = 0;
    for (const target of targets) {
      const phone = String(target.phone ?? "").replace(/\D/g, "");
      if (phone.length < 10 || phone.length > 15) {
        invalidPhones++;
        continue;
      }

      const url = new URL(`https://wa.me/${phone}`);
      url.searchParams.set("text", message);
      const link = document.createElement("a");
      link.className = "btn whatsapp-link";
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `Abrir WhatsApp${target.name ? ` · ${target.name}` : ""}`;
      targetList.append(link);
    }

    status.textContent = targetList.childElementCount
      ? "Escolha um responsável. A mensagem ficará preenchida no WhatsApp; confirme o envio por lá."
      : "Nenhum telefone cadastrado está em um formato válido. Confira o DDI e o número na tela Pessoas.";
    if (invalidPhones && targetList.childElementCount) {
      status.textContent += " Alguns telefones precisam ser conferidos.";
    }
  }

  $("whatsapp-dialog").showModal();
}


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
  const room0 = roomById(Number($("r-space").value));
  const st = $("r-status");
  const notes = {
    pending: "Solicitação pendente: não bloqueia o período até ser aprovada pelo responsável do quarto ou por um administrador.",
    rejected: "Solicitação recusada. Ao salvar, ela volta a ficar pendente.",
  };
  const msg = r && notes[r.status] ? notes[r.status] : "";
  st.textContent = msg;
  show("r-status", !!msg);
  show("r-approve", !!r && r.status === "pending" && canApprove(room0));
  show("r-reject", !!r && r.status === "pending" && canApprove(room0));
  formGuests = (r?.reservation_guests ?? []).map((g) => ({
    id: g.id, name: g.name, type: g.type, exempt: g.exempt, rate: chargeRate(g),
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
  const room = roomById(Number($("r-space").value));
  const needsApproval = !editing && room && !autoConfirm(room);
  $("res-title").textContent = editing ? (readOnly ? "Reserva" : "Editar reserva") : needsApproval ? "Solicitar reserva" : "Nova reserva";
  $("r-save").textContent = needsApproval ? "Enviar solicitação" : "Salvar";
  if (needsApproval) {
    $("r-status").textContent = "Este é um quarto pessoal: a reserva só vale depois de aprovada pelo responsável ou por um administrador.";
    show("r-status", true);
  } else if (!editing) show("r-status", false);
  const isPersonalRoom = room && room.kind === "personal";
  $("r-block").disabled = isPersonalRoom;
  if (isPersonalRoom) $("r-block").checked = false;
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
    const rate = stored ? g.rate : rates[g.type];
    if (rate == null) return say("r-total", "");
    total += rate * nights;
    if (!stored) estimated = true;
  }
  say("r-total", `Total: ${money(total)}${estimated ? " (valores atuais)" : ""}`);
}

function addGuest() {
  const name = $("g-name").value.trim();
  if (!name) return;
  const person = people.find((p) => p.name?.toLowerCase() === name.toLowerCase());
  formGuests.push({
    name: person?.name ?? name,
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
$("whatsapp-close").onclick = () => $("whatsapp-dialog").close();

$("r-delete").onclick = async () => {
  if (!confirm("Cancelar esta reserva?")) return;
  const { error } = await db.from("reservations").delete().eq("id", editing.id);
  if (error) return say("r-msg", error.code === "23503"
    ? "Não é possível excluir esta reserva porque há um comprovante vinculado a uma diária. Remova o vínculo financeiro antes."
    : error.message);
  $("res-dialog").close();
  loadAll();
};

const loadAll = async () => {
  if (!(await loadMyReservationIds())) return;
  await Promise.all([loadMonth(), loadPending()]);
};

async function resolveReservation(approve) {
  const id = editing.id;
  let { error } = approve
    ? await db.rpc("approve_reservation", { p_id: id, p_replace: false })
    : await db.rpc("reject_reservation", { p_id: id });
  if (error && approve && error.message.includes("CONFLITO")) {
    if (!me.is_admin) return say("r-msg", "Já existe reserva confirmada nesse período. Peça a um administrador para decidir.");
    if (!confirm("Já existe reserva confirmada nesse período.\n\nOK = substituir (a existente será recusada) e aprovar.\nCancelar = manter a existente.")) return;
    ({ error } = await db.rpc("approve_reservation", { p_id: id, p_replace: true }));
  }
  if (error) return say("r-msg", error.message);
  $("res-dialog").close();
  loadAll();
}
$("r-approve").onclick = () => resolveReservation(true);
$("r-reject").onclick = () => { if (confirm("Recusar esta solicitação?")) resolveReservation(false); };
$("r-space").onchange = refreshForm;

$("res-form").onsubmit = async (e) => {
  e.preventDefault();
  if (readOnly) return;
  const block = $("r-block").checked;
  const check_in = $("r-in").value, check_out = $("r-out").value;
  if (nightsBetween(check_in, check_out) <= 0) return say("r-msg", "A saída deve ser depois da entrada.");
  if (!block && !formGuests.length) return say("r-msg", "Adicione ao menos uma pessoa.");
  const room = roomById(Number($("r-space").value));
  if (block && room.kind === "personal") return say("r-msg", "Quartos pessoais não podem ter reservas por plataforma.");
  const payload = {
    space_id: room.id, check_in, check_out,
    kind: block ? "block" : "stay", note: $("r-note").value.trim() || null, status: statusFor(room, editing),
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
      reservation_id: id, name: g.name, type: g.type, exempt: g.exempt,
    }));
    if (fresh.length) {
      const { error } = await db.from("reservation_guests").insert(fresh);
      if (error) throw error;
    }
    for (const g of guests.filter((x) => x.id)) {
      const { error } = await db.from("reservation_guests").update({ name: g.name, type: g.type, exempt: g.exempt }).eq("id", g.id);
      if (error) throw error;
    }

    const shouldNotify = !editing && payload.status === "pending" && room.kind === "personal";
    let whatsappTargets = [];
    let whatsappError = null;
    if (shouldNotify) {
      const { data, error } = await db.rpc("get_reservation_whatsapp_targets", { p_reservation_id: id });
      whatsappError = error?.message ?? null;
      whatsappTargets = data ?? [];
    }

    $("res-dialog").close();
    loadAll();
    if (shouldNotify) {
      showReservationWhatsApp(whatsappTargets, reservationWhatsAppMessage(room, check_in, check_out), whatsappError);
    }
  } catch (err) {
    say("r-msg", err.code === "23P01"
      ? "Esse quarto já está reservado em parte desse período. Escolha outras datas."
      : err.code === "23503"
        ? "Não é possível remover hóspedes com comprovantes de diárias vinculados. Remova o vínculo financeiro antes."
        : err.message);
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
