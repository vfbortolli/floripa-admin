// modules/finance.js - Módulo de Financeiro
import { state, setState, updateState } from "../app-state.js";
import { $ } from "./dom.js";
import { show, say, canManageFinance } from "./ui.js";
import { getDb, uploadPaymentProof, cleanupUnlinkedPaymentProof, openPaymentProof, deletePaymentProof } from "./db.js";
import { setView, setActive } from "./ui.js";
import { money, parseDate } from "./utils.js";

const fnPeriod = () => `${state.fnYear}-${String(state.fnMonth + 1).padStart(2, "0")}-01`;
const fnMonthKey = (value) => String(value).slice(0, 7);
const TRANSACTIONS_PAGE_SIZE = 25;
const TRANSACTIONS_FETCH_SIZE = 500;
let transactionPage = 0;
const transactionDrafts = new Map();

function resetTransactionFilters(month = "") {
  $("fn-filter-month").value = month;
  for (const id of ["fn-filter-kind", "fn-filter-category", "fn-filter-description", "fn-filter-min", "fn-filter-max"]) {
    $(id).value = "";
  }
  transactionPage = 0;
}

export async function showFinance() {
  setState("current", null);
  setView("finance");
  setActive((b) => b.id === "nav-finance");
  await loadFinance();
}

export async function showFinanceAdmin() {
  if (!canManageFinance()) return showFinanceDashboard();
  setState("current", null);
  setView("finance-admin");
  setActive((b) => b.id === "nav-finance-admin");
  resetTransactionFilters(String(new Date().getMonth() + 1).padStart(2, "0"));
  $("fn-date").value = fnPeriod();
  await loadFinance();
}

export async function showFinanceDashboard() {
  setState("current", null);
  setView("dashboard");
  setActive((b) => b.id === "nav-dashboard");
  await loadFinance();
}

async function loadFinanceTransactions(db, start, end) {
  const rows = [];
  for (let offset = 0; ; offset += TRANSACTIONS_FETCH_SIZE) {
    const { data, error } = await db.from("finance_transactions").select("*")
      .gte("transaction_date", start).lt("transaction_date", end)
      .order("transaction_date").order("id").range(offset, offset + TRANSACTIONS_FETCH_SIZE - 1);
    if (error) return { data: null, error };
    if (!Array.isArray(data)) return { data: null, error: { message: "Não foi possível carregar os lançamentos financeiros." } };
    rows.push(...data);
    if (data.length < TRANSACTIONS_FETCH_SIZE) return { data: rows, error: null };
  }
}

export async function loadFinance() {
  const db = getDb();
  const start = `${state.fnYear}-01-01`, end = `${state.fnYear + 1}-01-01`;
  $("fn-year").value = state.fnYear;
  $("fn-admin-year").value = state.fnYear;
  $("fn-dashboard-year").value = state.fnYear;
  $("fn-dashboard-year-label").textContent = String(state.fnYear);
  say("fn-msg", ""); 
  say("fn-admin-msg", "");
  say("fn-dashboard-msg", "");
  
  const [categories, memberships, membershipRate, transactions, daily, dailyReceived, adjustments] = await Promise.all([
    db.from("finance_categories").select("*").order("kind").order("name"),
    db.from("finance_memberships").select("*").gte("period_month", start).lt("period_month", end),
    db.from("finance_membership_rates").select("amount").eq("year", state.fnYear).maybeSingle(),
    loadFinanceTransactions(db, start, end),
    db.rpc("get_finance_daily", { p_year: state.fnYear }),
    db.rpc("get_finance_daily_received", { p_year: state.fnYear }),
    db.from("finance_daily_adjustments").select("*").gte("period_month", start).lt("period_month", end),
  ]);
  
  const failed = [categories, memberships, membershipRate, transactions, daily, dailyReceived, adjustments]
    .find((result) => result.error);
  if (failed) {
    const message = dailyReceived.error?.code === "PGRST202"
      ? `Execute supabase/phase2t.sql no Supabase antes de consultar o painel. Detalhe: ${dailyReceived.error.message}`
      : failed.error.message;
    say("fn-msg", message);
    say("fn-admin-msg", message);
    say("fn-dashboard-msg", message);
    return;
  }
  
  setState("fnCategories", categories.data ?? []);
  setState("fnMemberships", memberships.data ?? []);
  setState("fnMembershipReceipts", new Map());
  
  if (canManageFinance() && state.fnMemberships.length) {
    const { data: links, error: receiptError } = await db.from("payment_receipt_memberships")
      .select("membership_id, payment_receipts(id, object_path, original_name, uploaded_at)")
      .in("membership_id", state.fnMemberships.map((r) => r.id));
    if (receiptError) {
      say("fn-msg", receiptError.message); 
      say("fn-admin-msg", receiptError.message);
      say("fn-dashboard-msg", receiptError.message);
      return;
    }
    for (const link of links ?? []) {
      const receipt = Array.isArray(link.payment_receipts) ? link.payment_receipts[0] : link.payment_receipts;
      if (receipt) state.fnMembershipReceipts.set(link.membership_id, [
        ...(state.fnMembershipReceipts.get(link.membership_id) ?? []), receipt,
      ]);
    }
  }
  
  setState("fnMembershipRate", membershipRate.data ? Number(membershipRate.data.amount) : null);
  setState("fnTransactions", transactions.data ?? []);
  setState("fnDaily", daily.data ?? []);
  setState("fnDailyReceived", dailyReceived.data ?? []);
  setState("fnDailyAdjustments", adjustments.data ?? []);
  
  updateFinanceCategoryOptions();
  updateTransactionFilterCategories();
  renderFinanceDashboard();
  renderFinanceDetails();
  renderFinanceCategories();
}

