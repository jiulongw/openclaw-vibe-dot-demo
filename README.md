# openclaw-vibe-dot-demo

OpenClaw channel plugin that receives meeting transcriptions from Vibe Dot devices via Server-Sent Events (SSE).

This is a **one-way inbound channel** -- transcriptions flow into OpenClaw but agent replies are not sent back to the device. Optionally, agent replies can be forwarded to a Slack incoming webhook.

## Configuration

Add the following to your OpenClaw config (`openclaw.json`):

```json
{
  "channels": {
    "vibedot": {
      "token": "your-bearer-token-here",
      "slack_webhook": "https://hooks.slack.com/services/...",
      "enabled": true
    }
  }
}
```

| Field           | Required | Description                                               |
| --------------- | -------- | --------------------------------------------------------- |
| `token`         | Yes      | Bearer token for the SSE relay endpoint                   |
| `slack_webhook` | No       | Slack incoming webhook URL for forwarding agent replies   |
| `enabled`       | No       | Defaults to `true`. Set to `false` to disable the channel |

Alternatively, you can set up the channel using the CLI:

```sh
openclaw channels add --channel vibedot --token "<token>"
```

The `token` is the bearer token used to authenticate with the Vibe Dot SSE relay endpoint at `https://demo-dot-relay.vibeus.workers.dev/dot-messages`. To obtain a token, visit https://demo-dot-relay.vibeus.workers.dev/auth/google.

## How It Works

1. On startup, the plugin opens an SSE connection to the relay endpoint
2. Each SSE event contains a JSON payload with meeting transcription data
3. The `transcription` field is extracted and delivered to OpenClaw as an inbound message
4. The plugin auto-reconnects with exponential backoff if the connection drops
5. If a `slack_webhook` is configured, agent replies are forwarded to Slack; otherwise they are silently discarded

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
