import { state, setState } from "../app-state.js";
import { show, say, setView, setActive } from "./ui.js";
import { money, fmtDate, parseDate, nightsBetween, brDate, personName, reservableRooms, roomById, whatsappUrl, TYPES } from "./utils.js";
import { $ } from "./dom.js";
import { getDb, uploadPaymentProof, cleanupUnlinkedPaymentProof } from "./db.js";
import { canEdit } from "./auth.js";

const canApprove = (room) => !!room && room.kind === "personal" && (state.me.is_admin || canEdit(room));
const canManage = (r) => state.me.is_admin || state.myReservationIds.has(r.id);
const autoConfirm = (room) => room.kind === "common" || state.me.is_admin || canEdit(room);
const statusFor = (room, existing) =>
  room.kind === "common" ? "confirmed" : existing?.status === "pending" ? "pending" : autoConfirm(room) ? "confirmed" : "pending";

const chargeRate = (g) => {
  const c = Array.isArray(g.guest_charges) ? g.guest_charges[0] : g.guest_charges;
  return c ? Number(c.rate) : null;
};

export function renderRoomChips() {
  const box = $("ag-rooms");
  box.innerHTML = "";
  for (const room of reservableRooms()) {
    const b = document.createElement("button");
    b.className = "chip" + (room.id === state.agRoom ? " active" : "") + (room.kind === "personal" ? " personal" : "");
    b.textContent = room.name;
    const n = canApprove(room) ? state.pendingRes.filter((r) => r.status === "pending" && r.space_id === room.id).length : 0;
    if (n) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = n;
      b.append(badge);
    }
    b.onclick = () => { setState("agRoom", room.id); renderRoomChips(); renderGantt(); renderResList(); };
    box.append(b);
  }
}

export async function showAgenda() {
  if (!reservableRooms().some((r) => r.id === state.agRoom)) setState("agRoom", reservableRooms()[0]?.id ?? null);
  renderRoomChips();
  setState("current", null);
  setView("agenda");
  setActive((b) => b.dataset.agendaRoom
    ? Number(b.dataset.agendaRoom) === state.agRoom
    : b.id === "nav-agenda" && !state.agRoom);
  if (!(await loadMyReservationIds())) return;
  await Promise.all([loadMonth(), loadPending()]);
}

export async function loadMyReservationIds() {
  const db = getDb();
  const { data, error } = await db.rpc("my_reservation_ids");
  if (error) {
    say("agenda-msg", error.message);
    return false;
  }
  setState("myReservationIds", new Set((data ?? []).map((row) => row.id)));
  return true;
}

export async function loadPending() {
  const db = getDb();
  const { data, error } = await db.from("reservations")
    .select("id, space_id, check_in, check_out, kind, status, note, created_at, created_by_name, reservation_guests(id, reservation_id, name, type, exempt, guest_charges(rate))")
    .in("status", ["pending", "rejected"])
    .gte("check_out", fmtDate(new Date()))
    .order("check_in");
  if (error) return say("agenda-msg", error.message);
  const pendingRes = data.filter((r) => r.status === "pending" || state.myReservationIds.has(r.id));
  setState("pendingRes", pendingRes);
  const todo = pendingRes.filter((r) => r.status === "pending" && canApprove(roomById(r.space_id))).length;
  const agendaCount = $("nav-agenda-count");
  agendaCount.textContent = todo;
  agendaCount.classList.toggle("hidden", !todo);
  renderRoomChips();
  renderPendingList();
}

export function renderPendingList() {
  const box = $("pending-list");
  box.innerHTML = "";
  show("pending-wrap", state.pendingRes.length > 0);
  for (const r of state.pendingRes) {
    const room = roomById(r.space_id);
    const card = document.createElement("div");
    card.className = "res-card";
    const head = document.createElement("div");
    head.className = "res-head";
    const title = document.createElement("b");
    title.textContent = `${room?.name ?? "?"} · ${brDate(r.check_in)} → ${brDate(r.check_out)}`;
    const tag = document.createElement("span");
    tag.className = "tag " + (r.status === "pending" ? "reparo" : "inutilizavel");
    tag.textContent = r.status === "pending" ? (canApprove(room) ? "Aguardando você" : "Pendente") : "Recusada";
    head.append(title, tag);
    const body = document.createElement("div");
    body.className = "res-body";
    body.textContent = r.reservation_guests.map((g) => g.name).join(", ") + ` · por ${r.created_by_name || "Pessoa cadastrada"}`;
    card.append(head, body);
    card.onclick = () => openReservation(r, {});
    box.append(card);
  }
}

