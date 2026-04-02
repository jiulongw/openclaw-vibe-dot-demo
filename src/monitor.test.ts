import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { VibeDotMonitorOptions, VibeDotSSEMessage } from "./monitor.js";
import { startVibeDotMonitor } from "./monitor.js";

// Mock dispatchInboundDirectDmWithRuntime
vi.mock("openclaw/plugin-sdk/direct-dm", () => ({
  dispatchInboundDirectDmWithRuntime: vi.fn().mockResolvedValue(undefined),
}));

import { dispatchInboundDirectDmWithRuntime } from "openclaw/plugin-sdk/direct-dm";

const mockDispatch = vi.mocked(dispatchInboundDirectDmWithRuntime);

// --- SSE stream helpers ---

function sseFrame(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}

function makeMessage(overrides: Partial<VibeDotSSEMessage> = {}): VibeDotSSEMessage {
  return {
    user_id: "user-1",
    user_email: "alice@example.com",
    device_type: "dot",
    meeting_type: "standup",
    start_timestamp: 1700000000,
    audio_url: "https://example.com/audio.wav",
    transcription: "Hello, this is a test transcription.",
    ...overrides,
  };
}

function createReadableStreamFromString(content: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(content));
      controller.close();
    },
  });
}

function createReadableStreamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function makeOptions(overrides: Partial<VibeDotMonitorOptions> = {}): VibeDotMonitorOptions {
  return {
    token: "test-token",
    accountId: "default",
    config: { channels: { vibedot: { token: "test-token" } } } as any,
    runtime: {} as any,
    abortSignal: AbortSignal.timeout(5000),
    log: vi.fn(),
    error: vi.fn(),
    ...overrides,
  };
}

