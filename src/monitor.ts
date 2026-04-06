import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk/core";
import { dispatchInboundDirectDmWithRuntime } from "openclaw/plugin-sdk/direct-dm";

const SSE_URL = "https://demo-dot-relay.vibeus.workers.dev/dot-messages";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const PING_TIMEOUT_MS = 120_000;

export type VibeDotSSEMessage = {
  user_id: string;
  user_email: string;
  device_type: string;
  meeting_type: string;
  start_timestamp: number;
  audio_url: string;
  transcription: string;
};

export type VibeDotMonitorOptions = {
  token: string;
  accountId: string;
  config: OpenClawConfig;
  runtime: PluginRuntime;
  abortSignal: AbortSignal;
  slackWebhook?: string;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
};

export async function startVibeDotMonitor(options: VibeDotMonitorOptions): Promise<void> {
  const { token, accountId, config, runtime, abortSignal, slackWebhook, log, error } = options;
  let reconnectDelay = RECONNECT_BASE_MS;

  while (!abortSignal.aborted) {
    try {
      log?.("[vibedot] connecting to SSE endpoint...");
      await connectAndProcess({
        token,
        accountId,
        config,
        runtime,
        abortSignal,
        slackWebhook,
        log,
        error,
      });
      // If connectAndProcess returns normally (stream ended), reconnect
      reconnectDelay = RECONNECT_BASE_MS;
    } catch (err) {
      if (abortSignal.aborted) break;
      error?.(`[vibedot] SSE connection error: ${String(err)}`);
      // Exponential backoff
      await sleep(reconnectDelay, abortSignal);
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    }
  }
}

async function connectAndProcess(options: VibeDotMonitorOptions): Promise<void> {
  const { token, accountId, config, runtime, abortSignal, log, error } = options;

  const response = await fetch(SSE_URL, {
    headers: { Authorization: `Bearer ${token}` },
    signal: abortSignal,
  });

  if (!response.ok) {
    throw new Error(`SSE endpoint returned ${response.status}: ${response.statusText}`);
  }

  const body = response.body;
  if (!body) {
    throw new Error("SSE response has no body");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let currentData = "";

  let pingTimedOut = false;
  let pingTimer: ReturnType<typeof setTimeout> | undefined;

  const resetPingTimeout = () => {
    if (pingTimer) clearTimeout(pingTimer);
    pingTimer = setTimeout(() => {
      pingTimedOut = true;
      reader.cancel();
    }, PING_TIMEOUT_MS);
  };

  resetPingTimeout();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith(":")) {
          // Comment line (e.g., ": ping") — reset ping timeout
          resetPingTimeout();
          continue;
        }

        if (line === "") {
          // Empty line = end of event
          if (currentEvent === "message" && currentData) {
            try {
              await processSSEMessage({
                data: currentData,
                accountId,
                config,
                runtime,
                slackWebhook: options.slackWebhook,
                log,
                error,
              });
            } catch (err) {
              error?.(`[vibedot] failed processing message: ${String(err)}`);
            }
          }
          currentEvent = "";
          currentData = "";
          continue;
        }

        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          currentData = line.slice(6);
        }
      }
    }
  } finally {
    if (pingTimer) clearTimeout(pingTimer);
    reader.releaseLock();
  }

  if (pingTimedOut) {
    throw new Error("ping timeout: no ping received for 120s");
  }
}

async function processSSEMessage(params: {
  data: string;
  accountId: string;
  config: OpenClawConfig;
  runtime: PluginRuntime;
  slackWebhook?: string;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
}): Promise<void> {
  const { data, accountId, config, runtime, slackWebhook, log, error } = params;

  let message: VibeDotSSEMessage;
  try {
    message = JSON.parse(data);
  } catch {
    error?.(`[vibedot] failed to parse SSE data: ${data.slice(0, 200)}`);
    return;
  }

  const transcription = message.transcription?.trim();
  if (!transcription) {
    return;
  }

  log?.(
    `[vibedot] received transcription from ${message.user_email}: ${transcription.slice(0, 80)}...`,
  );

  await dispatchInboundDirectDmWithRuntime({
    cfg: config,
    runtime,
    channel: "vibedot",
    channelLabel: "Vibe Dot",
    accountId,
    peer: { kind: "direct", id: message.user_id },
    senderId: message.user_id,
    senderAddress: `vibedot:${message.user_id}`,
    recipientAddress: "vibedot:dot",
    conversationLabel: message.user_email || message.user_id,
    rawBody: transcription,
    messageId: `${message.user_id}-${message.start_timestamp}`,
    timestamp: message.start_timestamp ? message.start_timestamp * 1000 : undefined,
    commandAuthorized: true,
    provider: "vibedot",
    surface: "vibedot",
    extraContext: {
      SenderUsername: message.user_email,
    },
    deliver: async (payload) => {
      log?.(`[vibedot] agent reply: ${JSON.stringify(payload)}`);

      if (slackWebhook) {
        try {
          const text = payload.text ?? "";
          const resp = await fetch(slackWebhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          if (!resp.ok) {
            error?.(`[vibedot] slack webhook returned ${resp.status}: ${resp.statusText}`);
          }
        } catch (err) {
          error?.(`[vibedot] slack webhook error: ${String(err)}`);
        }
      }
    },
    onRecordError: (err) => {
      error?.(`[vibedot] session record error: ${String(err)}`);
    },
    onDispatchError: (err, info) => {
      error?.(`[vibedot] reply dispatch error (${info.kind}): ${String(err)}`);
    },
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
