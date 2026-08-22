# Payments — Modular Payment-Processor Plugin System

A plugin architecture for payment backends. A new processor is a **drop-in
adapter**: implement one interface, tag it with a decorator, add it as a
provider — it auto-registers and is immediately routable. Two real adapters
ship today, **Stellar** (official SDK, testnet) and **Grantfox** (HTTP gateway),
and they run **side-by-side without interference**, selectable per request.

```
src/payments/
├── interfaces/payment-processor.interface.ts   # IPaymentProcessor contract + shared types
├── decorators/register-payment-processor.decorator.ts  # @RegisterPaymentProcessor() discovery marker
├── registry/payment-processor.registry.ts      # runtime registry + enable/disable (DB seam)
├── payment-processor.factory.ts                # per-request processor selection
├── payments.service.ts                         # thin orchestrator (delegates to factory)
├── payments.controller.ts                      # REST API (JWT + KYC; admin toggles)
├── payments.module.ts                          # wiring + auto-discovery + Horizon provider
├── dto/                                         # class-validator request DTOs
└── adapters/
    ├── stellar/    stellar.adapter.ts + stellar.constants.ts
    ├── grantfox/   grantfox.adapter.ts
    └── __shared__/ payment-processor.contract.spec.ts   # contract compliance (all adapters)
```

## The contract

Every processor implements [`IPaymentProcessor`](./interfaces/payment-processor.interface.ts):

| Method | Purpose |
|---|---|
| `initialize(config?)` | Optional runtime (re)configuration. |
| `createPayment(request)` | Build a payment; returns `{ paymentId, status, unsignedTransaction? }`. |
| `signTransaction(created)` | Sign it (server-side or a no-op for hosted gateways). |
| `submitTransaction(signed)` | Broadcast/settle; returns `{ transactionHash, status }`. |
| `getStatus(paymentId)` | Fetch current status. |
| `refund(request)` | Full or partial refund. |

Plus `name` (stable key), `displayName`, and `capabilities`
(`supportsPartialRefund`, `requiresClientSideSigning`, `currencies`).

The interface is **generic** — `IPaymentProcessor<TConfig, TCreate, TCreated>` —
so an adapter can narrow its config and native request/response payload types
while the registry and factory operate against the base type. **Amounts are
always decimal strings** (e.g. `"10.5"`), never floats.

The `create → sign → submit` flow is **stateless**: each step's output is posted
back in as the next step's body. There is no payment table (see
[Persisting payments](#persisting-payments-db-seam)).

## How processor selection works

`PaymentProcessorFactory.resolve()` picks the processor by this precedence:

1. **Explicit selector** — the `X-Payment-Processor` header (or `?processor=`).
2. **Env default** — `PAYMENTS_DEFAULT_PROCESSOR`.
3. **Sole enabled** — if exactly one processor is enabled, use it.
4. Otherwise → `400 Bad Request` asking the caller to choose.

Unknown selector → `400`; disabled selector → `409 Conflict`.

## Adding a new plugin

1. **Create the adapter** under `adapters/<name>/<name>.adapter.ts`:

   ```ts
   import { Injectable } from "@nestjs/common";
   import { RegisterPaymentProcessor } from "../../decorators/register-payment-processor.decorator";
   import { IPaymentProcessor, /* …types… */ } from "../../interfaces/payment-processor.interface";

   @Injectable()
   @RegisterPaymentProcessor()          // ← makes it auto-register on startup
   export class AcmeAdapter implements IPaymentProcessor {
     readonly name = "acme";            // ← stable selector key
     readonly displayName = "ACME Pay";
     readonly capabilities = {
       supportsPartialRefund: true,
       requiresClientSideSigning: false,
       currencies: ["USD"],
     };
     async initialize() {}
     async createPayment(request) { /* … */ }
     async signTransaction(created) { /* … */ }
     async submitTransaction(signed) { /* … */ }
     async getStatus(paymentId) { /* … */ }
     async refund(request) { /* … */ }
   }
   ```

2. **Register it as a provider** in [`payments.module.ts`](./payments.module.ts)
   (add `AcmeAdapter` to `providers`). The `@RegisterPaymentProcessor()` marker
   is discovered on `onModuleInit` and registered automatically — you do **not**
   touch the registry, factory, controller, or DTOs.

3. **Add config** to [`src/config/env.validation.ts`](../config/env.validation.ts)
   for any env your adapter reads (`@IsOptional() @IsString()`).

4. **Add a contract case** in
   [`adapters/__shared__/payment-processor.contract.spec.ts`](./adapters/__shared__/payment-processor.contract.spec.ts)
   so the full lifecycle is verified against mocked clients.

That's it — the endpoints below immediately work for `X-Payment-Processor: acme`.

> **Discovery note:** matching is by our own metadata key, so it never collides
> with the DeFi module's adapter discovery (which matches `*Adapter` classes
> that duck-type `getPosition`/`supportedChains`).

## API

All routes are under the global prefix (`/api/v1`) and require a JWT (plus the
global KYC guard). The processor is chosen via the `X-Payment-Processor` header
or `?processor=`.

| Method | Path | Access | Body |
|---|---|---|---|
| `POST` | `/payments` | JWT | `CreatePaymentDto` |
| `POST` | `/payments/:id/sign` | JWT | `SignTransactionDto` |
| `POST` | `/payments/:id/submit` | JWT | `SubmitTransactionDto` |
| `GET`  | `/payments/:id/status` | JWT | — |
| `POST` | `/payments/:id/refund` | JWT | `RefundDto` (omit `amount` for full) |
| `GET`  | `/payments/processors` | JWT | — (list + enabled state) |
| `POST` | `/payments/processors/:name/enable` | **ADMIN** | — |
| `POST` | `/payments/processors/:name/disable` | **ADMIN** | — |

