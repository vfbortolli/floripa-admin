import { state, setState } from "../app-state.js";
import { show, say, setView, setActive } from "./ui.js";
import { money, fmtDate, brDate, nightsBetween, roomById, whatsappUrl, TYPES } from "./utils.js";
import { $ } from "./dom.js";
import { getDb, uploadPaymentProof, cleanupUnlinkedPaymentProof, openPaymentProof, deletePaymentProof } from "./db.js";

export async function showBilling() {
  setState("current", null);
  setView("billing");
  setActive((b) => b.id === "nav-billing");
  await loadBilling();
}

export async function loadBilling() {
  const db = getDb();
  const y = state.blMonth.getFullYear(), m = state.blMonth.getMonth();
  const monthStart = fmtDate(new Date(y, m, 1));
  const monthEnd = fmtDate(new Date(y, m + 1, 1));
  $("bl-label").textContent = state.blMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const [reservations, memberships, membershipRate] = await Promise.all([
    db.from("reservations")
      .select("id, space_id, check_in, check_out, reservation_guests(id, name, type, exempt, guest_charges(rate, paid))")
      .eq("status", "confirmed").eq("kind", "stay")
      .gte("check_out", monthStart)
      .lt("check_out", monthEnd)
      .order("check_out"),
    db.from("finance_memberships").select("id, family_id, expected_amount, received_amount")
      .eq("period_month", monthStart),
    db.from("finance_membership_rates").select("amount").eq("year", y).maybeSingle(),
  ]);
  const failed = [reservations, memberships, membershipRate].find((result) => result.error);
  if (failed) return say("bl-msg", failed.error.message);
  say("bl-msg", "");
  setState("blSelected", new Set());
  setState("blRows", []);
  for (const r of reservations.data ?? []) {
    const nights = nightsBetween(r.check_in, r.check_out);
    for (const g of r.reservation_guests) {
      const c = Array.isArray(g.guest_charges) ? g.guest_charges[0] : g.guest_charges;
      if (g.exempt || !c) continue;
      state.blRows.push({
        kind: "daily",
        guestId: g.id, who: g.name, type: g.type,
        room: roomById(r.space_id)?.name ?? "?", check_in: r.check_in, check_out: r.check_out,
        nights, rate: Number(c.rate), amount: Number(c.rate) * nights,
        received: c.paid ? Number(c.rate) * nights : 0, paid: !!c.paid, receipts: [],
      });
    }
  }
  const savedMemberships = new Map((memberships.data ?? []).map((row) => [row.family_id, row]));
  for (const family of state.families) {
    const saved = savedMemberships.get(family.id);
    const amount = membershipRate.data
      ? Number(membershipRate.data.amount)
      : Number(saved?.expected_amount ?? 0);
    const received = Number(saved?.received_amount ?? 0);
    state.blRows.push({
      kind: "membership",
      familyId: family.id,
      who: family.name,
      period: monthStart,
      amount,
      received,
      paid: amount > 0 && received >= amount,
      receipts: [],
    });
  }
  setState("blMembershipContacts", new Map());
  setState("blWhatsAppError", null);
  const pendingMemberships = state.blRows.some((row) =>
    row.kind === "membership" && row.amount > row.received);
  if (pendingMemberships) {
    const { data: contacts, error: contactsError } = await db.rpc("get_membership_whatsapp_targets");
    if (contactsError) {
      setState("blWhatsAppError", contactsError.message);
      say("bl-msg", `Não foi possível carregar os responsáveis para os lembretes. Execute supabase/phase2q.sql no Supabase. Detalhe: ${contactsError.message}`);
    } else {
      const groupedContacts = new Map();
      for (const contact of contacts ?? []) {
        const familyId = Number(contact.family_id);
        groupedContacts.set(familyId, [...(groupedContacts.get(familyId) ?? []), contact]);
      }
      setState("blMembershipContacts", groupedContacts);
    }
  }
  const dailyRows = state.blRows.filter((row) => row.kind === "daily");
  if (dailyRows.length) {
    const { data: receiptLinks, error: receiptError } = await db.from("payment_receipt_guest_charges")
      .select("guest_id, payment_receipts(id, object_path, original_name, uploaded_at)")
      .in("guest_id", dailyRows.map((r) => r.guestId));
    if (receiptError) return say("bl-msg", receiptError.message);
    for (const link of receiptLinks ?? []) {
      const receipt = Array.isArray(link.payment_receipts) ? link.payment_receipts[0] : link.payment_receipts;
      const row = state.blRows.find((r) => r.guestId === link.guest_id);
      if (row && receipt) row.receipts.push(receipt);
    }
  }
  renderBilling();
}

