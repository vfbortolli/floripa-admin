# Floripa Admin – Inventário da casa de praia

Site estático (HTML/JS) + Supabase (banco e login). Custo zero.

## Configuração
1. Supabase > SQL Editor: cole e execute [supabase/schema.sql](supabase/schema.sql).
2. Supabase > Authentication > Providers: habilite **Email** (link mágico) e **Google**.
3. Supabase > Authentication > URL Configuration: defina **Site URL** e adicione a URL do site (e `http://localhost:8080`) em Redirect URLs.
4. Supabase > Project Settings > API: copie a **Project URL** e a chave **anon public** para [config.js](config.js).
5. Teste local: `npx serve -l 8080 .` e abra http://localhost:8080.
6. Entre como vfbortolli@gmail.com, abra "Quarto Bortolli" e use **Importar CSV** com [quarto-bortolli.csv](quarto-bortolli.csv).

## Autorizar mais pessoas
Use **Administração > Pessoas** no app (só administradores).

## Agenda e valores (Fase 2, etapa A)
Execute [supabase/phase2a.sql](supabase/phase2a.sql) no SQL Editor. Cria reservas, pessoas por reserva, valores e regras de acesso. Os valores (padrão R$ 30 sócio / R$ 50 convidado) são editados em **Administração > Valores**.

## Quartos pessoais e aprovações (Fase 2, etapa B)
Depois, execute [supabase/phase2b.sql](supabase/phase2b.sql). Reservas em quartos pessoais ficam pendentes (sem bloquear datas) até o responsável da família ou um administrador aprovar. Em caso de conflito com uma reserva confirmada, só um administrador pode substituí-la.

## Cobrança e backup
Rode [supabase/phase2c.sql](supabase/phase2c.sql) (marcar como pago) e [supabase/phase2d.sql](supabase/phase2d.sql) (backup). A tela **Cobrança** e o botão **Baixar backup** (em Pessoas) são só para administradores. Guarde o JSON em local privado: ele contém e-mails.

## Privacidade de e-mails e tarifas
Execute [supabase/phase2e.sql](supabase/phase2e.sql) (histórico) e depois [supabase/phase2f.sql](supabase/phase2f.sql). A migração limita a RPC de pessoas para que cada usuário veja apenas o próprio e-mail (administradores veem todos), remove e-mails de criadores e participantes das leituras disponíveis ao navegador, e restringe a leitura das tarifas aos administradores. Agenda e inventário continuam visíveis a todos os cadastrados; os valores de cobranças seguem visíveis somente ao dono da reserva e aos administradores.

Esta migração deve ser aplicada no Supabase antes de publicar a versão atualizada do `app.js`, pois a interface passa a usar a nova RPC e as colunas permitidas. O esquema e os nomes das tabelas ainda podem ser inspecionados publicamente; a proteção dos dados depende das policies e privilégios do banco.

## Financeiro
Execute [supabase/phase2g.sql](supabase/phase2g.sql) depois de `phase2f.sql`, [supabase/phase2h.sql](supabase/phase2h.sql) depois de `phase2g.sql`, [supabase/phase2i.sql](supabase/phase2i.sql) depois de `phase2h.sql` e [supabase/phase2j.sql](supabase/phase2j.sql) depois de `phase2i.sql`, antes de usar a versão atualizada da área **Administração > Financeiro**. O módulo é exclusivo para administradores e oferece resumo anual recolhido nos totais de receitas, despesas e balanço (clique nos totais de receitas/despesas para abrir ou recolher os itens), além de seções expansíveis para o detalhe do mês, mensalidades, diárias, lançamentos e categorias.

O valor previsto da mensalidade é definido uma vez por ano e vale para cada família em todos os meses daquele ano. A migração inicializa 2026 com R$ 300; outros anos podem ter um valor próprio informado na tela. O recebido e a data de pagamento continuam registrados por família e mês. As diárias são calculadas por noite a partir de reservas confirmadas, e o valor total de cada reserva é contabilizado no mês da saída. Cada reserva é atribuída integralmente a uma família: se quem criou a reserva está entre os hóspedes e tem família cadastrada, essa família é priorizada; caso contrário, usa-se a família do primeiro hóspede com família cadastrada. Se nenhum hóspede tiver família identificável, usa-se a família de quem criou a reserva. Assim, todos os hóspedes não isentos da reserva são contabilizados juntos na mesma família. A família do quarto não é usada como alternativa. A migração `phase2i.sql` recalcula a atribuição por família e `phase2j.sql` coloca o total no mês da saída; se nem os hóspedes nem o criador tiverem família cadastrada, a diária continuará sem família atribuída. Um ajuste financeiro mensal substitui o total importado daquela família e não altera a reserva. O backup JSON inclui os valores anuais das mensalidades.

### Restaurar um backup
Abra o projeto no VS Code com o Copilot e envie o prompt abaixo, anexando o arquivo `backup-casa-de-praia-*.json`:

> Restaure o backup anexado no Supabase do projeto floripa-admin. Gere um script SQL para o SQL Editor, na ordem: families, spaces, allowed_users, items, settings, reservations, reservation_guests, guest_charges, finance_categories, finance_membership_rates, finance_memberships, finance_transactions, finance_daily_adjustments. Use `insert ... on conflict (chave primária) do update` para não duplicar e preservar os ids originais. Depois ajuste as sequences (`setval`) de todas as tabelas com id serial. Não apague nada existente sem eu confirmar. Antes de gerar, me diga quantas linhas há em cada tabela do arquivo.

## Hospedagem gratuita
Publique a pasta em Cloudflare Pages, Netlify ou GitHub Pages (sem build).

## Keep-alive
Em repositório GitHub, cadastre os secrets `SUPABASE_URL` e `SUPABASE_ANON_KEY`; [keepalive.yml](.github/workflows/keepalive.yml) chama o banco 2x por semana para evitar a pausa.