describe("startVibeDotMonitor", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockDispatch.mockClear();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("connects with correct authorization header", async () => {
    const abortController = new AbortController();
    const body = createReadableStreamFromString(sseFrame("message", JSON.stringify(makeMessage())));

    fetchSpy.mockResolvedValueOnce(new Response(body, { status: 200 }));
    // Abort after first connection completes to stop the reconnect loop
    fetchSpy.mockImplementation(() => {
      abortController.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });

    await startVibeDotMonitor(makeOptions({ abortSignal: abortController.signal }));

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://demo-dot-relay.vibeus.workers.dev/dot-messages",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-token" },
      }),
    );
  });

  it("dispatches transcription as inbound DM", async () => {
    const abortController = new AbortController();
    const msg = makeMessage({ transcription: "Discuss Q4 goals" });
    const body = createReadableStreamFromString(sseFrame("message", JSON.stringify(msg)));

    fetchSpy.mockResolvedValueOnce(new Response(body, { status: 200 }));
    fetchSpy.mockImplementation(() => {
      abortController.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });

    await startVibeDotMonitor(makeOptions({ abortSignal: abortController.signal }));

    expect(mockDispatch).toHaveBeenCalledOnce();
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "vibedot",
        channelLabel: "Vibe Dot",
        rawBody: "Discuss Q4 goals",
        senderId: "user-1",
        senderAddress: "vibedot:user-1",
        messageId: "user-1-1700000000",
        conversationLabel: "alice@example.com",
      }),
    );
  });

  it("skips messages with empty transcription", async () => {
    const abortController = new AbortController();
    const msg = makeMessage({ transcription: "" });
    const body = createReadableStreamFromString(sseFrame("message", JSON.stringify(msg)));

    fetchSpy.mockResolvedValueOnce(new Response(body, { status: 200 }));
    fetchSpy.mockImplementation(() => {
      abortController.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });

    await startVibeDotMonitor(makeOptions({ abortSignal: abortController.signal }));

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("skips messages with whitespace-only transcription", async () => {
    const abortController = new AbortController();
    const msg = makeMessage({ transcription: "   \n  " });
    const body = createReadableStreamFromString(sseFrame("message", JSON.stringify(msg)));

    fetchSpy.mockResolvedValueOnce(new Response(body, { status: 200 }));
    fetchSpy.mockImplementation(() => {
      abortController.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });

    await startVibeDotMonitor(makeOptions({ abortSignal: abortController.signal }));

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("handles malformed JSON gracefully", async () => {
    const abortController = new AbortController();
    const body = createReadableStreamFromString(sseFrame("message", "not-json{{{"));
    const errorFn = vi.fn();

    fetchSpy.mockResolvedValueOnce(new Response(body, { status: 200 }));
    fetchSpy.mockImplementation(() => {
      abortController.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });

    await startVibeDotMonitor(makeOptions({ abortSignal: abortController.signal, error: errorFn }));

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(errorFn).toHaveBeenCalledWith(expect.stringContaining("failed to parse SSE data"));
  });

  it("ignores SSE comment lines", async () => {
    const abortController = new AbortController();
    const msg = makeMessage();
    const stream = `: this is a comment\n${sseFrame("message", JSON.stringify(msg))}`;
    const body = createReadableStreamFromString(stream);

    fetchSpy.mockResolvedValueOnce(new Response(body, { status: 200 }));
    fetchSpy.mockImplementation(() => {
      abortController.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });

    await startVibeDotMonitor(makeOptions({ abortSignal: abortController.signal }));

    // The message after the comment should still be processed
    expect(mockDispatch).toHaveBeenCalledOnce();
  });

  it("ignores non-message events", async () => {
    const abortController = new AbortController();
    const body = createReadableStreamFromString(
      sseFrame("ping", JSON.stringify(makeMessage())) +
        sseFrame("heartbeat", JSON.stringify(makeMessage())),
    );

    fetchSpy.mockResolvedValueOnce(new Response(body, { status: 200 }));
    fetchSpy.mockImplementation(() => {
      abortController.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });

    await startVibeDotMonitor(makeOptions({ abortSignal: abortController.signal }));

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("processes multiple messages in a single stream", async () => {
    const abortController = new AbortController();
    const msg1 = makeMessage({ user_id: "user-1", transcription: "First message" });
    const msg2 = makeMessage({ user_id: "user-2", transcription: "Second message" });
    const body = createReadableStreamFromString(
      sseFrame("message", JSON.stringify(msg1)) + sseFrame("message", JSON.stringify(msg2)),
    );

    fetchSpy.mockResolvedValueOnce(new Response(body, { status: 200 }));
    fetchSpy.mockImplementation(() => {
      abortController.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });

    await startVibeDotMonitor(makeOptions({ abortSignal: abortController.signal }));

    expect(mockDispatch).toHaveBeenCalledTimes(2);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ rawBody: "First message" }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ rawBody: "Second message" }),
    );
  });

  it("handles data split across chunks", async () => {
    const abortController = new AbortController();
    const msg = makeMessage({ transcription: "Split message" });
    const fullFrame = sseFrame("message", JSON.stringify(msg));
    // Split the frame in the middle
    const mid = Math.floor(fullFrame.length / 2);
    const body = createReadableStreamFromChunks([fullFrame.slice(0, mid), fullFrame.slice(mid)]);

    fetchSpy.mockResolvedValueOnce(new Response(body, { status: 200 }));
    fetchSpy.mockImplementation(() => {
      abortController.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });

    await startVibeDotMonitor(makeOptions({ abortSignal: abortController.signal }));

    expect(mockDispatch).toHaveBeenCalledOnce();
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ rawBody: "Split message" }),
    );
  });

  it("throws on non-200 response and logs error", async () => {
    const abortController = new AbortController();
    const errorFn = vi.fn();

    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 401, statusText: "Unauthorized" }));
    fetchSpy.mockImplementation(() => {
      abortController.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });

    await startVibeDotMonitor(makeOptions({ abortSignal: abortController.signal, error: errorFn }));

    expect(errorFn).toHaveBeenCalledWith(expect.stringContaining("SSE connection error"));
    expect(errorFn).toHaveBeenCalledWith(expect.stringContaining("401"));
  });

  it("stops when abort signal is triggered", async () => {
    const abortController = new AbortController();
    abortController.abort();

    await startVibeDotMonitor(makeOptions({ abortSignal: abortController.signal }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("forwards agent reply to Slack webhook", async () => {
    const abortController = new AbortController();
    const msg = makeMessage();
    const body = createReadableStreamFromString(sseFrame("message", JSON.stringify(msg)));
    let sseCallCount = 0;

    (mockDispatch as any).mockImplementation(async (params: any) => {
      await params.deliver({ text: "Agent says hello" });
    });

    fetchSpy.mockImplementation((input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("slack")) {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      // SSE endpoint
      sseCallCount++;
      if (sseCallCount === 1) {
        return Promise.resolve(new Response(body, { status: 200 }));
      }
      abortController.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });

    await startVibeDotMonitor(
      makeOptions({
        abortSignal: abortController.signal,
        slackWebhook: "https://hooks.slack.com/services/test",
      }),
    );

    const slackCall = fetchSpy.mock.calls.find(
      (call: any[]) => typeof call[0] === "string" && call[0].includes("slack"),
    );
    expect(slackCall).toBeDefined();
    expect(slackCall![1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Agent says hello" }),
      }),
    );
  });

  it("does not call Slack when webhook is not configured", async () => {
    const abortController = new AbortController();
    const msg = makeMessage();
    const body = createReadableStreamFromString(sseFrame("message", JSON.stringify(msg)));

    (mockDispatch as any).mockImplementation(async (params: any) => {
      await params.deliver({ text: "Reply" });
    });

    fetchSpy.mockResolvedValueOnce(new Response(body, { status: 200 }));
    fetchSpy.mockImplementation(() => {
      abortController.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });

    await startVibeDotMonitor(makeOptions({ abortSignal: abortController.signal }));

    // Only the SSE endpoint should have been called, not any webhook
    const calls = fetchSpy.mock.calls.filter(
      (call: any[]) => typeof call[0] === "string" && call[0].includes("slack"),
    );
    expect(calls).toHaveLength(0);
  });

  it("logs Slack webhook errors without throwing", async () => {
    const abortController = new AbortController();
    const msg = makeMessage();
    const body = createReadableStreamFromString(sseFrame("message", JSON.stringify(msg)));
    const errorFn = vi.fn();
    let sseCallCount = 0;

    (mockDispatch as any).mockImplementation(async (params: any) => {
      await params.deliver({ text: "Reply" });
    });

    fetchSpy.mockImplementation((input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("slack")) {
        return Promise.resolve(
          new Response(null, { status: 500, statusText: "Internal Server Error" }),
        );
      }
      sseCallCount++;
      if (sseCallCount === 1) {
        return Promise.resolve(new Response(body, { status: 200 }));
      }
      abortController.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });

    await startVibeDotMonitor(
      makeOptions({
        abortSignal: abortController.signal,
        slackWebhook: "https://hooks.slack.com/services/test",
        error: errorFn,
      }),
    );

    expect(errorFn).toHaveBeenCalledWith(expect.stringContaining("slack webhook returned 500"));
  });

  it("sets timestamp from start_timestamp in milliseconds", async () => {
    const abortController = new AbortController();
    const msg = makeMessage({ start_timestamp: 1700000000 });
    const body = createReadableStreamFromString(sseFrame("message", JSON.stringify(msg)));

    fetchSpy.mockResolvedValueOnce(new Response(body, { status: 200 }));
    fetchSpy.mockImplementation(() => {
      abortController.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });

    await startVibeDotMonitor(makeOptions({ abortSignal: abortController.signal }));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ timestamp: 1700000000000 }),
    );
  });

  it("uses user_email as conversationLabel, falls back to user_id", async () => {
    const abortController = new AbortController();
    const msg = makeMessage({ user_email: "", user_id: "fallback-id" });
    const body = createReadableStreamFromString(sseFrame("message", JSON.stringify(msg)));

    fetchSpy.mockResolvedValueOnce(new Response(body, { status: 200 }));
    fetchSpy.mockImplementation(() => {
      abortController.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });

    await startVibeDotMonitor(makeOptions({ abortSignal: abortController.signal }));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ conversationLabel: "fallback-id" }),
    );
  });
});
