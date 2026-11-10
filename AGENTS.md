# Casa dos Paulistas – guia do projeto (para IAs e mantenedores)

Sistema pequeno (≈10 usuários) para uma casa de praia familiar: inventário, agenda de diárias, valores e cobrança. Idioma da interface e do usuário: **português (pt-BR)**. Objetivo: custo zero de hospedagem.

## Stack e hospedagem
- Site estático, **HTML/JS/CSS puro, sem build**. `supabase-js@2` via CDN.
- Backend: **Supabase** (Postgres + Auth + RLS). Projeto `mdqaigczznohnxhjwrqa`. A chave publishable em `config.js` é pública de propósito; **a segurança está nas policies RLS**.
- Hospedagem: GitHub Pages (`main`, raiz) em https://vfbortolli.github.io/floripa-admin/. Push na `main` publica em ~1 min.
- Repositório **público**: nunca commitar backups (`backup-*.json` está no `.gitignore`), segredos ou dados pessoais.
- Keep-alive: `.github/workflows/keepalive.yml` chama a RPC `ping()` 2x/semana (secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY`) para o plano gratuito não pausar.
- Rodar local: `npx serve -l 8080 .` e abrir http://localhost:8080 (adicionar essa URL nas Redirect URLs do Supabase).

## Arquivos
| Arquivo | Conteúdo |
|---|---|
| `index.html` | Estrutura. Views (`<main>`): `inventory`, `people`, `agenda`, `rates`, `billing`, `dashboard`, `finance`, `history`. Diálogos `#res-dialog` (reserva) e `#whatsapp-dialog`. Carrega `app/app.js` como módulo ES. |
| `style.css` | Design (variáveis, componentes, calendário, `@media (max-width: 760px)` para celular). |
| `config.js` | Expõe `window.APP_CONFIG` com `SUPABASE_URL` e `SUPABASE_ANON_KEY`. |
| `app/app.js` | Entry point: `init()`, listeners de auth/login/logout/backup. **Este é o único arquivo JS de entrada**; não há mais `app.js` na raiz. |
| `app/app-state.js` | Estado global compartilhado (`state`). Exporta `state`, `setState`, `updateState`. |
| `app/modules/db.js` | Cria e expõe o cliente Supabase (`createDbClient`, `getDb`). Operações de comprovantes (`uploadPaymentProof`, `deletePaymentProof`, `openPaymentProof`, etc.). |
| `app/modules/dom.js` | Helper `$(id)` para `document.getElementById`. |
| `app/modules/ui.js` | `show`, `say`, `setView`, `setActive`, `canManageFinance`. |
| `app/modules/utils.js` | Helpers puros: `fmtDate`, `parseDate`, `nightsBetween`, `brDate`, `money`, `personName`, `whatsappUrl`, `reservableRooms`, `roomById`, `TYPES`. |
| `app/modules/auth.js` | `showLogin`, `canEdit`, `logout`. |
| `app/modules/nav.js` | `renderNav(router)`: constrói a navegação lateral dinamicamente a partir de `state.spaces`. Recebe objeto `router` de `app.js` com as funções de navegação, eliminando imports diretos de views. |
| `app/modules/inventory.js` | `selectSpace`, `loadItems`, `renderItems`, `parseCsv`, `setupInventoryListeners`. |
| `app/modules/audit.js` | Helpers de formatação do histórico de auditoria: `HS_TABLES`, `hsValue`, `hsText`. |
| `app/modules/people.js` | `showPeople`, `loadPeople`, `setupPeopleListeners`. |
| `app/modules/rates.js` | `showRates`, `displayRates`, `setupRatesListeners`. |
| `app/modules/history.js` | `showHistory`, `loadHistory`, `setupHistoryListeners`. |
| `app/modules/agenda.js` | `showAgenda`, `renderRoomChips`, `loadMonth`, `loadPending`, `renderGantt`, `renderResList`, `renderPendingList`, `openReservation`, `resolveReservation`, `setupAgendaListeners`. |
| `app/modules/billing.js` | `showBilling`, `loadBilling`, `renderBilling`, `setupBillingListeners`. |
| `app/modules/finance.js` | `showFinance`, `showFinanceDashboard`, `loadFinance`, `renderFinanceDashboard`, `renderFinanceDetails`, `renderFinanceCategories`, `updateFinanceCategoryOptions`, `setupFinanceListeners`. |
| `supabase/schema.sql` | Fase 1: tabelas, funções de permissão, policies, seed. |
| `supabase/phase2a.sql` … `phase2e.sql` | Migrações incrementais, **rodadas manualmente no SQL Editor, em ordem**. Idempotentes. |
| `supabase/phase2f.sql` | Restringe a leitura de e-mails e tarifas; executar após `phase2e.sql`. |
| `supabase/phase2g.sql` | Cria tabelas, permissões e RPC do Financeiro; executar após `phase2f.sql`. |
| `supabase/phase2h.sql` | Define o valor anual das mensalidades; executar após `phase2g.sql`. |
| `supabase/phase2i.sql` … `phase2j.sql` | Ajustes de contabilização de diárias; `phase2k.sql` depende de `phase2j.sql`. |
| `supabase/phase2k.sql` | Cria bucket privado e vínculos de comprovantes para mensalidades e diárias; executar após `phase2j.sql`. |
| `supabase/phase2l.sql` | Libera leitura do Financeiro a usuários autorizados e mantém edição/comprovantes restritos a admins; executar após `phase2k.sql`. |
| `supabase/phase2m.sql` | Adiciona campo `phone` a `allowed_users`. |
| `supabase/phase2o.sql` | RPC `get_reservation_whatsapp_targets` para contatos do responsável de uma reserva pendente. |
| `supabase/phase2p.sql` | Permite descrição em branco em lançamentos de "Outras receitas e despesas". |
| `supabase/phase2q.sql` | RPC `get_membership_whatsapp_targets` para lembretes de mensalidade. |
| `quarto-bortolli.csv` | Inventário do Quarto Bortolli (34 itens, já importado). |
| `README.md` | Configuração e restauração de backup. |

## Modelo de dados (Postgres)
- `families` (id, name): Bortolli, Carneiro, Della Rovere, Nigro, Marcia.
- `spaces` (id, name, kind `common|personal`, family_id, sort, `reservable`): casa comunitária = Quarto 1–3, Banheiro 1–2, Cozinha, Sala, Lavabo externo. Quartos pessoais = um por família. Só Quarto 1–3 e os pessoais têm `reservable = true`.
- `allowed_users` (email pk minúsculo, name, is_admin, family_id, is_responsible): **lista de quem pode entrar**. Gerenciada na aba Pessoas.
- `items` (space_id, description, quantity, condition `bom|reparo|inutilizavel`, notes).
- `settings` (key, value): `rate_socio` = 30, `rate_convidado` = 50 (por pessoa por noite).
- `reservations` (space_id, check_in, check_out, kind `stay|block`, status `confirmed|pending|rejected`, created_by email, note). Constraint `no_overlap` (btree_gist): sem sobreposição de `daterange(check_in, check_out)` por espaço **só entre `confirmed`**. Erro de conflito = código `23P01`.
- `reservation_guests` (reservation_id, name, user_email, type `socio|convidado`, exempt).
- `guest_charges` (guest_id pk, rate, paid, paid_at): valor/noite **congelado na criação** pelo trigger `set_guest_charge` (recalcula se o tipo mudar). Legível só por dono da reserva e admins; só admin altera `paid`.
- `audit_log` (at, actor, tbl, op, row_id, label, old_data, new_data): preenchido por triggers de auditoria nas tabelas operacionais e financeiras. Leitura só admin.
- Financeiro (`phase2g.sql`–`phase2l.sql`): `finance_categories` (categorias de receitas/despesas), `finance_membership_rates` (valor padrão da mensalidade por ano), `finance_memberships` (previsto/recebido por família e mês), `finance_transactions` (lançamentos avulsos) e `finance_daily_adjustments` (ajuste do total importado por família/mês). Após `phase2l.sql`, usuários autorizados podem ler os dados financeiros; somente admins podem alterar, e comprovantes continuam exclusivos de admins. `get_finance_daily(ano)` calcula diárias mensais a partir das reservas confirmadas. O valor anual é usado como previsto para todas as famílias e meses; 2026 inicia em R$ 300.
- Comprovantes (`phase2k.sql`): bucket privado `payment-proofs` (PDF/JPG/PNG, até 10 MB), acessível somente a admins. `payment_receipts` guarda metadados; `payment_receipt_memberships` permite vários comprovantes por mensalidade; `payment_receipt_guest_charges` permite um comprovante para várias cobranças de diárias. Novas baixas são bloqueadas no banco sem comprovante associado. O backup JSON inclui metadados e vínculos, não os arquivos do Storage.

## Funções SQL (security definer)
`is_allowed()`, `is_admin()`, `can_edit_space(sp)`, `can_manage_reservation(rid)`, `is_reservable_common(sp)`, `is_reservable_personal(sp)`, `me_email()`, `list_people()`, `get_rates()`, `approve_reservation(id, replace)`, `reject_reservation(id)`, `export_backup()` (admin), `ping()`.

## Regras de negócio (decididas com o usuário)
- **Acesso:** só e-mails em `allowed_users`. Login por link mágico por e-mail (Google OAuth opcional, não configurado). Todos veem tudo; valores só para dono da reserva e admins.
- **Inventário:** responsáveis editam o quarto da própria família; admins editam a casa comunitária.
- **Diárias:** contagem por **pernoite** (a noite da saída não ocupa). Valor = pessoas × noites × tarifa; `exempt` zera. Sócio R$ 30, convidado R$ 50. Reservas antigas mantêm a tarifa de quando foram criadas.
- **Quartos comunitários (1–3):** qualquer cadastrado reserva; confirma na hora se livre. Conflito é recusado pelo banco.
- **Aluguel por plataforma:** `kind = 'block'`, só admin, sem pessoas nem valores.
- **Quartos pessoais:** qualquer cadastrado **solicita** (`pending`, não bloqueia datas). O responsável da família dona ou um admin aprova/recusa. Responsável ou admin reservando já entra `confirmed`. Se há conflito com reserva confirmada, **só admin** decide: substituir (a existente vira `rejected`) ou recusar. Editar reserva em quarto pessoal por quem não é responsável/admin volta a `pending`.
- **Dono da reserva ou admin** edita/cancela.
- **Sem e-mails/notificações:** o status é visto dentro do sistema (seção "Solicitações de quartos pessoais" e contador na Agenda).
- Admins: gerenciam Pessoas (não podem remover nem rebaixar a si mesmos), Valores, Cobrança, Financeiro, Histórico e Backup. Todos os usuários autorizados podem consultar o Financeiro; apenas admins podem editar e acessar comprovantes.

## Arquitetura do cliente (módulos ES em `app/`)

O `index.html` carrega `app/app.js` como `<script type="module">`. Não há build nem bundler; o navegador resolve os imports nativamente.

### `app/app-state.js` — estado global
Objeto `state` único compartilhado entre todos os módulos. Campos principais:
- `me`: registro de `allowed_users` do usuário logado.
- `spaces`, `families`, `people`, `rates`: dados carregados no `init()`.
- `current`: espaço selecionado no inventário.
- Agenda: `agMonth`, `agRoom`, `monthRes`, `pendingRes`, `myReservationIds`.
- Cobrança: `blMonth`, `blRows`, `blSelected`, `blMembershipContacts`.
- Financeiro: `fnYear`, `fnMonth`, `fnCategories`, `fnMemberships`, `fnMembershipReceipts`, `fnMembershipRate`, `fnTransactions`, `fnDaily`, `fnDailyAdjustments`, `fnEditingTransaction`.
- Histórico: `hsRows`.
- Formulário de reserva: `editing`, `formGuests`, `removedIds`, `readOnly`.

Sempre usar `setState(key, value)` ou `updateState(patch)` para mutações; evitar atribuição direta em `state` fora do próprio módulo de estado.

### `app/app.js` — entry point
- `init()`: obtém sessão, valida e-mail em `allowed_users`, carrega `spaces`, `families`, `list_people`, `get_rates` em paralelo, chama `renderNav()` e abre a Agenda. Chama `setup*Listeners()` de cada módulo uma única vez.
- `onAuthStateChange`: reinicia só se o usuário mudou (evita recarga ao focar a aba); `SIGNED_OUT` → `location.reload()`.
- Listeners de `#btn-backup` (RPC `export_backup`), `#btn-google`, `#form-magic`, `#btn-logout`, `#btn-logout-denied`.

### `app/modules/nav.js` — navegação
`renderNav()` constrói a `<nav>` dinamicamente: grupos "Agenda", "Casa comunitária", "Quartos pessoais", "Financeiro" e (só admin) "Administração". Cada item de quarto chama `selectSpace`; cada item de view chama a função `show*` correspondente. O badge de pendências na Agenda é atualizado por `loadPending()` em `agenda.js`.

### `app/modules/agenda.js` — agenda e reservas
- `showAgenda`, `renderRoomChips`: seleciona quarto e renderiza chips com badges de pendências.
- `loadMonth`, `renderGantt`: calendário mensal em grade; barras vão do meio do dia de check-in ao meio do dia de check-out.
- `renderResList`: lista de reservas do mês do quarto selecionado.
- `loadPending`, `renderPendingList`: seção "Solicitações de quartos pessoais" (status `pending`/`rejected` futuros).
- `openReservation`, `refreshForm`, `addGuest`, submit de `#res-form`: cria/edita reserva e sincroniza `reservation_guests` (**não é transacional**).
- `resolveReservation`: aprovar (RPC `approve_reservation`) ou recusar (RPC `reject_reservation`).
- `setupAgendaListeners`: navegação de mês, chips, abertura de diálogo, botões de ação do formulário.
- Após criar reserva pendente em quarto pessoal de outra família, exibe `#whatsapp-dialog` com link `wa.me` por responsável (RPC `get_reservation_whatsapp_targets`, via `phase2o.sql`).

### `app/modules/billing.js` — cobrança
- `loadBilling`: busca reservas confirmadas com `check_out` no mês, mensalidades e comprovantes. Monta `state.blRows` com diárias e mensalidades.
- `renderBilling`: tabela de cobrança; seleção múltipla de diárias para vincular um comprovante; mensalidades com links WhatsApp para lembrete (RPC `get_membership_whatsapp_targets`, via `phase2q.sql`).
- Export CSV das diárias do mês.

### `app/modules/finance.js` — financeiro
- `loadFinance`: carrega categorias, mensalidades, taxa anual, lançamentos, diárias calculadas (`get_finance_daily`) e ajustes em paralelo.
- `renderFinanceDashboard`: painel anual (view `#dashboard`).
- `renderFinanceDetails`: detalhamento mensal de mensalidades, diárias e lançamentos (view `#finance`).
- `renderFinanceCategories`: CRUD de categorias (somente admins).
- Comprovantes de mensalidade: vários por mensalidade; visualização via URL assinada (1 min).

### `app/modules/people.js` — pessoas e helpers de histórico
- `showPeople`, `loadPeople`, `setupPeopleListeners`: CRUD de `allowed_users`. Admin não pode remover nem rebaixar a si mesmo.
- `hsText(r)`, `hsValue(field, v)`: formatam uma linha do `audit_log` em texto legível (usados também por `history.js`).

## Convenções e armadilhas

### SQL — migrações
- Execute as migrações em ordem antes de publicar o JS que dependa delas; nunca o contrário.
- Ordem obrigatória: `schema.sql` → `phase2a`→…→`phase2e` → `phase2f` → `phase2g` → `phase2h` → `phase2i` → `phase2j` → `phase2k` → `phase2l`. As migrações `phase2m`, `phase2o`, `phase2p`, `phase2q` são independentes entre si mas todas dependem de `phase2g` ou posterior.
- Mudou o banco? Criar novo `supabase/phaseX.sql` idempotente e avisar o usuário para rodá-lo; **não publicar JS que dependa de SQL ainda não executado sem avisar**.

### JS — módulos e estado
- O entry point é **somente** `app/app.js`. Não criar nem recriar `app.js` na raiz do projeto.
- Importar sempre por caminho relativo (`../app-state.js`, `./utils.js`). Não usar caminhos absolutos.
- Estado compartilhado vive em `app/app-state.js`. Usar `setState(key, value)` para escrever; evitar `state.x = y` diretamente fora de `app-state.js`.
- O cliente Supabase é criado uma vez em `createDbClient()` e acessado nos módulos via `getDb()`. Nunca criar um segundo `createClient` num módulo.
- `getDb()` pode retornar `null` se chamado antes de `createDbClient()`. Isso só ocorreria se um módulo fosse importado antes do `init()`.

### HTML/DOM
- Texto vindo do banco entra com `textContent` (nunca `innerHTML`).
- Datas como `YYYY-MM-DD`; usar `parseDate`/`fmtDate` de `utils.js` (evitam bug de fuso horário). Valores em BRL via `money()`.
- `.layout` precisa de `align-items: stretch` para o conteúdo não alargar a página no celular.

### Testes e validação
- Não há suíte de testes automatizados. Validação é visual: `npx serve -l 8080 .` e testar no navegador.
- Testes com Playwright em Node são possíveis com `supabase-js` interceptado e dados simulados, mas o navegador integrado do VS Code tem viewport minúsculo — preferir o navegador do sistema.

### Commits
- Terminam com `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## Estado atual

### Publicação e migrações
Todos os módulos estão publicados. As funcionalidades ativas dependem das seguintes migrações já aplicadas no Supabase: `schema.sql` + `phase2a`–`phase2l` + `phase2m` + `phase2o` + `phase2p` + `phase2q`. O fluxo de aprovação e os módulos de cobrança, backup e histórico foram verificados só visualmente com dados simulados, **sem teste com outras contas reais**.

### Arquitetura do cliente
- ✅ **Modularização concluída**: `app.js` raiz (arquivo legado monolítico) foi removido. O código vive exclusivamente em `app/app.js` e `app/modules/*.js`.
- ⚠️ **Dívidas técnicas conhecidas** (a corrigir oportunisticamente):
  - `rates.js` ainda muta `state.fnYear` diretamente (`state.fnYear = year`) em vez de usar `setState`.
  - `agenda.js` (~24 KB) concentra renderização do Gantt, formulário de reserva e lista de pendências — candidato a ser dividido futuramente.
  - `finance.js` (~28 KB) concentra painel, detalhamento e categorias — candidato a ser dividido futuramente.

## Pendências / ideias
- Cadastrar responsáveis das outras famílias e demais admins (usuário ainda não tem os e-mails).
- No Supabase: confirmar que provedor Email está ativo, Site URL e Redirect URLs configurados (`https://vfbortolli.github.io/floripa-admin/`, `http://localhost:8080`) e keep-alive funcionando.
- Importar inventário dos outros espaços (se houver planilhas).
- Arquitetura — próximos passos sugeridos (em ordem de impacto/risco):
  1. ~~Corrigir mutações diretas em `state`~~ ✅ concluído.
  2. ~~Desacoplar `nav.js` recebendo callbacks de roteamento em vez de importar as views~~ ✅ concluído.
  3. Dividir `agenda.js` em `agenda/index.js`, `agenda/gantt.js`, `agenda/reservation-form.js`, `agenda/pending.js`.
  4. Dividir `finance.js` em `finance/index.js`, `finance/dashboard.js`, `finance/details.js`.
- Ideias de produto: aviso por e-mail ao responsável, PWA (instalar no celular), login com Google, lista de itens que precisam de reparo, botão de importar backup (hoje a restauração é por prompt no README).