export function fnMonthlyData(monthIndex) {
  const monthKey = `${state.fnYear}-${String(monthIndex + 1).padStart(2, "0")}`;
  return {
    memberships: new Map(state.fnMemberships.filter((r) => fnMonthKey(r.period_month) === monthKey)
      .map((r) => [Number(r.family_id), r])),
    daily: state.fnDaily.filter((r) => fnMonthKey(r.period_month) === monthKey)
      .reduce((map, r) => map.set(Number(r.family_id), (map.get(Number(r.family_id)) ?? 0) + Number(r.amount)), new Map()),
    dailyReceived: state.fnDailyReceived.filter((r) => fnMonthKey(r.period_month) === monthKey)
      .reduce((map, r) => map.set(Number(r.family_id), (map.get(Number(r.family_id)) ?? 0) + Number(r.amount)), new Map()),
    adjustments: new Map(state.fnDailyAdjustments.filter((r) => fnMonthKey(r.period_month) === monthKey)
      .map((r) => [Number(r.family_id), r])),
    categoryTotals: state.fnTransactions.filter((r) => fnMonthKey(r.transaction_date) === monthKey)
      .reduce((map, r) => map.set(String(r.category_id), (map.get(String(r.category_id)) ?? 0) + Number(r.amount)), new Map()),
  };
}

export function fnDailyTotal(data) {
  return state.families.reduce((sum, family) =>
    sum + Number(data.adjustments.get(family.id)?.amount ?? data.daily.get(family.id) ?? 0), 0);
}

function fnDailyReceivedTotal(data) {
  return state.families.reduce((sum, family) => {
    const total = Number(data.adjustments.get(family.id)?.amount ?? data.daily.get(family.id) ?? 0);
    const received = Number(data.dailyReceived.get(family.id) ?? 0);
    return sum + Math.min(total, received);
  }, 0);
}

export function fnFinanceSummary(data) {
  const usedCategories = new Set(state.fnTransactions.map((r) => String(r.category_id)));
  const categories = state.fnCategories.filter((c) => c.active || usedCategories.has(String(c.id)));
  const amount = (category) => data.categoryTotals.get(String(category.id)) ?? 0;
  const membershipReceived = [...data.memberships.values()]
    .reduce((sum, row) => sum + Number(row.received_amount), 0);
  const membershipExpected = state.families.reduce((sum, family) =>
    sum + Number(state.fnMembershipRate ?? data.memberships.get(family.id)?.expected_amount ?? 0), 0);
  const pendingMemberships = Math.max(0, membershipExpected - membershipReceived);
  const incomeCategories = categories.filter((category) => category.kind === "income");
  const expenseCategories = categories.filter((category) => category.kind === "expense");
  const daily = fnDailyTotal(data);
  const dailyReceived = fnDailyReceivedTotal(data);
  const pendingDaily = Math.max(0, daily - dailyReceived);
  const otherIncome = incomeCategories.reduce((sum, category) => sum + amount(category), 0);
  const expenses = expenseCategories.reduce((sum, category) => sum + amount(category), 0);
  const income = membershipReceived + dailyReceived + otherIncome;
  return {
    income,
    expenses,
    balance: income - expenses,
    incomeRows: [
      { label: "Mensalidades", amount: membershipReceived },
      { label: "Diárias", amount: dailyReceived },
      ...incomeCategories.map((category) => ({ label: category.name, amount: amount(category) })),
    ],
    pending: pendingMemberships + pendingDaily,
    pendingRows: [
      { label: "Mensalidades", amount: pendingMemberships },
      { label: "Diárias", amount: pendingDaily },
    ],
    expenseRows: expenseCategories.map((category) => ({ label: category.name, amount: amount(category) })),
  };
}

