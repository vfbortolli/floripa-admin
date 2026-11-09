// modules/auth.js - Autenticação e gerenciamento de permissões
import { state, setState } from "../app-state.js";
import { show, say, setView, setActive, VIEWS } from "./ui.js";
import { $ } from "./dom.js";

export const showLogin = () => {
  show("app", false);
  show("denied", false);
  show("login", true);
};

export const canEdit = (space) => {
  if (!state.me || !space) return false;
  if (space.kind === "common") return state.me.is_admin;
  return state.me.is_responsible && state.me.family_id === space.family_id;
};

export const logout = async (db) => {
  await db.auth.signOut();
  location.reload();
};