export async function loadMonth() {
  const db = getDb();
  const y = state.agMonth.getFullYear(), m = state.agMonth.getMonth();
  $("ag-label").textContent = state.agMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const { data, error } = await db.from("reservations")
    .select("id, space_id, check_in, check_out, kind, status, note, created_at, created_by_name, reservation_guests(id, reservation_id, name, type, exempt, guest_charges(rate))")
    .eq("status", "confirmed")
    .lt("check_in", fmtDate(new Date(y, m + 1, 1)))
    .gt("check_out", fmtDate(new Date(y, m, 1)))
    .order("check_in");
  if (error) return say("agenda-msg", error.message);
  say("agenda-msg", "");
  setState("monthRes", data);
  renderGantt();
  renderResList();
}

export function barLabel(r) {
  if (r.kind === "block") return "Aluguel";
  const names = r.reservation_guests.map((g) => g.name.split(" ")[0]);
  return names.length ? names.join(", ") : r.created_by_name || "Reserva";
}

export function renderGantt() {
  const y = state.agMonth.getFullYear(), m = state.agMonth.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const today = fmtDate(new Date());
  const el = $("gantt");
  el.innerHTML = "";
  const div = (cls, text) => { const d = document.createElement("div"); d.className = cls; if (text != null) d.textContent = text; return d; };
  const room = state.spaces.find((s) => s.id === state.agRoom);
  if (!room) return;
  const list = state.monthRes.filter((x) => x.space_id === room.id);

  const head = div("cal-head");
  for (const n of ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]) head.append(div("", n));
  el.append(head);

  const start = new Date(y, m, 1 - first.getDay());
  for (let ws = new Date(start); ws <= last; ws.setDate(ws.getDate() + 7)) {
    const week = div("cal-week");
    const wsDate = new Date(ws);
    for (let k = 0; k < 7; k++) {
      const date = new Date(wsDate.getFullYear(), wsDate.getMonth(), wsDate.getDate() + k);
      const out = date.getMonth() !== m;
      const cell = div("cal-day" + (out ? " out" : "") + (fmtDate(date) === today ? " today" : ""));
      cell.append(div("num", date.getDate()));
      cell.title = `${room.name} – ${date.toLocaleDateString("pt-BR")}`;
      if (!out) cell.onclick = () => openReservation(null, { space_id: room.id, check_in: fmtDate(date) });
      cell.style.gridColumn = `${2 * k + 1} / span 2`;
      cell.style.gridRow = "1 / span 2";
      week.append(cell);
    }
    const weekEnd = new Date(wsDate.getFullYear(), wsDate.getMonth(), wsDate.getDate() + 7);
    for (const r of list) {
      const inD = parseDate(r.check_in), outD = parseDate(r.check_out);
      if (inD >= weekEnd || outD < wsDate) continue;
      const s = inD < wsDate ? 1 : 2 * nightsBetween(fmtDate(wsDate), r.check_in) + 2;
      const e = outD >= weekEnd ? 15 : 2 * nightsBetween(fmtDate(wsDate), r.check_out) + 2;
      if (e <= s) continue;
      const bar = div("bar" + (r.kind === "block" ? " block" : "") + (state.myReservationIds.has(r.id) ? " mine" : "") + (inD < wsDate ? " cont-l" : "") + (outD >= weekEnd ? " cont-r" : ""), barLabel(r));
      bar.title = `${barLabel(r)} (${brDate(r.check_in)} → ${brDate(r.check_out)})`;
      bar.onclick = (ev) => { ev.stopPropagation(); openReservation(r); };
      bar.style.gridColumn = `${s} / ${e}`;
      bar.style.gridRow = "2";
      week.append(bar);
    }
    el.append(week);
  }
}

