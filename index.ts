import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { vibedotPlugin } from "./src/channel.js";
import { setVibeDotRuntime } from "./src/runtime.js";

export { vibedotPlugin } from "./src/channel.js";
export { setVibeDotRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "vibedot",
  name: "Vibe Dot",
  description: "OpenClaw Vibe Dot meeting transcription channel plugin (demo)",
  plugin: vibedotPlugin as ChannelPlugin,
  setRuntime: setVibeDotRuntime,
});
