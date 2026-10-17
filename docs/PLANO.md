# lastfinance — Plano de arquitetura e entrega

> Status: **aprovado** (Hobby, Open Finance, Drizzle + Inngest, `*.vercel.app`, sem importação de planilha, um PR por fase). Fases 1, 2 e 3 implementadas; Fase 6 em andamento (assistente).
> Data da pesquisa: 16/10/2026. Tudo marcado com 🔎 foi conferido na documentação ou em fontes públicas nesta data; tudo marcado com ⚠️ ainda precisa ser confirmado (na sua conta ou em fonte oficial) e tem um passo explícito no plano para isso.

---

## 0. Leia primeiro: o que a Pluggy entrega de fato (e o que isso muda)

### 0.1 Fatos da documentação atual 🔎

| Tema                                                               | O que a doc diz                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Impacto no app                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth                                                               | `POST /auth` com `CLIENT_ID`/`CLIENT_SECRET` → `apiKey` válida por **2h**. `POST /connect_token` → token de **30 min**, escopo limitado; aceita `itemId` (atualizar/reconectar) e `options.webhookUrl`, `options.clientUserId`, `options.avoidDuplicates`.                                                                                                                                                                                                                                                                                                                                                                | apiKey cacheada (Redis/DB) e renovada com margem (ex.: aos 100 min). Connect token gerado por clique, nunca reaproveitado.                                                                                                                                                                                                                                                              |
| Webhooks                                                           | Eventos `item/created`, `item/updated`, `item/error`, `item/waiting_user_input`, `item/waiting_user_action`, `item/login_succeeded`, `item/deleted`, `connector/status_updated`, `transactions/created` (com `createdTransactionsLink`, `transactionsCount`, `transactionsCreatedAtFrom`), `transactions/updated`, `transactions/deleted`. Todo evento tem `event` e `eventId`. **2xx em até 10s**. Retentativas: imediata, ~15 min, ~2 h (no máximo 3). Sem retry para 400/401/403/404/405. Headers customizados **só via API** (`POST /webhooks` com `headers`). Só HTTPS, sem localhost. IP de origem: `52.67.145.81`. | Webhook valida header secreto + (opcional) IP, grava `webhook_event` com `UNIQUE(event_id)` e enfileira. Header inválido → 401 (a Pluggy não re-tenta, correto). Erro nosso → 5xx (a Pluggy re-tenta). Também precisamos tratar `item/waiting_user_action` e `item/login_succeeded`, que não estavam na sua lista.                                                                      |
| Transações                                                         | `pageSize` máx. **500** (acima disso dá 400). Histórico de até **12 meses**. `status` `PENDING`/`POSTED`, `type` `DEBIT`/`CREDIT`. `creditCardMetadata`: `installmentNumber`, `totalInstallments`, `purchaseDate`, `billId` (**só Open Finance**), `totalAmount` (**só conectores diretos**). No cartão, valor positivo = compra, negativo = pagamento/crédito.                                                                                                                                                                                                                                                           | A carga histórica busca 12 meses, em páginas de 500, uma página por passo da fila.                                                                                                                                                                                                                                                                                                      |
| Mudança de ID                                                      | Se `date`/`description`/`amount` mudam muito, a Pluggy **apaga e cria com outro id**, sem ligar os dois. `transactions/deleted` **não é definitivo** (a transação pode voltar). Reconectar pode gerar **item novo com ids novos**, e a Pluggy não deduplica entre itens.                                                                                                                                                                                                                                                                                                                                                  | Upsert por `pluggy_id` **e** deduplicação secundária por `providerId` (Open Finance) / `providerCode` / impressão digital (`conta + data + valor + descrição normalizada`). Exclusão é _soft delete_ (`deleted_at`), reversível. Edições manuais (categoria, notas, kind) vivem em colunas `user_*` que o sync nunca sobrescreve, e migram quando uma transação "renasce" com outro id. |
| `category` e `merchant` da transação                               | Exigem **assinatura Pro** da Pluggy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Não dá para contar com a categoria da Pluggy na transação. `/categories` (a árvore) serve de ponto de partida; quem categoriza é o nosso pipeline (regras → cache → Haiku).                                                                                                                                                                                                             |
| Faturas (`/bills`)                                                 | Campos: `dueDate`, `totalAmount`, `minimumPaymentAmount`, `allowsInstallments`, `financeCharges[]`, `payments[]`. **Não há data de fechamento na fatura.** Obrigatória no Open Finance regulado; nos conectores diretos, só Inter PF e Itaú Cartões.                                                                                                                                                                                                                                                                                                                                                                      | Data de fechamento vem de `account.creditData` (⚠️ confirmar campos no payload real) ou é inferida (vencimento − N dias, configurável por cartão).                                                                                                                                                                                                                                      |
| Investimentos                                                      | `type`/`subtype` (FIXED_INCOME/CDB…), `issuer`, `rate`, `rateType` (CDI…), `amount` (bruto), `balance` (líquido), `taxes`, `amountProfit`, `dueDate`, `issueDate`, `status`. Movimentações num endpoint paginado à parte. **Os Cofrinhos/Caixinhas do Nubank vêm configurados como CDB.**                                                                                                                                                                                                                                                                                                                                 | Ótima notícia: a caixinha do Nubank deve chegar como investimento. Para o Itaú, verificar no payload real; o fallback por transações fica pronto de qualquer jeito.                                                                                                                                                                                                                     |
| Limites do Open Finance (por CPF + instituição + produto, por mês) | Saldo: 420/mês (a cada atualização). Transações recentes (1 a 6 dias): 240/mês (a cada atualização). Transações antigas (7 a 365 dias): **4/mês, a cada 7 dias**. Faturas: 30/mês (1×/dia). Lista de investimentos: 30/mês (1×/dia). Auto-sync: **até 4×/dia**. Ao estourar, o item fica `PARTIAL_SUCCESS` (aviso 423) até o mês seguinte.                                                                                                                                                                                                                                                                                | **"Tempo real" significa até ~4 atualizações por dia**, com webhook, e não a cada compra. Correções antigas chegam semanalmente. Forçar atualização manual (`PATCH /items/{id}`) consome cota: o botão "atualizar agora" terá _throttle_ e mostrará a cota estimada. Nunca criar dois itens para a mesma instituição.                                                                   |
| Open Finance                                                       | Conectores Open Finance são **recurso premium** (contato com vendas).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Ver 0.2.                                                                                                                                                                                                                                                                                                                                                                                |

### 0.2 Limitações da sua "aplicação demo" e o que proponho ⚠️

