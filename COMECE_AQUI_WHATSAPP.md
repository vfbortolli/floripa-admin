# 🚀 Início Rápido – WhatsApp

## ⚡ 5 Minutos para Começar

### 1. Leia o Resumo (2 min)
👉 **Arquivo:** [RESUMO_WHATSAPP.md](RESUMO_WHATSAPP.md)

Vai dar uma visão geral do que foi implementado.

---

### 2. Execute as Migrações SQL (2 min)
No Supabase SQL Editor:

**Copie e execute `supabase/phase2m.sql`**
```sql
-- Adiciona campo phone e tabela whatsapp_notifications
```

**Depois copie e execute `supabase/phase2n.sql`**
```sql
-- Cria função RPC send_whatsapp_notification()
```

⚠️ **Não pule essas etapas!**

---

### 3. Cadastre Telefones (1 min)
No app, aba **Pessoas**:
- Edite cada responsável
- Adicione telefone: `55 11 99999-9999`
- Salve

---

## 📚 Documentação Completa

Leia na seguinte ordem:

1. **[RESUMO_WHATSAPP.md](RESUMO_WHATSAPP.md)** ← Comece aqui
   - Visão geral
   - Como usar
   - Estrutura de dados

2. **[IMPLEMENTACAO_WHATSAPP.md](IMPLEMENTACAO_WHATSAPP.md)** ← Depois
   - Guia visual passo a passo
   - Exemplos práticos
   - Próximos passos

3. **[WHATSAPP_SETUP.md](WHATSAPP_SETUP.md)** ← Para configuração avançada
   - WhatsApp Cloud API
   - Edge Function
   - Troubleshooting

4. **[MUDANCAS_WHATSAPP.md](MUDANCAS_WHATSAPP.md)** ← Referência técnica
   - Lista de mudanças
   - Arquivos modificados
   - Fluxo de notificação

---

## 🧪 Teste Rápido

1. Abra o app em `http://localhost:8080`
2. Vá à aba **Agenda**
3. Crie uma reserva em um **Quarto Pessoal de outra família**
4. A reserva fica **"Pendente"** (não bloqueia período)
5. Uma notificação é registrada no banco

**Verifique no Supabase:**
```sql
SELECT * FROM whatsapp_notifications ORDER BY created_at DESC;
```

---

## ❓ FAQ Rápido

**P: Preciso fazer mais alguma coisa?**
R: Execute as migrações SQL e cadastre os telefones. Pronto!

**P: As mensagens já são enviadas?**
R: Não, ainda falta implementar a Edge Function (consulte WHATSAPP_SETUP.md)

**P: Posso usar o app normalmente?**
R: Sim! Tudo funciona. As notificações são apenas registradas no banco.

**P: Qual é o formato do telefone?**
R: `55 11 99999-9999` (com código do país 55)

**P: Notificação é enviada em qual situação?**
R: Quando uma reserva é criada em quarto pessoal com status "Pendente"

---

## 🔗 Referência Rápida

| Item | Localização |
|------|------------|
| Migração SQL (1) | `supabase/phase2m.sql` |
| Migração SQL (2) | `supabase/phase2n.sql` |
| Interface | `index.html` (campo de telefone) |
| Lógica | `app.js` (função notifyResponsibleViaWhatsapp) |
| Tabela Notificações | `whatsapp_notifications` no Supabase |

---

## ✅ Você está pronto!

Próximo passo: Leia [RESUMO_WHATSAPP.md](RESUMO_WHATSAPP.md) →

---

**Dúvidas?** Consulte os documentos acima na ordem recomendada.
