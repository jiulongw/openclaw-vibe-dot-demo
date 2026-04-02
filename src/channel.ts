import { createChatChannelPlugin, type OpenClawConfig } from "openclaw/plugin-sdk/core";
import {
  createScopedChannelConfigAdapter,
  adaptScopedAccountAccessor,
} from "openclaw/plugin-sdk/channel-config-helpers";
import { createPatchedAccountSetupAdapter } from "openclaw/plugin-sdk/setup";
import {
  createAccountListHelpers,
  normalizeAccountId,
} from "openclaw/plugin-sdk/account-resolution";
import { runPassiveAccountLifecycle } from "openclaw/plugin-sdk/channel-lifecycle";
import { getVibeDotRuntime } from "./runtime.js";
import { startVibeDotMonitor } from "./monitor.js";

// --- Account resolution ---

export type VibeDotAccountConfig = {
  enabled?: boolean;
  token?: string;
};

export type ResolvedVibeDotAccount = {
  accountId: string;
  enabled: boolean;
  config: VibeDotAccountConfig;
};

const { listAccountIds, resolveDefaultAccountId } = createAccountListHelpers("vibedot");

function resolveVibeDotAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedVibeDotAccount {
  const accountId = normalizeAccountId(params.accountId);
  const channelConfig = (params.cfg.channels?.["vibedot"] ?? {}) as VibeDotAccountConfig;
  const enabled = channelConfig.enabled !== false;

  return {
    accountId,
    enabled,
    config: {
      token: channelConfig.token,
    },
  };
}

// --- Setup adapter ---

const vibedotSetupAdapter = createPatchedAccountSetupAdapter({
  channelKey: "vibedot",
  buildPatch: (input) => {
    const patch: Record<string, unknown> = {};
    if (input.token) {
      patch.token = input.token;
    }
    return patch;
  },
});

// --- Config adapter ---

const vibedotConfigAdapter = createScopedChannelConfigAdapter<ResolvedVibeDotAccount>({
  sectionKey: "vibedot",
  listAccountIds,
  resolveAccount: adaptScopedAccountAccessor(resolveVibeDotAccount),
  defaultAccountId: resolveDefaultAccountId,
  clearBaseFields: ["token"],
  resolveAllowFrom: () => null,
  formatAllowFrom: () => [],
});

// --- Plugin definition ---

export const vibedotPlugin = createChatChannelPlugin({
  base: {
    id: "vibedot",
    meta: {
      id: "vibedot",
      label: "Vibe Dot",
      blurb: "One-way channel for Vibe Dot meeting transcriptions via SSE.",
      order: 100,
    },
    setup: vibedotSetupAdapter,
    capabilities: {
      chatTypes: ["direct"],
      nativeCommands: false,
      blockStreaming: true,
    },
    reload: { configPrefixes: ["channels.vibedot"] },
    config: {
      ...vibedotConfigAdapter,
      isConfigured: (account) => Boolean(account.config.token),
      describeAccount: (account) => ({
        accountId: account.accountId,
        enabled: account.enabled,
        configured: Boolean(account.config.token),
      }),
    },
    gateway: {
      startAccount: async (ctx) => {
        const account = ctx.account;
        const token = account.config.token;
        if (!token) {
          ctx.log?.warn(`[${account.accountId}] no token configured, skipping Vibe Dot SSE`);
          return;
        }

        ctx.log?.info(`[${account.accountId}] starting Vibe Dot SSE monitor`);
        const runtime = getVibeDotRuntime();

        await runPassiveAccountLifecycle({
          abortSignal: ctx.abortSignal,
          start: async () => {
            // Fire-and-forget: the monitor runs until aborted
            void startVibeDotMonitor({
              token,
              accountId: account.accountId,
              config: ctx.cfg,
              runtime,
              abortSignal: ctx.abortSignal,
              log: (msg) => ctx.log?.info(msg),
              error: (msg) => ctx.log?.error(msg),
            });
            return undefined;
          },
        });
      },
    },
  },
});