1. **Que tipo de conector são seus itens?** Se Nubank e Itaú foram conectados via Open Finance regulado, temos `billId`, faturas e `providerId`. Se forem conectores diretos, muda: fatura só no Itaú Cartões, `totalAmount` da compra parcelada disponível, sem `providerId`. **Fase 1, passo 1:** um script `scripts/pluggy-probe.ts` lista conector, produtos e um exemplo anonimizado de cada entidade dos seus dois itens. O mapeamento é escrito a partir do dado real, não da doc.
2. **Trial/demo expira.** Pela documentação e por relatos da comunidade (Actual Budget, TabNews), depois do trial os itens existentes continuam sincronizando, mas pode não ser possível criar ou editar conectores. Uso pessoal costuma passar pelo **Meu Pluggy** (meu.pluggy.ai: você conecta os bancos lá via Open Finance e a sua aplicação lê pelo conector "MeuPluggy"). **Recomendação:** confirme no dashboard a data de fim do trial e as cotas; se o caminho for o MeuPluggy, o app funciona igual (é só outro conector), e a tela de "Contas conectadas" passa a abrir o widget com esse conector.
3. **Listar todos os itens da aplicação (`GET /v2/items`) é recurso opcional de plano pago** (🔎 confirmado na documentação do `pluggy-sdk` 0.92; sem ele a API responde `403 LIST_ITEMS_FEATURE_NOT_ENABLED`). Os itens que você já tem precisam ser importados pelo `itemId` (tela "Importar item existente", colando o ID do dashboard). Itens novos chegam pelo callback do widget e, de forma confiável, pelo webhook `item/created`.
4. **Categoria da Pluggy por transação exige Pro** → coberto pelo nosso pipeline com Haiku (Fase 2).
5. **Histórico máximo de 12 meses** → as médias de 6 meses e as recorrências anuais terão pouco dado no começo. Proposta: importação **opcional** da sua planilha atual (CSV) como transações `source = 'import'`, para alongar o histórico. Elas nunca se misturam com o que vem da Pluggy (marcação própria e deduplicação por data e valor).
6. **Sem webhook em localhost** → ngrok no desenvolvimento (documentado no README). Os testes automatizados usam um _fake_ da Pluggy e não dependem disso.

### 0.3 Vercel e fila ⚠️

- **Plano Hobby:** cron limitado a **1×/dia** (horário impreciso). **Pro:** até por minuto. Com Fluid Compute, a duração máxima das funções é maior do que antigamente, mas **não confio nela**: todo trabalho pesado é quebrado em passos curtos (< 60 s), então o app funciona em qualquer plano.
- **Proposta: Inngest** (integração oficial com a Vercel) em vez de QStash. Motivo: _step functions_ duráveis (cada página de transações é um `step.run`, com retry e backoff por passo), `concurrency` por item (nunca dois syncs do mesmo item ao mesmo tempo), `debounce` (uma rajada de webhooks vira um sync só), `cron` nativo (dispensa o limite do cron Hobby) e uma UI de execuções que ajuda a depurar. O volume estimado (dezenas de execuções por dia) cabe no plano gratuito (⚠️ confirmar a cota atual).
- **Vercel Cron** fica só como "despertador" redundante 1×/dia, que dispara o sync de _fallback_ no Inngest, caso o próprio agendamento do Inngest falhe.

### 0.4 Tabelas fiscais 2026 (fontes secundárias, ⚠️ validar na Receita/DOU antes de semear o banco)

- **INSS empregado 2026** (Portaria Interministerial MPS/MF nº 13/2026): 7,5% até R$ 1.621,00; 9% até R$ 2.902,84; 12% até R$ 4.354,27; 14% até R$ 8.475,55 (teto). Desconto máximo de R$ 988,09.
- **IRRF mensal 2026:** a tabela progressiva vigente desde maio/2025, mais a **redução da Lei 15.270/2025**: renda tributável até R$ 5.000 → redução de até R$ 312,89 (IR zerado); entre R$ 5.000,01 e R$ 7.350 → redução de `978,62 − 0,133145 × rendimentos tributáveis` (sobre o **bruto tributável**, não sobre a base após deduções). Dependente: R$ 189,59. Desconto simplificado: R$ 607,20.
- **Ajuste anual:** a lei também traz redução na apuração anual (isenção efetiva até R$ 60 mil/ano, redução parcial até R$ 88,2 mil). ⚠️ Confirmar a fórmula anual exata, porque é ela que decide o ajuste quando há **mais de um vínculo CLT** (cada folha aplica a isenção mensal sozinha, e a soma pode gerar imposto a pagar na declaração).
- **CDB:** IR regressivo de 22,5/20/17,5/15% e IOF regressivo nos 30 primeiros dias. A tentativa de alíquota única (MP 1.303/2025) caducou, até onde verifiquei. ⚠️ Revalidar no início da Fase 4.
- Tudo isso vira **dado versionado** (`tax_table` com vigência), nunca constante no código. O _seed_ inclui a URL da fonte e a data de verificação.

---

## 1. Stack (e onde eu mudaria a sua sugestão)

