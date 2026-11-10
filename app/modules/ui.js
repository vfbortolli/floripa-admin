// modules/ui.js - Helpers de UI generais
import { state } from "../app-state.js";

const $ = (id) => document.getElementById(id);

export const show = (id, on) => $(id).classList.toggle("hidden", !on);
export const say = (id, text) => { $(id).textContent = text || ""; };
export const canManageFinance = () => Boolean(state.me?.is_admin);

export const setView = (name) => {
  const VIEWS = ["inventory", "people", "agenda", "rates", "billing", "dashboard", "finance", "finance-admin", "history"];
  VIEWS.forEach((v) => show(v, v === name));
};

export const setActive = (match) => {
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", match(b)));
  document.querySelectorAll("nav .nav-group").forEach((group) =>
    group.classList.toggle("has-active", !!group.querySelector(".nav-item.active")));
};

export const VIEWS = ["inventory", "people", "agenda", "rates", "billing", "dashboard", "finance", "finance-admin", "history"];
