import { state, setState } from "../app-state.js";
import { show, say, setView, setActive, canManageFinance } from "./ui.js";
import { money, fmtDate, brDate, nightsBetween, roomById, whatsappUrl, TYPES } from "./utils.js";
import { $ } from "./dom.js";
import { getDb, uploadPaymentProof, cleanupUnlinkedPaymentProof, openPaymentProof, deletePaymentProof } from "./db.js";

let expandedMembershipKey = null;
let expandedDailyReservationId = null;

export async function showBilling() {
  setState("current", null);
  setView("billing");
  setActive((b) => b.id === "nav-billing");
  expandedMembershipKey = null;
  expandedDailyReservationId = null;
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
    db.from("finance_memberships").select("id, family_id, expected_amount, received_amount, paid_at")
      .eq("period_month", monthStart),
    db.from("finance_membership_rates").select("amount").eq("year", y).maybeSingle(),
  ]);
  const failed = [reservations, memberships, membershipRate].find((result) => result.error);
  if (failed) return say("bl-msg", failed.error.message);
  say("bl-msg", "");
  setState("blRows", []);
  for (const r of reservations.data ?? []) {
    const nights = nightsBetween(r.check_in, r.check_out);
    for (const g of r.reservation_guests) {
      const c = Array.isArray(g.guest_charges) ? g.guest_charges[0] : g.guest_charges;
      if (g.exempt || !c) continue;
      state.blRows.push({
        kind: "daily",
        reservationId: r.id,
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
      membershipId: saved?.id ?? null,
      familyId: family.id,
      who: family.name,
      period: monthStart,
      amount,
      received,
      paidAt: saved?.paid_at ?? "",
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
  const membershipRows = state.blRows.filter((row) => row.kind === "membership" && row.membershipId);
  if (canManageFinance() && membershipRows.length) {
    const { data: receiptLinks, error: receiptError } = await db.from("payment_receipt_memberships")
      .select("membership_id, payment_receipts(id, object_path, original_name, uploaded_at)")
      .in("membership_id", membershipRows.map((row) => row.membershipId));
    if (receiptError) return say("bl-msg", receiptError.message);
    for (const link of receiptLinks ?? []) {
      const receipt = Array.isArray(link.payment_receipts) ? link.payment_receipts[0] : link.payment_receipts;
      const row = membershipRows.find((item) => item.membershipId === link.membership_id);
      if (row && receipt) row.receipts.push(receipt);
    }
  }
  renderBilling();
}

export function renderBilling() {
  const sum = (rows) => rows.reduce((t, r) => t + r.amount, 0);
  const paid = state.blRows.reduce((total, row) => total + Math.min(row.amount, row.received), 0);
  const total = sum(state.blRows);
  const statusFilter = $("bl-status-filter").value;
  const typeFilter = $("bl-type-filter").value;
  const rowsByReservation = new Map();
  for (const row of state.blRows) {
    if (row.kind !== "daily") continue;
    rowsByReservation.set(row.reservationId, [...(rowsByReservation.get(row.reservationId) ?? []), row]);
  }
  const dailyGroups = [...rowsByReservation.values()].filter((rows) =>
    typeFilter !== "membership"
    && (statusFilter === "all"
      || (statusFilter === "paid" ? rows.every((row) => row.paid) : rows.some((row) => !row.paid))));
  const membershipRows = state.blRows.filter((row) =>
    row.kind === "membership"
    && typeFilter !== "daily"
    && (statusFilter === "all" || (statusFilter === "paid" ? row.paid : !row.paid)));
  const visibleRows = [...dailyGroups.flat(), ...membershipRows];
  if (expandedDailyReservationId && !dailyGroups.some((rows) => rows[0].reservationId === expandedDailyReservationId)) {
    expandedDailyReservationId = null;
  }
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
  const sortedGroups = dailyGroups.sort((a, b) =>
    a[0].room.localeCompare(b[0].room, "pt-BR", { numeric: true })
      || a[0].check_in.localeCompare(b[0].check_in));
  for (const rows of sortedGroups) {
    const reservation = rows[0];
    const card = document.createElement("div");
    card.className = "res-card bl-card";
    const head = document.createElement("div");
    head.className = "res-head";
    const heading = document.createElement("div");
    heading.className = "bl-payment-heading";
    const name = document.createElement("b");
    name.textContent = `${reservation.room} · ${brDate(reservation.check_in)} → ${brDate(reservation.check_out)}`;
    const open = rows.filter((row) => !row.paid).reduce((amount, row) => amount + row.amount - row.received, 0);
    const tag = document.createElement("span");
    tag.className = "tag " + (open ? "reparo" : "bom");
    tag.textContent = open ? `Deve ${money(open)}` : "Quitado";
    heading.append(name);
    const expanded = expandedDailyReservationId === reservation.reservationId;
    if (canManageFinance()) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "secondary bl-payment-toggle";
      toggle.textContent = expanded
        ? "Fechar quitação"
        : open ? "Registrar quitação" : rows.some((row) => !row.receipts.length) ? "Anexar comprovante" : "Ver comprovantes";
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.setAttribute("aria-controls", `bl-daily-details-${reservation.reservationId}`);
      toggle.onclick = () => {
        expandedDailyReservationId = expanded ? null : reservation.reservationId;
        renderBilling();
      };
      heading.append(toggle);
    }
    head.append(heading, tag);
    card.append(head);
    for (const r of rows) {
      const line = document.createElement("div");
      line.className = "bl-line";
      const txt = document.createElement("span");
      txt.textContent = `${r.who} · ${brDate(r.check_in)} → ${brDate(r.check_out)} · ${r.nights}×${money(r.rate)} (${TYPES[r.type]})${r.paid ? " · Quitado" : " · Deve"}`;
      const amt = document.createElement("b");
      amt.textContent = money(r.amount);
      line.append(txt, amt);
      card.append(line);
    }
    if (expanded) renderDailyPaymentDetails(rows, card);
    else if (!rows.some((row) => row.receipts.length)) {
      const noProof = document.createElement("small");
      noProof.className = "bl-no-proof bl-daily-no-proof";
      noProof.textContent = rows.every((row) => row.paid)
        ? "Pagamento já registrado antes da exigência de comprovante."
        : "Anexe um comprovante para registrar a quitação do quarto.";
      card.append(noProof);
    }
    box.append(card);
  }

  for (const row of membershipRows) {
    const card = document.createElement("div");
    card.className = "res-card bl-card";
    const open = Math.max(0, row.amount - row.received);
    const key = `${row.period}:${row.familyId}`;
    const expanded = canManageFinance() && expandedMembershipKey === key;
    const head = document.createElement("div");
    head.className = "res-head";
    const heading = document.createElement("div");
    heading.className = "bl-payment-heading";
    const title = document.createElement("b");
    title.textContent = `Mensalidade · ${row.who}`;
    const tag = document.createElement("span");
    tag.className = "tag " + (open ? "reparo" : "bom");
    tag.textContent = open ? `Deve ${money(open)}` : "Quitado";
    heading.append(title);
    if (canManageFinance()) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "secondary bl-payment-toggle";
      toggle.textContent = expanded
        ? "Fechar quitação"
        : open > 0 ? "Registrar quitação" : row.receipts.length ? "Ver comprovantes" : "Anexar comprovante";
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.setAttribute("aria-controls", `bl-payment-details-${row.familyId}`);
      toggle.onclick = () => {
        expandedMembershipKey = expanded ? null : key;
        renderBilling();
      };
      heading.append(toggle);
    }
    head.append(heading, tag);
    card.append(head);
    const line = document.createElement("div");
    line.className = "bl-line";
    const description = document.createElement("span");
    description.textContent = `Previsto ${money(row.amount)} · Recebido ${money(row.received)}`;
    const amount = document.createElement("b");
    amount.textContent = `Em aberto ${money(open)}`;
    line.append(description, amount);
    card.append(line);
    if (expanded) renderMembershipPaymentDetails(row, card);
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

function renderDailyPaymentDetails(rows, card) {
  const db = getDb();
  const reservation = rows[0];
  const details = document.createElement("div");
  details.className = "bl-payment-details";
  details.id = `bl-daily-details-${reservation.reservationId}`;
  const instruction = document.createElement("p");
  instruction.className = "msg";
  instruction.textContent = "Um comprovante registra o pagamento de todas as pessoas desta hospedagem.";
  details.append(instruction);

  const proofLabel = document.createElement("div");
  proofLabel.className = "bl-payment-proof";
  const proofTitle = document.createElement("span");
  proofTitle.textContent = "Comprovantes";
  const proofInput = document.createElement("input");
  proofInput.type = "file";
  proofInput.className = "finance-attachment-input";
  proofInput.accept = "application/pdf,image/jpeg,image/png";
  proofInput.multiple = true;
  proofInput.setAttribute("aria-label", `Adicionar comprovante da hospedagem em ${reservation.room}`);
  const attachment = document.createElement("label");
  attachment.className = "btn secondary finance-attachment";
  attachment.append("Escolher arquivos", proofInput);
  const attachmentName = document.createElement("span");
  attachmentName.className = "finance-attachment-name";
  attachmentName.setAttribute("aria-live", "polite");
  proofLabel.append(proofTitle, attachment, attachmentName);

  const receipts = [...new Map(rows.flatMap((row) => row.receipts).map((receipt) => [receipt.id, receipt])).values()];
  if (receipts.length) {
    const receiptList = document.createElement("div");
    receiptList.className = "bl-receipts";
    for (const receipt of receipts) {
      const view = document.createElement("button");
      view.type = "button";
      view.className = "secondary";
      view.textContent = `Comprovante: ${receipt.original_name}`;
      view.onclick = () => openPaymentProof(receipt, "bl-msg");
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
      receiptList.append(view, remove);
    }
    proofLabel.append(receiptList);
  }
  details.append(proofLabel);

  const save = document.createElement("button");
  save.type = "button";
  const unpaidRows = rows.filter((row) => !row.paid);
  save.textContent = unpaidRows.length ? "Anexar comprovante e dar baixa" : "Anexar comprovante";
  save.disabled = true;
  proofInput.onchange = () => {
    const files = [...(proofInput.files ?? [])];
    attachmentName.textContent = files.length === 1 ? files[0].name : files.length ? `${files.length} arquivos` : "";
    attachmentName.title = files.map((file) => file.name).join(", ");
    save.disabled = !files.length;
  };
  save.onclick = async () => {
    const files = [...(proofInput.files ?? [])];
    if (!files.length) return;
    save.disabled = true;
    for (const file of files) {
      const { data: receipt, error: uploadError } = await uploadPaymentProof(file);
      if (uploadError) {
        await loadBilling();
        say("bl-msg", `Não foi possível concluir o envio: ${uploadError}`);
        return;
      }
      const { error: linkError } = await db.from("payment_receipt_guest_charges")
        .insert(rows.map((row) => ({ receipt_id: receipt.id, guest_id: row.guestId })));
      if (linkError) {
        const cleanupErrors = await cleanupUnlinkedPaymentProof(receipt);
        await loadBilling();
        say("bl-msg", [`Não foi possível vincular o comprovante: ${linkError.message}`, ...cleanupErrors].join(" "));
        return;
      }
    }
    if (unpaidRows.length) {
      const { error } = await db.from("guest_charges").update({
        paid: true, paid_at: new Date().toISOString(),
      }).in("guest_id", unpaidRows.map((row) => row.guestId));
      if (error) {
        await loadBilling();
        say("bl-msg", `Comprovante anexado, mas não foi possível dar baixa: ${error.message}`);
        return;
      }
    }
    await loadBilling();
  };
  details.append(save);
  card.append(details);
}

function renderMembershipPaymentDetails(row, card) {
  const db = getDb();
  const details = document.createElement("div");
  details.className = "bl-payment-details";
  details.id = `bl-payment-details-${row.familyId}`;

  const heading = document.createElement("p");
  heading.className = "msg";
  heading.textContent = "Registre o valor recebido e a data. Anexe um comprovante antes de salvar qualquer recebimento.";
  details.append(heading);

  const form = document.createElement("div");
  form.className = "bl-payment-form";
  const receivedLabel = document.createElement("label");
  receivedLabel.textContent = "Valor recebido";
  const receivedInput = document.createElement("input");
  receivedInput.type = "number";
  receivedInput.min = "0";
  receivedInput.step = "0.01";
  receivedInput.value = String(row.received);
  receivedInput.setAttribute("aria-label", `Valor recebido da mensalidade de ${row.who}`);
  receivedLabel.append(receivedInput);

  const dateLabel = document.createElement("label");
  dateLabel.textContent = "Data do pagamento";
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.value = row.paidAt;
  dateInput.setAttribute("aria-label", `Data do pagamento da mensalidade de ${row.who}`);
  dateLabel.append(dateInput);

  const proofLabel = document.createElement("div");
  proofLabel.className = "bl-payment-proof";
  const proofTitle = document.createElement("span");
  proofTitle.textContent = "Comprovantes";
  const proofInput = document.createElement("input");
  proofInput.type = "file";
  proofInput.className = "finance-attachment-input";
  proofInput.accept = "application/pdf,image/jpeg,image/png";
  proofInput.multiple = true;
  proofInput.setAttribute("aria-label", `Adicionar comprovantes da mensalidade de ${row.who}`);
  const attachment = document.createElement("label");
  attachment.className = "btn secondary finance-attachment";
  attachment.append("Escolher arquivos", proofInput);
  const attachmentName = document.createElement("span");
  attachmentName.className = "finance-attachment-name";
  attachmentName.setAttribute("aria-live", "polite");
  proofInput.onchange = () => {
    const files = [...(proofInput.files ?? [])];
    attachmentName.textContent = files.length === 1 ? files[0].name : files.length ? `${files.length} arquivos` : "";
    attachmentName.title = files.map((file) => file.name).join(", ");
  };
  proofLabel.append(proofTitle, attachment, attachmentName);
  form.append(receivedLabel, dateLabel, proofLabel);
  details.append(form);

  if (row.receipts.length) {
    const receiptList = document.createElement("div");
    receiptList.className = "bl-receipts";
    for (const receipt of row.receipts) {
      const view = document.createElement("button");
      view.type = "button";
      view.className = "secondary";
      view.textContent = `Comprovante: ${receipt.original_name}`;
      view.onclick = () => openPaymentProof(receipt, "bl-msg");
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary";
      remove.textContent = "Excluir";
      remove.setAttribute("aria-label", `Excluir comprovante ${receipt.original_name}`);
      remove.onclick = async () => {
        if (!confirm(`Excluir o comprovante "${receipt.original_name}"?`)) return;
        remove.disabled = true;
        const { error } = await deletePaymentProof(receipt);
        await loadBilling();
        if (error) say("bl-msg", error);
      };
      receiptList.append(view, remove);
    }
    proofLabel.append(receiptList);
  }

  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Salvar quitação";
  save.onclick = async () => {
    if (receivedInput.value === "" || !Number.isFinite(Number(receivedInput.value)) || Number(receivedInput.value) < 0) {
      say("bl-msg", "Informe um valor recebido válido (zero ou maior).");
      return;
    }
    const receivedAmount = Number(receivedInput.value);
    const files = [...(proofInput.files ?? [])];
    if (receivedAmount > 0 && !row.receipts.length && !files.length) {
      say("bl-msg", `Anexe um comprovante para registrar o recebimento de ${row.who}.`);
      return;
    }

    save.disabled = true;
    let membershipId = row.membershipId;
    if (!membershipId && files.length) {
      const { data: created, error } = await db.from("finance_memberships").upsert({
        family_id: row.familyId, period_month: row.period,
        expected_amount: row.amount, received_amount: 0, paid_at: null,
      }, { onConflict: "family_id,period_month" }).select("id").single();
      if (error) {
        say("bl-msg", error.message);
        save.disabled = false;
        return;
      }
      membershipId = created.id;
    }

    for (const file of files) {
      const { data: receipt, error: uploadError } = await uploadPaymentProof(file);
      if (uploadError) {
        await loadBilling();
        say("bl-msg", `Não foi possível concluir o envio: ${uploadError}`);
        return;
      }
      const { error: linkError } = await db.from("payment_receipt_memberships")
        .insert({ receipt_id: receipt.id, membership_id: membershipId });
      if (linkError) {
        const cleanupErrors = await cleanupUnlinkedPaymentProof(receipt);
        await loadBilling();
        say("bl-msg", [`Não foi possível vincular o comprovante: ${linkError.message}`, ...cleanupErrors].join(" "));
        return;
      }
    }

    const values = {
      expected_amount: row.amount,
      received_amount: receivedAmount,
      paid_at: receivedAmount > 0 ? dateInput.value || null : null,
    };
    const result = membershipId
      ? await db.from("finance_memberships").update(values).eq("id", membershipId)
      : await db.from("finance_memberships").insert({
        family_id: row.familyId, period_month: row.period, ...values,
      });
    if (result.error) {
      await loadBilling();
      say("bl-msg", `Comprovante(s) anexado(s), mas o recebimento não foi salvo: ${result.error.message}`);
      return;
    }
    await loadBilling();
  };
  details.append(save);
  card.append(details);
}

export function setupBillingListeners() {
  $("bl-prev").onclick = () => { expandedMembershipKey = null; expandedDailyReservationId = null; setState("blMonth", new Date(state.blMonth.getFullYear(), state.blMonth.getMonth() - 1, 1)); loadBilling(); };
  $("bl-next").onclick = () => { expandedMembershipKey = null; expandedDailyReservationId = null; setState("blMonth", new Date(state.blMonth.getFullYear(), state.blMonth.getMonth() + 1, 1)); loadBilling(); };
  $("bl-status-filter").onchange = () => {
    expandedDailyReservationId = null;
    renderBilling();
  };
  $("bl-type-filter").onchange = () => {
    expandedDailyReservationId = null;
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
