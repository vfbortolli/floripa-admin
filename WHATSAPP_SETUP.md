# Integração com WhatsApp – Guia de Configuração

## Overview
Este documento descreve como configurar a integração com WhatsApp para enviar notificações quando um agendamento é solicitado em um quarto pessoal que requer aprovação.

## Mudanças Implementadas

### 1. Schema do Banco de Dados (`phase2m.sql`)
- Adicionado campo `phone` na tabela `allowed_users`
- Criada tabela `whatsapp_notifications` para rastrear notificações enviadas

### 2. Interface (`index.html`)
- Campo de telefone adicionado à tabela de Pessoas
- Campo de entrada de telefone no formulário de cadastro de pessoas

### 3. Lógica de Aplicação (`app.js`)
- Função `notifyResponsibleViaWhatsapp()` envia notificação quando uma reserva é criada em quarto pessoal com status `pending`
- Integração com RPC `send_whatsapp_notification()`

### 4. Funções SQL (`phase2n.sql`)
- Função RPC `send_whatsapp_notification()` que registra a notificação no banco de dados

## Pré-requisitos

1. **Conta Meta Business** com acesso à WhatsApp Cloud API
2. **Token de acesso** com permissões para enviar mensagens
3. **Número de telefone verificado** do WhatsApp Business (Phone Number ID)
4. **Endpoint de webhook** configurado (opcional, se usará webhooks de status)

## Passos de Configuração

### Passo 1: Executar Migrações SQL
```sql
-- No Supabase SQL Editor, execute em ordem:
1. phase2m.sql  -- Adiciona campo phone e tabela de notificações
2. phase2n.sql  -- Cria função RPC send_whatsapp_notification
```

### Passo 2: Configurar Credenciais
As credenciais devem ser armazenadas no Supabase como variáveis de ambiente (secrets). No painel do Supabase:

1. Vá para **Project Settings > Edge Functions > Secrets**
2. Adicione as seguintes variáveis:
   - `WHATSAPP_ACCESS_TOKEN`: Seu token de acesso Meta
   - `WHATSAPP_PHONE_NUMBER_ID`: ID do seu número de telefone verificado

### Passo 3: Implementar Edge Function (Opcional)
Para enviar mensagens realmente via WhatsApp Cloud API, crie uma Edge Function do Supabase que:

1. Recebe eventos da tabela `whatsapp_notifications` quando status é `pending`
2. Faz uma chamada HTTP POST para `https://graph.instagram.com/v18.0/{PHONE_NUMBER_ID}/messages`
3. Atualiza o status da notificação para `sent` ou `failed`

**Exemplo de requisição:**
```bash
curl -X POST https://graph.instagram.com/v18.0/YOUR_PHONE_NUMBER_ID/messages \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": "55" + numero_sem_prefixo,
    "type": "text",
    "text": {
      "body": "Sua mensagem aqui"
    }
  }'
```

### Passo 4: Cadastrar Telefones dos Responsáveis
Na aba **Pessoas**:
1. Para cada responsável de família que deve receber notificações
2. Adicionar o número de telefone no formato: `55 11 99999-9999`
3. Garantir que a checkbox "Responsável" está marcada

## Formato do Telefone
- **Esperado**: `55 11 99999-9999` (com formatação) ou `5511999999999` (apenas dígitos)
- O sistema aceita ambos os formatos
- Código do país (55 para Brasil) é obrigatório

## Fluxo de Notificação

1. **Criação de Reserva em Quarto Pessoal**
   - Quando alguém cria uma reserva em um quarto de outra família
   - A reserva inicia com status `pending` (requer aprovação)

2. **Disparo de Notificação**
   - Sistema identifica os responsáveis da família dona do quarto
   - Para cada responsável com telefone cadastrado
   - Registra um evento em `whatsapp_notifications`

3. **Envio via WhatsApp**
   - Uma Edge Function ou serviço backend detecta notificações pendentes
   - Envia a mensagem via WhatsApp Cloud API
   - Atualiza o status (`sent` ou `failed`)

4. **Aprovação/Recusa**
   - Responsável recebe a mensagem e acessa o link do sistema
   - Aprova ou recusa a reserva na aba "Agenda"
   - Reserva é confirmada ou recusada

## Mensagem Enviada
```
Nova solicitação de reserva para [NOME DO QUARTO]
Hóspedes: [NOMES DOS HÓSPEDES]
Entrada: [DATA]
Saída: [DATA]
Acesse https://vfbortolli.github.io/floripa-admin/ para aprovar
```

## Troubleshooting

### "Phone number not in correct format"
- Verificar se o número está em formato E.164: `+55` + DDD + número
- Exemplo: `+5511999999999`

### Notificação não é enviada
- Verificar se o responsável tem `is_responsible = true` no banco
- Verificar se o responsável tem número de telefone cadastrado
- Verificar se a Edge Function está rodando e tem acesso aos tokens

### Edge Function retorna erro 401
- Verificar se o `WHATSAPP_ACCESS_TOKEN` está correto
- Verificar se o token não expirou
- Verificar permissões no Meta App

## Próximos Passos

1. Executar `phase2m.sql` e `phase2n.sql` no Supabase
2. Cadastrar telefones dos responsáveis na aba Pessoas
3. Criar Edge Function para envio real via WhatsApp Cloud API
4. Testar criando uma reserva em um quarto pessoal de outra família
5. Verificar se a notificação foi registrada em `whatsapp_notifications`

## Referências

- [WhatsApp Cloud API Docs](https://developers.facebook.com/docs/whatsapp/cloud-api/reference)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Meta App Setup](https://developers.facebook.com/apps/)
