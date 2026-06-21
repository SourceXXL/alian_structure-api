import {
  WalletManager,
  WalletPermission,
  WalletError,
  Wallet,
} from "./wallet-manager";

const w = (
  address: string,
  opts: Partial<Wallet> = {},
): Wallet => ({
  address: WalletManager.normalizeAddress(address),
  chain: "ethereum",
  permission: WalletPermission.OWNER,
  isPrimary: false,
  ...opts,
});

describe("WalletManager", () => {
  describe("link", () => {
    it("links the first wallet and makes it primary", () => {
      const r = WalletManager.link([], { address: "0xABC", chain: "ethereum" }, {}, 100);
      expect(r.wallets).toHaveLength(1);
      expect(r.wallets[0].isPrimary).toBe(true);
      expect(r.wallets[0].address).toBe("0xabc"); // normalized
      expect(r.events.map((e) => e.type)).toEqual([
        "wallet.linked",
        "wallet.primary_changed",
      ]);
    });
    it("a second wallet is not primary", () => {
      const r1 = WalletManager.link([], { address: "0xA", chain: "ethereum" });
      const r2 = WalletManager.link(r1.wallets, { address: "0xB", chain: "ethereum" });
      expect(r2.wallets[1].isPrimary).toBe(false);
      expect(r2.events.map((e) => e.type)).toEqual(["wallet.linked"]);
    });
    it("rejects a duplicate address on the same chain", () => {
      const r1 = WalletManager.link([], { address: "0xA", chain: "ethereum" });
      expect(() =>
        WalletManager.link(r1.wallets, { address: "0xa", chain: "ethereum" }),
      ).toThrow(WalletError);
    });
    it("allows the same address on a different chain", () => {
      const r1 = WalletManager.link([], { address: "0xA", chain: "ethereum" });
      const r2 = WalletManager.link(r1.wallets, { address: "0xA", chain: "polygon" });
      expect(r2.wallets).toHaveLength(2);
    });
    it("enforces the configurable max-wallet limit", () => {
      let wallets: Wallet[] = [];
      for (let i = 0; i < 3; i++) {
        wallets = WalletManager.link(wallets, { address: `0x${i}`, chain: "ethereum" }, { maxWallets: 3 }).wallets;
      }
      expect(() =>
        WalletManager.link(wallets, { address: "0x9", chain: "ethereum" }, { maxWallets: 3 }),
      ).toThrow(/limit/);
    });
    it("rejects an empty address", () => {
      expect(() => WalletManager.link([], { address: "  ", chain: "ethereum" })).toThrow();
    });
  });

  describe("unlink", () => {
    it("refuses to remove the last wallet", () => {
      const wallets = [w("0xA", { isPrimary: true })];
      expect(() => WalletManager.unlink(wallets, "0xA", "ethereum")).toThrow(/last/);
    });
    it("promotes a new primary when the primary is removed", () => {
      const wallets = [
        w("0xA", { isPrimary: true }),
        w("0xB", { permission: WalletPermission.OWNER }),
      ];
      const r = WalletManager.unlink(wallets, "0xA", "ethereum");
      expect(r.wallets).toHaveLength(1);
      expect(r.wallets[0].address).toBe("0xb");
      expect(r.wallets[0].isPrimary).toBe(true);
      expect(r.events.some((e) => e.type === "wallet.primary_changed")).toBe(true);
    });
    it("throws on an unknown wallet", () => {
      expect(() => WalletManager.unlink([w("0xA")], "0xZ", "ethereum")).toThrow();
    });
  });

  describe("setPrimary", () => {
    it("moves the primary flag to an owner wallet", () => {
      const wallets = [
        w("0xA", { isPrimary: true }),
        w("0xB", { permission: WalletPermission.OWNER }),
      ];
      const r = WalletManager.setPrimary(wallets, "0xB", "ethereum");
      expect(WalletManager.primary(r.wallets)!.address).toBe("0xb");
      expect(r.wallets.filter((x) => x.isPrimary)).toHaveLength(1);
    });
    it("refuses to make a non-owner wallet primary", () => {
      const wallets = [
        w("0xA", { isPrimary: true }),
        w("0xB", { permission: WalletPermission.READ_ONLY }),
      ];
      expect(() => WalletManager.setPrimary(wallets, "0xB", "ethereum")).toThrow(/owner/);
    });
    it("is a no-op when already primary", () => {
      const wallets = [w("0xA", { isPrimary: true })];
      const r = WalletManager.setPrimary(wallets, "0xA", "ethereum");
      expect(r.events).toEqual([]);
    });
  });

  describe("setPermission", () => {
    it("changes a non-primary wallet's permission", () => {
      const wallets = [
        w("0xA", { isPrimary: true }),
        w("0xB", { permission: WalletPermission.OWNER }),
      ];
      const r = WalletManager.setPermission(wallets, "0xB", "ethereum", WalletPermission.OPERATOR);
      expect(WalletManager.find(r.wallets, "0xB", "ethereum")!.permission).toBe(
        WalletPermission.OPERATOR,
      );
    });
    it("refuses to demote the primary below owner", () => {
      const wallets = [w("0xA", { isPrimary: true })];
      expect(() =>
        WalletManager.setPermission(wallets, "0xA", "ethereum", WalletPermission.READ_ONLY),
      ).toThrow(/demote/);
    });
  });

  describe("canAuthenticate", () => {
    it("allows any linked wallet to authenticate", () => {
      const wallets = [w("0xA", { isPrimary: true }), w("0xB")];
      expect(WalletManager.canAuthenticate(wallets, "0xB", "ethereum")).toBe(true);
      expect(WalletManager.canAuthenticate(wallets, "0xZ", "ethereum")).toBe(false);
    });
  });
});
