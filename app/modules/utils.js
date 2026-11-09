// modules/utils.js - Helpers de data, formatação e conversão
import { state } from "../app-state.js";

const pad = (n) => String(n).padStart(2, "0");

export const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDate = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const nightsBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);
export const brDate = (s) => parseDate(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
export const money = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const personName = (email) => state.people.find((p) => p.email === email)?.name || email;

export const TYPES = { socio: "Sócio", convidado: "Convidado" };

export const reservableRooms = () => state.spaces.filter((s) => s.reservable);
export const roomById = (id) => state.spaces.find((s) => s.id === id);
