// app-state.js - Gerenciaestado compartilhado global
export const state = {
  me: null,
  spaces: [],
  families: [],
  people: [],
  rates: {},
  current: null,
  inventoryItems: [],
  myReservationIds: new Set(),
  
  // Agenda
  agMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  monthRes: [],
  pendingRes: [],
  agRoom: null,
  
  // Cobrança
  blMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  blRows: [],
  blSelected: new Set(),
  blMembershipContacts: new Map(),
  blWhatsAppError: null,
  
  // Financeiro
  fnYear: new Date().getFullYear(),
  fnMonth: new Date().getMonth(),
  fnCategories: [],
  fnMemberships: [],
  fnMembershipReceipts: new Map(),
  fnMembershipRate: null,
  fnTransactions: [],
  fnDaily: [],
  fnDailyAdjustments: [],
  
  // Histórico
  hsRows: [],
  
  // Formulário de reserva
  editing: null,
  formGuests: [],
  removedIds: [],
  readOnly: false,
};

// Getters e setters para melhor legibilidade
export const getState = (key) => state[key];
export const setState = (key, value) => { state[key] = value; };
export const updateState = (updates) => Object.assign(state, updates);