export function reservationTotal(r) {
  const nights = nightsBetween(r.check_in, r.check_out);
  let total = 0;
  for (const g of r.reservation_guests) {
    if (g.exempt) continue;
    const rate = chargeRate(g);
    if (rate == null) return null;
    total += rate * nights;
  }
  return total;
}

export function renderResList() {
  const box = $("res-list");
  box.innerHTML = "";
  const list = state.monthRes.filter((r) => r.space_id === state.agRoom);
  const room = state.spaces.find((s) => s.id === state.agRoom);
  const roomNumber = room?.name?.match(/\d+/)?.[0];
  
  const wrapper = document.createElement("div");
  wrapper.className = "res-list-wrapper";
  
  if (list.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Nenhuma reserva neste mês.";
    wrapper.append(empty);
  } else {
    for (const r of list) {
      const nights = nightsBetween(r.check_in, r.check_out);
      const card = document.createElement("div");
      card.className = "res-card";
      const head = document.createElement("div");
      head.className = "res-head";
      const title = document.createElement("b");
      title.textContent = `${brDate(r.check_in)} → ${brDate(r.check_out)}`;
      const tag = document.createElement("span");
      tag.className = "tag bom";
      tag.textContent = `${nights} ${nights === 1 ? "noite" : "noites"}`;
      head.append(title, tag);
      card.append(head);
      for (const g of r.reservation_guests) {
        const line = document.createElement("div");
        line.className = "res-line";
        const name = document.createElement("span");
        name.textContent = `${g.name} (${TYPES[g.type]})`;
        const rate = chargeRate(g);
        const charge = g.exempt ? "Isento" : rate ? money(rate * nights) : "—";
        const amt = document.createElement("b");
        amt.textContent = charge;
        line.append(name, amt);
        card.append(line);
      }
      const total = reservationTotal(r);
      if (total != null) {
        const footer = document.createElement("div");
        footer.className = "res-footer";
        footer.textContent = `Total: ${money(total)}`;
        card.append(footer);
      }
      card.onclick = () => openReservation(r);
      wrapper.append(card);
    }
  }

  const imagesByRoom = {
    "1": ["quarto-1.1.avif", "quarto-1.2.avif"],
    "2": ["quarto-2.1.avif"],
    "3": ["quarto-3.1.avif"],
  };
  const images = imagesByRoom[roomNumber] ?? [];
  if (images.length) {
    const container = document.createElement("div");
    container.className = "room-images-container";
    for (const imageName of images) {
      const image = document.createElement("img");
      image.src = `espacos/${imageName}`;
      image.className = "room-image";
      image.alt = `${room?.name} - Foto`;
      container.append(image);
    }
    wrapper.append(container);
  }

  box.replaceChildren(wrapper);
}

export function reservationWhatsAppMessage(room, checkIn, checkOut) {
  const nights = nightsBetween(checkIn, checkOut);
  return `Olá! Há uma solicitação de reserva aguardando sua aprovação:\n\n${room.name}\n${brDate(checkIn)} → ${brDate(checkOut)} (${nights} ${nights === 1 ? "noite" : "noites"})\n\nClique no link para aprovar ou recusar: ${location.href.replace(/[?#].*/,"")}`;
}

export function showReservationWhatsApp(targets, message, error) {
  const targetList = $("whatsapp-targets");
  const status = $("whatsapp-dialog-message");
  targetList.replaceChildren();

  if (error) {
    status.textContent = `A solicitação foi salva, mas não foi possível carregar os telefones. Execute supabase/phase2o.sql no Supabase. Detalhe: ${error}`;
  } else if (!targets.length) {
    status.textContent = "A solicitação foi salva, mas não há responsável com telefone cadastrado para receber a mensagem.";
  } else {
    let invalidPhones = 0;
    for (const target of targets) {
      const url = whatsappUrl(target.phone, message);
      if (!url) {
        invalidPhones++;
        continue;
      }

      const link = document.createElement("a");
      link.className = "btn whatsapp-link";
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `Abrir WhatsApp${target.name ? ` · ${target.name}` : ""}`;
      targetList.append(link);
    }

    status.textContent = targetList.childElementCount
      ? "Escolha um responsável. A mensagem ficará preenchida no WhatsApp; confirme o envio por lá."
      : "Nenhum telefone cadastrado está em um formato válido. Confira o DDI e o número na tela Pessoas.";
    if (invalidPhones && targetList.childElementCount) {
      status.textContent += " Alguns telefones precisam ser conferidos.";
    }
  }

  $("whatsapp-dialog").showModal();
}

