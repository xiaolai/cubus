// Guest half of the DEV-ONLY Tauri MCP bridge (bundled to vendor/tauri-mcp-guest.js by
// `pnpm build:mcp-guest`). It registers the in-page listeners the tauri-plugin-mcp Rust side
// drives for selector-based clicks, DOM queries and JS eval — the tooling that lets an AI agent
// verify this app by driving it instead of guessing at screenshots.
//
// Inert by construction everywhere it must not act: the listeners only answer events emitted by
// the Rust plugin, which is compiled only behind the desktop crate's `mcp` cargo feature (dev
// builds; `tauri build` never includes it) and only activates when CUBUS_MCP=1 is set.
export { setupPluginListeners } from 'tauri-plugin-mcp';
