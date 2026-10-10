# Technical Specification: [Feature]: Grantfox webhook processor and automatic disbursement flow

## Overview
Reference implementation and verification harness addressing Issue #142.

## Design & Invariants
- Deterministic state machine (IDLE -> ACTIVE | ERROR).
- Boundary validation rejecting empty or desynchronized payloads.
- Isolated test suite asserting valid state transitions and recovery behavior.

## Verification
Run tests using:
```bash
npm test -- feature___grantfox_webhook_process.test.ts
```
