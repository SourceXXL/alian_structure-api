/**
 * WalletManager — pure, dependency-free multi-wallet collection logic for a user account (issue #52).
 *
 * No DB / Nest DI: operates on plain wallet records and returns the next state + the domain event to
 * emit (link/unlink/primary-change/permission-change), so the service layer just persists and fires
 * notifications/audit logs. Unit-testable in isolation.
 *
 * Rules: configurable max wallets (default 10); addresses normalized + de-duplicated per chain; first
 * wallet auto-becomes primary; primary must be an owner-permission wallet; cannot unlink the last
 * wallet or leave the account without a primary.
 */

export enum WalletPermission {
  OWNER = "owner",
  OPERATOR = "operator",
  READ_ONLY = "read_only",
}

export interface Wallet {
  address: string; // normalized (lowercased, trimmed)
  chain: string;
  permission: WalletPermission;
  isPrimary: boolean;
  linkedAt?: number;
}

export interface WalletManagerConfig {
  maxWallets: number; // default 10
}

export const DEFAULT_WALLET_CONFIG: WalletManagerConfig = { maxWallets: 10 };

export type WalletEvent =
  | { type: "wallet.linked"; address: string; chain: string }
  | { type: "wallet.unlinked"; address: string; chain: string }
  | { type: "wallet.primary_changed"; address: string; chain: string }
  | { type: "wallet.permission_changed"; address: string; permission: WalletPermission };

export interface MutationResult {
  wallets: Wallet[];
  events: WalletEvent[];
}

export class WalletError extends Error {}

export class WalletManager {
  static normalizeAddress(address: string): string {
    return (address ?? "").trim().toLowerCase();
  }

  private static key(address: string, chain: string): string {
    return `${chain}:${this.normalizeAddress(address)}`;
  }

  static find(
    wallets: Wallet[],
    address: string,
    chain: string,
  ): Wallet | undefined {
    const k = this.key(address, chain);
    return wallets.find((w) => this.key(w.address, w.chain) === k);
  }

  /**
   * Link a new wallet. First wallet becomes primary automatically. Enforces max-wallets and
   * per-chain address de-duplication.
   */
  static link(
    current: Wallet[],
    incoming: { address: string; chain: string; permission?: WalletPermission },
    config: Partial<WalletManagerConfig> = {},
    nowMs: number = Date.now(),
  ): MutationResult {
    const cfg = { ...DEFAULT_WALLET_CONFIG, ...config };
    const address = this.normalizeAddress(incoming.address);
    if (!address) throw new WalletError("address is required");
    if (this.find(current, address, incoming.chain)) {
      throw new WalletError("wallet already linked");
    }
    if (current.length >= cfg.maxWallets) {
      throw new WalletError(`wallet limit reached (${cfg.maxWallets})`);
    }
    const isFirst = current.length === 0;
    const wallet: Wallet = {
      address,
      chain: incoming.chain,
      permission: incoming.permission ?? WalletPermission.OWNER,
      isPrimary: isFirst,
      linkedAt: nowMs,
    };
    return {
      wallets: [...current, wallet],
      events: [
        { type: "wallet.linked", address, chain: incoming.chain },
        ...(isFirst
          ? [
              {
                type: "wallet.primary_changed" as const,
                address,
                chain: incoming.chain,
              },
            ]
          : []),
      ],
    };
  }

  /** Unlink a wallet. Refuses to remove the last wallet; re-assigns primary if needed. */
  static unlink(
    current: Wallet[],
    address: string,
    chain: string,
  ): MutationResult {
    const target = this.find(current, address, chain);
    if (!target) throw new WalletError("wallet not found");
    if (current.length === 1) {
      throw new WalletError("cannot unlink the last wallet");
    }
    let remaining = current.filter(
      (w) => this.key(w.address, w.chain) !== this.key(address, chain),
    );
    const events: WalletEvent[] = [
      { type: "wallet.unlinked", address: target.address, chain: target.chain },
    ];
    // if we removed the primary, promote the next owner-capable wallet
    if (target.isPrimary) {
      const next =
        remaining.find((w) => w.permission === WalletPermission.OWNER) ??
        remaining[0];
      remaining = remaining.map((w) => ({
        ...w,
        isPrimary: this.key(w.address, w.chain) === this.key(next.address, next.chain),
      }));
      events.push({
        type: "wallet.primary_changed",
        address: next.address,
        chain: next.chain,
      });
    }
    return { wallets: remaining, events };
  }

  /** Designate a new primary wallet. Primary must hold OWNER permission. */
  static setPrimary(
    current: Wallet[],
    address: string,
    chain: string,
  ): MutationResult {
    const target = this.find(current, address, chain);
    if (!target) throw new WalletError("wallet not found");
    if (target.permission !== WalletPermission.OWNER) {
      throw new WalletError("primary wallet must have owner permission");
    }
    if (target.isPrimary) return { wallets: current, events: [] };
    const wallets = current.map((w) => ({
      ...w,
      isPrimary: this.key(w.address, w.chain) === this.key(address, chain),
    }));
    return {
      wallets,
      events: [
        { type: "wallet.primary_changed", address: target.address, chain: target.chain },
      ],
    };
  }

  /** Change a wallet's permission. Cannot demote the primary below owner. */
  static setPermission(
    current: Wallet[],
    address: string,
    chain: string,
    permission: WalletPermission,
  ): MutationResult {
    const target = this.find(current, address, chain);
    if (!target) throw new WalletError("wallet not found");
    if (target.isPrimary && permission !== WalletPermission.OWNER) {
      throw new WalletError("cannot demote the primary wallet below owner");
    }
    if (target.permission === permission) return { wallets: current, events: [] };
    const wallets = current.map((w) =>
      this.key(w.address, w.chain) === this.key(address, chain)
        ? { ...w, permission }
        : w,
    );
    return {
      wallets,
      events: [
        { type: "wallet.permission_changed", address: target.address, permission },
      ],
    };
  }

  /** Can the given wallet authenticate the user? Any linked wallet may. */
  static canAuthenticate(current: Wallet[], address: string, chain: string): boolean {
    return !!this.find(current, address, chain);
  }

  static primary(current: Wallet[]): Wallet | undefined {
    return current.find((w) => w.isPrimary);
  }
}
