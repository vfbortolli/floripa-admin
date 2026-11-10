// modules/audit.js - Helpers de formatação do histórico de auditoria
import { state } from "../app-state.js";
import { roomById } from "./utils.js";

export const HS_TABLES = {
  items: "Item", reservations: "Reserva", reservation_guests: "Pessoa da reserva",
  allowed_users: "Pessoa", settings: "Valor", guest_charges: "Cobrança",
  finance_categories: "Categoria financeira", finance_memberships: "Mensalidade",
  finance_membership_rates: "Valor anual da mensalidade",
  finance_transactions: "Lançamento financeiro", finance_daily_adjustments: "Ajuste de diárias",
};

const HS_FIELDS = {
  description: "descrição", quantity: "quantidade", condition: "estado", notes: "observações",
  space_id: "quarto", check_in: "entrada", check_out: "saída", kind: "tipo", status: "situação", note: "observação",
  name: "nome", type: "tipo", exempt: "isento", is_admin: "admin", is_responsible: "responsável",
  family_id: "família", value: "valor", paid: "pago", user_email: "e-mail", rate: "valor/noite",
  active: "ativa", period_month: "mês", year: "ano", expected_amount: "previsto", received_amount: "recebido",
  paid_at: "data do pagamento", category_id: "categoria", transaction_date: "data", amount: "valor",
};

const HS_VALUES = {
  bom: "Bom", reparo: "Precisa de reparo", inutilizavel: "Inutilizável",
  socio: "Sócio", convidado: "Convidado", confirmed: "Confirmada", pending: "Pendente", rejected: "Recusada",
  stay: "Estadia", block: "Bloqueio",
  income: "Receita", expense: "Despesa",
};

export function hsValue(field, v) {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (field === "space_id") return roomById(v)?.name ?? v;
  if (field === "family_id") return state.families.find((f) => f.id === v)?.name ?? v;
  return HS_VALUES[v] ?? v;
}

export function hsText(r) {
  const op = { INSERT: "criou", UPDATE: "alterou", DELETE: "removeu" }[r.op];
  const head = `${op} ${HS_TABLES[r.tbl]?.toLowerCase() ?? r.tbl} "${r.label ?? r.row_id ?? ""}"`;
  if (r.op !== "UPDATE") return head;
  const changes = Object.keys(r.new_data ?? {}).map(
    (k) => `${HS_FIELDS[k] ?? k}: ${hsValue(k, r.old_data?.[k])} → ${hsValue(k, r.new_data[k])}`);
  return `${head} (${changes.join("; ")})`;
}
