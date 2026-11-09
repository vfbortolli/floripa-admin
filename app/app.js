// app/app.js - Entry point principal que orquestra toda a aplicação
import { state, setState, updateState } from "./app-state.js";
import { $ } from "./modules/dom.js";
import { show, say, setView, setActive } from "./modules/ui.js";
import { createDbClient } from "./modules/db.js";
import { showLogin, canEdit, logout } from "./modules/auth.js";
import { selectSpace, loadItems } from "./modules/inventory.js";
import { showPeople } from "./modules/people.js";
import { showRates } from "./modules/rates.js";
import { showHistory } from "./modules/history.js";
import { showAgenda, renderRoomChips } from "./modules/agenda.js";
import { showBilling } from "./modules/billing.js";
import { 
  showFinance, showFinanceDashboard, loadFinance, updateFinanceCategoryOptions 
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

// Event listeners de Financeiro
$("fn-load").onclick = async () => {
  const year = Number($("fn-year").value);
  if (!Number.isInteger(year) || year < 1900 || year > 9998) return say("fn-msg", "Informe um ano entre 1900 e 9998.");
  setState("fnYear", year);
  await loadFinance();
};

$("fn-dashboard-load").onclick = async () => {
  const year = Number($("fn-dashboard-year").value);
  if (!Number.isInteger(year) || year < 1900 || year > 9998) {
    return say("fn-dashboard-msg", "Informe um ano entre 1900 e 9998.");
  }
  setState("fnYear", year);
  await loadFinance();
};

$("fn-prev").onclick = async () => {
  if (state.fnYear === 1900 && state.fnMonth === 0) return;
  if (state.fnMonth === 0) { setState("fnMonth", 11); setState("fnYear", state.fnYear - 1); } 
  else setState("fnMonth", state.fnMonth - 1);
  await loadFinance();
};

$("fn-next").onclick = async () => {
  if (state.fnYear === 9998 && state.fnMonth === 11) return;
  if (state.fnMonth === 11) { setState("fnMonth", 0); setState("fnYear", state.fnYear + 1); } 
  else setState("fnMonth", state.fnMonth + 1);
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
  const query = state.fnEditingTransaction
    ? db.from("finance_transactions").update(payload).eq("id", state.fnEditingTransaction)
    : db.from("finance_transactions").insert(payload);
  const { error } = await query;
  if (error) return say("fn-msg", error.message);
  setState("fnEditingTransaction", null);
  $("fn-transaction-form").reset();
  $("fn-transaction-save").textContent = "Adicionar"; 
  show("fn-transaction-cancel", false);
  const { fnPeriod } = await import("./modules/finance.js");
  // Note: fnPeriod is not exported, will need to handle this differently
  await loadFinance();
};

$("fn-transaction-cancel").onclick = () => {
  setState("fnEditingTransaction", null);
  $("fn-transaction-form").reset();
  $("fn-transaction-save").textContent = "Adicionar"; 
  show("fn-transaction-cancel", false);
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

// Event listeners de Valores
$("r-load").onclick = async () => {
  const year = Number($("r-year").value);
  if (!Number.isInteger(year) || year < 1900 || year > 9998) {
    return say("rates-msg", "Informe um ano entre 1900 e 9998.");
  }
  setState("fnYear", year);
  const { displayRates } = await import("./modules/rates.js");
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
  setState("rates", { socio, convidado });
  say("rates-msg", "Valores salvos.");
};

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
  setState("fnYear", year);
  await loadFinance();
  say("rates-msg", `Mensalidade padrão de ${year} salva.`);
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
