/**
 * DI token for the Stellar Horizon `Server` instance. Provided by a factory in
 * PaymentsModule and injected into {@link StellarAdapter}. Tests override this
 * token with an in-memory fake so no real network I/O happens offline.
 */
export const STELLAR_HORIZON_SERVER = "STELLAR_HORIZON_SERVER";

/** Default Horizon endpoint (Stellar testnet). */
export const DEFAULT_HORIZON_URL = "https://horizon-testnet.stellar.org";

/**
 * Stable selector key for the Stellar processor. Single source of truth shared
 * by {@link StellarAdapter.name} and the `/payments/stellar/*` alias controller,
 * so the route prefix and the processor it pins to can never drift apart.
 */
export const STELLAR_PROCESSOR_NAME = "stellar";
