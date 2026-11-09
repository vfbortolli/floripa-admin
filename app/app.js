// app/app.js - Entry point principal que orquestra toda a aplicação
import { state, setState, updateState } from "./app-state.js";
import { $ } from "./modules/dom.js";
import { show, say, setView, setActive } from "./modules/ui.js";
import { createDbClient } from "./modules/db.js";
import { showLogin, canEdit, logout } from "./modules/auth.js";
import { selectSpace, loadItems, setupInventoryListeners } from "./modules/inventory.js";
import { showPeople, setupPeopleListeners } from "./modules/people.js";
import { showRates, setupRatesListeners } from "./modules/rates.js";
import { showHistory, setupHistoryListeners } from "./modules/history.js";
import { showAgenda, renderRoomChips, setupAgendaListeners } from "./modules/agenda.js";
import { showBilling, setupBillingListeners } from "./modules/billing.js";
import { 
  showFinance, showFinanceDashboard, loadFinance, updateFinanceCategoryOptions, setupFinanceListeners
} from "./modules/finance.js";
import { renderNav } from "./modules/nav.js";
import { reservableRooms } from "./modules/utils.js";

const db = createDbClient();

async function init() {
  setState("me", null);
  setState("people", []);
  setState("rates", {});
  setState("myReservationIds", new Set());

  const { data: { session } } = await db.auth.getSession();
  if (!session) return showLogin();

  const email = session.user.email.toLowerCase();
  const { data, error } = await db.from("allowed_users").select("*").eq("email", email).maybeSingle();
  
  if (error || !data) {
    $("denied-email").textContent = email;
    show("login", false);
    show("app", false);
    show("denied", true);
    return;
  }

  setState("me", data);

  const [{ data: sp }, { data: fam }, { data: ppl }, { data: rt }] = await Promise.all([
    db.from("spaces").select("*").order("sort"),
    db.from("families").select("*").order("name"),
    db.rpc("list_people"),
    db.rpc("get_rates"),
  ]);

  setState("spaces", sp || []);
  setState("families", fam || []);
  setState("people", ppl || []);

  const rates = {};
  for (const r of rt || []) rates[r.key.replace("rate_", "")] = Number(r.value);
  setState("rates", rates);

  show("login", false);
  show("denied", false);
  show("app", true);
  $("who").textContent = state.me.name || state.me.email;

  renderNav();
  showAgenda();
  
  // Setup event listeners para todos os módulos
  setupInventoryListeners(db);
  setupPeopleListeners();
  setupRatesListeners();
  setupHistoryListeners();
  setupAgendaListeners();
  setupBillingListeners();
  setupFinanceListeners();
}

// Event listeners do formulário de backup
$("btn-backup").onclick = async () => {
  say("backup-msg", "Gerando…");
  const { fmtDate } = await import("./modules/utils.js");
  const { data, error } = await db.rpc("export_backup");
  if (error) return say("backup-msg", error.message);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = `backup-casa-de-praia-${fmtDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  say("backup-msg", "Backup baixado.");
};

// Event listeners de login e logout
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

$("btn-logout").onclick = () => logout(db);
$("btn-logout-denied").onclick = () => logout(db);

// Watch de mudanças de autenticação
db.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_IN" && session && state.me?.email !== session.user.email.toLowerCase()) init();
  if (event === "SIGNED_OUT") location.reload();
});

// Inicializa a aplicação
init();