export function openReservation(r, preset = {}) {
  setState("editing", r);
  setState("readOnly", !!r && !canManage(r));
  setState("removedIds", []);
  const isNew = !r;
  $("res-title").textContent = isNew ? "Nova reserva" : state.readOnly ? "Reserva" : "Editar reserva";
  const sel = $("r-space");
  sel.innerHTML = "";
  reservableRooms(state.spaces).forEach((s) => sel.append(new Option(s.name, s.id)));
  sel.value = r?.space_id ?? preset.space_id ?? reservableRooms(state.spaces)[0]?.id;
  $("r-in").value = r?.check_in ?? preset.check_in ?? "";
  $("r-out").value = r?.check_out ?? (preset.check_in ? fmtDate(new Date(parseDate(preset.check_in).getTime() + 864e5)) : "");
  $("r-note").value = r?.note ?? "";
  show("r-block-wrap", state.me.is_admin && !state.readOnly);
  $("r-block").checked = r?.kind === "block";
  const room0 = roomById(Number($("r-space").value));
  const st = $("r-status");
  const notes = {
    pending: "Solicitação pendente: não bloqueia o período até ser aprovada pelo responsável do quarto ou por um administrador.",
    rejected: "Solicitação recusada. Ao salvar, ela volta a ficar pendente.",
  };
  const msg = r && notes[r.status] ? notes[r.status] : "";
  st.textContent = msg;
  show("r-status", !!msg);
  show("r-approve", !!r && r.status === "pending" && canApprove(room0));
  show("r-reject", !!r && r.status === "pending" && canApprove(room0));
  setState("formGuests", (r?.reservation_guests ?? []).map((g) => ({
    id: g.id, name: g.name, type: g.type, exempt: g.exempt, rate: chargeRate(g),
  })));
  $("people-names").innerHTML = "";
  state.people.forEach((p) => $("people-names").append(new Option(p.name)));
  say("r-msg", "");
  show("r-delete", !isNew && !state.readOnly);
  show("r-save", !state.readOnly);
  show("g-add-row", !state.readOnly);
  for (const id of ["r-space", "r-in", "r-out", "r-note", "r-block"]) $(id).disabled = state.readOnly;
  refreshForm();
  setTimeout(() => $("res-dialog").showModal(), 10);
}