export function fnFinanceYearSummary(currentDate = new Date()) {
  const incomeRows = new Map();
  const pendingRows = new Map();
  const expenseRows = new Map();
  const lastClosedMonth = state.fnYear < currentDate.getFullYear()
    ? 11
    : state.fnYear === currentDate.getFullYear()
      ? currentDate.getMonth() - 1
      : -1;
  for (let month = 0; month <= lastClosedMonth; month += 1) {
    const summary = fnFinanceSummary(fnMonthlyData(month));
    for (const row of summary.incomeRows) {
      incomeRows.set(row.label, (incomeRows.get(row.label) ?? 0) + row.amount);
    }
    for (const row of summary.pendingRows) {
      pendingRows.set(row.label, (pendingRows.get(row.label) ?? 0) + row.amount);
    }
    for (const row of summary.expenseRows) {
      expenseRows.set(row.label, (expenseRows.get(row.label) ?? 0) + row.amount);
    }
  }
  const income = [...incomeRows.values()].reduce((sum, amount) => sum + amount, 0);
  const expenses = [...expenseRows.values()].reduce((sum, amount) => sum + amount, 0);
  return {
    income,
    pending: [...pendingRows.values()].reduce((sum, amount) => sum + amount, 0),
    expenses,
    balance: income - expenses,
    incomeRows: [...incomeRows].map(([label, amount]) => ({ label, amount })),
    pendingRows: [...pendingRows].map(([label, amount]) => ({ label, amount })),
    expenseRows: [...expenseRows].map(([label, amount]) => ({ label, amount })),
    lastClosedMonth,
  };
}

export function renderFinanceDashboard() {
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
    const monthName = new Date(state.fnYear, i, 1).toLocaleDateString("pt-BR", { month: "long" });
    const summary = fnFinanceSummary(data);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "finance-month-card";
    card.setAttribute("aria-pressed", String(i === state.fnMonth));
    card.setAttribute("aria-label", `${monthName}: receitas recebidas ${money(summary.income)}, a receber ${money(summary.pending)}, despesas ${money(summary.expenses)}, balanço ${money(summary.balance)}. Ver detalhes.`);
    const title = document.createElement("span");
    title.className = "finance-month-card-title";
    title.textContent = monthName;
    card.append(title);
    addMetric(card, "Recebido", summary.income, "income");
    addMetric(card, "A receber", summary.pending, "pending");
    addMetric(card, "Despesas", summary.expenses, "expense");
    addMetric(card, "Balanço", summary.balance, "balance");
    card.onclick = () => {
      setState("fnMonth", i);
      grid.querySelectorAll(".finance-month-card").forEach((monthCard, index) => {
        monthCard.setAttribute("aria-pressed", String(index === state.fnMonth));
      });
      renderFinanceDashboardDetails();
      renderFinanceDetails();
      $("fn-dashboard-detail").scrollIntoView({ behavior: "smooth", block: "start" });
    };
    grid.append(card);
  });
  renderFinanceDashboardDetails();
  renderFinanceDashboardYear();
}

export function renderFinanceDashboardYear() {
  const currentDate = new Date();
  const summary = fnFinanceYearSummary(currentDate);
  const periodLabel = summary.lastClosedMonth < 0
    ? `${state.fnYear} (sem meses fechados)`
    : state.fnYear === currentDate.getFullYear()
      ? `${state.fnYear} (até ${new Date(state.fnYear, summary.lastClosedMonth, 1)
        .toLocaleDateString("pt-BR", { month: "long" })})`
      : String(state.fnYear);
  $("fn-dashboard-annual-label").textContent = periodLabel;
  $("fn-dashboard-annual-balance").textContent = money(summary.balance);
  $("fn-dashboard-annual-income-total").textContent = money(summary.income);
  $("fn-dashboard-annual-pending-total").textContent = money(summary.pending);
  $("fn-dashboard-annual-expense-total").textContent = money(summary.expenses);
  renderFinanceBreakdownRows($("fn-dashboard-annual-income"), summary.incomeRows);
  renderFinanceBreakdownRows($("fn-dashboard-annual-pending"), summary.pendingRows);
  renderFinanceBreakdownRows($("fn-dashboard-annual-expenses"), summary.expenseRows);
}

