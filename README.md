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
Insira linhas em `allowed_users` (Table Editor): e-mail em minúsculas, `family_id`, `is_responsible`, `is_admin`.

## Hospedagem gratuita
Publique a pasta em Cloudflare Pages, Netlify ou GitHub Pages (sem build).

## Keep-alive
Em repositório GitHub, cadastre os secrets `SUPABASE_URL` e `SUPABASE_ANON_KEY`; [keepalive.yml](.github/workflows/keepalive.yml) chama o banco 2x por semana para evitar a pausa.