### Stellar convenience routes

The feature spec names Stellar-specific endpoints. These three aliases pin the
processor to Stellar — no `X-Payment-Processor` header needed, and
`PAYMENTS_DEFAULT_PROCESSOR` is ignored:

| Method | Path | Body | Maps to |
|---|---|---|---|
| `POST` | `/payments/stellar/create` | `CreatePaymentDto` | create, forced to Stellar |
| `POST` | `/payments/stellar/submit` | `StellarSubmitDto` | server-side sign **+** submit (or submit a client-signed payload) |
| `GET`  | `/payments/stellar/status?id=<hash>` | — | status by on-chain transaction hash |

Because Stellar signs server-side, `submit` takes the created payment's
`unsignedTransaction`, signs it, and submits — so the create → submit flow needs
no separate sign step. Pass `signedPayload` instead to submit a client-signed
XDR as-is. `paymentId` travels in the body (there is no `:id` in the path).

> These are thin aliases over the generic endpoints, declared in a dedicated
> controller registered **before** the generic one so the static
> `/payments/stellar/{submit,status}` paths take precedence over the dynamic
> `/payments/:id/{submit,status}` routes (Express matches in registration order).

### Example

```bash
# Create via the env-default processor
curl -X POST /api/v1/payments -H 'Authorization: Bearer <jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"amount":"10","currency":"XLM","destination":"G...","source":"G...","idempotencyKey":"abc-1"}'

# Force a specific processor
curl -X POST /api/v1/payments -H 'Authorization: Bearer <jwt>' \
  -H 'X-Payment-Processor: grantfox' -H 'Content-Type: application/json' \
  -d '{"amount":"25.00","currency":"USD","destination":"acct_1","idempotencyKey":"abc-2"}'

# Operator disables a processor at runtime (admin only)
curl -X POST /api/v1/payments/processors/grantfox/disable -H 'Authorization: Bearer <admin-jwt>'
```

## Configuration

All variables are optional (validated in `env.validation.ts`). Add to `.env`:

```dotenv
# Default processor when no X-Payment-Processor header is supplied
PAYMENTS_DEFAULT_PROCESSOR=stellar

# ── Stellar ──────────────────────────────────────────────
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
STELLAR_SIGNING_SECRET=S...            # server-side signing seed (secret!)

# ── Grantfox ─────────────────────────────────────────────
GRANTFOX_API_URL=https://api.your-grantfox.example
GRANTFOX_API_KEY=...                   # sent as: Authorization: Bearer <key>
```

> Secrets (`STELLAR_SIGNING_SECRET`, `GRANTFOX_API_KEY`) are env-only — never
> commit them.

### Stellar adapter notes

- Server-side signing: the server holds `STELLAR_SIGNING_SECRET` and signs the
  unsigned XDR returned by `createPayment`.
- `getStatus(id)` / `refund(id)` treat `id` as the **on-chain transaction
  hash** (there is no hash until after `submitTransaction`).
- Stellar has no native refund — a refund is a **reverse payment** from the
  original recipient back to the payer (partial refunds supported). This assumes
  the signing key controls the original recipient account.
- Non-native assets require `metadata.assetIssuer` in the request; otherwise the
  payment is in native XLM.

### Grantfox adapter notes

- Grantfox is a hosted gateway that signs/submits server-side, so
  `signTransaction`/`submitTransaction` are pass-throughs.
- **The request/response mapping is isolated** in `mapCreateRequest()` and
  `mapPaymentResponse()` (both marked `// ADAPT:`). If your Grantfox endpoint's
  shape differs, those two methods are the only things to change.

## Persisting payments (DB seam)

The system is intentionally stateless — no new TypeORM entity or migration.
Two seams are documented for when persistence is needed:

- **Enable/disable state** lives in an in-memory `Set` in
  [`PaymentProcessorRegistry`](./registry/payment-processor.registry.ts). To make
  a toggle survive restarts / be shared across instances, back the single
  mutation point (`setEnabled`) and `isEnabled` with a small
  `payment_processor_state` table. The public method surface does not change.
- **Payment records** — create/sign/submit currently pass payloads through
  request bodies. To persist payments (and enforce real idempotency via
  `idempotencyKey`), add a `payment` entity and write to it in
  `PaymentsService` around each processor call.

## Tests

```bash
npm run test -- src/payments        # unit + integration, fully offline
```

- `registry.spec` / `factory.spec` — registration, selection precedence, errors.
- `adapters/__shared__/payment-processor.contract.spec` — **contract
  compliance**: every adapter is driven through the full lifecycle against
  mocked network clients.
- `stellar.adapter.spec` / `grantfox.adapter.spec` — per-adapter behaviour with
  mocked Horizon `Server` / `HttpService`.
- `payments.integration.spec` — **side-by-side**: routing by header/env, two
  processors isolated in one test, and disabling one leaving the other working.
- `stellar-payments.controller.spec` — the `/payments/stellar/*` aliases: pinning
  to Stellar under a `grantfox` env default, server-side sign+submit, and the
  route-precedence guarantee over the generic `/payments/:id/*` routes.

Network clients are always mocked/injected, so no test touches the network.
