-- Fase 2 (etapa P): torna opcional a descrição de outras receitas e despesas.
-- Execute antes de publicar a versão com o campo de descrição não obrigatório.
-- Execute em: Supabase > SQL Editor > New query > Run

alter table finance_transactions drop constraint if exists finance_transactions_description_check;
alter table finance_transactions alter column description drop not null;
