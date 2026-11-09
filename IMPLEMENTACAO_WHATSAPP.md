# 📱 Integração WhatsApp – Resumo Completo

## 🎯 Objetivo Alcançado
Adicionar suporte a **número de telefone** e enviar **notificações via WhatsApp** quando alguém solicita uma reserva em um quarto pessoal que requer aprovação.

---

## 📋 O que foi implementado

### 1️⃣ Campo de Telefone
**Onde:** Aba "Pessoas"
- ✅ Nova coluna "Telefone" na tabela
- ✅ Campo de entrada no formulário de cadastro
- ✅ Edição inline de telefone para cada pessoa

**Formato aceito:**
```
55 11 99999-9999  (com formatação)
5511999999999     (apenas dígitos)
+55 11 99999-9999 (com +)
```

---

### 2️⃣ Notificações via WhatsApp
**Quando:** Uma reserva é criada em **quarto pessoal de outra família**

**Fluxo:**
```
Usuário cria reserva 
    ↓ (em Quarto Pessoal da família X)
    ↓ (A reserva fica "Pendente")
    ↓
Sistema detecta notificação necessária
    ↓
Encontra responsáveis da família X com telefone
    ↓
Registra notificação(ões) no banco de dados
    ↓
Tabela: whatsapp_notifications
Status: pending (aguardando envio via API)
    ↓
[Próximo passo] Edge Function envia via WhatsApp Cloud API
```

**Mensagem enviada:**
```
Nova solicitação de reserva para Quarto Fulano
Hóspedes: João Silva, Maria Santos
Entrada: 15/11
Saída: 17/11
Acesse https://vfbortolli.github.io/floripa-admin/ para aprovar
```

---

## 📦 Arquivos Criados e Modificados

### Novos Arquivos SQL
```
supabase/
├── phase2m.sql          ← Campo phone + tabela notificações
└── phase2n.sql          ← Função RPC send_whatsapp_notification()
```

### Documentação Nova
```
MUDANCAS_WHATSAPP.md    ← Resumo das mudanças (para seu entendimento)
WHATSAPP_SETUP.md       ← Guia completo de configuração (técnico)
```

### Modificações Existentes
```
index.html              ← +1 campo, +1 coluna (telefone)
app.js                  ← +1 função, +lógica de integração
README.md               ← Atualização da documentação
```

---

## 🚀 Como Usar – Passo a Passo

### Passo 1: Executar as Migrações SQL (**IMPORTANTE**)
No Supabase, SQL Editor:

```sql
-- 1. Primeira migração (adiciona campo phone)
[Cole o conteúdo de supabase/phase2m.sql e execute]

-- 2. Segunda migração (cria função RPC)
[Cole o conteúdo de supabase/phase2n.sql e execute]
```

⚠️ **Não pular essas etapas! O banco de dados precisa estar atualizado.**

### Passo 2: Cadastrar Telefones dos Responsáveis
Na aba "Pessoas":
1. Encontre cada responsável de família
2. Edite o número de telefone: `55 11 99999-9999`
3. Marque o checkbox "Responsável"
4. Salvar

**Exemplo antes/depois:**
```
ANTES:
Nome        | E-mail              | Família | Responsável
João Silva  | joao@example.com    | Bortolli | ✓

DEPOIS:
Nome        | E-mail              | Telefone        | Família | Responsável
João Silva  | joao@example.com    | 55 11 98765-4321| Bortolli | ✓
```

### Passo 3: Testar
1. Faça login como **Pessoa A** (de Família 1)
2. Vá à "Agenda"
3. Crie uma reserva em **Quarto Pessoal da Família 2**
4. Salve a reserva
5. A reserva fica com status **"Pendente"** (não bloqueia período)
6. Uma notificação é registrada para o responsável da Família 2

**Verifique no Supabase:**
```sql
SELECT * FROM whatsapp_notifications ORDER BY created_at DESC;
```

Você verá:
```
id  | phone           | reservation_id | status  | message
1   | 5511987654321   | 123            | pending | "Nova solicitação de reserva..."
```

### Passo 4 (Opcional): Enviar Realmente via WhatsApp
Para enviar as mensagens via WhatsApp Cloud API, consulte **WHATSAPP_SETUP.md**

Isso requer:
- Conta Meta Business
- Edge Function do Supabase
- Token de acesso WhatsApp

---

## 🔄 Fluxo Completo de Aprovação

