// modules/nav.js - Renderização da navegação
import { state } from "../app-state.js";
import { $ } from "./dom.js";
import { show } from "./ui.js";
import { reservableRooms } from "./utils.js";

export const renderNav = (router) => {
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

  const agendaItems = addGroup("Agenda", "📅", "nav-agenda", () => router.showAgenda());
  for (const room of reservableRooms()) {
    const b = document.createElement("button");
    b.className = "nav-item";
    b.textContent = room.name;
    b.dataset.agendaRoom = room.id;
    b.onclick = async () => {
      const { setState } = await import("../app-state.js");
      setState("agRoom", room.id);
      await router.showAgenda();
    };
    agendaItems.append(b);
  }

  for (const [title, kind, icon, id] of [
    ["Casa comunitária", "common", "🏠", "nav-common"],
    ["Quartos pessoais", "personal", "🛏️", "nav-personal"],
  ]) {
    const items = addGroup(title, icon, id);
    for (const s of state.spaces.filter((x) => x.kind === kind)) {
      const b = document.createElement("button");
      b.className = "nav-item";
      b.textContent = s.name;
      b.dataset.id = s.id;
      b.onclick = () => router.selectSpace(s);
      items.append(b);
    }
  }

  const financeItems = addGroup("Financeiro", "💰", "nav-finance-group");
  const dashboard = document.createElement("button");
  dashboard.className = "nav-item";
  dashboard.textContent = "Painel financeiro";
  dashboard.id = "nav-dashboard";
  dashboard.onclick = () => router.showFinanceDashboard();
  financeItems.append(dashboard);

  if (state.me?.is_admin) {
    const items = addGroup("Administração", "⚙️", "nav-admin");
    const peopleBtn = document.createElement("button");
    peopleBtn.className = "nav-item";
    peopleBtn.textContent = "Pessoas";
    peopleBtn.id = "nav-people";
    peopleBtn.onclick = () => router.showPeople();
    const rt = document.createElement("button");
    rt.className = "nav-item";
    rt.textContent = "Valores";
    rt.id = "nav-rates";
    rt.onclick = () => router.showRates();
    const bl = document.createElement("button");
    bl.className = "nav-item";
    bl.textContent = "Cobrança";
    bl.id = "nav-billing";
    bl.onclick = () => router.showBilling();
    const financeAdmin = document.createElement("button");
    financeAdmin.className = "nav-item";
    financeAdmin.textContent = "Receitas e despesas";
    financeAdmin.id = "nav-finance-admin";
    financeAdmin.onclick = () => router.showFinanceAdmin();
    const finance = document.createElement("button");
    finance.className = "nav-item";
    finance.textContent = "Mensalidades e Diárias";
    finance.id = "nav-finance";
    finance.onclick = () => router.showFinance();
    items.append(peopleBtn, bl, rt, finance);
    items.append(financeAdmin);
    const hs = document.createElement("button");
    hs.className = "nav-item";
    hs.textContent = "Histórico";
    hs.id = "nav-history";
    hs.onclick = () => router.showHistory();
    items.append(hs);
  }
};