export function renderFinanceDashboardDetails() {
  const data = fnMonthlyData(state.fnMonth);
  const summary = fnFinanceSummary(data);
  const label = new Date(state.fnYear, state.fnMonth, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  $("fn-dashboard-month-label").textContent = label;
  $("fn-dashboard-balance").textContent = money(summary.balance);
  $("fn-dashboard-income-total").textContent = money(summary.income);
  $("fn-dashboard-pending-total").textContent = money(summary.pending);
  $("fn-dashboard-expense-total").textContent = money(summary.expenses);

  renderFinanceBreakdownRows($("fn-dashboard-income"), summary.incomeRows);
  renderFinanceBreakdownRows($("fn-dashboard-pending"), summary.pendingRows);
  renderFinanceBreakdownRows($("fn-dashboard-expenses"), summary.expenseRows);
}

function renderFinanceBreakdownRows(target, rows) {
  target.innerHTML = "";
  for (const row of rows) {
    if (row.amount <= 0) continue;
    const div = document.createElement("div");
    div.className = "finance-breakdown-row";
    const label = document.createElement("span");
    label.className = "finance-breakdown-label";
    label.textContent = row.label;
    const value = document.createElement("span");
    value.className = "finance-breakdown-value";
    value.textContent = money(row.amount);
    div.append(label, value);
    target.append(div);
  }
}

export function renderFinanceDetails() {
  const period = fnPeriod();
  const label = new Date(state.fnYear, state.fnMonth, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  $("fn-month-label").textContent = label;
  renderFinanceMemberships(fnMonthlyData(state.fnMonth), period);
  renderFinanceDaily(fnMonthlyData(state.fnMonth), period);
  renderFinanceTransactions();
}

export function renderFinanceMemberships(data, period) {
  const db = getDb();
  const membershipRows = $("fn-memberships");
  membershipRows.innerHTML = "";
  for (const family of state.families) {
    const saved = data.memberships.get(family.id);
    const expectedAmount = state.fnMembershipRate ?? Number(saved?.expected_amount ?? 0);
    const row = document.createElement("tr");
    const name = document.createElement("th");
    name.scope = "row"; 
    name.textContent = family.name; 
    row.append(name);
    
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
        input.value = value; 
        input.setAttribute("aria-label", label);
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
    const receipts = saved ? state.fnMembershipReceipts.get(saved.id) ?? [] : [];
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
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "secondary";
        remove.textContent = "Excluir";
        remove.setAttribute("aria-label", `Excluir comprovante ${receipt.original_name}`);
        remove.onclick = async () => {
          if (!confirm(`Excluir o comprovante "${receipt.original_name}"?`)) return;
          remove.disabled = true;
          const { error } = await deletePaymentProof(receipt);
          await loadFinance();
          if (error) say("fn-msg", error);
        };
        proofList.append(open, remove);
      }
      const proofInput = document.createElement("input");
      proofInput.type = "file";
      proofInput.className = "finance-attachment-input";
      proofInput.accept = "application/pdf,image/jpeg,image/png";
      proofInput.multiple = true;
      proofInput.setAttribute("aria-label", `Adicionar comprovantes de ${family.name}`);
      const attachment = document.createElement("label");
      attachment.className = "btn secondary finance-attachment";
      attachment.append("Anexo", proofInput);
      const attachmentName = document.createElement("span");
      attachmentName.className = "finance-attachment-name";
      attachmentName.setAttribute("aria-live", "polite");
      proofInput.onchange = () => {
        const files = [...(proofInput.files ?? [])];
        attachmentName.textContent = files.length === 1 ? files[0].name : files.length ? `${files.length} arquivos` : "";
        attachmentName.title = files.map((file) => file.name).join(", ");
      };
      proofList.append(attachment, attachmentName);
      proofsCell.append(proofList);
    } else {
      proofsCell.textContent = "Restritos a administradores";
    }
    row.append(proofsCell);
    
    const action = document.createElement("td");
    action.dataset.label = "Ação";
    if (canManageFinance()) {
      const proofInput = proofsCell.querySelector('input[type="file"]');
      const save = document.createElement("button");
      save.type = "button"; 
      save.className = "secondary"; 
      save.textContent = "Salvar";
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
          if (createError) { 
            say("fn-msg", createError.message); 
            save.disabled = false; 
            return; 
          }
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
        
        const availableReceipts = (saved ? state.fnMembershipReceipts.get(saved.id) ?? [] : []).length + files.length;
        if (receivedAmount > 0 && !availableReceipts) {
          say("fn-msg", `Anexe um comprovante para registrar o recebimento de ${family.name}.`);
          save.disabled = false;
          return;
        }
        
        // Upsert dispara o trigger de INSERT com id novo (sem comprovante) e falha; atualiza pelo id.
        const values = {
          expected_amount: expectedAmount, received_amount: receivedAmount,
          paid_at: receivedAmount > 0 ? inputs[1].value || null : null,
        };
        const { error } = membershipId
          ? await db.from("finance_memberships").update(values).eq("id", membershipId)
          : await db.from("finance_memberships").insert({ family_id: family.id, period_month: period, ...values });
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
    row.append(action); 
    membershipRows.append(row);
  }
}

export function renderFinanceDaily(data, period) {
  const db = getDb();
  const dailyRows = $("fn-daily");
  dailyRows.innerHTML = "";
  for (const family of state.families) {
    const imported = data.daily.get(family.id) ?? 0;
    const adjustment = data.adjustments.get(family.id);
    const row = document.createElement("tr");
    const name = document.createElement("th");
    name.scope = "row"; 
    name.textContent = family.name; 
    row.append(name);
    
    const source = document.createElement("td");
    source.dataset.label = "Importado das reservas";
    source.className = "num"; 
    source.textContent = money(imported); 
    row.append(source);
    
    const finalAmount = document.createElement("td");
    finalAmount.dataset.label = "Valor no financeiro";
    finalAmount.className = "num"; 
    finalAmount.textContent = money(adjustment?.amount ?? imported);
    row.append(finalAmount);
    
    const action = document.createElement("td");
    action.dataset.label = "Ajuste";
    if (!canManageFinance()) {
      action.textContent = adjustment ? `Ajuste: ${money(Number(adjustment.amount))}` : "Sem ajuste";
    } else {
      const input = document.createElement("input");
      input.type = "number"; 
      input.min = "0"; 
      input.step = "0.01"; 
      input.placeholder = "Sem ajuste";
      input.value = adjustment ? adjustment.amount : "";
      input.setAttribute("aria-label", `Ajuste de diárias para ${family.name}`);
      
      const save = document.createElement("button");
      save.type = "button"; 
      save.className = "secondary"; 
      save.textContent = "Salvar";
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
        if (result.error) { 
          say("fn-msg", result.error.message); 
          save.disabled = false; 
          return; 
        }
        await loadFinance();
      };
      action.append(input, save);
    }
    row.append(action);
    dailyRows.append(row);
  }
}

