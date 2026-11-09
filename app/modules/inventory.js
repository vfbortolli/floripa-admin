// modules/inventory.js - Gerenciamento de inventário de espaços
import { state, setState } from "../app-state.js";
import { show, say, setView, setActive } from "./ui.js";
import { $ } from "./dom.js";
import { canEdit } from "./auth.js";
import { getDb } from "./db.js";

const CONDITIONS = { bom: "Bom", reparo: "Precisa de reparo", inutilizavel: "Inutilizável" };

export async function selectSpace(space) {
  setState("current", space);
  setState("inventoryItems", []);
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

export async function loadItems() {
  const db = getDb();
  const space = state.current;
  const { data, error } = await db.from("items").select("*").eq("space_id", space.id).order("description");
  if (space !== state.current) return;
  if (error) return say("app-msg", error.message);
  say("app-msg", "");
  setState("inventoryItems", data);
  renderItems();
}

export function normalizeSearch(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function renderItems() {
  const query = normalizeSearch($("item-search").value.trim());
  const filteredItems = state.inventoryItems.filter((it) =>
    normalizeSearch(`${it.description} ${it.notes} ${CONDITIONS[it.condition]}`).includes(query));
  const tbody = $("items");
  tbody.innerHTML = "";
  const count = filteredItems.length;
  const total = state.inventoryItems.length;
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
  for (const it of filteredItems) {
    tbody.append(canEdit(state.current) ? editableRow(it) : readonlyRow(it));
  }
}

export function td(content, cls, label) {
  const c = document.createElement("td");
  if (cls) c.className = cls;
  if (label) c.dataset.label = label;
  if (content instanceof Node) c.append(content); else c.textContent = content ?? "";
  return c;
}

export function readonlyRow(it) {
  const tr = document.createElement("tr");
  const tag = document.createElement("span");
  tag.className = `tag ${it.condition}`;
  tag.textContent = CONDITIONS[it.condition];
  tr.append(td(it.description, "ro", "Descrição"), td(it.quantity, "num ro", "Qtd"),
    td(tag, "ro", "Estado"), td(it.notes, "ro", "Observações"), td(""));
  return tr;
}

export function editableRow(it) {
  const tr = document.createElement("tr");
  const save = async (patch) => {
    const db = getDb();
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
    const db = getDb();
    const { error } = await db.from("items").delete().eq("id", it.id);
    if (error) say("app-msg", error.message); else await loadItems();
  };
  tr.append(td(text(it.description, "description"), "", "Descrição"),
    td(text(it.quantity, "quantity", "number"), "num", "Qtd"),
    td(sel, "", "Estado"), td(text(it.notes, "notes"), "", "Observações"), td(del));
  return tr;
}

export function parseCsv(text) {
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

export const setupInventoryListeners = (db) => {
  $("form-add").onsubmit = async (e) => {
    e.preventDefault();
    const q = $("add-qty").value;
    const { error } = await db.from("items").insert({
      space_id: state.current.id,
      description: $("add-desc").value.trim(),
      quantity: q === "" ? null : parseInt(q, 10),
    });
    if (error) return say("app-msg", error.message);
    e.target.reset();
    await loadItems(db);
  };

  $("item-search").addEventListener("input", renderItems);

  $("csv-file").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const rows = parseCsv((await file.text()).replace(/^\uFEFF/, ""));
    const first = (rows[0]?.[0] || "").trim().toLowerCase();
    const data = first.startsWith("descri") ? rows.slice(1) : rows;
    const items = data.map((r) => {
      const n = parseInt((r[1] || "").trim(), 10);
      return { space_id: state.current.id, description: (r[0] || "").trim(), quantity: Number.isNaN(n) ? null : n };
    }).filter((x) => x.description);
    if (!items.length) return say("app-msg", "Nenhum item encontrado no arquivo.");
    if (!confirm(`Importar ${items.length} itens em "${state.current.name}"?`)) return;
    const { error } = await db.from("items").insert(items);
    say("app-msg", error ? error.message : `${items.length} itens importados.`);
    if (!error) await loadItems(db);
  };
};