```
┌─────────────────────────────────────┐
│ Pessoa A (Família 1) cria reserva   │
│ no Quarto Pessoal de Família 2      │
└────────────────┬────────────────────┘
                 │
                 ↓
        ┌─────────────────┐
        │ Status: Pendente │ (não bloqueia)
        └────────┬────────┘
                 │
                 ↓
    ┌──────────────────────────┐
    │ Responsável da Família 2 │
    │ recebe notificação (Se  │
    │ houver WhatsApp ativo)   │
    └─────────────┬────────────┘
                  │
                  ↓
        ┌─────────────────────┐
        │ Clica no link/acessa│
        │ app.js na Agenda    │
        └──────────┬──────────┘
                   │
                   ↓
        ┌──────────────────────┐
        │ Vê "Solicitações de  │
        │ quartos pessoais"    │
        └──────────┬───────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ↓                     ↓
   ┌────────────┐        ┌──────────┐
   │ Aprovar ✓  │        │ Recusar ✗│
   └────────────┘        └──────────┘
        │                     │
        ↓                     ↓
  Status: Confirmed    Status: Rejected
  Bloqueia período     Fica pendente
```

---

## 🔐 Segurança e Privacidade

- ✅ Telefones só são armazenados no banco de dados (não no git)
- ✅ RLS (Row Level Security) ativa: usuários veem apenas seu próprio telefone
- ✅ Admins veem todos os telefones
- ✅ Notificações só são criadas para responsáveis
- ✅ Dados são sensíveis → Guardar backup em local privado

---

## 📊 Tabelas do Banco

### Tabela: `allowed_users` (existente, modificada)
```sql
CREATE TABLE allowed_users (
  email text PRIMARY KEY,
  name text,
  phone text,                    ← NOVO
  family_id int,
  is_admin boolean,
  is_responsible boolean,
  updated_at timestamptz
);
```

### Tabela: `whatsapp_notifications` (NOVA)
```sql
CREATE TABLE whatsapp_notifications (
  id bigserial PRIMARY KEY,
  phone text NOT NULL,
  reservation_id bigint,
  message text,
  status text ('pending' | 'sent' | 'failed'),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);
```

---

## 🧪 Exemplo de Teste

```javascript
// No console do navegador (F12), você pode ver:

// 1. Pessoa com telefone cadastrado
people.filter(p => p.phone)
// [{email: "joao@example.com", phone: "5511987654321", ...}]

// 2. Responsáveis da Família 2
people.filter(p => p.family_id === 2 && p.is_responsible && p.phone)

// 3. Criar reserva em Quarto Pessoal Família 2
// A função notifyResponsibleViaWhatsapp() será chamada automaticamente
```

---

## ⚠️ Pontos Importantes

1. **Execute as migrações SQL ANTES de usar**
   - `phase2m.sql` + `phase2n.sql` no Supabase SQL Editor

2. **Formato de telefone**
   - Código país (55) é obrigatório
   - Sistema aceita com espaços, hífen ou só números

3. **Notificações são apenas registro no banco**
   - Status começa como `pending`
   - Para enviar via WhatsApp, precisa de Edge Function (próximo passo)

4. **Somente quarto pessoal + status pending**
   - Quartos comunitários não disparam notificação
   - Reservas já confirmadas não disparam notificação

5. **Responsável deve ter telefone cadastrado**
   - Sem telefone = sem notificação
   - Checkout "Responsável" precisa estar marcado

---

## 📚 Documentação Adicional

- **MUDANCAS_WHATSAPP.md** ← Leia primeiro (resumido)
- **WHATSAPP_SETUP.md** ← Leia para configuração avançada
- **README.md** ← Atualizado com novas seções

---

## ✅ Próximos Passos

- [ ] Executar `phase2m.sql` no Supabase
- [ ] Executar `phase2n.sql` no Supabase
- [ ] Cadastrar telefones dos responsáveis
- [ ] Testar criando uma reserva em quarto pessoal
- [ ] Verificar `whatsapp_notifications` no Supabase
- [ ] (Opcional) Implementar Edge Function para enviar via WhatsApp

---

## 🎉 Conclusão

O sistema agora suporta:
- ✅ Cadastro de telefones
- ✅ Detecção de reservas pendentes em quartos pessoais
- ✅ Registro de notificações no banco
- ⏳ Envio via WhatsApp (próximo passo via Edge Function)

Tudo está pronto para a próxima fase de implementação!