export function refreshForm() {
  const room = roomById(Number($("r-space").value));
  const needsApproval = !state.editing && room && !autoConfirm(room);
  $("res-title").textContent = state.editing ? (state.readOnly ? "Reserva" : "Editar reserva") : needsApproval ? "Solicitar reserva" : "Nova reserva";
  $("r-save").textContent = needsApproval ? "Enviar solicitação" : "Salvar";
  if (needsApproval) {
    $("r-status").textContent = "Este é um quarto pessoal: a reserva só vale depois de aprovada pelo responsável ou por um administrador.";
    show("r-status", true);
  } else if (!state.editing) show("r-status", false);
  const isPersonalRoom = room && room.kind === "personal";
  $("r-block").disabled = isPersonalRoom;
  if (isPersonalRoom) $("r-block").checked = false;
  const block = $("r-block").checked;
  show("r-guests-wrap", !block);
  const nights = $("r-in").value && $("r-out").value ? nightsBetween($("r-in").value, $("r-out").value) : 0;
  say("r-nights", nights > 0 ? `${nights} ${nights === 1 ? "noite" : "noites"}` : nights < 0 ? "A saída deve ser depois da entrada." : "");
  const box = $("r-guests");
  box.innerHTML = "";
  state.formGuests.forEach((g, i) => {
    const row = document.createElement("div");
    row.className = "guest-row";
    const name = document.createElement("span");
    name.className = "g-name";
    name.textContent = g.name;
    const type = document.createElement("select");
    Object.entries(TYPES).forEach(([k, v]) => type.append(new Option(v, k, false, k === g.type)));
    type.disabled = state.readOnly;
    type.onchange = () => { g.type = type.value; if (g.id) g.rate = null; refreshForm(); };
    const ex = document.createElement("label");
    ex.className = "check";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = g.exempt; cb.disabled = state.readOnly;
    cb.onchange = () => { g.exempt = cb.checked; refreshForm(); };
    ex.append(cb, " Isento");
    row.append(name, type, ex);
    if (!state.readOnly) {
      const del = document.createElement("button");
      del.type = "button"; del.className = "danger"; del.textContent = "✕";
      del.onclick = () => { if (g.id) state.removedIds.push(g.id); state.formGuests.splice(i, 1); refreshForm(); };
      row.append(del);
    }
    box.append(row);
  });
  const manage = !state.editing || canManage(state.editing);
  if (!manage || block || nights <= 0) return say("r-total", "");
  let total = 0, estimated = false;
  for (const g of state.formGuests) {
    if (g.exempt) continue;
    const stored = g.id && g.rate != null && !(state.editing && g.type !== state.editing.reservation_guests.find((x) => x.id === g.id)?.type);
    const rate = stored ? g.rate : state.rates[g.type];
    if (rate == null) return say("r-total", "");
    total += rate * nights;
    if (!stored) estimated = true;
  }
  say("r-total", `Total: ${money(total)}${estimated ? " (valores atuais)" : ""}`);
}

export function addGuest() {
  const name = $("g-name").value.trim();
  if (!name) return;
  const person = state.people.find((p) => p.name?.toLowerCase() === name.toLowerCase());
  state.formGuests.push({
    name: person?.name ?? name,
    type: $("g-type").value, exempt: $("g-exempt").checked,
  });
  $("g-name").value = "";
  $("g-exempt").checked = false;
  refreshForm();
}

export async function resolveReservation(approve) {
  const db = getDb();
  const id = state.editing.id;
  let { error } = approve
    ? await db.rpc("approve_reservation", { p_id: id, p_replace: false })
    : await db.rpc("reject_reservation", { p_id: id });
  if (error && approve && error.message.includes("CONFLITO")) {
    if (!state.me.is_admin) return say("r-msg", "Já existe reserva confirmada nesse período. Peça a um administrador para decidir.");
    if (!confirm("Já existe reserva confirmada nesse período.\n\nOK = substituir (a existente será recusada) e aprovar.\nCancelar = manter a existente.")) return;
    ({ error } = await db.rpc("approve_reservation", { p_id: id, p_replace: true }));
  }
  if (error) return say("r-msg", error.message);
  $("res-dialog").close();
  await loadAll();
}

const loadAll = async () => {
  if (!(await loadMyReservationIds())) return;
  await Promise.all([loadMonth(), loadPending()]);
};

