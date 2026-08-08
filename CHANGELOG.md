# Changelog

All notable changes to the player's UI (`index.html` / `style.css` / `app.js`) are logged here. No backend or data-layer changes are included in this log — everything below is client-side (markup, styling, canvas drawing, and local UI state).

## Added

- **Mood Shuffle** — new topbar button/menu offering the pad's four mood quadrants (Mellow, Upbeat, Moody, Intense). Picking one drops a randomized point inside that quadrant (inset from the edges) and queues the nearest tracks to it using the current MIX SIZE, so repicking the same mood gives a different mix each time rather than a fixed spot.
- **"Locate now playing" button** — a crosshair-icon button alongside the existing pad zoom controls (+ / − / reset) that recenters and zooms in on whichever track is currently playing. Required generalizing the pad's pan animation to interpolate zoom level as well as position (previously recenter-only).
- **Search field clear (×) button** — appears once text is entered in the topbar search box; clears the field, resets the pad filter, and refocuses the input.
- **Settings panel** (cog icon, topbar) — a persisted (`localStorage`) settings modal with:
  - *Music square transparency* — slider, affects only the pad's own panel background.
  - *Panel transparency* — slider, affects the topbar search field, sidebar/queue panel, and playlist-builder search field.
  - *Background dimness* — slider that layers an adjustable black overlay between the visualizer and the UI.
  - *Background visualizer on/off* — toggle; when off, the visualizer's per-frame draw work is skipped (canvas just stays cleared) rather than the animation loop being torn down, so it resumes instantly when re-enabled.
  - *Blur track info* — toggle (see below).
  - *Reset to defaults* — restores all of the above. Slider defaults are calibrated to exactly reproduce the app's original baked-in transparency values, so enabling settings for the first time doesn't visibly change anything until a control is touched.
- **Blur track info** — when enabled, blurs the title/artist text in both the "now playing" card and every row in the queue list. Each blurred element reveals individually on hover (not the whole list at once), so a track can be peeked at without exposing the rest of the queue — intended for streaming/screen-sharing.

## Changed

- **Pad artwork ring visibility** — non-dimmed track thumbnails on the mood pad now draw at full opacity (0.9 → 1) instead of blending into overlapping neighbors, so the thin ring stroke baked around each thumbnail stays legible.
- **Panel transparency, split from pad transparency** — introduced a `--surface-outer` CSS variable, distinct from the pad's own `--surface`, and moved the topbar search field, the sidebar/queue panel, and the playlist-builder search field onto it. This lets the chrome around the pad be made more see-through (`--surface-2` lowered 0.09 → 0.05 alpha) without touching the mood pad's own background.
- **Drag-sweep line on the pad** — reworked from a single faint stroke into a dark-halo + bright-core double stroke for legibility over busy album art, plus a trail of small bubble-like circles along the path (size varying organically, fading in from the tail toward the current drag position).

## Fixed

- **Album-art color pipeline** — the ambient per-track color sampling had a lightness floor (`Math.max(0.22, …)`) alongside its ceiling, so genuinely dark/moody covers (mostly black or navy artwork) were being artificially brightened toward grey instead of staying dark. Removed the floor; only the near-white blowout ceiling remains.
- **Background visualizer over-saturation** — the blurred spectrum wash behind the app was reading as blown-out/clipped on louder tracks. Tuned down the CSS `saturate()` filter (1.4 → 1.1) and the visualizer's playing-state paint alpha (0.9 → 0.6).
- **Background visualizer pinning/"static" look on loud songs** — the level-compression curve (soft-knee + `pow(x, 0.5)`) was pushing most frequency bins to near-max height together on loud passages, so the spikes read as a flat, barely-animating plateau. Eased the knee rate (1.15 → 0.85) and the compression exponent (0.5 → 0.75) to restore headroom and bin-to-bin separation.
- **Mood Shuffle menu rendering behind the sidebar** — the topbar and the main layout shared the same stacking-context `z-index: 1`, so the layout (painted later in the DOM) covered any dropdown opened from the topbar regardless of the dropdown's own z-index. Gave the topbar its own higher z-index so its menus render above the pad/sidebar.

## Files touched

| File | Changes |
|---|---|
| `index.html` | Topbar (search-clear button, Mood Shuffle button + menu, settings/cog button), settings modal markup, `#bg-dim` overlay element. |
| `style.css` | `--surface` / `--surface-outer` split, search-clear/mood-menu/settings-modal/toggle-switch/`#bg-dim`/blur styling, topbar z-index fix. |
| `app.js` | Color-clamp fix, visualizer saturation/compression tuning, pad artwork alpha, drag-path redraw (contrast stroke + bubble trail), generalized pan/zoom animation, "locate now playing", search-clear wiring, Mood Shuffle logic, settings persistence/application, blur-track toggle. |
