const { createClient } = supabase;
const cfg = window.APP_CONFIG;
const db = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const CONDITIONS = { bom: "Bom", reparo: "Precisa de reparo", inutilizavel: "Inutilizável" };

let me = null;
let spaces = [];
let current = null;

const show = (id, on) => $(id).classList.toggle("hidden", !on);
const say = (id, text) => { $(id).textContent = text || ""; };

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
  const [{ data: sp }] = await Promise.all([db.from("spaces").select("*").order("sort")]);
  spaces = sp || [];
  show("login", false); show("denied", false); show("app", true);
  $("who").textContent = me.name || me.email;
  renderNav();
  selectSpace(spaces[0]);
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
}

async function selectSpace(space) {
  current = space;
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", Number(b.dataset.id) === space.id));
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

db.auth.onAuthStateChange((event) => { if (event === "SIGNED_IN") init(); });
init();