function populateTransactionCategories(select, kind, selectedId = null) {
  select.replaceChildren();
  const categories = state.fnCategories.filter((c) =>
    (c.active || String(c.id) === String(selectedId)) && c.kind === kind);
  if (!categories.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Nenhuma categoria disponível";
    select.append(option);
  }
  for (const c of categories) {
    const option = document.createElement("option");
    option.value = c.id;
    option.textContent = `${c.name}${c.active ? "" : " (desativada)"}`;
    select.append(option);
  }
  if (categories.some((c) => String(c.id) === String(selectedId))) select.value = String(selectedId);
}

export function updateFinanceCategoryOptions() {
  populateTransactionCategories($("fn-category"), $("fn-kind").value);
}

function updateTransactionFilterCategories() {
  const select = $("fn-filter-category");
  const selected = select.value;
  const used = new Set(state.fnTransactions.map((transaction) => String(transaction.category_id)));
  select.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "Todas as categorias";
  select.append(all);
  const categories = state.fnCategories.filter((category) => category.active || used.has(String(category.id)))
    .slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = `${category.name}${category.active ? "" : " (desativada)"}`;
    select.append(option);
  }
  select.value = categories.some((category) => String(category.id) === selected) ? selected : "";
}

function renderTransactionEditor(row, transaction, draft) {
  const cell = document.createElement("td");
  cell.colSpan = 6;
  cell.className = "finance-transaction-edit-cell";
  const form = document.createElement("form");
  form.className = "finance-transaction-editor";
  form.setAttribute("aria-label", `Editar lançamento de ${parseDate(transaction.transaction_date).toLocaleDateString("pt-BR")}`);
  const field = (labelText, control) => {
    const label = document.createElement("label");
    label.textContent = labelText;
    label.append(control);
    form.append(label);
    return control;
  };
  const date = field("Data", document.createElement("input"));
  date.type = "date";
  date.required = true;
  date.value = draft.transaction_date;
  const kind = field("Tipo", document.createElement("select"));
  for (const [value, label] of [["income", "Receita"], ["expense", "Despesa"]]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    kind.append(option);
  }
  kind.value = draft.kind;
  const category = field("Categoria", document.createElement("select"));
  category.required = true;
  populateTransactionCategories(category, draft.kind, draft.category_id);
  draft.category_id = category.value;
  const description = field("Descrição", document.createElement("input"));
  description.value = draft.description;
  const amount = field("Valor (R$)", document.createElement("input"));
  amount.type = "number";
  amount.min = "0.01";
  amount.step = "0.01";
  amount.required = true;
  amount.value = draft.amount;
  date.oninput = () => { draft.transaction_date = date.value; };
  kind.onchange = () => {
    draft.kind = kind.value;
    populateTransactionCategories(category, draft.kind, transaction.category_id);
    draft.category_id = category.value;
  };
  category.onchange = () => { draft.category_id = category.value; };
  description.oninput = () => { draft.description = description.value; };
  amount.oninput = () => { draft.amount = amount.value; };
  const actions = document.createElement("div");
  actions.className = "finance-transaction-actions";
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Salvar";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = "Cancelar";
  save.disabled = draft.saving;
  cancel.disabled = draft.saving;
  for (const control of [date, kind, category, description, amount]) control.disabled = draft.saving;
  cancel.onclick = () => {
    transactionDrafts.delete(transaction.id);
    renderFinanceTransactions();
    [...$("fn-transactions").rows].find((item) => item.dataset.transactionId === String(transaction.id))
      ?.querySelector("button")?.focus();
  };
  actions.append(save, cancel);
  form.append(actions);
  if (draft.error) {
    const error = document.createElement("p");
    error.className = "msg finance-transaction-error";
    error.setAttribute("role", "alert");
    error.textContent = draft.error;
    form.append(error);
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!canManageFinance()) {
      draft.error = "Apenas administradores podem gerenciar lançamentos.";
      return renderFinanceTransactions();
    }
    if (draft.saving || !form.reportValidity()) return;
    draft.saving = true;
    draft.error = "";
    renderFinanceTransactions();
    const { error } = await getDb().from("finance_transactions").update({
      transaction_date: draft.transaction_date,
      kind: draft.kind,
      category_id: Number(draft.category_id),
      description: draft.description.trim(),
      amount: Number(draft.amount),
    }).eq("id", transaction.id);
    if (error) {
      draft.saving = false;
      draft.error = error.message;
      say("fn-admin-msg", `Não foi possível salvar o lançamento: ${error.message}`);
      return renderFinanceTransactions();
    }
    transactionDrafts.delete(transaction.id);
    await loadFinance();
  };
  cell.append(form);
  row.append(cell);
}

