# lastfinance

App web pessoal (single-user) de finanças em tempo real, alimentado pela Pluggy (Open Finance), em modo **somente leitura**.
Plano completo, schema e fases em [`docs/PLANO.md`](docs/PLANO.md).

**Fases entregues:**

- **1** — setup, PWA instalável, login com senha + digital (passkey) e bloqueio do app, conexão com a Pluggy,
  sincronização completa + webhooks, lista de transações, detecção de transferências entre contas próprias, pagamento de
  fatura, aplicações/resgates, estornos, parcelas e caixa × competência.
- **2** — categorias e regras, categorização do histórico com Claude Haiku (regras → cache por estabelecimento → IA,
  carga histórica via Message Batches) e fila de revisão; divisão de transações e tags; análise de fixas × variáveis ×
  eventuais; painel com meta de poupança e gastos por categoria; orçamentos com ritmo e sobra; cartões com parcelas futuras,
  melhor dia de compra e comprometimento da renda.
- **3** — fontes de renda (CLT, PJ e outras) com calculadora de líquido (INSS, IRRF com a redução da Lei 15.270, legal ×
  simplificado, vários vínculos e estimativa do ajuste anual; MEI, Simples com fator R, Presumido), regras de pagamento em
  dias úteis, 13º, férias, PLR e bônus; recorrências detectadas; gastos planejados; conciliação Planejado × Realizado;
  previsão de caixa dia a dia para 30/60/90 dias com faixa de incerteza e cenários; **Posso gastar?** e "livre para gastar
  por dia".

## Stack

Next.js 16 (App Router, TypeScript estrito) · PostgreSQL (Neon) + Drizzle · Inngest (fila/agenda serverless) ·
Tailwind v4 · SimpleWebAuthn (passkeys) · Argon2id · Zod · Vitest + fast-check + PGlite · Playwright.

```
src/domain/     regras de negócio puras (sem IO) — onde ficam quase todos os testes
src/server/     serviços, banco, adapters (Pluggy real e falsa), jobs, auth
src/app/        telas e rotas (webhook, Inngest, cron)
drizzle/        migrações SQL versionadas
tests/          integração (PGlite) e E2E (Playwright)
scripts/        migrate, pluggy-probe, register-webhook, generate-icons
```

## Rodando localmente

Pré-requisitos: Node 22, pnpm 10, PostgreSQL 16 (local ou um branch do Neon).

```bash
pnpm install
cp .env.example .env.local      # preencha (ver tabela abaixo)
createdb lastfinance            # ou use a URL de um branch de dev do Neon
pnpm db:migrate
pnpm dev                        # http://localhost:3000 → /setup na primeira vez
```

**Sem credenciais da Pluggy?** Use `PLUGGY_FAKE=true` e `JOBS_MODE=inline`: a tela "Contas conectadas" ganha os botões
"Nubank (demo)" e "Itaú (demo)", que geram 12 meses de dados sintéticos com todos os casos (Pix entre contas, fatura,
caixinha, parcelado, estorno).

**Com a Pluggy de verdade em dev:** o widget funciona em `localhost`, mas a Pluggy só envia webhooks para HTTPS público.
Use o ngrok e registre o webhook apontando para ele:

```bash
ngrok http 3000
pnpm pluggy:webhook https://<subdominio>.ngrok-free.app
```