| Camada             | Escolha                                                                                                                                                                                                                                                    | Por quê                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework          | **Next.js (App Router) + TypeScript `strict`** (+ `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)                                                                                                                                                | Como sugerido. Server Actions para mutações da UI; Route Handlers para webhook, Inngest, cron e chat em streaming.                                                                                                                                                                                                                                  |
| ORM                | **Drizzle** (em vez de Prisma)                                                                                                                                                                                                                             | Mais próximo do SQL (você é engenheiro de dados), sem engine binária (cold start menor na Vercel), driver serverless nativo do Neon, migrações SQL versionadas e legíveis, suporte a `numeric`, `jsonb`, índices parciais, `CHECK` e views sem gambiarra. Também roda sobre **PGlite** nos testes de integração (Postgres em processo, sem Docker). |
| Banco              | **Neon** (integração Vercel Marketplace)                                                                                                                                                                                                                   | _Branch_ por preview deployment criado automaticamente a partir de um branch `dev` com dados de teste → previews nunca tocam produção. Pooling via PgBouncer (`-pooler`) para as funções; conexão direta só para migração. PITR incluso.                                                                                                            |
| Fila / agendamento | **Inngest**                                                                                                                                                                                                                                                | Ver 0.3.                                                                                                                                                                                                                                                                                                                                            |
| Cache / rate limit | **Upstash Redis** + `@upstash/ratelimit`                                                                                                                                                                                                                   | Rate limit de login/webhook/chat e cache da `apiKey` da Pluggy.                                                                                                                                                                                                                                                                                     |
| UI                 | Tailwind v4 + **shadcn/ui**, **Recharts**, `next-themes`, `lucide-react`                                                                                                                                                                                   | Como sugerido.                                                                                                                                                                                                                                                                                                                                      |
| PWA                | Manifest nativo do Next (`app/manifest.ts`) + **Serwist** (service worker)                                                                                                                                                                                 | Instalável no Android, tela cheia (`display: standalone`), splash. O SW **não guarda dados financeiros em cache**, só o _shell_.                                                                                                                                                                                                                    |
| Auth               | Implementação própria, pequena e auditável: **Argon2id** (`@node-rs/argon2`), **SimpleWebAuthn** (passkeys), TOTP (`otpauth`), sessões no banco                                                                                                            | Single-user com bloqueio de app, reautenticação para ações sensíveis e várias passkeys: Auth.js atrapalha mais do que ajuda. Detalhes em §4.                                                                                                                                                                                                        |
| Validação          | **Zod** em toda fronteira: payloads da Pluggy, webhooks, formulários, saídas do LLM, `tax_table.payload`                                                                                                                                                   |                                                                                                                                                                                                                                                                                                                                                     |
| Dinheiro e datas   | Valores em **centavos inteiros (`bigint`)** no banco e no domínio; `decimal.js` só dentro dos cálculos de imposto/juros, com arredondamento explícito. Datas: `Temporal` (polyfill) com fuso `America/Sao_Paulo`; datas de negócio como `date` (sem hora). | Elimina erro de ponto flutuante; dia útil e competência não sofrem com o fuso.                                                                                                                                                                                                                                                                      |
| IA                 | `@anthropic-ai/sdk`, `claude-haiku-5-5` por padrão, escalonamento configurável para `claude-sonnet-5-5`; tool use, structured outputs, prompt caching, Message Batches                                                                                     | §11 do pedido.                                                                                                                                                                                                                                                                                                                                      |
| Notificações       | `web-push` (VAPID) + Telegram Bot API (`grammy`)                                                                                                                                                                                                           |                                                                                                                                                                                                                                                                                                                                                     |
| Export             | `exceljs` (XLSX) e CSV via stream                                                                                                                                                                                                                          |                                                                                                                                                                                                                                                                                                                                                     |
| Testes             | **Vitest** (unidade e integração com PGlite), **fast-check** (propriedades), **Playwright** (E2E com _fake_ da Pluggy e **autenticador WebAuthn virtual** do Chromium)                                                                                     |                                                                                                                                                                                                                                                                                                                                                     |
| Qualidade          | ESLint (typescript-eslint strict), Prettier, `knip` (código morto), GitHub Actions (lint → typecheck → unit → integração → e2e), Renovate                                                                                                                  |                                                                                                                                                                                                                                                                                                                                                     |
| Observabilidade    | Logs estruturados (pino) **com redação** de valores, descrições e documentos; tela de status alimentada por `sync_log`                                                                                                                                     | "Nenhum dado financeiro em logs" é garantido por uma lista de campos permitidos, não por boa vontade.                                                                                                                                                                                                                                               |

---

## 2. Arquitetura

```
                    ┌────────────────────────────── Vercel ───────────────────────────────┐
 Android (PWA) ───▶ │  Next.js App Router                                                  │
 PC (browser)  ───▶ │   ├─ app/(app)/*  Server Components ── leem via services/queries     │
                    │   ├─ Server Actions ── mutações (reauth p/ ações sensíveis)          │
                    │   ├─ /api/webhooks/pluggy ── valida header+IP → INSERT webhook_event │──┐
                    │   │                         ON CONFLICT DO NOTHING → inngest.send    │  │
                    │   ├─ /api/inngest  ◀──────── Inngest chama as funções (passos)       │◀─┤
                    │   ├─ /api/cron/*   ── despertador redundante (Vercel Cron)           │  │
                    │   └─ /api/chat     ── streaming SSE, tool use                        │  │
                    └────────┬───────────────────────────┬──────────────────────┬──────────┘  │
                             │                           │                      │             │
                     Neon Postgres (pooler)        Upstash Redis          Inngest Cloud ──────┘
                             │                                                  │
                    Pluggy API ◀── adapters/pluggy (SDK + Zod) ◀── funções de sync
                    Anthropic API ◀── adapters/ai
                    BCB SGS (CDI/Selic) · Web Push · Telegram
```

### 2.1 Camadas do código (hexagonal, sem cerimônia)

- **`src/domain/`**: TypeScript **puro**, sem IO, sem Next, sem Drizzle. Aqui moram **todas as regras de negócio**: classificação de _kind_, pareamento de transferências, atribuição de fatura, parcelas, caixa × competência, dia útil e feriados, INSS/IRRF/PJ, conciliação, projeção, simulador, Price/SAC/CET, lotes de CDB, recomendação de aporte. Entrada → saída, 100% testável. Esta pasta concentra a maior parte dos testes.
- **`src/server/services/`**: casos de uso que orquestram domínio + repositórios + adapters (ex.: `syncItem`, `reconcileForecasts`, `buildForecast`).
- **`src/server/db/`**: schema Drizzle, repositórios e queries.
- **`src/server/adapters/`**: Pluggy, Anthropic, BCB, push, Telegram. Cada um tem uma interface e um _fake_ para testes.
- **`src/server/jobs/`**: funções Inngest (finas: chamam services).
- **`src/app/`**: UI. Nunca importa `adapters` direto.

A IA (Fase 6) só enxerga as **mesmas funções de `services/`** expostas como ferramentas tipadas. Ela não tem nenhum caminho próprio para calcular.

### 2.2 Fluxo de sincronização

```
webhook ──▶ webhook_event(UNIQUE event_id) ──▶ inngest.send("pluggy/event")
                                                     │
              ┌──────────────────────────────────────┼──────────────────────────────┐
              ▼                                      ▼                              ▼
  item/* → "item/refresh"            transactions/created → "tx/fetch-link"   transactions/updated|deleted
  (debounce 60s, concurrency=1/item)   (busca createdTransactionsLink        → "tx/fetch-ids" (lotes ≤500)
              │                         paginado, 1 página por step)            / soft-delete
              ▼
  GET /items/{id} → status → accounts → bills → investments (+ investment tx)
              │
              ▼
  pós-processamento (idempotente, por item): dedupe → kind/transferência/fatura → parcelas
  → categorização (fila IA) → conciliação de previstos → recalcular snapshot/projeção → alertas
```

- **Carga histórica:** `item/backfill` → para cada conta → para cada página (500) → `step.run` separado. O cursor fica salvo em `sync_cursor`, então a carga sobrevive a qualquer falha e continua de onde parou.
- **Fallback:** a cada 6 h (Inngest cron), para cada item: `GET /items/{id}`; se `lastUpdatedAt` > nosso último sync, busca transações de `from = último sync − 7 dias` (janela de sobreposição) e reconcilia. Exclusões são detectadas comparando a janela inteira. **O fallback nunca chama `PATCH /items` (atualizar)**, para não gastar cota do Open Finance; só lê o que a Pluggy já tem.
- **Idempotência:** `webhook_event.event_id UNIQUE`; funções Inngest com `idempotency` key; todo write é `INSERT … ON CONFLICT (pluggy_id) DO UPDATE` limitado às colunas `src_*`.
- **Retry:** Inngest com backoff exponencial por passo; 429/5xx da Pluggy são reexecutados, 4xx não (vira erro em `sync_log`).

### 2.3 As três camadas de dados financeiros

| Camada         | Tabelas                                                                                     | Regra                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Realizado**  | `transaction`, `account`, `credit_card_bill`, `investment*`                                 | Só vem da Pluggy (ou da importação marcada). Projeção e cenário **nunca** escrevem aqui.                                               |
| **Planejado**  | `forecast_entry`, `recurring_item`, `planned_expense`, `income_source*`, `installment_plan` | Gerado por regras. Status `previsto / realizado / atrasado / cancelado / ajustado`. Liga-se ao realizado via `forecast_match`.         |
| **Hipotético** | `scenario`, `scenario_change`                                                               | Aplicado **em memória** sobre o Planejado na hora de projetar. "Promover" copia as mudanças para o Planejado com `origin_scenario_id`. |

A projeção é uma função pura: `project(snapshot, planned, scenarioChanges?, options) → DailySeries`. Cenários e "Posso gastar?" são só chamadas com `scenarioChanges` diferentes. Um motor só, testado uma vez.

---

## 3. Regras de negócio: como cada uma vira código

Cada transação tem um **`kind`** derivado (com origem e confiança), e é ele que decide onde ela conta:

| `kind`                             |          Despesa           | Receita |     Caixa      | Investido | Exemplo                                                |
| ---------------------------------- | :------------------------: | :-----: | :------------: | :-------: | ------------------------------------------------------ |
| `expense`                          |             ✔              |         |       ✔        |           | compra no débito, compra no cartão (competência)       |
| `income`                           |                            |    ✔    |       ✔        |           | salário                                                |
| `internal_transfer`                |                            |         | ↔ (soma zero)  |           | Itaú → Nubank                                          |
| `investment_in` / `investment_out` |                            |         |       ✔        |     ✔     | guardar/resgatar na caixinha                           |
| `card_payment`                     |                            |         | ✔ (lado conta) |           | pagamento da fatura (as despesas são as compras)       |
| `refund`                           | abate a categoria original |         |       ✔        |           | estorno                                                |
| `adjustment`                       |                            |         |       ✔        |           | IOF/juros da fatura (despesa financeira, configurável) |

- **`kind_source`**: `rule | auto | ai | user`. A precedência é `user > rule > auto/ai`; o sync nunca sobrescreve `user`.
- **Transferência interna:** em `domain/transfers`, um pareamento guloso por pontuação entre DEBIT de uma conta minha e CREDIT de **outra** conta minha: |valor| igual (tolerância de 0 centavo; configurável), Δdata ≤ 2 dias úteis, bônus para `paymentData` com documento do pagador igual ao do recebedor (comparado por **hash**, nunca guardado em claro), palavras-chave (PIX/TED/"transferência"), penalidade se uma das pontas já é salário/fatura. O pareamento é 1:1, estável e determinístico (testado com fast-check: nunca pareia a mesma transação duas vezes, e a soma de transferências é zero). Transferência para conta própria **não conectada** é marcada manualmente (ou por regra) como `internal_transfer` sem par.
- **Pagamento de fatura:** no lado da conta corrente, DEBIT casado com uma fatura (`credit_card_bill`) de um cartão meu por valor (total, mínimo ou parcial) e data perto do vencimento, mais padrões de descrição. No lado do cartão, o crédito negativo de "pagamento recebido" também vira `card_payment`. As duas pontas ficam ligadas (`linked_transaction_id` / `bill_id`). **Invariante testada:** a soma das despesas de um mês = compras + débitos, nunca + pagamento de fatura.
- **Caixinha:** movimentação entre conta e investimento (descrições como "Aplicação RDB"/"Resgate", ou casando com a variação de saldo do investimento) → `investment_in/out`, ligada à `savings_box`.
- **Parcelas:** `installmentNumber/totalInstallments` da Pluggy ou _parse_ da descrição (`3/10`, `PARC 03/10`, `03 DE 10`). Cada compra parcelada vira um `installment_plan` (compra original, valor da parcela, n, total). As parcelas futuras viram `forecast_entry(source='installment')` atribuídas à fatura certa e, quando a parcela real chega, a conciliação as fecha.
- **Estorno:** CREDIT no cartão (ou DEBIT invertido) com descrição/valor/estabelecimento casando com uma compra anterior → `refund` com `refund_of_transaction_id`, que abate a categoria da original. Sem par, a categoria vem do estabelecimento.
- **Caixa × competência:** toda transação tem `competence_date` (data da compra: `purchaseDate` ou `date`) e `cash_date` (conta: `date`; cartão: `due_date` da fatura). Todas as agregações recebem `basis: 'cash' | 'accrual'`. A atribuição de fatura usa `billId` (Open Finance) ou, sem ele, o dia de fechamento do cartão (`domain/cards/assignBill`, testado em virada de mês, fevereiro e fechamento em dia não útil).
- **Dia útil:** feriados nacionais calculados (fixos + móveis via Páscoa: Carnaval, Sexta-Santa, Corpus Christi) e guardados em `holiday` (com espaço para feriados extras). `nthBusinessDay`, `lastBusinessDay` e `shift(±n)` com testes de borda (1º dia útil caindo depois de feriado, mês que começa no sábado, dezembro).

---

## 4. Segurança e autenticação

- **Primeiro acesso:** `/setup` só funciona enquanto não houver usuário **e** com `SETUP_TOKEN` (env). Depois, é desativado para sempre.
- **Senha:** Argon2id (m=19 MiB, t=2, p=1, conforme OWASP), mínimo de 12 caracteres + checagem zxcvbn. Rate limit por IP e por conta (Upstash) e bloqueio progressivo (5 erros → 15 min, dobrando).
- **Passkeys (SimpleWebAuthn):** depois do login com senha, o app oferece "Ativar entrada com digital". `userVerification: 'required'`, _discoverable credentials_ (o login vira um toque no sensor) e várias passkeys com nome e último uso. Funciona com Windows Hello e com o celular via QR (_hybrid_). **Atenção:** passkey é amarrada ao domínio (`rpID`) → em _preview deployments_ só funciona a senha; a passkey vale no domínio de produção.
- **TOTP opcional** + 10 códigos de recuperação (guardados com hash Argon2id, uso único).
- **Sessões:** id aleatório de 256 bits no cookie `__Host-session` (`httpOnly`, `secure`, `sameSite=lax`); no banco só o **hash SHA-256**. Cada sessão tem dispositivo/UA, IP aproximado, `last_seen_at` e `expires_at`. Tela para listar e encerrar sessões.
- **Bloqueio do app:** a sessão tem `unlocked_until`. O `middleware` e o layout autenticado checam `unlocked_until`; se passou (inatividade configurável, ou reabertura do PWA detectada por `visibilitychange`), o **servidor não renderiza nenhum valor** e devolve só a tela de desbloqueio (digital ou senha). Não é um _overlay_ CSS por cima de dados já enviados.
- **Reautenticação:** trocar senha, remover passkey, reconectar banco, exportar e apagar conversas exigem `step-up` (WebAuthn ou senha nos últimos 5 min).
- **Criptografia em repouso:** além da criptografia do Neon, campos sensíveis (segredo TOTP, _subscriptions_ de push, chat id do Telegram, tokens) são cifrados com AES-256-GCM e chave `DATA_ENCRYPTION_KEY` (com `key_version`, para permitir rotação).
- **Headers:** CSP estrita com nonce, HSTS, `frame-ancestors 'none'` (exceto o que o widget Pluggy Connect exigir, ⚠️ verificar), `Referrer-Policy: no-referrer`.
- **Somente leitura:** o app nunca usa produtos de pagamento da Pluggy; o cliente Pluggy é encapsulado e só expõe métodos GET mais `connect_token`/`PATCH item` (atualizar).
- **Privacidade com IA:** um _sanitizer_ remove números de conta, CPF/CNPJ, chaves Pix e nomes de pessoas de `paymentData` antes de qualquer chamada; os testes garantem que o payload enviado não tem esses padrões.

---

## 5. Schema (PostgreSQL)

Convenções: PK `uuid` (v7, ordenável); dinheiro em `bigint` **centavos** (`*_cents`); `created_at`/`updated_at` em todas as tabelas; enums do Postgres; colunas `src_*` = vindas da Pluggy (o sync escreve), `user_*` = edição manual (o sync nunca toca); a coluna "efetiva" é `COALESCE(user_x, rule_x, src_x)`, exposta em views. Single-user, mas todas as tabelas de domínio têm `user_id` (custo zero e evita uma migração dolorosa se um dia existir um segundo usuário).

### 5.1 Identidade e segurança

- **`app_user`**: id, email, password_hash, totp_secret_enc, totp_enabled, settings `jsonb` (reserva mínima, timeout de bloqueio, cenário padrão, limite de comprometimento, limites de IA…), timezone.
- **`webauthn_credential`**: id, user_id, credential_id `bytea UNIQUE`, public_key, counter, transports[], device_name, backed_up, last_used_at.
- **`session`**: id, user_id, token_hash `UNIQUE`, user_agent, ip_prefix, created_at, last_seen_at, unlocked_until, step_up_at, expires_at, revoked_at.
- **`recovery_code`**: id, user_id, code_hash, used_at.
- **`auth_attempt`**: id, identifier, ip_prefix, success, at (base do bloqueio progressivo e da auditoria).
- **`audit_log`**: id, user_id, action, metadata (sem valores), at.

### 5.2 Pluggy / Realizado

- **`institution_connection`** (item): id, pluggy_item_id `UNIQUE`, connector_id, connector_name, is_open_finance, status, execution_status, status_detail `jsonb`, error_code, error_message, consent_expires_at, last_updated_at (Pluggy), last_synced_at (nosso), next_auto_sync_at, backfill_state (`pending/running/done/failed`), deleted_at.
- **`account`**: id, connection_id, pluggy_account_id `UNIQUE`, type (`BANK/CREDIT`), subtype (`CHECKING/SAVINGS/CREDIT_CARD`), name, display_name, number_masked (só os 4 últimos), currency, balance_cents, balance_at, credit_limit_cents, available_limit_cents, closing_day, due_day, closing_day_source (`pluggy/inferred/user`), include_in_cash (bool), is_active.
- **`transaction`**: id, account_id, pluggy_id `UNIQUE NULL`, provider_id, provider_code, fingerprint, source (`pluggy/import/manual`), src_description, src_description_raw, description_norm, user_description, amount_cents (com sinal: + entra, − sai, normalizado entre conta e cartão), currency, type (`DEBIT/CREDIT`), status (`PENDING/POSTED`), date, competence_date, cash_date, bill_id → credit_card_bill, installment_number, installment_total, installment_plan_id, kind, kind_source, kind_confidence, linked_transaction_id (par da transferência/fatura), refund_of_transaction_id, category_id, category_source, category_confidence, merchant_id, savings_box_id, notes, is_split, src_payload `jsonb` (sanitizado), deleted_at, superseded_by_id (quando a Pluggy troca o id).
  - Índices: `(account_id, date)`, `(cash_date)`, `(competence_date)`, `(category_id, competence_date)`, parcial `WHERE deleted_at IS NULL`, `UNIQUE (provider_id) WHERE provider_id IS NOT NULL`, GIN trigram em `description_norm` (busca).
- **`transaction_split`**: id, transaction_id, category_id, amount_cents, note. `CHECK`: a soma dos splits = valor da transação (garantida por trigger _deferrable_).
- **`tag`** / **`transaction_tag`**: tags livres (`#viagem-2026`).
- **`credit_card_bill`**: id, account_id, pluggy_bill_id `UNIQUE NULL`, closing_date, due_date, total_cents, minimum_payment_cents, allows_installments, finance_charges `jsonb`, status (`open/closed/paid/partial/overdue/projected`), paid_cents, source (`pluggy/projected`).
- **`investment`**: id, connection_id, pluggy_investment_id `UNIQUE NULL`, type, subtype, name, issuer, rate, rate_type, fixed_annual_rate, gross_cents, net_cents, taxes_cents, profit_cents, issue_date, due_date, status, savings_box_id, source (`pluggy/manual`), balance_at.
- **`investment_transaction`**: id, investment_id, pluggy_id `UNIQUE NULL`, type (aporte/resgate/rendimento/IR/IOF), date, amount_cents, quantity, linked_transaction_id.
- **`category`**: id, parent_id, name, icon, color, kind_hint (`expense/income/…`), pluggy_category_id, is_system, archived_at. **`category_suggestion`**: categorias novas sugeridas pela IA, aguardando aprovação.

### 5.3 Categorização e IA

- **`categorization_rule`**: id, priority, conditions `jsonb` (validadas por Zod: descrição contém/regex, conta, faixa de valor, tipo), actions `jsonb` (categoria, kind, tags, renomear), origin (`user/correction`), hits, last_hit_at, enabled.
- **`merchant`** (cache): id, description_norm `UNIQUE`, display_name, category_id, subcategory, nature (`fixed/variable_recurring/eventual`), looks_recurring, periodicity, confidence, source (`ai/user`), model, examples_count.
- **`review_queue`**: id, transaction_id, reason (`low_confidence/conflict/new_category`), suggested `jsonb`, status, resolved_at.
- **`ai_batch_job`**: id, anthropic_batch_id, status, item_count, submitted_at, ended_at (Message Batches).
- **`ai_conversation`** / **`ai_message`**: id, title, role, content `jsonb` (blocos, inclusive _tool calls_ e componentes renderizáveis), created_at, deleted_at.
- **`ai_usage_log`**: id, feature (`categorize/chat/insight/…`), model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, batch (bool), cost_micros_usd, latency_ms, conversation_id, at.
- **`insight`**: id, period, kind, payload `jsonb` (números vindos de funções), text, created_at, dismissed_at.

### 5.4 Planejado

- **`recurring_item`**: id, name, direction (`in/out`), kind, category_id, account_id, merchant_id, match_pattern, amount_cents, amount_tolerance_pct, nature (`fixed/variable`), periodicity (`weekly/monthly/yearly/custom` + `rrule`), anchor (dia / regra de dia útil), start_date, end_date, status (`suggested/confirmed/ignored`), detection_stats `jsonb` (n ocorrências, desvio, última ocorrência), is_subscription, last_amount_cents.
- **`planned_expense`**: id, description, amount_cents, date, account_id, payment_method (`pix/debit/credit`), installments, category_id, status, origin_scenario_id.
- **`income_source`**: id, name, type (`clt/pj/other`), employer_name, match_pattern (para a conciliação), account_id, start_date, end_date, status (`active/paused/ended`), payment_rule `jsonb` (`fixed_day`, `nth_business_day`, `last_business_day`, `split: [{pct, rule}]`), deductions `jsonb` (dependentes, pensão, saúde, VR/VA, VT 6%, previdência, outros), pj_config `jsonb` (regime, alíquota, fator R, ISS, pró-labore, custos, prazo de recebimento), forecast_mode (`calculated/calibrated`), prorate_first_month.
- **`income_salary_history`**: id, income_source_id, gross_cents, valid_from, valid_to (`EXCLUDE` usando `daterange` para impedir vigências sobrepostas).
- **`income_event`**: id, income_source_id, type (`13_1/13_2/vacation/plr/bonus/other`), reference_date, expected_date, gross_cents (nulo = calculado), notes.
- **`installment_plan`**: id, account_id, first_transaction_id, description_norm, installment_amount_cents, total_installments, purchase_date, total_cents.
- **`forecast_entry`**: id, source_type (`income/recurring/planned/installment/bill/variable/scenario_promoted`), source_id, direction, account_id, category_id, expected_date, window_start, window_end, expected_cents, uncertainty_low_cents, uncertainty_high_cents, status (`previsto/realizado/atrasado/cancelado/ajustado`), certainty (`certain/estimated`), calc_breakdown `jsonb` (ex.: bruto, INSS, IRRF…), generated_at, generator_version, user_override_cents. `UNIQUE (source_type, source_id, expected_date)` → a regeneração é idempotente e preserva os status já resolvidos.
- **`forecast_match`**: id, forecast_entry_id, transaction_id, matched_by (`auto/user`), score, expected_cents, actual_cents, delta_cents, matched_at, unmatched_at.
- **`tax_table`**: id, kind (`inss_employee/irrf_monthly/irrf_reduction_monthly/irpf_annual/irpf_reduction_annual/dependent_deduction/simplified_discount/simples_annex_iii/v/mei_das/cdb_ir/iof_regressive/…`), valid_from, valid_to, payload `jsonb` (schema Zod por `kind`), source_url, verified_at. `EXCLUDE` contra sobreposição por `kind`.
- **`holiday`**: date, name, scope (`national/custom`).

### 5.5 Orçamento, metas, investimentos

- **`budget`**: id, category_id, month (`date`, primeiro dia), amount_cents, rollover (bool), rolled_in_cents. `UNIQUE (category_id, month)`.
- **`goal`**: id, name, target_cents, target_date, savings_box_id, priority, status.
- **`savings_box`** (caixinha): id, name, purpose (`emergency/goal/tax_provision/other`), institution, account_id, investment_id (nulo no fallback), cdi_pct, goal_id, manual_balance_cents, manual_balance_at, priority.
- **`investment_lot`**: id, savings_box_id, investment_id, applied_at, principal_cents, remaining_cents, source_transaction_id. O resgate consome os lotes mais antigos primeiro (FIFO), registrado em **`lot_redemption`**: id, lot_id, redeemed_at, principal_cents, gross_yield_cents, ir_cents, iof_cents.
- **`rate_history`**: series (`cdi_daily/selic_daily/selic_target`), date, rate (numeric, % ao dia/ao ano), fetched_at. PK `(series, date)`. Fonte: BCB SGS (séries 12, 11, 432 ⚠️ confirmar códigos).
- **`savings_recommendation`**: id, month, trigger (`salary_received/manual/monthly`), inputs `jsonb` (sobra prevista, reserva mínima, saídas até o próximo salário…), allocations `jsonb` ([{box, cents, reason}]), explanation, status, realized `jsonb`.
- **`net_worth_snapshot`**: date PK, cash_cents, investments_cents, card_debt_cents, loans_cents, net_cents, breakdown `jsonb`.

### 5.6 Cenários

- **`scenario`**: id, name, description, base_date, horizon_end, status (`draft/saved/promoted/archived`), assumptions `jsonb`, result_cache `jsonb`, promoted_at.
- **`scenario_change`**: id, scenario_id, type (`one_off/recurring_expense/financing/card_installments/income_change/investment_move`), params `jsonb` (schema Zod por tipo; financiamento: valor do bem, entrada, taxa a.m., n, `price|sac`, IOF, seguro prestamista, tarifas, custos de posse), order.

### 5.7 Alertas, operação

- **`alert_rule`**: id, type (`large_expense/budget_threshold/negative_projection/bill_due/connection_error/income_late/duplicate_charge/idle_cash/subscription_change/daily_digest/weekly_digest`), params `jsonb`, channels[] (`push/telegram`), enabled, quiet_hours.
- **`alert_event`**: id, rule_id, dedupe_key `UNIQUE`, payload `jsonb`, sent_at, channel_results `jsonb`.
- **`push_subscription`**: id, session_id, endpoint, keys_enc, created_at.
- **`notification_channel`**: telegram_chat_id_enc, verified_at.
- **`sync_log`**: id, connection_id, trigger (`webhook/cron/manual/backfill`), job (`item/accounts/transactions/bills/investments/postprocess`), started_at, finished_at, status, counts `jsonb` (lidos, inseridos, atualizados, apagados), error_code, error_message (sanitizada), inngest_run_id.
- **`sync_cursor`**: connection_id, account_id, entity, cursor `jsonb` (página/data), updated_at.
- **`webhook_event`**: id, event_id `UNIQUE`, event, item_id, payload `jsonb`, received_at, processed_at, status, attempts, error.
- **`pluggy_token_cache`** (se não usar Redis): api_key_enc, expires_at.

### 5.8 Views/materializações

- `v_transaction_effective` (colunas efetivas e flags `counts_as_expense/income/investment`), `v_monthly_category` (por `basis`), `v_account_daily_balance` (reconstruído para trás a partir do saldo atual, base da linha sólida do gráfico). Começam como views comuns; se ficarem lentas, viram tabelas atualizadas pelo pós-processamento (o volume pessoal não deve exigir isso).

---

## 6. Estrutura de pastas

```
lastfinance/
├─ docs/                         PLANO.md, ADRs (decisões), pluggy-mapping.md (do payload real)
├─ drizzle/                      migrações SQL versionadas + seeds (categorias, tax_table, feriados)
├─ public/                       ícones PWA, splash
├─ scripts/                      pluggy-probe.ts, register-webhook.ts, import-spreadsheet.ts, seed-dev.ts
├─ src/
│  ├─ app/
│  │  ├─ (auth)/                 login, setup, unlock
│  │  ├─ (app)/                  dashboard, transacoes, previsao, posso-gastar, renda, cartoes,
│  │  │                          orcamentos, caixinhas, metas, assinaturas, relatorios, assistente,
│  │  │                          contas-conectadas, status, configuracoes/{seguranca,sessoes,alertas,ia}
│  │  ├─ api/
│  │  │  ├─ webhooks/pluggy/route.ts
│  │  │  ├─ inngest/route.ts
│  │  │  ├─ cron/[job]/route.ts
│  │  │  ├─ chat/route.ts
│  │  │  └─ export/[format]/route.ts
│  │  ├─ manifest.ts · sw.ts (Serwist)
│  ├─ components/                ui/ (shadcn), charts/, money/ (formatação BR, ocultar valores)
│  ├─ domain/                    ⟵ regras puras + testes ao lado (*.test.ts)
│  │  ├─ money/ dates/ (business-days, holidays)
│  │  ├─ classification/ (kind, transfers, card-payments, refunds, installments)
│  │  ├─ cards/ (assign-bill, best-purchase-day, future-bills)
│  │  ├─ recurrence/ (detecção estatística)
│  │  ├─ income/ (payment-rules, clt/{inss,irrf,annual-adjustment}, pj/{mei,simples,presumido}, consolidate)
│  │  ├─ forecast/ (project, variable-spend, uncertainty, reconcile, can-i-spend, free-to-spend)
│  │  ├─ investments/ (lots, cdb-tax, projection, recommendation)
│  │  ├─ financing/ (price, sac, cet)
│  │  ├─ scenarios/ (apply-changes, compare, verdict)
│  │  └─ budgets/ reports/
│  ├─ server/
│  │  ├─ db/ (schema/*.ts, client.ts, repositories/)
│  │  ├─ services/
│  │  ├─ adapters/ (pluggy/, anthropic/, bcb/, push/, telegram/) — cada um com fake.ts
│  │  ├─ jobs/ (inngest client + funções)
│  │  ├─ auth/ (password, webauthn, totp, session, step-up, lock)
│  │  ├─ ai/ (tools/, prompts/, sanitizer.ts, cost.ts)
│  │  └─ security/ (crypto, csp, ratelimit, log-redaction)
│  └─ lib/ (env.ts validado por Zod, utilidades)
├─ tests/
│  ├─ integration/               services + PGlite + fakes
│  ├─ e2e/                       Playwright (fake Pluggy, WebAuthn virtual)
│  ├─ fixtures/                  transações anonimizadas, payloads de webhook
│  └─ evals/                     conjunto fixo p/ categorização e escolha de ferramentas
├─ .github/workflows/ci.yml
├─ vercel.json                   crons
└─ README.md
```

---

## 7. Fases (cada uma termina implantada, testada e utilizável)

Definição de pronto de **toda** fase: CI verde (lint, typecheck, unit, integração, e2e), migração aplicada no Neon de dev, preview deployment funcionando, README atualizado e uma demonstração com seus dados reais.

### Fase 1: Fundação, auth, Pluggy, transações

1. `pluggy-probe` nos seus dois itens → `docs/pluggy-mapping.md` (conector, produtos, campos realmente preenchidos, caixinha como CDB?, `creditData` tem fechamento?).
2. Setup: Next + TS strict + Tailwind/shadcn + Drizzle/Neon + Inngest + Upstash + CI + env validado por Zod (falha no build se faltar variável).
3. PWA instalável (manifest, ícones, splash, Serwist), tema claro/escuro, formatação pt-BR, modo "ocultar valores".
4. Auth completo: setup único, senha Argon2id + rate limit/bloqueio, passkeys (várias), bloqueio do app no servidor, step-up, TOTP + códigos de recuperação, tela de sessões.
5. Pluggy: token cache, "Contas conectadas" (Connect widget, importar item por id, reconectar com `itemId`, status/erros), registro de webhook com header secreto (`scripts/register-webhook.ts`).
6. Sync: webhook → evento → Inngest; backfill paginado por conta e página; `item/*` e `transactions/*`; fallback a cada 6 h; soft delete; dedupe entre ids; tela **Status** (`sync_log`, último sync, cotas).
7. Classificação base: transferência interna, pagamento de fatura (com faturas sincronizadas), caixinhas, estorno, atribuição de fatura e caixa × competência, edição manual de `kind`.
8. Lista de transações: busca, filtros, edição de descrição/notas, alternar caixa/competência.

- **Testes-chave:** pareamento de transferências (Δdatas, valores iguais em contas iguais, triplas ambíguas, fins de semana), fatura (pagamento total/mínimo/parcial, duas faturas no mesmo dia), parcelas (_parse_ de formatos), idempotência do webhook (mesmo `eventId` 2×), ressurreição de transação deletada, troca de id preservando edição manual; E2E: setup → login → passkey virtual → bloqueio → desbloqueio; conectar (fake) → backfill → lista.

### Fase 2: Categorização, painel, orçamentos, cartões

- Categorias (semente a partir de `/categories` da Pluggy + as suas), regras (aplicar a novas e, opcionalmente, retroativas com _preview_ do impacto), splits e tags.
- Pipeline: regras → cache `merchant` → Haiku (structured output, enum de categorias, _few-shot_ com as suas correções); backfill via **Message Batches**; fila de revisão abaixo do limiar de confiança; correção → regra + exemplo.
- Fixas × variáveis × eventuais: estatística em código (coeficiente de variação, periodicidade), nomes e agrupamento pelo Haiku; média, mín., máx. e tendência 3/6/12 meses, % da renda.
- Painel (saldo, mês, sobra, poupança × meta, faturas, limite, comparação com o mesmo dia do mês anterior, últimas transações, "sincronizado há X min").
- Orçamentos (barra, ritmo, alertas 80/100% preparados, rollover). Cartões: fatura atual e futuras, melhor dia de compra, comprometimento futuro.
- **Evals:** acurácia da categorização num conjunto fixo anonimizado (meta inicial ≥ 90% top-1 nas categorias principais); custo por 1.000 transações registrado.

### Fase 3: Planejado × Realizado e previsão (o coração)

- Detecção de recorrências (sugerir → confirmar/editar/ignorar). Gastos planejados.
- Fontes de renda: histórico de salário com vigência, regras de pagamento com dias úteis e feriados, proporcional no 1º mês, 13º/férias/PLR/bônus; calculadora CLT (INSS, IRRF com redução da Lei 15.270, legal × simplificado, vários vínculos com o excedente do teto de INSS e a estimativa do ajuste anual + provisão mensal); PJ (MEI, Simples com fator R, Presumido, manual, ISS, pró-labore, custos, prazo); visão consolidada; simulador de salário.
- Geração de `forecast_entry` (idempotente), conciliação automática (janela em dias úteis, tolerância, similaridade com o empregador), atrasado + alerta, casar/descasar manual, calibração.
- Motor de projeção diária 30/60/90 com faixa de incerteza (variáveis por média 3/6 meses ou orçamento; banda a partir do desvio histórico) e cenários conservador/otimista; gráfico realizado sólido × planejado tracejado, menor saldo, dias negativos; calendário; tabela mensal Previsto × Realizado × Δ.
- "Posso gastar?" (Pix/débito/crédito, parcelas → faturas, reserva mínima, veredito ✅/⚠️/❌, antes/depois) e "Livre para gastar por dia".
- **Testes-chave:** INSS/IRRF em todas as faixas e nas bordas exatas (R$ 5.000,00, R$ 5.000,01, R$ 7.350,00, R$ 7.350,01, teto do INSS), dedução legal × simplificado, dois vínculos, PJ por regime; regras de dia útil; propriedades do motor (sem eventos, o saldo é constante; somar uma despesa nunca aumenta o saldo em nenhum dia; a conciliação nunca conta o mesmo valor duas vezes).

### Fase 4: Caixinhas, rendimento, recomendação, patrimônio, metas, assinaturas

- Caixinhas (pela Pluggy ou pelo fallback de transações + saldo manual), lotes FIFO, IR regressivo + IOF por lote, bruto/IR/líquido.
- CDI/Selic diários do BCB SGS (job diário, histórico guardado), projeção 6/12/24/60 meses em 3 cenários editáveis, simulador direto e inverso, comparação com poupança e com dinheiro parado.
- Recomendação de aporte (prioridades, reserva mínima até o próximo salário, provisão de IR), disparada pela conciliação do salário, com explicação item a item e recomendado × realizado. Alerta de dinheiro parado.
- Patrimônio (snapshot diário), reserva de emergência (N meses), metas com ritmo, assinaturas (lista, total anual, mudança de valor, nova assinatura).

### Fase 5: Alertas, relatórios, exportação

- Web Push (VAPID) e bot do Telegram (vínculo por código), todos os gatilhos, _quiet hours_, deduplicação, resumo diário e semanal.
- Relatório mensal automático, visão anual mês a mês (no formato da sua planilha), exportação CSV/XLSX (com step-up).

### Fase 6: IA conversacional e cenários

- Chat em streaming com ferramentas tipadas (as da sua lista), respostas com "de onde veio" e componentes (gráfico, tabela, veredito) renderizados a partir de JSON estruturado.
- Motor de cenários: pontual, recorrente, **financiamento Price/SAC com IOF, seguro, tarifas e CET** (taxa interna de retorno por Newton–Raphson com _fallback_ por bisseção), parcelado, mudança de renda, aporte/resgate; comparar e promover. O caso do carro (R$ 70 mil, R$ 10 mil de entrada, dezembro) vira um teste E2E com a IA simulada (_mock_ do modelo) e um eval com o modelo real.
- Insights mensais quantificados; controle de custo (tokens, custo, teto mensal, aviso), prompt caching, escalonamento de modelo; histórico apagável.
- **Testes-chave:** Price/SAC contra valores de referência (planilha/HP-12C), CET com tarifas, cenário aplicado = projeção com mudanças manuais equivalentes; evals de escolha de ferramenta ("quanto gastei com delivery…" → `get_category_breakdown`, nunca conta de cabeça).

---

## 8. Decisões que preciso de você (com o meu padrão, se não responder)

1. **Plano da Vercel:** Hobby ou Pro? _(Padrão: funciona nos dois; o agendamento fica no Inngest.)_
2. **Seus itens são Open Finance ou conectores diretos?** E até quando vai o trial? _(Padrão: descubro no `pluggy-probe` e te mostro antes de mapear.)_
3. **Drizzle no lugar de Prisma** e **Inngest no lugar de QStash**: ok?
4. **Domínio:** vai usar um domínio próprio ou `*.vercel.app`? (Afeta o `rpID` das passkeys; dá para trocar depois, mas as passkeys teriam que ser recadastradas.)
5. **Importar a planilha antiga** para alongar o histórico além de 12 meses? Se sim, me mande o layout das colunas (sem valores).
6. **Repositório:** tudo neste repo (`tudolin/lastfinance`), branch de trabalho `claude/eager-gauss-13r0ga`, um PR por fase?

Respondido isso (ou com "ok, use os padrões"), começo a Fase 1 pelo `pluggy-probe`.

---

### Fontes consultadas

- Pluggy: [Webhooks](https://docs.pluggy.ai/docs/webhooks), [Authentication](https://docs.pluggy.ai/docs/authentication), [Environments](https://docs.pluggy.ai/docs/environments-and-configurations), [Transactions](https://docs.pluggy.ai/docs/transactions), [Investments](https://docs.pluggy.ai/docs/investments), [Credit Card Bills](https://docs.pluggy.ai/docs/credit-card-bills), [Operational Rate Limits (Open Finance)](https://docs.pluggy.ai/docs/rate-limits-of), [Open Finance Connectors](https://docs.pluggy.ai/docs/open-finance-regulated)
- Uso pessoal / MeuPluggy (comunidade): [Actual Budget: Pluggy.ai](https://actualbudget.org/docs/advanced/bank-sync/pluggyai), [TabNews](https://www.tabnews.com.br/marlindo71/d39804a3-211a-4d45-8491-e4a36e85a6e8)
- IRRF 2026 / Lei 15.270 (secundárias): [Alterdata](https://ajuda.alterdata.com.br/prosoftsocial/fp3358-tabelas-irrf-2026-lei-15-270-2025-308711074.html), [TabNews (rubin)](https://www.tabnews.com.br/rubin/como-calcular-o-irrf-2026-com-a-reducao-da-lei-15-270-e-um-json-aberto-com-as-tabelas-clt), [holerit.com.br](https://holerit.com.br/tabelas/irrf/2026)
- INSS 2026 (secundárias): [Contabilizei](https://www.contabilizei.com.br/contabilidade-online/tabela-inss/), [Convenia](https://blog.convenia.com.br/nova-tabela-inss/), [Sijur: teto 2026](https://www.sijur.com.br/teto-do-inss/)