export function setupAgendaListeners() {
  const db = getDb();
  $("g-add").onclick = addGuest;
  $("g-name").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addGuest(); } };
  $("g-name").onchange = () => {
    const name = $("g-name").value.trim().toLowerCase();
    $("g-type").value = state.people.some((p) => p.name?.toLowerCase() === name) ? "socio" : "convidado";
  };
  $("r-block").onchange = refreshForm;
  $("r-in").onchange = () => {
    const i = $("r-in").value;
    if (i && (!$("r-out").value || $("r-out").value <= i)) $("r-out").value = fmtDate(new Date(parseDate(i).getTime() + 864e5));
    refreshForm();
  };
  $("r-out").onchange = refreshForm;
  $("r-close").onclick = () => $("res-dialog").close();
  $("whatsapp-close").onclick = () => $("whatsapp-dialog").close();

  $("r-delete").onclick = async () => {
    if (!confirm("Cancelar esta reserva?")) return;
    const { error: delError } = await db.from("reservations").delete().eq("id", state.editing.id);
    if (error) return say("r-msg", error.code === "23503"
      ? "Não é possível excluir esta reserva porque há um comprovante vinculado a uma diária. Remova o vínculo financeiro antes."
      : error.message);
    $("res-dialog").close();
    await loadAll();
  };

  $("r-approve").onclick = () => resolveReservation(true);
  $("r-reject").onclick = () => { if (confirm("Recusar esta solicitação?")) resolveReservation(false); };
  $("r-space").onchange = refreshForm;

  $("res-form").onsubmit = async (e) => {
    e.preventDefault();
    if (state.readOnly) return;
    const block = $("r-block").checked;
    const check_in = $("r-in").value, check_out = $("r-out").value;
    if (nightsBetween(check_in, check_out) <= 0) return say("r-msg", "A saída deve ser depois da entrada.");
    if (!block && !state.formGuests.length) return say("r-msg", "Adicione ao menos uma pessoa.");
    const room = roomById(Number($("r-space").value));
    if (block && room.kind === "personal") return say("r-msg", "Quartos pessoais não podem ter reservas por plataforma.");
    const payload = {
      space_id: room.id, check_in, check_out,
      kind: block ? "block" : "stay", note: $("r-note").value.trim() || null, status: statusFor(room, state.editing),
    };
    $("r-save").disabled = true;
    try {
      let id;
      if (state.editing) {
        const { error } = await db.from("reservations").update(payload).eq("id", state.editing.id);
        if (error) throw error;
        id = state.editing.id;
      } else {
        const { data, error } = await db.from("reservations").insert({ ...payload, created_by: state.me.email }).select("id").single();
        if (error) throw error;
        id = data.id;
      }
      if (block) setState("removedIds", (state.editing?.reservation_guests ?? []).map((g) => g.id));
      if (state.removedIds.length) {
        const { error } = await db.from("reservation_guests").delete().in("id", state.removedIds);
        if (error) throw error;
      }
      const guests = block ? [] : state.formGuests;
      const fresh = guests.filter((g) => !g.id).map((g) => ({
        reservation_id: id, name: g.name, type: g.type, exempt: g.exempt,
      }));
      if (fresh.length) {
        const { error } = await db.from("reservation_guests").insert(fresh);
        if (error) throw error;
      }
      for (const g of guests.filter((x) => x.id)) {
        const { error } = await db.from("reservation_guests").update({ name: g.name, type: g.type, exempt: g.exempt }).eq("id", g.id);
        if (error) throw error;
      }

      const shouldNotify = !state.editing && payload.status === "pending" && room.kind === "personal";
      let whatsappTargets = [];
      let whatsappError = null;
      if (shouldNotify) {
        const { data, error } = await db.rpc("get_reservation_whatsapp_targets", { p_reservation_id: id });
        whatsappError = error?.message ?? null;
        whatsappTargets = data ?? [];
      }

      $("res-dialog").close();
      await loadAll();
      if (shouldNotify) {
        showReservationWhatsApp(whatsappTargets, reservationWhatsAppMessage(room, check_in, check_out), whatsappError);
      }
    } catch (err) {
      say("r-msg", err.code === "23P01"
        ? "Esse quarto já está reservado em parte desse período. Escolha outras datas."
        : err.code === "23503"
          ? "Não é possível remover hóspedes com comprovantes de diárias vinculados. Remova o vínculo financeiro antes."
          : err.message);
    } finally {
      $("r-save").disabled = false;
    }
  };

  // Listeners dos botões de navegação da agenda
  $("ag-prev").onclick = () => {
    setState("agMonth", new Date(state.agMonth.getFullYear(), state.agMonth.getMonth() - 1, 1));
    void loadMonth();
    renderGantt();
    renderResList();
  };

  $("ag-next").onclick = () => {
    setState("agMonth", new Date(state.agMonth.getFullYear(), state.agMonth.getMonth() + 1, 1));
    void loadMonth();
    renderGantt();
    renderResList();
  };

  $("ag-new").onclick = () => openReservation(null, { space_id: state.agRoom });
}