export function renderFinanceTransactions() {
  const db = getDb();
  const tbody = $("fn-transactions");
  tbody.innerHTML = "";
  const month = $("fn-filter-month").value;
  const kind = $("fn-filter-kind").value;
  const categoryId = $("fn-filter-category").value;
  const description = $("fn-filter-description").value.trim().toLocaleLowerCase("pt-BR");
  const minInput = $("fn-filter-min");
  const maxInput = $("fn-filter-max");
  const min = minInput.value === "" ? null : Number(minInput.value);
  const max = maxInput.value === "" ? null : Number(maxInput.value);
  const invalidRange = !minInput.validity.valid || !maxInput.validity.valid || (min !== null && max !== null && min > max);
  const rows = invalidRange ? [] : state.fnTransactions.filter((t) =>
    (!month || t.transaction_date.slice(5, 7) === month) &&
    (!kind || t.kind === kind) &&
    (!categoryId || String(t.category_id) === categoryId) &&
    (!description || (t.description ?? "").toLocaleLowerCase("pt-BR").includes(description)) &&
    (min === null || Number(t.amount) >= min) &&
    (max === null || Number(t.amount) <= max));
  const pageCount = Math.max(1, Math.ceil(rows.length / TRANSACTIONS_PAGE_SIZE));
  transactionPage = Math.min(transactionPage, pageCount - 1);
  $("fn-filter-msg").textContent = invalidRange
    ? "Informe valores válidos e um mínimo menor ou igual ao máximo."
    : `${rows.length} ${rows.length === 1 ? "lançamento encontrado" : "lançamentos encontrados"}.`;
  $("fn-page-label").textContent = `Página ${transactionPage + 1} de ${pageCount}`;
  $("fn-page-prev").disabled = transactionPage === 0;
  $("fn-page-next").disabled = transactionPage >= pageCount - 1;
  show("fn-edit-msg", transactionDrafts.size > 0);
  $("fn-edit-msg").textContent = transactionDrafts.size
    ? `${transactionDrafts.size} ${transactionDrafts.size === 1 ? "edição não salva" : "edições não salvas"} (inclusive em outras páginas ou filtros).`
    : "";
  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.className = "empty";
    cell.textContent = invalidRange ? "Corrija a faixa de valores para consultar." : "Nenhum lançamento encontrado para os filtros selecionados.";
    row.append(cell);
    tbody.append(row);
  }
  const pageRows = rows.slice(transactionPage * TRANSACTIONS_PAGE_SIZE, (transactionPage + 1) * TRANSACTIONS_PAGE_SIZE);
  for (const t of pageRows) {
    const category = state.fnCategories.find((c) => c.id === t.category_id);
    const row = document.createElement("tr");
    row.dataset.transactionId = t.id;
    const draft = transactionDrafts.get(t.id);
    if (draft && canManageFinance()) {
      renderTransactionEditor(row, t, draft);
      tbody.append(row);
      continue;
    }
    
    const date = document.createElement("td");
    date.dataset.label = "Data"; 
    date.textContent = parseDate(t.transaction_date).toLocaleDateString("pt-BR");
    row.append(date);
    
    const type = document.createElement("td");
    type.dataset.label = "Tipo";
    type.textContent = t.kind === "income" ? "Receita" : "Despesa";
    row.append(type);
    
    const cat = document.createElement("td");
    cat.dataset.label = "Categoria"; 
    cat.textContent = category?.name ?? "?";
    row.append(cat);
    
    const desc = document.createElement("td");
    desc.dataset.label = "Descrição"; 
    desc.textContent = t.description;
    row.append(desc);
    
    const amt = document.createElement("td");
    amt.className = "num"; 
    amt.dataset.label = "Valor"; 
    amt.textContent = money(t.amount);
    row.append(amt);
    
    if (canManageFinance()) {
      const actions = document.createElement("td");
      actions.dataset.label = "Ações";
      const actionButtons = document.createElement("div");
      actionButtons.className = "finance-transaction-actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button"; 
      editBtn.className = "secondary"; 
      editBtn.textContent = "Editar";
      editBtn.onclick = () => {
        transactionDrafts.set(t.id, {
          transaction_date: t.transaction_date, kind: t.kind, category_id: t.category_id,
          description: t.description ?? "", amount: t.amount, saving: false, error: "",
        });
        renderFinanceTransactions();
        [...tbody.rows].find((item) => item.dataset.transactionId === String(t.id))
          ?.querySelector("input")?.focus();
      };
      
      const delBtn = document.createElement("button");
      delBtn.type = "button"; 
      delBtn.className = "secondary"; 
      delBtn.textContent = "Excluir";
      delBtn.onclick = async () => {
        if (!confirm("Tem certeza que deseja excluir este lançamento?")) return;
        const { error } = await db.from("finance_transactions").delete().eq("id", t.id);
        if (error) return say("fn-admin-msg", error.message);
        await loadFinance();
      };
      
      actionButtons.append(editBtn, delBtn);
      actions.append(actionButtons);
      row.append(actions);
    }
    tbody.append(row);
  }
}

