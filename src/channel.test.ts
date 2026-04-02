import { describe, it, expect } from "vitest";
import { vibedotPlugin } from "./channel.js";

function makeCfg(channelConfig: Record<string, unknown> = {}) {
  return { channels: { vibedot: channelConfig } } as any;
}

// The SDK types require two arguments for some methods; cast to simplify test calls.
const config = vibedotPlugin.config as any;
const gateway = vibedotPlugin.gateway as any;

describe("vibedot plugin", () => {
  describe("config adapter", () => {
    it("resolves account from config with token", () => {
      const cfg = makeCfg({ token: "test-token", slack_webhook: "https://hooks.slack.com/test" });
      const account = config.resolveAccount(cfg, undefined);
      expect(account.config.token).toBe("test-token");
      expect(account.config.slack_webhook).toBe("https://hooks.slack.com/test");
      expect(account.enabled).toBe(true);
    });

    it("resolves account with enabled defaulting to true", () => {
      const cfg = makeCfg({ token: "t" });
      const account = config.resolveAccount(cfg, undefined);
      expect(account.enabled).toBe(true);
    });

    it("resolves account with enabled=false", () => {
      const cfg = makeCfg({ token: "t", enabled: false });
      const account = config.resolveAccount(cfg, undefined);
      expect(account.enabled).toBe(false);
    });

    it("resolves account when channel config is missing", () => {
      const cfg = { channels: {} } as any;
      const account = config.resolveAccount(cfg, undefined);
      expect(account.config.token).toBeUndefined();
      expect(account.enabled).toBe(true);
    });

    it("isConfigured returns true when token is present", () => {
      const cfg = makeCfg({ token: "test-token" });
      const account = config.resolveAccount(cfg, undefined);
      expect(config.isConfigured(account)).toBe(true);
    });

    it("isConfigured returns false when token is missing", () => {
      const cfg = makeCfg({});
      const account = config.resolveAccount(cfg, undefined);
      expect(config.isConfigured(account)).toBe(false);
    });

    it("describeAccount returns correct shape", () => {
      const cfg = makeCfg({ token: "test-token" });
      const account = config.resolveAccount(cfg, undefined);
      const desc = config.describeAccount(account);
      expect(desc).toEqual({
        accountId: account.accountId,
        enabled: true,
        configured: true,
      });
    });

    it("describeAccount reports unconfigured when no token", () => {
      const cfg = makeCfg({});
      const account = config.resolveAccount(cfg, undefined);
      const desc = config.describeAccount(account);
      expect(desc.configured).toBe(false);
    });
  });

  describe("plugin metadata", () => {
    it("has correct channel id", () => {
      expect(vibedotPlugin.meta.id).toBe("vibedot");
    });

    it("has correct label", () => {
      expect(vibedotPlugin.meta.label).toBe("Vibe Dot");
    });

    it("supports only direct chat", () => {
      expect(vibedotPlugin.capabilities.chatTypes).toEqual(["direct"]);
    });

    it("blocks streaming", () => {
      expect(vibedotPlugin.capabilities.blockStreaming).toBe(true);
    });

    it("has nativeCommands enabled", () => {
      expect(vibedotPlugin.capabilities.nativeCommands).toBe(true);
    });
  });

  describe("gateway", () => {
    it("skips when no token is configured", async () => {
      const warnings: string[] = [];
      const cfg = makeCfg({});
      const account = config.resolveAccount(cfg, undefined);

      await gateway.startAccount({
        account,
        cfg,
        abortSignal: AbortSignal.abort(),
        log: { warn: (msg: string) => warnings.push(msg) },
      } as any);

      expect(warnings.some((w: string) => w.includes("no token configured"))).toBe(true);
    });
  });
});
