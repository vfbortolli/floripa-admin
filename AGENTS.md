# Casa de Praia – guia do projeto (para IAs e mantenedores)

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
| `index.html` | Estrutura. Views (`<main>`): `inventory`, `people`, `agenda`, `rates`, `billing`, `finance`, `history`. Diálogo `#res-dialog` (reserva). |
| `app.js` | Toda a lógica do cliente (ver mapa abaixo). |
| `style.css` | Design (variáveis, componentes, calendário, `@media (max-width: 760px)` para celular). |
| `config.js` | URL e chave publishable do Supabase. |
| `supabase/phase2f.sql` | Restringe a leitura de e-mails e tarifas; executar após `phase2e.sql`. |
| `supabase/phase2g.sql` | Cria tabelas, permissões e RPC do Financeiro; executar após `phase2f.sql`. |
| `supabase/phase2h.sql` | Define o valor anual das mensalidades; executar após `phase2g.sql`. |
| `supabase/schema.sql` | Fase 1: tabelas, funções de permissão, policies, seed. |
| `supabase/phase2a.sql` … `phase2e.sql` | Migrações incrementais, **rodadas manualmente no SQL Editor, em ordem**. Idempotentes. |
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
- Financeiro (`phase2g.sql` e `phase2h.sql`): `finance_categories` (categorias de receitas/despesas), `finance_membership_rates` (valor padrão da mensalidade por ano), `finance_memberships` (previsto/recebido por família e mês), `finance_transactions` (lançamentos avulsos) e `finance_daily_adjustments` (ajuste do total importado por família/mês). Todas as tabelas são exclusivas de admins via RLS; `get_finance_daily(ano)` calcula diárias mensais a partir das reservas confirmadas. O valor anual é usado como previsto para todas as famílias e meses; 2026 inicia em R$ 300.

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
- Admins: gerenciam Pessoas (não podem remover nem rebaixar a si mesmos), Valores, Cobrança, Financeiro, Histórico e Backup.

## Mapa do `app.js`
- Globais (`let`): `me`, `spaces`, `families`, `people`, `rates`, `current`, `monthRes`, `pendingRes`, `agRoom`, `agMonth`, `blRows` etc.
- `init()`: carrega sessão, `allowed_users`, spaces/families, RPCs `list_people`/`get_rates`; `renderNav()`; abre a Agenda. `onAuthStateChange` (fim do arquivo) só reinicia se o usuário mudou (evita recarga ao focar a aba).
- `renderNav`, `setView`, `setActive`, `canEdit(space)`.
- Inventário: `selectSpace`, `loadItems`, import CSV.
- Pessoas: `showPeople`, `loadPeople`. Valores: `showRates`. Backup: botão `btn-backup` (RPC `export_backup`).
- Agenda: `showAgenda`, `renderRoomChips` (um quarto por vez), `loadMonth`, `loadPending`, `renderGantt` (calendário mensal em grade; barras do meio do dia de entrada ao meio do dia de saída), `renderResList`, `renderPendingList`.
- Reserva: `openReservation`, `refreshForm`, `addGuest`, submit de `#res-form` (insere/atualiza reserva e sincroniza guests; **não é transacional**), `resolveReservation` (aprovar/recusar).
- Cobrança: `showBilling`, `loadBilling`, `renderBilling`, export CSV. Histórico: `showHistory`, `loadHistory`, `hsText`.
- Financeiro: `showFinance`, `loadFinance`, `renderFinance`, detalhes mensais de mensalidades/diárias e gestão de lançamentos/categorias.

## Convenções e armadilhas
- Execute a `phase2f.sql` após `phase2e.sql` antes de publicar a versão de `app.js` que usa as permissões de privacidade atualizadas.
- Execute `phase2g.sql` após `phase2f.sql` antes de usar/publicar o módulo Financeiro.
- Execute `phase2h.sql` após `phase2g.sql` antes de usar/publicar o padrão anual de mensalidades.
- Datas como `YYYY-MM-DD`; usar `parseDate`/`fmtDate` (evitam bug de fuso). Valores em BRL via `money()`.
- Texto vindo do banco entra com `textContent` (nunca `innerHTML`).
- Mudou o banco? Criar novo `supabase/phaseX.sql` idempotente e avisar o usuário para rodá-lo; **não publicar JS que dependa de SQL ainda não executado sem avisar**.
- Testes visuais: Playwright em Node com `supabase-js` interceptado e dados simulados (o navegador integrado do VS Code tem viewport minúsculo). Não há suíte de testes automatizados.
- `.layout` precisa de `align-items: stretch` para o conteúdo não alargar a página no celular.
- Commits terminam com `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## Estado atual
Os módulos existentes estão publicados. O módulo Financeiro depende da execução manual das migrações `phase2g.sql` e `phase2h.sql` no Supabase antes de ser usado/publicado. O fluxo de aprovação e os módulos de cobrança, backup e histórico foram verificados só visualmente com dados simulados, **sem teste com outras contas reais**.

## Pendências / ideias
- Cadastrar responsáveis das outras famílias e demais admins (usuário ainda não tem os e-mails).
- No Supabase: provedor Email ativo e Site URL/Redirect URLs (`https://vfbortolli.github.io/floripa-admin/`, `http://localhost:8080`); confirmar execução do keep-alive.
- Importar inventário dos outros espaços (se houver planilhas).
- Ideias: aviso por e-mail ao responsável, PWA (instalar no celular), login com Google, lista de itens que precisam de reparo, botão de importar backup (hoje a restauração é por prompt no README).