export function renderFinanceCategories() {
  const db = getDb();
  const container = $("fn-categories");
  container.innerHTML = "";
  const allCategories = state.fnCategories.slice().sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "income" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  
  for (const c of allCategories) {
    const row = document.createElement("div");
    row.className = "finance-breakdown-row";
    
    const label = document.createElement("span");
    label.textContent = `${c.kind === "income" ? "Receita" : "Despesa"} · ${c.name}`;
    row.append(label);
    
    if (canManageFinance()) {
      const actions = document.createElement("div");
      actions.className = "finance-category-actions";
      
      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "secondary";
      renameBtn.textContent = "Renomear";
      renameBtn.onclick = () => {
        const newName = prompt(`Novo nome para "${c.name}":`, c.name);
        if (!newName || newName === c.name) return;
        (async () => {
          const { error } = await db.from("finance_categories").update({ name: newName }).eq("id", c.id);
          if (error) return say("fn-admin-msg", error.message);
          await loadFinance();
        })();
      };
      actions.append(renameBtn);
      
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "secondary";
      toggleBtn.textContent = c.active ? "Desativar" : "Ativar";
      toggleBtn.onclick = () => {
        (async () => {
          const { error } = await db.from("finance_categories").update({ active: !c.active }).eq("id", c.id);
          if (error) return say("fn-admin-msg", error.message);
          await loadFinance();
        })();
      };
      actions.append(toggleBtn);
      
      row.append(actions);
    }
    
    container.append(row);
  }
}

