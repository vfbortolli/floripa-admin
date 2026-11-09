// modules/history.js - Histórico de alterações (auditoria)
import { state, setState } from "../app-state.js";
import { show, say, setView, setActive } from "./ui.js";
import { $ } from "./dom.js";
import { personName } from "./utils.js";
import { hsValue, hsText } from "./people.js";
import { getDb } from "./db.js";

const HS_PAGE = 50;

const HS_TABLES = {
  items: "Item", reservations: "Reserva", reservation_guests: "Pessoa da reserva",
  allowed_users: "Pessoa", settings: "Valor", guest_charges: "Cobrança",
  finance_categories: "Categoria financeira", finance_memberships: "Mensalidade",
  finance_membership_rates: "Valor anual da mensalidade",
  finance_transactions: "Lançamento financeiro", finance_daily_adjustments: "Ajuste de diárias",
};

export async function showHistory() {
  state.current = null;
  setView("history");
  setActive((b) => b.id === "nav-history");
  setState("hsRows", []);
  $("hs-list").innerHTML = "";
  await loadHistory();
}

export async function loadHistory() {
  const db = getDb();
  let q = db.from("audit_log").select("*").order("id", { ascending: false }).range(state.hsRows.length, state.hsRows.length + HS_PAGE - 1);
  if ($("hs-filter").value) q = q.eq("tbl", $("hs-filter").value);
  const { data, error } = await q;
  if (error) return say("hs-msg", error.message);
  say("hs-msg", "");
  setState("hsRows", state.hsRows.concat(data));
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
  if (!state.hsRows.length) $("hs-list").innerHTML = '<p class="empty">Nenhuma alteração registrada.</p>';
}

export const setupHistoryListeners = () => {
  $("hs-filter").onchange = () => {
    setState("hsRows", []);
    $("hs-list").innerHTML = "";
    loadHistory();
  };
  $("hs-more").onclick = () => loadHistory();
};

export { HS_PAGE, HS_TABLES };
