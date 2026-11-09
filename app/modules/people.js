// modules/people.js - Gerenciamento de pessoas autorizadas
import { state, setState } from "../app-state.js";
import { say, setView, setActive } from "./ui.js";
import { $ } from "./dom.js";
import { roomById } from "./utils.js";
import { getDb } from "./db.js";

export async function showPeople() {
  setState("current", null);
  setView("people");
  setActive((b) => b.id === "nav-people");
  const sel = $("p-family");
  if (!sel.options.length) {
    sel.append(new Option("Família…", ""));
    state.families.forEach((f) => sel.append(new Option(f.name, f.id)));
  }
  await loadPeople();
}

export async function loadPeople() {
  const db = getDb();
  const { data, error } = await db.from("allowed_users").select("*").order("name");
  if (error) return say("people-msg", error.message);
  say("people-msg", "");
  $("people-count").textContent = `${data.length} ${data.length === 1 ? "pessoa" : "pessoas"}`;
  const tbody = $("people-list");
  tbody.innerHTML = "";
  for (const p of data) tbody.append(personRow(p));
}

let personCardId = 0;

export function personRow(p) {
  const db = getDb();
  const tr = document.createElement("tr");
  tr.className = "person-card";
  const isMe = p.email === state.me.email;
  const save = async (patch) => {
    const { error } = await db.from("allowed_users").update(patch).eq("email", p.email);
    say("people-msg", error ? error.message : "Salvo.");
    if (error) {
      void loadPeople();
      return;
    }
    Object.assign(p, patch);
    nameLabel.textContent = p.name || p.email;
    phoneLabel.textContent = p.phone || "";
    phoneLabel.hidden = !p.phone;
  };
  const summary = document.createElement("td");
  summary.className = "person-summary";
  summary.colSpan = 6;
  const detailsId = `person-details-${++personCardId}`;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "person-toggle";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", detailsId);
  const nameLabel = document.createElement("strong");
  nameLabel.textContent = p.name || p.email;
  const phoneLabel = document.createElement("span");
  phoneLabel.className = "person-summary-phone";
  phoneLabel.textContent = p.phone || "";
  phoneLabel.hidden = !p.phone;
  const chevron = document.createElement("span");
  chevron.className = "person-chevron";
  chevron.textContent = "▾";
  chevron.setAttribute("aria-hidden", "true");
  toggle.append(nameLabel, phoneLabel, chevron);
  summary.append(toggle);

  const details = document.createElement("td");
  details.className = "person-details";
  details.colSpan = 7;
  details.id = detailsId;
  details.hidden = true;
  toggle.onclick = () => {
    details.hidden = !details.hidden;
    tr.classList.toggle("is-expanded", !details.hidden);
    toggle.setAttribute("aria-expanded", String(!details.hidden));
  };
  const field = (labelText, control) => {
    const label = document.createElement("label");
    label.className = "person-detail-field";
    label.append(document.createTextNode(labelText), control);
    return label;
  };
  const name = document.createElement("input");
  name.value = p.name ?? "";
  name.onchange = () => save({ name: name.value.trim() || null });
  const email = document.createElement("span");
  email.className = "person-detail-email";
  email.textContent = p.email;
  const fam = document.createElement("select");
  fam.append(new Option("—", ""));
  state.families.forEach((f) => fam.append(new Option(f.name, f.id, false, f.id === p.family_id)));
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
  del.setAttribute("aria-label", `Remover acesso de ${p.name || p.email}`);
  del.onclick = async () => {
    if (!confirm(`Remover o acesso de ${p.name || p.email}?`)) return;
    const { error } = await db.from("allowed_users").delete().eq("email", p.email);
    if (error) say("people-msg", error.message); else await loadPeople();
  };
  const phone = document.createElement("input");
  phone.type = "tel"; phone.value = p.phone ?? "";
  phone.onchange = () => save({ phone: phone.value.trim() || null });
  const flags = document.createElement("div");
  flags.className = "person-detail-flags";
  for (const [label, control] of [
    ["Responsável", flag("is_responsible", false)],
    ["Admin", flag("is_admin", isMe)],
  ]) {
    const wrapper = document.createElement("label");
    wrapper.className = "check";
    wrapper.append(control, document.createTextNode(label));
    flags.append(wrapper);
  }
  const detailActions = document.createElement("div");
  detailActions.className = "person-detail-actions";
  detailActions.append(del);
  details.append(
    field("Nome", name),
    field("E-mail", email),
    field("Telefone", phone),
    field("Família", fam),
    flags,
    detailActions,
  );
  tr.append(summary, details);
  return tr;
}

export const setupPeopleListeners = () => {
  const db = getDb();
  const form = $("form-person");
  const toggle = $("p-new-toggle");
  const setOpen = (open) => {
    form.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.closest(".person-new").classList.toggle("is-expanded", open);
  };
  toggle.onclick = () => setOpen(form.hidden);
  form.onsubmit = async (e) => {
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
    setOpen(false);
    await loadPeople();
  };
};

// Helpers para histórico
export function hsValue(field, v) {
  const HS_VALUES = {
    bom: "Bom", reparo: "Precisa de reparo", inutilizavel: "Inutilizável",
    socio: "Sócio", convidado: "Convidado", confirmed: "Confirmada", pending: "Pendente", rejected: "Recusada",
    stay: "Estadia", block: "Bloqueio",
    income: "Receita", expense: "Despesa",
  };
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (field === "space_id") return roomById(v)?.name ?? v;
  if (field === "family_id") return state.families.find((f) => f.id === v)?.name ?? v;
  return HS_VALUES[v] ?? v;
}

export function hsText(r) {
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
  const op = { INSERT: "criou", UPDATE: "alterou", DELETE: "removeu" }[r.op];
  const head = `${op} ${HS_TABLES[r.tbl]?.toLowerCase() ?? r.tbl} "${r.label ?? r.row_id ?? ""}"`;
  if (r.op !== "UPDATE") return head;
  const changes = Object.keys(r.new_data ?? {}).map(
    (k) => `${HS_FIELDS[k] ?? k}: ${hsValue(k, r.old_data?.[k])} → ${hsValue(k, r.new_data[k])}`);
  return `${head} (${changes.join("; ")})`;
}