export function setupFinanceListeners() {
  const db = getDb();

  $("fn-view-month").onclick = () => {
    show("fn-month-view", true);
    show("fn-year-view", false);
    $("fn-view-month").setAttribute("aria-pressed", "true");
    $("fn-view-year").setAttribute("aria-pressed", "false");
  };

  $("fn-view-year").onclick = () => {
    show("fn-month-view", false);
    show("fn-year-view", true);
    $("fn-view-month").setAttribute("aria-pressed", "false");
    $("fn-view-year").setAttribute("aria-pressed", "true");
  };

  $("fn-load").onclick = async () => {
    const year = Number($("fn-year").value);
    if (!Number.isInteger(year) || year < 1900 || year > 9998) {
      return say("fn-msg", "Informe um ano entre 1900 e 9998.");
    }
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

  $("fn-admin-load").onclick = async () => {
    const year = Number($("fn-admin-year").value);
    if (!Number.isInteger(year) || year < 1900 || year > 9998) {
      return say("fn-admin-msg", "Informe um ano entre 1900 e 9998.");
    }
    setState("fnYear", year);
    transactionPage = 0;
    $("fn-date").value = fnPeriod();
    await loadFinance();
  };

  $("fn-prev").onclick = async () => {
    if (state.fnYear === 1900 && state.fnMonth === 0) return;
    if (state.fnMonth === 0) {
      setState("fnMonth", 11);
      setState("fnYear", state.fnYear - 1);
    } else {
      setState("fnMonth", state.fnMonth - 1);
    }
    await loadFinance();
  };

  $("fn-next").onclick = async () => {
    if (state.fnYear === 9998 && state.fnMonth === 11) return;
    if (state.fnMonth === 11) {
      setState("fnMonth", 0);
      setState("fnYear", state.fnYear + 1);
    } else {
      setState("fnMonth", state.fnMonth + 1);
    }
    await loadFinance();
  };

  $("fn-kind").onchange = updateFinanceCategoryOptions;

  for (const id of ["fn-filter-month", "fn-filter-kind", "fn-filter-category", "fn-filter-description", "fn-filter-min", "fn-filter-max"]) {
    $(id).oninput = () => {
      transactionPage = 0;
      renderFinanceTransactions();
    };
  }
  $("fn-filter-clear").onclick = () => {
    resetTransactionFilters();
    renderFinanceTransactions();
  };
  $("fn-page-prev").onclick = () => {
    if (transactionPage > 0) transactionPage--;
    renderFinanceTransactions();
  };
  $("fn-page-next").onclick = () => {
    transactionPage++;
    renderFinanceTransactions();
  };

  $("fn-transaction-form").onsubmit = async (event) => {
    event.preventDefault();
    if (!canManageFinance()) return say("fn-admin-msg", "Apenas administradores podem gerenciar lançamentos.");
    const payload = {
      kind: $("fn-kind").value,
      category_id: Number($("fn-category").value),
      transaction_date: $("fn-date").value,
      description: $("fn-description").value.trim(),
      amount: Number($("fn-amount").value),
    };
    const { error } = await db.from("finance_transactions").insert(payload);
    if (error) return say("fn-admin-msg", error.message);
    $("fn-transaction-form").reset();
    updateFinanceCategoryOptions();
    await loadFinance();
  };

  $("fn-category-form").onsubmit = async (event) => {
    event.preventDefault();
    if (!canManageFinance()) return say("fn-admin-msg", "Apenas administradores podem gerenciar categorias.");
    const { error } = await db.from("finance_categories").insert({
      kind: $("fn-category-kind").value,
      name: $("fn-category-name").value.trim(),
    });
    if (error) return say("fn-admin-msg", error.message);
    $("fn-category-form").reset();
    await loadFinance();
  };
}