export function renderBilling() {
  const db = getDb();
  const sum = (rows) => rows.reduce((t, r) => t + r.amount, 0);
  const paid = state.blRows.reduce((total, row) => total + Math.min(row.amount, row.received), 0);
  const total = sum(state.blRows);
  const statusFilter = $("bl-status-filter").value;
  const typeFilter = $("bl-type-filter").value;
  const visibleRows = state.blRows.filter((row) =>
    (statusFilter === "all" || (statusFilter === "paid" ? row.paid : !row.paid))
    && (typeFilter === "all" || row.kind === typeFilter));
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
  if (!visibleRows.length) {
    box.innerHTML = `<p class="empty">${state.blRows.length ? "Nenhuma cobrança com esse status neste mês." : "Nenhuma cobrança neste mês."}</p>`;
    return;
  }
  const dailyRows = visibleRows.filter((row) => row.kind === "daily");
  let updateSelection = () => {};
  if (dailyRows.length) {
    const proofTools = document.createElement("div");
    proofTools.className = "bl-proof-tools";
    const instructions = document.createElement("span");
    instructions.textContent = "Selecione uma ou mais diárias para anexar o comprovante da transferência e dar baixa.";
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
      applyProof.disabled = !uploadInput.files?.length || !state.blSelected.size;
    };
    updateSelection = () => {
      applyProof.disabled = !uploadInput.files?.length || !state.blSelected.size;
      const selectedRows = state.blRows.filter((row) => row.kind === "daily" && state.blSelected.has(row.guestId));
      applyProof.textContent = selectedRows.some((row) => !row.paid)
        ? "Anexar comprovante e dar baixa"
        : "Anexar comprovante";
    };
    applyProof.onclick = async () => {
      const file = uploadInput.files?.[0];
      const selectedRows = state.blRows.filter((row) => row.kind === "daily" && state.blSelected.has(row.guestId));
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
        selectedRows.map((row) => ({ receipt_id: receipt.id, guest_id: row.guestId })),
      );
      if (linkError) {
        const cleanupErrors = await cleanupUnlinkedPaymentProof(receipt);
        say("bl-msg", [linkError.message, ...cleanupErrors].join(" "));
        updateSelection();
        return;
      }
      const unpaidRows = selectedRows.filter((row) => !row.paid);
      if (unpaidRows.length) {
        const { error: paidError } = await db.from("guest_charges").update({
          paid: true, paid_at: new Date().toISOString(),
        }).in("guest_id", unpaidRows.map((row) => row.guestId));
        if (paidError) {
          await loadBilling();
          say("bl-msg", `Comprovante anexado, mas não foi possível dar baixa: ${paidError.message}`);
          return;
        }
      }
      uploadInput.value = "";
      setState("blSelected", new Set());
      await loadBilling();
    };
    proofTools.append(instructions, uploadLabel, applyProof);
    box.append(proofTools);
  }
  const groups = new Map();
  for (const r of dailyRows) groups.set(r.room, [...(groups.get(r.room) ?? []), r]);
  const sortedGroups = [...groups].sort((a, b) => a[0].localeCompare(b[0], "pt-BR", { numeric: true }));
  for (const [room, rows] of sortedGroups) {
    const card = document.createElement("div");
    card.className = "res-card bl-card";
    const head = document.createElement("div");
    head.className = "res-head";
    const name = document.createElement("b");
    name.textContent = room;
    const open = rows.filter((row) => !row.paid).reduce((amount, row) => amount + row.amount - row.received, 0);
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
      select.checked = state.blSelected.has(r.guestId);
      select.disabled = r.paid && r.receipts.length > 0;
      select.setAttribute("aria-label", `Selecionar cobrança de ${r.who} para comprovante`);
      select.title = "Selecionar para anexar comprovante";
      select.onchange = () => {
        if (select.checked) state.blSelected.add(r.guestId);
        else state.blSelected.delete(r.guestId);
        updateSelection();
      };
      const txt = document.createElement("span");
      txt.textContent = `${r.who} · ${brDate(r.check_in)} → ${brDate(r.check_out)} · ${r.nights}×${money(r.rate)} (${TYPES[r.type]})${r.paid ? " · Quitado" : " · Deve"}`;
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
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "secondary";
          remove.textContent = "Excluir";
          remove.setAttribute("aria-label", `Excluir comprovante ${receipt.original_name}`);
          remove.onclick = async () => {
            if (!confirm(`Excluir o comprovante "${receipt.original_name}"? Ele será removido de todas as cobranças vinculadas.`)) return;
            remove.disabled = true;
            const { error } = await deletePaymentProof(receipt);
            await loadBilling();
            if (error) say("bl-msg", error);
          };
          receiptList.append(button, remove);
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

  const memberships = visibleRows.filter((row) => row.kind === "membership");
  for (const row of memberships) {
    const card = document.createElement("div");
    card.className = "res-card bl-card";
    const head = document.createElement("div");
    head.className = "res-head";
    const title = document.createElement("b");
    title.textContent = `Mensalidade · ${row.who}`;
    const open = Math.max(0, row.amount - row.received);
    const tag = document.createElement("span");
    tag.className = "tag " + (open ? "reparo" : "bom");
    tag.textContent = open ? `Deve ${money(open)}` : "Quitado";
    head.append(title, tag);
    card.append(head);
    const line = document.createElement("div");
    line.className = "bl-line";
    const description = document.createElement("span");
    description.textContent = `Previsto ${money(row.amount)} · Recebido ${money(row.received)}`;
    const amount = document.createElement("b");
    amount.textContent = `Em aberto ${money(open)}`;
    line.append(description, amount);
    card.append(line);
    if (open > 0) {
      const contacts = state.blMembershipContacts.get(row.familyId) ?? [];
      if (state.blWhatsAppError) {
        const error = document.createElement("small");
        error.className = "bl-no-proof";
        error.textContent = "Os responsáveis não puderam ser carregados.";
        card.append(error);
      } else if (!contacts.length) {
        const empty = document.createElement("small");
        empty.className = "bl-no-proof";
        empty.textContent = "Nenhum responsável cadastrado para esta família.";
        card.append(empty);
      } else {
        const monthLabel = state.blMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
        const contactsLabel = document.createElement("small");
        contactsLabel.className = "bl-no-proof";
        contactsLabel.textContent = "Responsáveis cadastrados:";
        card.append(contactsLabel);
        for (const contact of contacts) {
          const contactLine = document.createElement("div");
          contactLine.className = "bl-line";
          const name = document.createElement("span");
          name.textContent = contact.name;
          const message = `Lembrete de Mensalidade da Casa dos Paulistas - Florianopolis\nMês: ${monthLabel}\nValor: ${money(open)}`;
          const url = whatsappUrl(contact.phone, message);
          if (url) {
            const link = document.createElement("a");
            link.className = "btn whatsapp-link";
            link.href = url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = "Lembrar via WhatsApp";
            link.setAttribute("aria-label", `Lembrar ${contact.name} da mensalidade de ${monthLabel} via WhatsApp`);
            contactLine.append(name, link);
          } else {
            const phoneStatus = document.createElement("small");
            phoneStatus.className = "bl-no-proof";
            phoneStatus.textContent = String(contact.phone ?? "").trim()
              ? "Telefone inválido; confira o cadastro em Pessoas."
              : "Telefone não cadastrado.";
            contactLine.append(name, phoneStatus);
          }
          card.append(contactLine);
        }
      }
    }
    box.append(card);
  }
}

