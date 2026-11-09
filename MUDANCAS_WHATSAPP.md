# Resumo das Mudanças – WhatsApp e Telefones

## O que foi feito?

Adicionamos suporte a **número de telefone** no cadastro de pessoas e a funcionalidade de **notificações por WhatsApp** quando alguém solicita uma reserva em um quarto pessoal que pertence a outra família (e depende de aprovação).

## Mudanças no Interface

### Aba "Pessoas"
- Nova coluna **"Telefone"** na tabela de pessoas
- Novo campo de entrada **"Telefone (55 11 99999-9999)"** no formulário de cadastro de pessoas
- Agora é possível editar o telefone de cada pessoa diretamente na tabela

## Mudanças no Banco de Dados

### Arquivos SQL para executar (em ordem)
1. **`supabase/phase2m.sql`** – Adiciona campo `phone` na tabela `allowed_users` e cria tabela `whatsapp_notifications`
2. **`supabase/phase2n.sql`** – Cria função RPC para enviar notificações

⚠️ **Importante:** Execute os dois arquivos **no SQL Editor do Supabase** (Project > SQL Editor > New query) antes de usar o sistema atualizado.

## Fluxo de Notificação

Quando alguém cria uma reserva em um **quarto pessoal de outra família**:

1. ✅ A reserva é criada com status **"Pendente"** (não bloqueia o período)
2. ✅ O sistema registra uma **notificação** para todos os **responsáveis daquela família** que têm número de telefone cadastrado
3. ⏳ A notificação fica registrada na tabela `whatsapp_notifications` com status `pending`
4. 📱 **Próximo passo:** Implementar a integração real com WhatsApp Cloud API para enviar a mensagem (ver `WHATSAPP_SETUP.md`)

## Configuração Necessária

### Passo 1: Executar as Migrações SQL
No Supabase:
1. Abra SQL Editor
2. Cole e execute: `supabase/phase2m.sql`
3. Cole e execute: `supabase/phase2n.sql`

### Passo 2: Cadastrar Telefones (Responsáveis)
Na aba **Pessoas**:
1. Para cada responsável de família que deve receber notificações
2. Editar a linha e adicionar o **Telefone** (formato: `55 11 99999-9999` ou `5511999999999`)
3. Salvar

**Exemplo:**
```
Nome: João Silva
E-mail: joao@example.com
Telefone: 55 11 99999-9999  ← Novo campo
Família: Bortolli
Responsável: ✓ (marca)
Admin: 
```

### Passo 3: Envio Real via WhatsApp (Opcional)
Para enviar as mensagens realmente via WhatsApp, você precisa:
1. Ter uma conta **Meta Business** com WhatsApp Cloud API ativado
2. Criar uma **Edge Function** do Supabase que lê as notificações pendentes e envia via API
3. Consultear o arquivo `WHATSAPP_SETUP.md` para instruções completas

## Teste Local

```bash
npx serve -l 8080 .
```

1. Abra http://localhost:8080 na aba "Pessoas"
2. Cadastre uma pessoa com telefone
3. Vá à "Agenda", crie uma reserva em um quarto pessoal de outra família
4. A reserva fica pendente e uma notificação é registrada no banco

Verifique a tabela `whatsapp_notifications` no Supabase:
```sql
SELECT * FROM whatsapp_notifications ORDER BY created_at DESC;
```

## Formato de Telefone Aceito

- ✅ `55 11 99999-9999` (com espaços e hífen)
- ✅ `5511999999999` (apenas dígitos)
- ✅ `+55 11 99999-9999` (com + prefixo)

⚠️ **Importante:** O código do país (55 para Brasil) é obrigatório!

## Arquivos Modificados

- `index.html` – Adicionado campo de telefone
- `app.js` – Função `notifyResponsibleViaWhatsapp()` e lógica de integração
- `supabase/phase2m.sql` – Nova migração (schema)
- `supabase/phase2n.sql` – Nova migração (funções RPC)
- `README.md` – Documentação atualizada
- `WHATSAPP_SETUP.md` – Novo arquivo com guia de configuração completo

## Próximos Passos

1. ✅ Executar `phase2m.sql` e `phase2n.sql`
2. ✅ Cadastrar telefones dos responsáveis
3. ⏳ Implementar Edge Function para enviar via WhatsApp Cloud API (ver `WHATSAPP_SETUP.md`)
4. ⏳ Testar end-to-end com múltiplas contas reais

## Dúvidas?

Consulte `WHATSAPP_SETUP.md` para:
- Configuração da WhatsApp Cloud API
- Exemplo de Edge Function
- Troubleshooting de erros comuns
