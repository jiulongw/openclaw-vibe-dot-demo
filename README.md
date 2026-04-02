# @openclaw/vibedot-demo

OpenClaw channel plugin that receives meeting transcriptions from Vibe Dot devices via Server-Sent Events (SSE).

This is a **one-way inbound channel** -- transcriptions flow into OpenClaw but agent replies are not surfaced back to the device.

## Configuration

Add the following to your OpenClaw config (`openclaw.yaml`):

```yaml
channels:
  vibedot:
    token: "your-bearer-token-here"
```

The `token` is the bearer token used to authenticate with the Vibe Dot SSE relay endpoint at `https://demo-dot-relay.vibeus.workers.dev/dot-messages`.

## How It Works

1. On startup, the plugin opens an SSE connection to the relay endpoint
2. Each SSE event contains a JSON payload with meeting transcription data
3. The `transcription` field is extracted and delivered to OpenClaw as an inbound message
4. The plugin auto-reconnects with exponential backoff if the connection drops
5. Agent replies are silently discarded (one-way channel)

## SSE Message Format

```json
{
  "user_id": "...",
  "user_email": "user@example.com",
  "device_type": "dot",
  "meeting_type": "normal",
  "start_timestamp": 1775104884,
  "audio_url": "https://...",
  "transcription": "Hello, this is a transcription from the meeting."
}
```
