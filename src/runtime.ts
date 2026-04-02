import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

const { setRuntime: setVibeDotRuntime, getRuntime: getVibeDotRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Vibe Dot runtime not initialized");

export { getVibeDotRuntime, setVibeDotRuntime };
