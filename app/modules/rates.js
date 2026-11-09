// modules/rates.js - Gerenciamento de tarifas (sócio e convidado)
import { state } from "../app-state.js";
import { show, say, setView, setActive } from "./ui.js";
import { $ } from "./dom.js";
import { getDb } from "./db.js";

export async function showRates() {
  state.current = null;
  setView("rates");
  setActive((b) => b.id === "nav-rates");
  say("rates-msg", "");
  const year = new Date().getFullYear();
  $("r-year").value = year;
  await displayRates(year);
}

export async function displayRates(year) {
  const db = getDb();
  state.fnYear = year;
  $("fn-membership-rate-year").textContent = String(year);
  $("r-socio").value = state.rates.socio ?? "";
  $("r-convidado").value = state.rates.convidado ?? "";
  const { data, error } = await db.from("finance_membership_rates")
    .select("amount").eq("year", year).maybeSingle();
  if (error) return say("rates-msg", error.message);
  $("fn-membership-rate").value = data?.amount ?? "";
  say("rates-msg", "");
}

export const setupRatesListeners = () => {
  const db = getDb();
  $("r-load").onclick = async () => {
    const year = Number($("r-year").value);
    if (!Number.isInteger(year) || year < 1900 || year > 9998) {
      return say("rates-msg", "Informe um ano entre 1900 e 9998.");
    }
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
    state.rates = { socio, convidado };
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
    state.fnYear = year;
    await displayRates(year);
    say("rates-msg", `Mensalidade padrão de ${year} salva.`);
  };
};