Para usar o Inngest localmente: `JOBS_MODE=inngest`, `INNGEST_DEV=1` e `npx inngest-cli@latest dev` (UI em http://localhost:8288).

### Testes

```bash
pnpm test              # unidade + integração (Postgres em memória via PGlite; não precisa de banco)
pnpm test:e2e          # Playwright: sobe o app com Pluggy falsa contra o banco lastfinance_e2e (zerado a cada execução)
pnpm lint && pnpm typecheck && pnpm format:check
```

Os E2E usam o autenticador WebAuthn virtual do Chromium para testar cadastro e uso da digital. Se o seu Chromium não for
o do Playwright, aponte `PW_CHROMIUM_PATH`.

## Variáveis de ambiente

| Variável                                    | Obrigatória            | Descrição                                                                                                             |
| ------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                              | sim                    | Postgres **com pooler** (Neon: host `-pooler`). Usada pelas funções.                                                  |
| `DATABASE_URL_UNPOOLED`                     | recomendado            | Conexão direta, usada só nas migrações.                                                                               |
| `APP_URL`                                   | em produção            | URL canônica (`https://…`). Define o domínio das passkeys. Em preview é derivada de `VERCEL_URL`.                     |
| `SESSION_SECRET`                            | sim                    | ≥ 32 caracteres aleatórios (`openssl rand -base64 48`).                                                               |
| `DATA_ENCRYPTION_KEY`                       | sim                    | 32 bytes em base64 (`openssl rand -base64 32`). Cifra segredo do TOTP etc. **Não troque depois** sem migrar os dados. |
| `SETUP_TOKEN`                               | só no 1º acesso        | Exigido em `/setup` para criar o usuário. Remova depois.                                                              |
| `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` | sim (exceto modo fake) | Credenciais da sua aplicação Pluggy. Nunca vão ao navegador.                                                          |
| `PLUGGY_WEBHOOK_SECRET`                     | sim                    | Segredo enviado pela Pluggy no header `x-lastfinance-webhook-secret` (`openssl rand -hex 32`).                        |
| `PLUGGY_WEBHOOK_IP_ALLOWLIST`               | não                    | Ex.: `52.67.145.81` (IP de origem da Pluggy).                                                                         |
| `PLUGGY_FAKE`                               | não                    | `true` = Pluggy falsa (dev/E2E).                                                                                      |
| `JOBS_MODE`                                 | não                    | `inngest` (padrão) ou `inline` (executa na hora; dev/testes).                                                         |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | em produção            | Preenchidas pela integração Inngest na Vercel.                                                                        |
| `CRON_SECRET`                               | em produção            | Protege `/api/cron/fallback` (a Vercel envia `Authorization: Bearer`).                                                |
| `ANTHROPIC_API_KEY`                         | recomendado            | Chave da Anthropic, só no backend. Sem ela, a categorização usa apenas regras e o histórico de estabelecimentos.      |
| `AI_MODEL`                                  | não                    | Padrão `claude-haiku-5-5`.                                                                                            |
| `AI_FAKE`                                   | não                    | `true` = IA falsa e determinística (dev/E2E, sem custo).                                                              |

## Deploy na Vercel (plano Hobby)

1. **Importe o repositório** na Vercel (framework: Next.js). O comando de build já é `vercel-build` (migra o banco e compila).
2. **Banco:** Marketplace → **Neon** → conecte ao projeto. Ative **"Create database branch for preview deployments"**:
   cada preview ganha um branch isolado do banco de desenvolvimento, e produção fica separada. A integração cria
   `DATABASE_URL` e `DATABASE_URL_UNPOOLED` para cada ambiente. Ative o point-in-time recovery do Neon.
3. **Fila:** Marketplace → **Inngest** → conecte. Ela cria `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` e sincroniza o endpoint
   `/api/inngest` a cada deploy. As funções: `process-pluggy-webhook`, `sync-pluggy-item` (1 por item por vez, com debounce)
   `fallback-sync` (a cada 6 h, horário de Brasília) e `daily-bank-refresh` (5h de Brasília).
4. **Variáveis:** em Settings → Environment Variables, cadastre as da tabela acima **separadas por ambiente**
   (Production × Preview). Em Preview, use `PLUGGY_FAKE=true` ou credenciais de teste.
5. **Cron:** `vercel.json` agenda `/api/cron/fallback` 1×/dia (limite do Hobby). É só um despertador redundante; o
   agendamento principal é o do Inngest.
6. Faça o deploy, abra `https://<seu-app>.vercel.app/setup`, informe o `SETUP_TOKEN` e crie o acesso. Em seguida
   **ative a entrada com digital** (no celular e no PC) e remova o `SETUP_TOKEN`.

> Passkeys ficam presas ao domínio (`APP_URL`). Em previews (`*-git-*.vercel.app`) entre com a senha.

### Instalar no Android

Abra o app no Chrome → menu ⋮ → **Instalar app**. Ele abre em tela cheia, com ícone próprio. Depois do login com senha,
ative a digital em Configurações → Segurança.

## Pluggy

### Registrar o webhook (uma vez por ambiente)

O header secreto só pode ser configurado pela API (não pelo dashboard):

```bash
PLUGGY_CLIENT_ID=… PLUGGY_CLIENT_SECRET=… PLUGGY_WEBHOOK_SECRET=<o mesmo da Vercel> \
  pnpm pluggy:webhook https://<seu-app>.vercel.app
```

O endpoint `/api/webhooks/pluggy` responde em milissegundos (a Pluggy exige 2xx em até 10 s): valida o header, grava o
evento com idempotência por `eventId` e enfileira. Tudo o que chega aparece na tela **Status**.

### Seus itens já conectados (Nubank e Itaú)

Listar itens pela API é recurso de plano pago da Pluggy, então importe cada um pelo ID:
Dashboard da Pluggy → sua aplicação → Items → copie o ID → no app, **Contas conectadas → Importar conexão existente**.
A carga histórica (12 meses) começa na hora, em lotes por conta e por página.

### Conferir o que a Pluggy entrega nos seus itens

```bash
PLUGGY_CLIENT_ID=… PLUGGY_CLIENT_SECRET=… pnpm pluggy:probe <itemId-nubank> <itemId-itau>
```

Mostra quais campos vêm preenchidos (billId, parcelas, documento da contraparte, fechamento da fatura, caixinhas como CDB…)
**sem imprimir valores**. Use para validar o mapeamento antes de confiar nos números.

### Reconectar uma instituição

Quando o consentimento expira ou o banco pede nova autorização, a conexão aparece em vermelho em **Contas conectadas**
("Precisa reconectar"). Toque em **Reconectar** (confirma com a digital): o widget da Pluggy abre no modo de atualização
do mesmo item, então o histórico e as suas edições são preservados.

### "Tempo real" e cotas do Open Finance

A Pluggy atualiza cada item automaticamente até 4×/dia e avisa por webhook. Transações com mais de 6 dias são
reatualizadas só 1×/semana, faturas e lista de investimentos 1×/dia. O botão **Sincronizar** relê o que a Pluggy já tem
(grátis); **Atualizar no banco** pede uma coleta nova e gasta cota mensal — por isso é limitado a 1×/hora por instituição.
Como a atualização automática da Pluggy nem sempre acontece todo dia, a função `daily-bank-refresh` pede, às 5h, uma
coleta nova dos itens que a Pluggy não atualizou nas últimas 20 h (no máximo 1×/dia por item).

## Categorização com IA (Claude Haiku)

Pipeline em camadas, para gastar o mínimo:

1. **Estorno** herda a categoria da compra original.
2. **Regras** do usuário ("se a descrição contém UBER → Transporte"), por prioridade. Regras também podem mudar o tipo
   (ex.: "PIX PARA MÃE" → transferência).
3. **Cache por estabelecimento** (descrição normalizada): o mesmo comerciante nunca vai duas vezes à IA.
4. **Claude Haiku** só para o que sobrar, em blocos de 40 estabelecimentos, com saída JSON validada por Zod e categorias
   sempre da sua lista. A carga histórica (≥ 50 estabelecimentos) vai pela **Message Batches API** (50% mais barata);
   o resto, na hora.

- Abaixo do limiar de confiança (padrão 70%), a transação vai para **Revisão**. Cada correção vale para o estabelecimento
  inteiro, vira exemplo para as próximas classificações e, opcionalmente, uma regra.
- Privacidade: só vão para a API descrições normalizadas de estabelecimentos (sem CPF/CNPJ, e-mails, telefones, contas ou
  números longos) e o valor típico arredondado.
- Custo: cada chamada registra tokens e custo (`ai_usage_log`); há um **teto mensal** configurável em Configurações →
  Preferências, com aviso aos 80%. Para ~5 mil transações/ano o custo esperado é de centavos de dólar.
- Eval: `pnpm tsx scripts/eval-categorization.ts` mede a acurácia num conjunto fixo de 45 estabelecimentos
  (`tests/evals/categorization.json`; meta ≥ 90%). Custa poucos centavos; use `--fake` para testar o harness.

## Previsão, renda e "Posso gastar?"

Três camadas que nunca se misturam: **Realizado** (só a Pluggy escreve), **Planejado** (`forecast_entry`, gerado por
regras) e, na Fase 6, **Hipotético** (cenários em memória).

- **Renda** (`/renda`): cada fonte tem histórico de salário com vigência, regra de pagamento (N-ésimo dia útil, dia fixo,
  último dia útil, adiantamento + saldo; sábado conta para o prazo da CLT, mas o crédito cai no dia útil bancário) e
  eventos (13º em duas parcelas, férias com 1/3, PLR, bônus). O líquido é calculado pelas **tabelas fiscais versionadas**
  em `tax_table` (semeadas com as de 2026: INSS, IRRF, Lei 15.270 mensal e anual, Simples III/V, MEI, Presumido, retenção
  de dividendos). Quando sair uma tabela nova, cadastre outra linha com a nova vigência; o código não muda. ⚠️ Os valores
  vieram de fontes secundárias (conferidas em 16/10/2026): confirme no DOU/RFB, em especial a tabela anual.
- **Recorrências** (`/recorrencias`): o app detecta cobranças com intervalo regular (semanal, mensal, anual) e sugere;
  só as **confirmadas** entram na previsão. Ignoradas não voltam.
- **Gastos planejados** (`/planejados`): no crédito, cada parcela cai na fatura certa e sai do caixa no vencimento.
- **Conciliação** (`/previsao/conciliacao`): cada previsto procura a transação real na janela de dias úteis, com
  tolerância de valor e semelhança com o empregador/estabelecimento; pareamento 1:1 (uma transação nunca conta duas
  vezes). Sem par até o fim da janela, o previsto fica **atrasado**. Dá para casar à mão, desfazer (o par não volta),
  ajustar o valor ou cancelar. Rendas em modo **calibrado** aprendem o fator real ÷ calculado.
- **Previsão** (`/previsao`): um motor só (`domain/forecast/project.ts`, função pura) parte do saldo das contas e soma
  previstos em aberto (atrasados entram hoje), faturas já gastas no cartão, parcelas futuras e o gasto variável estimado
  (média de 3/6 meses ou orçamentos, sem contar recorrentes e parcelas; no cartão, sai no vencimento). A faixa de incerteza
  vem dos previstos estimados e do desvio histórico do gasto variável; há cenários conservador e otimista.
- **Posso gastar?** (`/posso-gastar`): roda a mesma projeção com e sem a compra (Pix/débito no dia; crédito parcelado nas
  faturas). ✅ cabe acima da reserva mínima; ⚠️ fura a reserva ou fica negativo no conservador; ❌ fica negativo. A reserva
  mínima e o modo do gasto variável ficam em Configurações → Preferências.
- Tudo é recalculado depois de cada sincronização (`refreshPlanning`: calibra → regenera → concilia → detecta) e a cada
  edição; a geração é idempotente (`UNIQUE (source_type, source_id, expected_date)`) e não altera o que já foi realizado.

## Segurança

- Senha com Argon2id; bloqueio progressivo após 5 tentativas erradas (15 min, dobrando).
- Passkeys (WebAuthn) com verificação do usuário obrigatória; várias por conta.
- Bloqueio do app no **servidor**: depois de N minutos sem uso, ao voltar do segundo plano e ao reabrir o app, nenhuma
  tela carrega dados até a digital/senha. Ações sensíveis (cadastrar/remover passkey, 2FA, trocar senha, reconectar banco)
  exigem confirmação recente.
- 2FA (TOTP) opcional com códigos de recuperação; sessões independentes por dispositivo, com tela para encerrá-las.
- Cookies `httpOnly`/`secure`/`sameSite`, CSP com nonce, HSTS. Segredos cifrados com AES-256-GCM.
- Logs com lista de campos permitidos: valores, descrições e documentos nunca vão para os logs. CPF/CNPJ de contrapartes
  são guardados só como HMAC.
- O service worker não guarda páginas nem dados em cache.
