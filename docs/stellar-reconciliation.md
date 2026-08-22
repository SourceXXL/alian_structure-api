# Stellar reconciliation

The reconciliation module records confirmed Stellar payments, matches them to internal invoices, and preserves every decision in an audit trail.

## Testnet polling

Set `STELLAR_RECONCILIATION_ACCOUNT` to the Stellar destination account monitored by the service. The service polls `STELLAR_HORIZON_URL` every 60 seconds and defaults to `https://horizon-testnet.stellar.org`. Horizon paging tokens provide idempotent continuation. Duplicate transaction hashes are ignored and recorded as retry-safe audit entries.

For webhook or queue consumers, send a confirmed payment to `POST /reconcile/stellar/transactions` with its transaction hash, destination account, amount, asset, and memo. The endpoint accepts the same payload shape as the Horizon adapter.

## Invoice lifecycle

Register an invoice with `POST /reconcile/stellar/invoice`.

```json
{
  "invoiceId": "INV-2026-0001",
  "expectedAmount": "125.5000000",
  "destinationAccount": "GABC...DEST",
  "paymentReference": "order-0001",
  "assetCode": "XLM"
}
```

Matching requires destination account and asset equality. When an invoice has a payment reference, the incoming memo must match it. The invoice moves from `open` to `partial` or `paid`. Transactions without a matching invoice remain `unmatched`.

## Lookup and operations

`GET /reconcile/stellar/tx/:txid` returns the transaction and its decisions. `GET /reconcile/stellar/invoice/:invoiceId` returns the invoice and its decisions. `POST /reconcile/stellar/invoice/:invoiceId/reconcile` retries matching for accounting staff. Administrators can inspect unmatched transactions with `GET /reconcile/stellar/admin/unmatched` and audit records with `GET /reconcile/stellar/admin/audit`.

The admin endpoints require an authenticated administrator with verified two-factor authentication. All decision records include the invoice, transaction, decision, reason, attempt, and relevant matching metadata.
