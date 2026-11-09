import { state, setState } from "../app-state.js";
import { show, say, setView, setActive } from "./ui.js";
import { money, fmtDate, brDate, nightsBetween, roomById, TYPES } from "./utils.js";
import { $ } from "./dom.js";
import { getDb, uploadPaymentProof, cleanupUnlinkedPaymentProof, openPaymentProof } from "./db.js";

export async function showBilling() {
  setState("current", null);
  setView("billing");
  setActive((b) => b.id === "nav-billing");
  await loadBilling();
}

export async function loadBilling() {
  const db = getDb();
  const y = state.blMonth.getFullYear(), m = state.blMonth.getMonth();
  $("bl-label").textContent = state.blMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const { data, error } = await db.from("reservations")
    .select("id, space_id, check_in, check_out, reservation_guests(id, name, type, exempt, guest_charges(rate, paid))")
    .eq("status", "confirmed").eq("kind", "stay")
    .gte("check_out", fmtDate(new Date(y, m, 1)))
    .lt("check_out", fmtDate(new Date(y, m + 1, 1)))
    .order("check_out");
  if (error) return say("bl-msg", error.message);
  say("bl-msg", "");
  setState("blSelected", new Set());
  setState("blRows", []);
  for (const r of data) {
    const nights = nightsBetween(r.check_in, r.check_out);
    for (const g of r.reservation_guests) {
      const c = Array.isArray(g.guest_charges) ? g.guest_charges[0] : g.guest_charges;
      if (g.exempt || !c) continue;
      state.blRows.push({
        guestId: g.id, who: g.name, type: g.type,
        room: roomById(r.space_id)?.name ?? "?", check_in: r.check_in, check_out: r.check_out,
        nights, rate: Number(c.rate), amount: Number(c.rate) * nights, paid: !!c.paid, receipts: [],
      });
    }
  }
  if (state.blRows.length) {
    const { data: receiptLinks, error: receiptError } = await db.from("payment_receipt_guest_charges")
      .select("guest_id, payment_receipts(id, object_path, original_name, uploaded_at)")
      .in("guest_id", state.blRows.map((r) => r.guestId));
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
  const paid = sum(state.blRows.filter((r) => r.paid));
  const total = sum(state.blRows);
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
  if (!state.blRows.length) {
    box.innerHTML = '<p class="empty">Nenhuma cobrança neste mês.</p>';
    return;
  }
  const proofTools = document.createElement("div");
  proofTools.className = "bl-proof-tools";
  const instructions = document.createElement("span");
  instructions.textContent = "Selecione uma ou mais cobranças para anexar o comprovante da transferência e dar baixa em todas.";
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
  const updateSelection = () => {
    applyProof.disabled = !uploadInput.files?.length || !state.blSelected.size;
    const selectedRows = state.blRows.filter((r) => state.blSelected.has(r.guestId));
    applyProof.textContent = selectedRows.some((r) => !r.paid)
      ? "Anexar comprovante e dar baixa"
      : "Anexar comprovante";
  };
  applyProof.onclick = async () => {
    const file = uploadInput.files?.[0];
    const selectedRows = state.blRows.filter((r) => state.blSelected.has(r.guestId));
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
      selectedRows.map((r) => ({ receipt_id: receipt.id, guest_id: r.guestId })),
    );
    if (linkError) {
      const cleanupErrors = await cleanupUnlinkedPaymentProof(receipt);
      say("bl-msg", [linkError.message, ...cleanupErrors].join(" "));
      updateSelection();
      return;
    }
    const unpaidRows = selectedRows.filter((r) => !r.paid);
    if (unpaidRows.length) {
      const { error: paidError } = await db.from("guest_charges").update({
        paid: true, paid_at: new Date().toISOString(),
      }).in("guest_id", unpaidRows.map((r) => r.guestId));
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
  const groups = new Map();
  for (const r of state.blRows) groups.set(r.room, [...(groups.get(r.room) ?? []), r]);
  const sortedGroups = [...groups].sort((a, b) => a[0].localeCompare(b[0], "pt-BR", { numeric: true }));
  for (const [room, rows] of sortedGroups) {
    const card = document.createElement("div");
    card.className = "res-card bl-card";
    const head = document.createElement("div");
    head.className = "res-head";
    const name = document.createElement("b");
    name.textContent = room;
    const open = sum(rows.filter((r) => !r.paid));
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
      txt.textContent = `${r.who} · ${brDate(r.check_in)} → ${brDate(r.check_out)} · ${r.nights}×${money(r.rate)} (${TYPES[r.type]})${r.paid ? " · Pago" : " · Pendente"}`;
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
          receiptList.append(button);
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
}

export function setupBillingListeners() {
  $("bl-prev").onclick = () => { setState("blMonth", new Date(state.blMonth.getFullYear(), state.blMonth.getMonth() - 1, 1)); loadBilling(); };
  $("bl-next").onclick = () => { setState("blMonth", new Date(state.blMonth.getFullYear(), state.blMonth.getMonth() + 1, 1)); loadBilling(); };
  $("bl-csv").onclick = () => {
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [["Pessoa", "Quarto", "Entrada", "Saída", "Noites", "Tipo", "Valor/noite", "Total", "Pago"]];
    for (const r of state.blRows) lines.push([r.who, r.room, r.check_in, r.check_out, r.nights, TYPES[r.type], r.rate.toFixed(2), r.amount.toFixed(2), r.paid ? "Sim" : "Não"]);
    const blob = new Blob(["\ufeff" + lines.map((l) => l.map(esc).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cobranca-${fmtDate(state.blMonth).slice(0, 7)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
}
