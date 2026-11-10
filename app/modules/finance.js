// modules/finance.js - Módulo de Financeiro
import { state, setState, updateState } from "../app-state.js";
import { $ } from "./dom.js";
import { show, say, canManageFinance } from "./ui.js";
import { getDb, uploadPaymentProof, cleanupUnlinkedPaymentProof, openPaymentProof, deletePaymentProof } from "./db.js";
import { setView, setActive } from "./ui.js";
import { money, parseDate } from "./utils.js";

const fnPeriod = () => `${state.fnYear}-${String(state.fnMonth + 1).padStart(2, "0")}-01`;
const fnMonthKey = (value) => String(value).slice(0, 7);

export async function showFinance() {
  setState("current", null);
  setView("finance");
  setActive((b) => b.id === "nav-finance");
  show("fn-transaction-form", canManageFinance());
  show("fn-category-form", canManageFinance());
  $("fn-date").value = fnPeriod();
  await loadFinance();
}

export async function showFinanceDashboard() {
  setState("current", null);
  setView("dashboard");
  setActive((b) => b.id === "nav-dashboard");
  await loadFinance();
}

export async function loadFinance() {
  const db = getDb();
  const start = `${state.fnYear}-01-01`, end = `${state.fnYear + 1}-01-01`;
  $("fn-year").value = state.fnYear;
  $("fn-dashboard-year").value = state.fnYear;
  $("fn-dashboard-year-label").textContent = String(state.fnYear);
  show("fn-transaction-form", canManageFinance());
  show("fn-category-form", canManageFinance());
  say("fn-msg", ""); 
  say("fn-dashboard-msg", "");
  
  const [categories, memberships, membershipRate, transactions, daily, adjustments] = await Promise.all([
    db.from("finance_categories").select("*").order("kind").order("name"),
    db.from("finance_memberships").select("*").gte("period_month", start).lt("period_month", end),
    db.from("finance_membership_rates").select("amount").eq("year", state.fnYear).maybeSingle(),
    db.from("finance_transactions").select("*").gte("transaction_date", start).lt("transaction_date", end).order("transaction_date"),
    db.rpc("get_finance_daily", { p_year: state.fnYear }),
    db.from("finance_daily_adjustments").select("*").gte("period_month", start).lt("period_month", end),
  ]);
  
  const failed = [categories, memberships, membershipRate, transactions, daily, adjustments].find((result) => result.error);
  if (failed) {
    say("fn-msg", failed.error.message); 
    say("fn-dashboard-msg", failed.error.message);
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
  setState("fnDailyAdjustments", adjustments.data ?? []);
  
  updateFinanceCategoryOptions();
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

export function fnFinanceSummary(data) {
  const usedCategories = new Set(state.fnTransactions.map((r) => String(r.category_id)));
  const categories = state.fnCategories.filter((c) => c.active || usedCategories.has(String(c.id)));
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
    card.setAttribute("aria-label", `${monthName}: receitas ${money(summary.income)}, despesas ${money(summary.expenses)}, balanço ${money(summary.balance)}. Ver detalhes.`);
    const title = document.createElement("span");
    title.className = "finance-month-card-title";
    title.textContent = monthName;
    card.append(title);
    addMetric(card, "Receitas", summary.income, "income");
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
}

export function renderFinanceDashboardDetails() {
  const data = fnMonthlyData(state.fnMonth);
  const summary = fnFinanceSummary(data);
  const label = new Date(state.fnYear, state.fnMonth, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  $("fn-dashboard-month-label").textContent = label;
  $("fn-dashboard-balance").textContent = money(summary.balance);
  $("fn-dashboard-income-total").textContent = money(summary.income);
  $("fn-dashboard-expense-total").textContent = money(summary.expenses);

  const renderRows = (target, rows) => {
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
  };
  renderRows($("fn-dashboard-income"), summary.incomeRows);
  renderRows($("fn-dashboard-expenses"), summary.expenseRows);
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

export function updateFinanceCategoryOptions() {
  const select = $("fn-category");
  select.innerHTML = "";
  const categories = state.fnCategories.filter((c) => c.active && c.kind === ($("fn-kind").value || "income"));
  for (const c of categories) {
    const option = document.createElement("option");
    option.value = c.id;
    option.textContent = c.name;
    select.append(option);
  }
}

export function renderFinanceTransactions() {
  const db = getDb();
  const tbody = $("fn-transactions");
  tbody.innerHTML = "";
  for (const t of state.fnTransactions) {
    const category = state.fnCategories.find((c) => c.id === t.category_id);
    const row = document.createElement("tr");
    
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
      const actionButtons = document.createElement("div");
      actionButtons.className = "finance-transaction-actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button"; 
      editBtn.className = "secondary"; 
      editBtn.textContent = "Editar";
      editBtn.onclick = () => {
        setState("fnEditingTransaction", t.id);
        $("fn-kind").value = t.kind;
        updateFinanceCategoryOptions();
        $("fn-category").value = t.category_id;
        $("fn-date").value = t.transaction_date;
        $("fn-description").value = t.description;
        $("fn-amount").value = t.amount;
        $("fn-transaction-save").textContent = "Atualizar";
        show("fn-transaction-cancel", true);
      };
      
      const delBtn = document.createElement("button");
      delBtn.type = "button"; 
      delBtn.className = "secondary"; 
      delBtn.textContent = "Excluir";
      delBtn.onclick = async () => {
        if (!confirm("Tem certeza que deseja excluir este lançamento?")) return;
        const { error } = await db.from("finance_transactions").delete().eq("id", t.id);
        if (error) return say("fn-msg", error.message);
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
          if (error) return say("fn-msg", error.message);
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
          if (error) return say("fn-msg", error.message);
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

  $("fn-transaction-form").onsubmit = async (event) => {
    event.preventDefault();
    const payload = {
      kind: $("fn-kind").value,
      category_id: Number($("fn-category").value),
      transaction_date: $("fn-date").value,
      description: $("fn-description").value.trim(),
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
    await loadFinance();
  };

  $("fn-transaction-cancel").onclick = () => {
    setState("fnEditingTransaction", null);
    $("fn-transaction-form").reset();
    updateFinanceCategoryOptions();
    $("fn-transaction-save").textContent = "Adicionar";
    show("fn-transaction-cancel", false);
  };

  $("fn-category-form").onsubmit = async (event) => {
    event.preventDefault();
    const { error } = await db.from("finance_categories").insert({
      kind: $("fn-category-kind").value,
      name: $("fn-category-name").value.trim(),
    });
    if (error) return say("fn-msg", error.message);
    $("fn-category-form").reset();
    await loadFinance();
  };
}