export function setupBillingListeners() {
  $("bl-prev").onclick = () => { setState("blMonth", new Date(state.blMonth.getFullYear(), state.blMonth.getMonth() - 1, 1)); loadBilling(); };
  $("bl-next").onclick = () => { setState("blMonth", new Date(state.blMonth.getFullYear(), state.blMonth.getMonth() + 1, 1)); loadBilling(); };
  $("bl-status-filter").onchange = () => {
    setState("blSelected", new Set());
    renderBilling();
  };
  $("bl-type-filter").onchange = () => {
    setState("blSelected", new Set());
    renderBilling();
  };
  $("bl-csv").onclick = () => {
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const statusFilter = $("bl-status-filter").value;
    const typeFilter = $("bl-type-filter").value;
    const rows = state.blRows.filter((row) =>
      (statusFilter === "all" || (statusFilter === "paid" ? row.paid : !row.paid))
      && (typeFilter === "all" || row.kind === typeFilter));
    const lines = [["Categoria", "Pessoa/Família", "Referência", "Quarto", "Entrada", "Saída", "Noites", "Tipo", "Total", "Recebido", "A receber", "Status"]];
    for (const row of rows) {
      lines.push(row.kind === "daily"
        ? ["Diária", row.who, `${row.check_in} a ${row.check_out}`, row.room, row.check_in, row.check_out, row.nights, TYPES[row.type], row.amount.toFixed(2), row.received.toFixed(2), (row.amount - row.received).toFixed(2), row.paid ? "Quitado" : "Deve"]
        : ["Mensalidade", row.who, row.period, "", "", "", "", "", row.amount.toFixed(2), row.received.toFixed(2), Math.max(0, row.amount - row.received).toFixed(2), row.paid ? "Quitado" : "Deve"]);
    }
    const blob = new Blob(["\ufeff" + lines.map((l) => l.map(esc).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cobranca-${fmtDate(state.blMonth).slice(0, 7)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
}
