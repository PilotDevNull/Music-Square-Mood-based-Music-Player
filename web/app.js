(() => {
  "use strict";

  const canvas = document.getElementById("pad");
  const ctx = canvas.getContext("2d");
  const readout = document.getElementById("readout");
  const libinfo = document.getElementById("libinfo");
  const searchBox = document.getElementById("search");

  const player = document.getElementById("player");
  const btnPlay = document.getElementById("btn-play");
  const btnPrev = document.getElementById("btn-prev");
  const btnNext = document.getElementById("btn-next");
  const seek = document.getElementById("seek");
  const timeCur = document.getElementById("time-cur");
  const timeDur = document.getElementById("time-dur");
  const radius = document.getElementById("radius");
  const radiusVal = document.getElementById("radius-val");
  const vol = document.getElementById("vol");

  const npTitle = document.getElementById("np-title");
  const npArtist = document.getElementById("np-artist");
  const npFormat = document.getElementById("np-format");
  const npStats = document.getElementById("np-stats");
  const npArt = document.getElementById("np-art");
  const npGlyph = document.getElementById("np-glyph");
  const colorSampler = document.getElementById("color-sampler");
  const queueList = document.getElementById("queue-list");
  const queueCount = document.getElementById("queue-count");

  const btnShuffle = document.getElementById("btn-shuffle");
  const btnRepeat = document.getElementById("btn-repeat");
  const btnLike = document.getElementById("btn-like");

  const btnOpenBuilder = document.getElementById("btn-open-builder");
  const builderOverlay = document.getElementById("builder-overlay");
  const builderClose = document.getElementById("builder-close");
  const builderSearch = document.getElementById("builder-search");
  const builderResultsEl = document.getElementById("builder-results");
  const builderSeedsEl = document.getElementById("builder-seeds");
  const seedCountEl = document.getElementById("seed-count");
  const builderSize = document.getElementById("builder-size");
  const builderSizeVal = document.getElementById("builder-size-val");
  const builderBuildBtn = document.getElementById("builder-build");

  // ---------- ambient background visualizer ----------
  // A soft, blurred audio-reactive wash behind the whole UI - drawn on a
  // fixed full-viewport canvas that sits below the glass panels (which then
  // let it bloom through). Built on the Web Audio API's AnalyserNode, tapped
  // straight off the <audio> element so it reacts to whatever's actually
  // playing. Falls back to a slow idle shimmer when nothing's playing, or
  // silently does nothing if Web Audio isn't available.
  (function initBackgroundVisualizer() {
    const bgCanvas = document.getElementById("bg-visualizer");
    if (!bgCanvas) return;
    const bgCtx = bgCanvas.getContext("2d");
    const padEl = document.getElementById("pad");

    let audioCtx, analyser, dataArray, bufferLength, sourceNode;
    const HALF_POINTS = 26; // mirrored left/right -> 51 sample points total

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      bgCanvas.width = Math.round(window.innerWidth * dpr);
      bgCanvas.height = Math.round(window.innerHeight * dpr);
      bgCanvas.style.width = window.innerWidth + "px";
      bgCanvas.style.height = window.innerHeight + "px";
      bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener("resize", resize);
    resize();

    // Anchors the visualizer on the mood pad itself (rather than the
    // viewport center), so the glow reads as radiating from the square
    // people are actually interacting with. Falls back to the viewport
    // center if the pad isn't in the DOM for some reason.
    function padAnchor() {
      if (!padEl) {
        return { cx: window.innerWidth / 2, cy: window.innerHeight / 2, span: Math.min(window.innerWidth, window.innerHeight) };
      }
      const r = padEl.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, span: Math.max(r.width, r.height) };
    }

    // The Web Audio graph can only be built after a user gesture (autoplay
    // policy) and createMediaElementSource can only ever be called once per
    // <audio> element, so this is deliberately lazy + guarded.
    function ensureAudioGraph() {
      if (audioCtx) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioCtx = new AC();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.82;
        bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        sourceNode = audioCtx.createMediaElementSource(player);
        sourceNode.connect(analyser);
        analyser.connect(audioCtx.destination);
      } catch (e) {
        audioCtx = null; // unsupported/blocked - visualizer just stays idle
      }
    }

    player.addEventListener("play", () => {
      ensureAudioGraph();
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    });

    function accentColors() {
      const cs = getComputedStyle(document.documentElement);
      const a1 = cs.getPropertyValue("--dyn-accent").trim() || "#F3B88A";
      const a2 = cs.getPropertyValue("--dyn-accent-2").trim() || "#B9D9A8";
      return [a1, a2];
    }

    // Raw FFT bins are linear-frequency, so bass dominates the first few
    // bins and everything above the low-mids reads as near-silent - which
    // is what made the old version look like it was only lighting up on
    // the left. This buckets bins on a log-ish curve (so highs get a fair
    // share of the bars, not just one starved bin) and applies a rising
    // gain curve to compensate for the naturally weaker high-frequency
    // energy, so the spread looks even across the full width. A power
    // curve then compresses the dynamic range - without it, the bass bin
    // (which lands at the very center once mirrored) towers over
    // everything else and the whole thing reads as one clustered peak
    // instead of a spread-out spectrum.
    function computeLevels(t) {
      const levels = new Array(HALF_POINTS);
      if (analyser && audioCtx && !player.paused && !player.ended) {
        analyser.getByteFrequencyData(dataArray);
        for (let i = 0; i < HALF_POINTS; i++) {
          const t0 = i / HALF_POINTS;
          const t1 = (i + 1) / HALF_POINTS;
          const startBin = Math.floor(t0 * t0 * bufferLength);
          const endBin = Math.max(startBin + 1, Math.floor(t1 * t1 * bufferLength));
          let sum = 0, n = 0;
          for (let b = startBin; b < endBin && b < bufferLength; b++) { sum += dataArray[b]; n++; }
          const raw = n ? (sum / n) / 255 : 0;
          const gain = 1 + t0 * 1.7; // boost highs so they're not invisible next to bass
          const compressed = Math.pow(Math.min(1, raw * gain), 0.5);
          levels[i] = Math.max(0.1, compressed); // floor keeps quiet bins from vanishing entirely
        }
        return { levels, playing: true };
      }
      // gentle idle shimmer so the wash never looks dead when paused
      for (let i = 0; i < HALF_POINTS; i++) {
        levels[i] = 0.08 + 0.07 * Math.sin(t / 1400 + i * 0.45);
      }
      return { levels, playing: false };
    }

    // Traces a smooth curve through a series of points (quadratic-curve
    // midpoint smoothing) instead of connecting them with straight
    // segments - used for the translucent waveform outline overlaid on
    // top of the bars.
    function smoothLineTo(c, pts) {
      c.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const xc = (pts[i][0] + pts[i + 1][0]) / 2;
        const yc = (pts[i][1] + pts[i + 1][1]) / 2;
        c.quadraticCurveTo(pts[i][0], pts[i][1], xc, yc);
      }
      const last = pts[pts.length - 1];
      c.lineTo(last[0], last[1]);
    }

    // 1x1 scratch canvas used purely to resolve whatever color format the
    // live CSS custom properties happen to be in (hex or hsl()) down to an
    // actual hue, so the rainbow sweep can be anchored to the current
    // theme instead of a hardcoded palette.
    const swatch = document.createElement("canvas");
    swatch.width = 1; swatch.height = 1;
    const swatchCtx = swatch.getContext("2d", { willReadFrequently: true });
    function hueOf(cssColor) {
      try {
        swatchCtx.fillStyle = "#000";
        swatchCtx.fillRect(0, 0, 1, 1);
        swatchCtx.fillStyle = cssColor;
        swatchCtx.fillRect(0, 0, 1, 1);
        const d = swatchCtx.getImageData(0, 0, 1, 1).data;
        return rgbToHsl(d[0], d[1], d[2])[0];
      } catch (e) { return 200; }
    }

    // Maps a frequency index to a color: pulled straight from the current
    // track's artwork palette when one is available, otherwise a rainbow
    // hue-sweep anchored to the theme accent as a graceful fallback (e.g.
    // before any art has loaded, or for art-less tracks).
    function colorAt(i, n, colors, baseHue) {
      if (colors && colors.length) {
        const p = i / (n - 1);
        const idx = Math.min(colors.length - 1, Math.floor(p * (colors.length - 1)));
        return colors[idx];
      }
      const hue = baseHue + (i / (n - 1) - 0.5) * 190;
      return `hsl(${hue} 78% 60%)`;
    }

    // Full amplitude across the inner ~two-thirds of the span, then eases
    // down gently over the outer tips - just enough to read as a taper,
    // not so much that the extending bits fade to nothing. Kept mild on
    // purpose: the frequency mapping below already puts the loudest (bass)
    // content at the center, so a steep taper on top of that was what made
    // the whole thing read as one clustered peak instead of a spread-out
    // spectrum.
    function envelopeAt(i, n) {
      const p = i / (n - 1);
      const d = Math.abs(p - 0.5) * 2; // 0 at center, 1 at the outer tips
      if (d <= 0.65) return 1;
      const q = (d - 0.65) / 0.35;
      return 1 - 0.35 * q * q;
    }

    // Mirrored spiky waveform, like a stack of thin overlapping diamonds
    // rising/falling from the pad's center line - each one individually
    // colored so the frequency spread reads as a real spectrum, not a
    // solid block. Colors and blend combine into the soft plasma look
    // once the CSS blur hits the canvas.
    function drawSpikes(cx, cy, halfWidth, levels, amp, colors, baseHue) {
      const n = levels.length;
      const step = (halfWidth * 2) / (n - 1);
      const halfBarW = step * 0.82;
      const topPts = [], botPts = [];

      // Normal alpha blending for the fills - every diamond's left/right
      // tips converge on the center line, so additive ("lighter") blending
      // here stacked them into one over-bright band that read as a single
      // clustered blob instead of a spread-out spectrum. Lighter blending
      // is still used for the glow outline below, where it belongs.
      bgCtx.globalCompositeOperation = "source-over";
      for (let i = 0; i < n; i++) {
        const x = cx - halfWidth + i * step;
        const env = envelopeAt(i, n);
        const h = Math.max(2, levels[i] * amp * env);
        const color = colorAt(i, n, colors, baseHue);

        bgCtx.fillStyle = color;
        bgCtx.beginPath();
        bgCtx.moveTo(x - halfBarW, cy);
        bgCtx.lineTo(x, cy - h);
        bgCtx.lineTo(x + halfBarW, cy);
        bgCtx.lineTo(x, cy + h);
        bgCtx.closePath();
        bgCtx.fill();

        topPts.push([x, cy - h]);
        botPts.push([x, cy + h]);
      }

      // soft glowing outline traced across the spike tips, top and bottom,
      // using the same color spread for cohesion
      const grad = bgCtx.createLinearGradient(cx - halfWidth, 0, cx + halfWidth, 0);
      if (colors && colors.length) {
        colors.forEach((c, i) => grad.addColorStop(i / (colors.length - 1), c));
      } else {
        for (let i = 0; i <= 10; i++) grad.addColorStop(i / 10, colorAt(i, 10, null, baseHue));
      }
      bgCtx.globalCompositeOperation = "lighter";
      bgCtx.lineWidth = 2;
      bgCtx.strokeStyle = grad;
      bgCtx.globalAlpha *= 0.7;
      bgCtx.beginPath();
      smoothLineTo(bgCtx, topPts);
      bgCtx.stroke();
      bgCtx.beginPath();
      smoothLineTo(bgCtx, botPts);
      bgCtx.stroke();
      bgCtx.globalAlpha /= 0.7;

      // thin hairline through the center, like a zero-crossing axis
      bgCtx.globalCompositeOperation = "source-over";
      bgCtx.strokeStyle = "hsla(350 85% 65% / 0.4)";
      bgCtx.lineWidth = 1.5;
      bgCtx.beginPath();
      bgCtx.moveTo(cx - halfWidth, cy);
      bgCtx.lineTo(cx + halfWidth, cy);
      bgCtx.stroke();
    }

    function frame(t) {
      const W = window.innerWidth, H = window.innerHeight;
      bgCtx.clearRect(0, 0, W, H);

      const [c1] = accentColors();
      const { levels, playing } = computeLevels(t);
      const { cx, cy, span } = padAnchor();

      // mirror the sampled levels into a full point set so the equalizer
      // reads as symmetric outward from the pad's own center.
      const full = new Array(levels.length * 2 - 1);
      const mid = levels.length - 1;
      for (let i = 0; i < levels.length; i++) {
        full[mid + i] = levels[i];
        full[mid - i] = levels[i];
      }

      // kept close to the pad's own footprint (not the viewport) so the
      // whole effect reads as anchored to the square, blurring outward
      // into the surrounding glass panels rather than washing the screen.
      // The square's own edge sits at span/2 from center, so this reaches
      // about half the square's length past each edge on top of that.
      const halfWidth = span * 1.0;
      const amp = span * 0.22;
      const baseHue = hueOf(c1);

      bgCtx.globalAlpha = playing ? 0.9 : 0.35;
      drawSpikes(cx, cy, halfWidth, full, amp, vizPalette, baseHue);
      bgCtx.globalCompositeOperation = "source-over";
      bgCtx.globalAlpha = 1;

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  })();


  let tracks = [];           // full library
  let filterActive = false;
  let matchedIds = new Set();
  let queue = [];            // array of track objects, current playing order
  let queueIds = new Set();  // t.id for everything in queue - lets the pad dim non-queued tracks
  let currentIndex = -1;
  let seekDragging = false;

  let probe = null;          // {x,y,t0} for ripple animation
  let dragPath = [];         // points collected while dragging
  let isDragging = false;
  let dragMoved = false;

  let seeds = [];            // tracks added in the playlist builder, in order added
  let builtIds = new Set();  // ids highlighted on the pad from the last "Build"
  let builtActive = false;

  let shuffleOn = false;
  let repeatOn = false;
  let liked = new Set(JSON.parse(localStorage.getItem("musicSquareLiked") || "[]"));

  // Colors sampled straight from the currently playing track's artwork,
  // left-to-right across the image - used by the background visualizer so
  // each frequency band gets a color that actually came from the cover,
  // not a synthetic rainbow. Populated in playIndex() once art loads.
  let vizPalette = null;

  // ---------- pad thumbnails (album art dots) ----------
  const ART_R = 8;   // pad-dot radius when a track has usable art
  const DOT_R = 3;   // pad-dot radius when falling back to a plain mood dot
  const artThumbs = new Map();    // trackId -> pre-baked offscreen canvas (clipped circle + ring)
  const artFailed = new Set();    // trackIds whose art failed to load, don't retry
  const artRequested = new Map(); // trackId -> Promise<void> (resolves once baked or failed - never rejects)
  const artPopStart = new Map();  // trackId -> performance.now() when its thumb finished baking, for the pop-in animation
  const trackPopStart = new Map(); // trackId -> performance.now() when this track is allowed to first appear on the pad
  let renderScheduled = false;

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => { renderScheduled = false; render(); });
  }

  // ---------- art asset cache ----------
  // Two layers, so artwork only ever gets downloaded once per browser:
  //  1. an in-memory Map of trackId -> Promise<blobUrl>, so the pad preload,
  //     the queue thumbnail, and the now-playing panel all share one fetch
  //     instead of each requesting the same image separately.
  //  2. the Cache Storage API, which persists the actual image bytes across
  //     page reloads - so on a refresh, art comes back instantly from disk
  //     instead of re-downloading and popping in dot-by-dot again.
  const artBlobCache = new Map(); // trackId -> Promise<string blobUrl>
  let artCacheStorage; // undefined = not yet resolved, null = unsupported/unavailable

  async function getArtCacheStorage() {
    if (artCacheStorage !== undefined) return artCacheStorage;
    if (!("caches" in window)) { artCacheStorage = null; return null; }
    try { artCacheStorage = await caches.open("musicpad-art-v1"); }
    catch (e) { artCacheStorage = null; }
    return artCacheStorage;
  }

  function fetchArtBlobUrl(id, url) {
    if (artBlobCache.has(id)) return artBlobCache.get(id);
    const p = (async () => {
      const store = await getArtCacheStorage();
      if (store) {
        try {
          const hit = await store.match(url);
          if (hit) return URL.createObjectURL(await hit.blob());
        } catch (e) { /* fall through to network */ }
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error("art fetch failed: " + url);
      if (store) {
        try { await store.put(url, res.clone()); } catch (e) { /* quota etc - non-fatal */ }
      }
      return URL.createObjectURL(await res.blob());
    })();
    artBlobCache.set(id, p);
    return p;
  }

  // Bakes a loaded <img> into a small offscreen canvas, clipped to a circle
  // with the ring already stroked on. Doing the clip/stroke once here (instead
  // of on the live context every frame) turns per-frame drawing into a plain
  // drawImage blit, which is what was making the pad sluggish with a big library.
  function bakeThumb(img) {
    const size = ART_R * 2;
    const off = document.createElement("canvas");
    off.width = size;
    off.height = size;
    const octx = off.getContext("2d");
    octx.save();
    octx.beginPath();
    octx.arc(ART_R, ART_R, ART_R, 0, Math.PI * 2);
    octx.closePath();
    octx.clip();
    octx.drawImage(img, 0, 0, size, size);
    octx.restore();
    octx.beginPath();
    octx.arc(ART_R, ART_R, ART_R - 0.5, 0, Math.PI * 2);
    octx.strokeStyle = "rgba(0,0,0,0.4)";
    octx.lineWidth = 1;
    octx.stroke();
    return off;
  }

  // Kicks off (once) loading a track's art so it can be baked and drawn on
  // the pad. Cheap to call repeatedly - returns the same in-flight/settled
  // promise on later calls instead of re-requesting. Resolves once the art
  // is baked *or* has failed - it deliberately never rejects, so awaiting a
  // whole batch of these (Promise.all) can't be short-circuited by one bad
  // track's art failing to load.
  function preloadArt(t) {
    if (!t.art) return Promise.resolve();
    if (artRequested.has(t.id)) return artRequested.get(t.id);
    const p = fetchArtBlobUrl(t.id, t.art)
      .then((blobUrl) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { artThumbs.set(t.id, bakeThumb(img)); artPopStart.set(t.id, performance.now()); scheduleRender(); resolve(); };
        img.onerror = () => { artFailed.add(t.id); resolve(); };
        img.src = blobUrl;
      }))
      .catch(() => { artFailed.add(t.id); });
    artRequested.set(t.id, p);
    return p;
  }

  // Boosts saturation by pushing each channel further from the pixel's own
  // average, so the four mood colors read as more vivid on the pad without
  // changing their underlying hue/brightness balance.
  function popColor(rgb, amount = 1.4) {
    const avg = (rgb[0] + rgb[1] + rgb[2]) / 3;
    return rgb.map((c) => Math.round(Math.max(0, Math.min(255, avg + (c - avg) * amount))));
  }

  const COLORS = {
    tl: popColor([95, 208, 198]),   // calm + joyful -> cyan
    tr: popColor([232, 163, 61]),   // exciting + joyful -> amber
    bl: popColor([108, 127, 224]),  // calm + sad -> indigo
    br: popColor([217, 72, 122]),   // exciting + sad -> magenta
  };

  function lerp(a, b, t) { return a + (b - a) * t; }

  const DEFAULT_THEME = {
    bg: "#3B2A20", bg2: "#241811", accent: "#F3B88A", accent2: "#B9D9A8",
  };

  function resetDynamicTheme() {
    const root = document.documentElement.style;
    root.setProperty("--dyn-bg", DEFAULT_THEME.bg);
    root.setProperty("--dyn-bg-2", DEFAULT_THEME.bg2);
    root.setProperty("--dyn-accent", DEFAULT_THEME.accent);
    root.setProperty("--dyn-accent-2", DEFAULT_THEME.accent2);
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    const d = max - min;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      switch (max) {
        case r: h = ((g - b) / d) % 6; break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, s, l];
  }

  function hslCss(h, s, l) {
    return `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  }

  // Samples the now-playing album art down to a tiny canvas and picks a
  // saturation-weighted dominant color (rather than a flat pixel average,
  // which tends to collapse toward a muddy gray-brown and is why the accent
  // kept landing on the same washed-out pastel regardless of the art) - then
  // derives a Material-You-style two-tone accent palette + dark background
  // wash from that hue, with saturation floored and lightness tuned for a
  // punchier, more saturated result.
  function applyDynamicTheme(imgEl) {
    try {
      const cctx = colorSampler.getContext("2d");
      cctx.drawImage(imgEl, 0, 0, 16, 16);
      const data = cctx.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0, wTotal = 0;
      for (let i = 0; i < data.length; i += 4) {
        const rr = data[i], gg = data[i + 1], bb = data[i + 2];
        const lum = (rr + gg + bb) / 3;
        if (lum < 12 || lum > 248) continue;
        const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb);
        const pxSat = mx === 0 ? 0 : (mx - mn) / mx;
        // vivid pixels count for much more than gray/muddy ones, so the
        // extracted hue tracks the art's actual color instead of averaging
        // it away - a small baseline weight keeps fully-gray covers stable.
        const weight = 0.12 + pxSat * pxSat * 3;
        r += rr * weight; g += gg * weight; b += bb * weight; wTotal += weight;
      }
      if (wTotal === 0) { r = data[0]; g = data[1]; b = data[2]; wTotal = 1; }
      r /= wTotal; g /= wTotal; b /= wTotal;

      const [h, s] = rgbToHsl(r, g, b);
      const boostedS = Math.max(s, 0.5); // never let a washed-out cover go pastel
      const root = document.documentElement.style;
      root.setProperty("--dyn-bg", hslCss(h, Math.min(boostedS * 0.9, 0.6), 0.16));
      root.setProperty("--dyn-bg-2", hslCss(h, Math.min(boostedS * 0.85, 0.55), 0.09));
      root.setProperty("--dyn-accent", hslCss(h, Math.min(boostedS + 0.35, 0.95), 0.62));
      root.setProperty("--dyn-accent-2", hslCss((h + 140) % 360, Math.min(boostedS * 0.95 + 0.3, 0.92), 0.55));
    } catch (e) {
      resetDynamicTheme();
    }
  }

  // Samples a horizontal strip across the actual album art and boosts each
  // sample's saturation, producing a left-to-right sequence of colors that
  // really did come from the cover (rather than a synthetic hue sweep) -
  // this is what the background visualizer uses to color each frequency
  // band. Falls back to null on failure so callers can use a theme-based
  // sweep instead.
  function extractVizPalette(imgEl, count = 20) {
    try {
      const cctx = colorSampler.getContext("2d");
      cctx.drawImage(imgEl, 0, 0, 16, 16);
      const data = cctx.getImageData(0, 0, 16, 16).data;
      const colors = [];
      for (let i = 0; i < count; i++) {
        const col = Math.min(15, Math.floor((i / (count - 1)) * 15));
        // average the column (all 16 rows) rather than one pixel, so a
        // stray bright/dark speck doesn't throw one band off
        let r = 0, g = 0, b = 0;
        for (let row = 0; row < 16; row++) {
          const idx = (row * 16 + col) * 4;
          r += data[idx]; g += data[idx + 1]; b += data[idx + 2];
        }
        r /= 16; g /= 16; b /= 16;
        const [pr, pg, pb] = popColor([r, g, b], 1.7);
        colors.push(`rgb(${pr},${pg},${pb})`);
      }
      return colors;
    } catch (e) {
      return null;
    }
  }

  function blendColor(x, y) {
    const u = (x + 1) / 2;       // 0 = calm, 1 = exciting
    const v = (y + 1) / 2;       // 0 = sad, 1 = joyful
    const top = COLORS.tl.map((c, i) => lerp(c, COLORS.tr[i], u));
    const bot = COLORS.bl.map((c, i) => lerp(c, COLORS.br[i], u));
    const rgb = top.map((c, i) => Math.round(lerp(bot[i], c, v)));
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  }

  // ---------- zoom viewport ----------
  // viewScale 1 = fully zoomed out (the whole [-1,1] data square fits the
  // canvas). Larger values narrow the visible window (viewCx/viewCy) around
  // whatever the user zoomed into.
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 8;
  let viewScale = 1;
  let viewCx = 0;
  let viewCy = 0;

  function clampView() {
    viewScale = Math.min(Math.max(viewScale, MIN_ZOOM), MAX_ZOOM);
    if (viewScale <= 1) { viewCx = 0; viewCy = 0; return; }
    const half = 1 / viewScale;
    viewCx = Math.min(Math.max(viewCx, -1 + half), 1 - half);
    viewCy = Math.min(Math.max(viewCy, -1 + half), 1 - half);
  }

  // Zooms by `factor` (>1 in, <1 out) while keeping the data point currently
  // under canvas pixel (px, py) fixed on screen - the usual scroll-to-zoom feel.
  function zoomAt(px, py, factor) {
    const [dx, dy] = pxToData(px, py);
    viewScale *= factor;
    clampView();
    const half = 1 / viewScale;
    const nx = (px / canvas.width) * 2 - 1;
    const ny = 1 - (py / canvas.height) * 2;
    viewCx = dx - nx * half;
    viewCy = dy - ny * half;
    clampView();
    render();
  }

  function resetZoom() {
    viewScale = 1; viewCx = 0; viewCy = 0;
    render();
  }

  // Smoothly re-centers the viewport on a track's pad position, so picking a
  // track (from the queue, etc.) while zoomed in doesn't leave you looking at
  // an empty corner of the pad. No-op when fully zoomed out, since the whole
  // square is already visible.
  let panAnim = null;
  function panToTrack(t) {
    if (viewScale <= 1) return;
    const half = 1 / viewScale;
    const toCx = Math.min(Math.max(t.x, -1 + half), 1 - half);
    const toCy = Math.min(Math.max(t.y, -1 + half), 1 - half);
    panAnim = { fromCx: viewCx, fromCy: viewCy, toCx, toCy, t0: performance.now(), dur: 350 };
    requestAnimationFrame(stepPan);
  }

  function stepPan(now) {
    if (!panAnim) return;
    const p = Math.min(1, (now - panAnim.t0) / panAnim.dur);
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // ease-in-out
    viewCx = lerp(panAnim.fromCx, panAnim.toCx, e);
    viewCy = lerp(panAnim.fromCy, panAnim.toCy, e);
    render();
    if (p < 1) requestAnimationFrame(stepPan); else panAnim = null;
  }

  function dataToPx(x, y) {
    const W = canvas.width, H = canvas.height;
    const half = 1 / viewScale;
    const nx = (x - viewCx) / half;
    const ny = (y - viewCy) / half;
    return [((nx + 1) / 2) * W, ((1 - ny) / 2) * H];
  }

  function pxToData(px, py) {
    const W = canvas.width, H = canvas.height;
    const half = 1 / viewScale;
    const nx = (px / W) * 2 - 1;
    const ny = 1 - (py / H) * 2;
    return [viewCx + nx * half, viewCy + ny * half];
  }

  function canvasPoint(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return [(evt.clientX - rect.left) * scaleX, (evt.clientY - rect.top) * scaleY];
  }

  // ---------- drawing ----------

  function drawGrid() {
    const W = canvas.width, H = canvas.height;
    ctx.strokeStyle = "rgba(237,233,225,0.05)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const p = (i / 4) * W;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(W, p); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(237,233,225,0.12)";
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
  }

  // Returns the pad radius a given track is drawn at, so highlight rings
  // and hit-adjacent effects can match whichever representation (art
  // thumbnail vs. plain mood dot) is actually on screen for it.
  function trackRadius(t, dim) {
    const hasArt = artThumbs.has(t.id);
    if (hasArt) return dim ? ART_R * 0.6 : ART_R;
    return dim ? 2 : DOT_R;
  }

  const POP_DURATION_MS = 320; // how long the "pop" animation runs per track
  // classic overshoot easing - scale ramps past 1 briefly then settles at 1,
  // which is what gives the artwork a "pop" feel rather than just appearing
  function easeOutBack(x) {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }

  function drawTracks() {
    let anyPopping = false;
    const now = performance.now();
    for (const t of tracks) {
      const revealAt = trackPopStart.get(t.id);
      if (revealAt !== undefined && now < revealAt) {
        anyPopping = true;
        continue; // hasn't reached the pad yet - stay invisible until its turn
      }

      const [px, py] = dataToPx(t.x, t.y);
      const dim = filterActive && !matchedIds.has(t.id);
      const alpha = dim ? 0.14 : 0.9;
      const thumb = artThumbs.get(t.id);
      const baseR = trackRadius(t, dim);

      // Whichever pop is currently live gets to scale this track: the
      // initial reveal onto the pad, or (later, separately) the dot->art
      // upgrade once its thumbnail finishes baking. These are sequential
      // events in practice so there's never a fight between the two.
      let popScale = 1;
      const artPop = artPopStart.get(t.id);
      if (artPop !== undefined) {
        const age = (now - artPop) / POP_DURATION_MS;
        if (age < 1) { popScale = Math.max(0, easeOutBack(age)); anyPopping = true; }
        else artPopStart.delete(t.id);
      } else if (revealAt !== undefined) {
        const age = (now - revealAt) / POP_DURATION_MS;
        if (age < 1) { popScale = Math.max(0, easeOutBack(age)); anyPopping = true; }
        else trackPopStart.delete(t.id);
      }

      const r = baseR * popScale;
      ctx.globalAlpha = alpha;
      if (thumb) {
        ctx.drawImage(thumb, px - r, py - r, r * 2, r * 2);
      } else {
        ctx.fillStyle = blendColor(t.x, t.y);
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (anyPopping) scheduleRender();
  }

  // Rings the current accent color around every queued track, so what's
  // playing/queued stands out on the pad without dimming everything else.
  // The currently-playing track gets a slightly thicker ring.
  function currentAccentColor() {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--dyn-accent").trim();
    return v || "#F3B88A";
  }

  function drawQueueHighlights() {
    if (queueIds.size === 0) return;
    const accent = currentAccentColor();
    const playingId = queue[currentIndex] && queue[currentIndex].id;
    for (const t of tracks) {
      if (!queueIds.has(t.id)) continue;
      const [px, py] = dataToPx(t.x, t.y);
      const isPlaying = t.id === playingId;
      const r = trackRadius(t, false) + (isPlaying ? 4 : 2.5);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.strokeStyle = accent;
      ctx.lineWidth = isPlaying ? 2.5 : 1.25;
      ctx.stroke();
    }
  }

  function drawBuiltHighlights() {
    if (!builtActive || builtIds.size === 0) return;
    const seedIds = new Set(seeds.map(s => s.id));
    for (const t of tracks) {
      if (!builtIds.has(t.id)) continue;
      const [px, py] = dataToPx(t.x, t.y);
      const isSeed = seedIds.has(t.id);
      const base = trackRadius(t, false);
      const r = base + (isSeed ? 4 : 2);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.strokeStyle = isSeed ? "rgba(237,233,225,0.9)" : "rgba(237,233,225,0.4)";
      ctx.lineWidth = isSeed ? 2 : 1;
      ctx.stroke();
    }
  }

  function drawDragPath() {
    if (dragPath.length < 2) return;
    ctx.strokeStyle = "rgba(237,233,225,0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    dragPath.forEach(([x, y], i) => {
      const [px, py] = dataToPx(x, y);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  function drawProbe() {
    if (!probe) return;
    const [px, py] = dataToPx(probe.x, probe.y);
    const age = (performance.now() - probe.t0) / 1000; // seconds
    ctx.strokeStyle = "rgba(237,233,225,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px - 8, py); ctx.lineTo(px + 8, py);
    ctx.moveTo(px, py - 8); ctx.lineTo(px, py + 8);
    ctx.stroke();

    if (age < 0.9) {
      const r = age * 55;
      ctx.strokeStyle = `rgba(232,163,61,${1 - age})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.stroke();
      requestAnimationFrame(render);
    }
  }

  let dataReady = false; // true once /api/library itself has returned - fast, just the JSON

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid();
    if (!dataReady) return; // nothing to draw yet, but don't block on art
    drawTracks();
    drawQueueHighlights();
    drawBuiltHighlights();
    drawDragPath();
    drawProbe();
  }

  // ---------- pad-corner status bar + ready toast ----------
  // Art now pops in on the pad as each track's thumbnail finishes baking
  // (see preloadArt's scheduleRender call) rather than the pad staying
  // blank until everything is done. This bar is just a progress readout
  // sitting on top of that, plus a small toast when the batch finishes.
  // Anchored to the pad's own container (same trick createZoomControls
  // uses) so it sits over the canvas rather than floating over the whole
  // page, where it could land on top of unrelated page chrome like a logo.
  let statusEl, toastEl;

  function ensureStatusUI() {
    if (statusEl) return;
    const parent = canvas.parentElement;
    if (parent && getComputedStyle(parent).position === "static") {
      parent.style.position = "relative";
    }

    statusEl = document.createElement("div");
    statusEl.style.cssText = `
      position: absolute; top: 10px; left: 10px; z-index: 5;
      background: rgba(36,24,17,0.88); color: #F3B88A;
      font: 500 12px/1.4 -apple-system, BlinkMacSystemFont, sans-serif;
      padding: 6px 12px; border-radius: 999px;
      border: 1px solid rgba(243,184,138,0.3);
      box-shadow: 0 2px 10px rgba(0,0,0,0.35);
      opacity: 0; transition: opacity .2s ease;
      pointer-events: none; white-space: nowrap;
    `;
    parent.appendChild(statusEl);

    toastEl = document.createElement("div");
    toastEl.style.cssText = `
      position: absolute; top: 10px; left: 10px; z-index: 5;
      background: rgba(36,24,17,0.92); color: #B9D9A8;
      font: 600 12px/1.4 -apple-system, BlinkMacSystemFont, sans-serif;
      padding: 6px 12px; border-radius: 999px;
      border: 1px solid rgba(185,217,168,0.4);
      box-shadow: 0 2px 10px rgba(0,0,0,0.35);
      opacity: 0; transform: translateY(-4px);
      transition: opacity .25s ease, transform .25s ease;
      pointer-events: none; white-space: nowrap;
    `;
    parent.appendChild(toastEl);
  }

  function showStatus(text) {
    ensureStatusUI();
    statusEl.textContent = text;
    statusEl.style.opacity = "1";
  }

  function hideStatus() {
    if (!statusEl) return;
    statusEl.style.opacity = "0";
  }

  function showReadyToast(text) {
    ensureStatusUI();
    toastEl.textContent = text;
    toastEl.style.opacity = "1";
    toastEl.style.transform = "translateY(0)";
    setTimeout(() => {
      toastEl.style.opacity = "0";
      toastEl.style.transform = "translateY(-4px)";
    }, 1800);
  }

  // ---------- data ----------

  async function loadLibrary() {
    try {
      const res = await fetch("/api/library");
      const data = await res.json();
      tracks = data.tracks;

      // Stagger each track's first appearance in an outward wave from the
      // pad's center, plus a little jitter so it doesn't look mechanical -
      // this is what makes the pad start empty and fill in with the pop
      // animation instead of every dot just appearing at once.
      const REVEAL_WAVE_MS = 260;   // ms of delay per unit of data-space distance from center
      const REVEAL_JITTER_MS = 140; // per-track randomness
      const revealBase = performance.now();
      for (const t of tracks) {
        const dist = Math.hypot(t.x, t.y); // 0 at center .. ~1.41 at a corner
        trackPopStart.set(t.id, revealBase + dist * REVEAL_WAVE_MS + Math.random() * REVEAL_JITTER_MS);
      }

      dataReady = true;
      libinfo.textContent = `${data.count} tracks mapped`;
      render(); // kicks off the reveal wave - drawTracks re-schedules itself while any dot is still waiting/popping

      const artTracks = tracks.filter(t => t.art);
      const total = artTracks.length;

      if (total) {
        let loaded = 0;
        showStatus(`Loading artwork 0/${total}\u2026`);
        // No timeout race here on purpose - preloadArt never rejects, so
        // this always resolves once every track has genuinely finished
        // (succeeded or failed). Racing it against a timer was what caused
        // the "ready" toast to fire while art was still trickling in: the
        // bar has to track reality, not a guess at how long loading "should"
        // take, or it goes stale the moment a real library is bigger or
        // slower than whatever the guess was tuned for.
        await Promise.all(artTracks.map(t => preloadArt(t).then(() => {
          loaded++;
          showStatus(`Loading artwork ${loaded}/${total}\u2026`);
        })));
        hideStatus();
        showReadyToast(`Artwork ready \u2014 ${total} tracks`);
      }
    } catch (e) {
      libinfo.textContent = "could not reach server";
    }
  }

  function distance(t, x, y) {
    const dx = t.x - x, dy = t.y - y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function nearestTracks(x, y, n, exclude) {
    const pool = tracks.filter(t => !exclude || !exclude.has(t.id));
    pool.sort((a, b) => distance(a, x, y) - distance(b, x, y));
    return pool.slice(0, n);
  }

  // ---------- queue / playback ----------

  function setQueue(newQueue) {
    queue = newQueue;
    queueIds = new Set(queue.map(t => t.id));
    renderQueueList();
    queueCount.textContent = queue.length;
    if (queue.length) playIndex(0);
    render();
  }

  function renderQueueList() {
    queueList.innerHTML = "";
    queue.forEach((t, i) => {
      const item = document.createElement("div");
      item.className = "queue-item" + (i === currentIndex ? " active" : "");
      const dotHtml = `<div class="queue-dot" style="position:absolute;inset:0;width:100%;height:100%;border-radius:6px;background:${blendColor(t.x, t.y)}"></div>`;
      const imgHtml = t.art
        ? `<img class="queue-thumb-img" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:6px;opacity:0;transition:opacity .15s ease;">`
        : "";
      item.innerHTML = `
        <div class="queue-thumb" style="position:relative;width:32px;height:32px;flex:0 0 auto;">
          ${dotHtml}
          ${imgHtml}
        </div>
        <div class="queue-text">
          <div class="queue-title">${escapeHtml(t.title)}</div>
          <div class="queue-artist">${escapeHtml(t.artist)}</div>
        </div>`;
      if (t.art) {
        const img = item.querySelector(".queue-thumb-img");
        fetchArtBlobUrl(t.id, t.art).then((blobUrl) => {
          img.onload = () => { img.style.opacity = "1"; };
          img.src = blobUrl;
        }).catch(() => { img.remove(); }); // leaves the mood dot showing
      }
      item.addEventListener("click", () => { playIndex(i); });
      queueList.appendChild(item);
    });
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s ?? "";
    return d.innerHTML;
  }

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function playIndex(i) {
    if (i < 0 || i >= queue.length) return;
    currentIndex = i;
    const t = queue[i];
    panToTrack(t);
    player.src = `/api/audio/${t.id}`;
    player.play().catch(() => {});
    npTitle.textContent = t.title;
    npArtist.textContent = t.artist;
    const khz = (t.samplerate / 1000).toFixed(1);
    npFormat.textContent = `${khz} kHz \u2022 ${t.bitrate_kbps || "?"} kbps \u2022 FLAC`;
    npStats.textContent = `${t.tempo || "?"} BPM   x ${t.x.toFixed(2)}   y ${t.y.toFixed(2)}`;
    updateMediaSessionMetadata(t);

    if (t.art) {
      fetchArtBlobUrl(t.id, t.art).then((blobUrl) => {
        if (queue[currentIndex] !== t) return; // track changed again before this resolved
        npArt.onload = () => { applyDynamicTheme(npArt); vizPalette = extractVizPalette(npArt); };
        npArt.onerror = () => { npArt.hidden = true; npGlyph.style.display = "flex"; resetDynamicTheme(); vizPalette = null; };
        npArt.src = blobUrl;
        npArt.hidden = false;
        npGlyph.style.display = "none";
      }).catch(() => {
        if (queue[currentIndex] !== t) return;
        npArt.hidden = true;
        npGlyph.style.display = "flex";
        resetDynamicTheme();
        vizPalette = null;
      });
    } else {
      npArt.hidden = true;
      npGlyph.style.display = "flex";
      resetDynamicTheme();
      vizPalette = null;
    }

    renderQueueList();
    updateLikeButton();
    const active = queueList.querySelector(".queue-item.active");
    if (active) active.scrollIntoView({ block: "nearest" });
    btnPlay.textContent = "\u23F8";
  }

  function next() {
    if (!queue.length) return;
    if (shuffleOn && queue.length > 1) {
      let idx;
      do { idx = Math.floor(Math.random() * queue.length); } while (idx === currentIndex);
      playIndex(idx);
      return;
    }
    if (currentIndex + 1 < queue.length) playIndex(currentIndex + 1);
    else if (repeatOn) playIndex(0);
  }
  function prev() { if (currentIndex > 0) playIndex(currentIndex - 1); }

  // ---------- media session (OS / browser media-key integration) ----------
  // Play/pause already worked because the browser derives that state from the
  // <audio> element itself. Previous/next did nothing because no action
  // handlers were ever registered for them - the OS had no idea this page
  // could handle "nexttrack"/"previoustrack" at all.
  function updateMediaSessionMetadata(t) {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title || "",
      artist: t.artist || "",
      artwork: t.art ? [
        { src: t.art, sizes: "512x512", type: "image/png" },
      ] : [],
    });
  }

  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", () => player.play().catch(() => {}));
    navigator.mediaSession.setActionHandler("pause", () => player.pause());
    navigator.mediaSession.setActionHandler("previoustrack", prev);
    navigator.mediaSession.setActionHandler("nexttrack", next);
    navigator.mediaSession.setActionHandler("seekbackward", (details) => {
      player.currentTime = Math.max(0, player.currentTime - (details.seekOffset || 10));
    });
    navigator.mediaSession.setActionHandler("seekforward", (details) => {
      player.currentTime = Math.min(player.duration || Infinity, player.currentTime + (details.seekOffset || 10));
    });
    navigator.mediaSession.setActionHandler("stop", () => player.pause());
  }

  function updateLikeButton() {
    if (currentIndex < 0 || !queue[currentIndex]) { btnLike.classList.remove("liked"); return; }
    btnLike.classList.toggle("liked", liked.has(queue[currentIndex].id));
  }

  btnShuffle.addEventListener("click", () => {
    shuffleOn = !shuffleOn;
    btnShuffle.classList.toggle("on", shuffleOn);
  });
  btnRepeat.addEventListener("click", () => {
    repeatOn = !repeatOn;
    btnRepeat.classList.toggle("on", repeatOn);
  });
  btnLike.addEventListener("click", () => {
    if (currentIndex < 0 || !queue[currentIndex]) return;
    const id = queue[currentIndex].id;
    if (liked.has(id)) liked.delete(id); else liked.add(id);
    localStorage.setItem("musicSquareLiked", JSON.stringify([...liked]));
    updateLikeButton();
  });

  player.addEventListener("ended", next);
  player.addEventListener("play", () => {
    btnPlay.textContent = "\u23F8";
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
  });
  player.addEventListener("pause", () => {
    btnPlay.textContent = "\u25B6";
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  });

  function updateSeekFill(pct) {
    seek.style.background = `linear-gradient(to right, var(--dyn-accent) ${pct}%, var(--surface-2) ${pct}%)`;
  }

  player.addEventListener("loadedmetadata", () => {
    timeDur.textContent = formatTime(player.duration);
  });
  player.addEventListener("timeupdate", () => {
    if (seekDragging) return;
    timeCur.textContent = formatTime(player.currentTime);
    const pct = player.duration ? (player.currentTime / player.duration) * 100 : 0;
    if (player.duration) seek.value = Math.round((player.currentTime / player.duration) * 1000);
    updateSeekFill(pct);
    if ("mediaSession" in navigator && navigator.mediaSession.setPositionState && isFinite(player.duration) && player.duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: player.duration,
          playbackRate: player.playbackRate,
          position: Math.min(player.currentTime, player.duration),
        });
      } catch (e) { /* ignore - duration/position can race on track change */ }
    }
  });
  seek.addEventListener("input", () => updateSeekFill(seek.value / 10));

  btnPlay.addEventListener("click", () => {
    if (!queue.length) return;
    if (player.paused) player.play(); else player.pause();
  });
  btnPrev.addEventListener("click", prev);
  btnNext.addEventListener("click", next);

  seek.addEventListener("mousedown", () => seekDragging = true);
  seek.addEventListener("change", () => {
    if (player.duration) player.currentTime = (seek.value / 1000) * player.duration;
    seekDragging = false;
  });

  vol.addEventListener("input", () => { player.volume = vol.value / 100; });
  player.volume = vol.value / 100;

  radius.addEventListener("input", () => { radiusVal.textContent = radius.value; });

  // ---------- zoom controls ----------

  canvas.addEventListener("wheel", (evt) => {
    evt.preventDefault();
    const [px, py] = canvasPoint(evt);
    const factor = evt.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomAt(px, py, factor);
  }, { passive: false });

  function createZoomControls() {
    const style = document.createElement("style");
    style.textContent = `
      .pad-zoom-controls {
        position: absolute;
        right: 10px;
        bottom: 10px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        z-index: 5;
      }
      .pad-zoom-controls button {
        width: 28px;
        height: 28px;
        border-radius: 6px;
        border: 1px solid rgba(237,233,225,0.18);
        background: rgba(36,24,17,0.75);
        color: #EDE9E1;
        font-size: 15px;
        line-height: 1;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
      }
      .pad-zoom-controls button:hover { background: rgba(59,42,32,0.9); }
    `;
    document.head.appendChild(style);

    const wrap = document.createElement("div");
    wrap.className = "pad-zoom-controls";
    wrap.innerHTML = `
      <button type="button" data-zoom="in" title="Zoom in">+</button>
      <button type="button" data-zoom="out" title="Zoom out">&minus;</button>
      <button type="button" data-zoom="reset" title="Reset zoom">&#8634;</button>
    `;

    const parent = canvas.parentElement;
    if (parent && getComputedStyle(parent).position === "static") {
      parent.style.position = "relative";
    }
    parent.appendChild(wrap);

    wrap.querySelector('[data-zoom="in"]').addEventListener("click", () => {
      zoomAt(canvas.width / 2, canvas.height / 2, 1.4);
    });
    wrap.querySelector('[data-zoom="out"]').addEventListener("click", () => {
      zoomAt(canvas.width / 2, canvas.height / 2, 1 / 1.4);
    });
    wrap.querySelector('[data-zoom="reset"]').addEventListener("click", resetZoom);
  }

  createZoomControls();

  // ---------- pad interaction ----------

  let isPanning = false;
  let panLastPx = null;

  // Stop the browser's right-click menu from popping up over the pad, since
  // right-click is now the pan gesture.
  canvas.addEventListener("contextmenu", (evt) => evt.preventDefault());

  canvas.addEventListener("mousedown", (evt) => {
    if (evt.button === 2) {
      isPanning = true;
      panLastPx = canvasPoint(evt);
      canvas.style.cursor = "grabbing";
      return;
    }
    if (evt.button !== 0) return; // ignore middle-click etc.

    isDragging = true;
    dragMoved = false;
    builtActive = false;
    const [px, py] = canvasPoint(evt);
    const [x, y] = pxToData(px, py);
    dragPath = [[x, y]];
  });

  canvas.addEventListener("mousemove", (evt) => {
    const [px, py] = canvasPoint(evt);

    if (isPanning) {
      // Keep whatever data point was under the mouse a moment ago pinned
      // under the mouse now - same "grab and drag" math zoomAt uses to
      // anchor the zoom target, just applied every move instead of once.
      const [ox, oy] = pxToData(panLastPx[0], panLastPx[1]);
      const [nx, ny] = pxToData(px, py);
      viewCx += ox - nx;
      viewCy += oy - ny;
      clampView();
      panLastPx = [px, py];
      const [x, y] = pxToData(px, py);
      readout.textContent = `x ${x.toFixed(2)}   y ${y.toFixed(2)}`;
      render();
      return;
    }

    const [x, y] = pxToData(px, py);
    readout.textContent = `x ${x.toFixed(2)}   y ${y.toFixed(2)}`;

    if (isDragging) {
      const [lx, ly] = dragPath[dragPath.length - 1];
      const d = Math.hypot(x - lx, y - ly);
      if (d > 0.04) {
        dragPath.push([x, y]);
        dragMoved = true;
        render();
      }
    }
  });

  window.addEventListener("mouseup", (evt) => {
    if (isPanning && evt.button === 2) {
      isPanning = false;
      panLastPx = null;
      canvas.style.cursor = "";
      return;
    }
    if (!isDragging) return;
    isDragging = false;

    const n = parseInt(radius.value, 10);

    if (dragMoved && dragPath.length > 2) {
      // sweep: pick one nearest unused track per sampled point along the path
      const used = new Set();
      const built = [];
      for (const [x, y] of dragPath) {
        const pick = nearestTracks(x, y, 1, used)[0];
        if (pick) { built.push(pick); used.add(pick.id); }
        if (built.length >= n) break;
      }
      if (built.length) {
        probe = { x: dragPath[dragPath.length - 1][0], y: dragPath[dragPath.length - 1][1], t0: performance.now() };
        setQueue(built);
      }
    } else {
      const [x, y] = dragPath[0];
      const built = nearestTracks(x, y, n);
      if (built.length) {
        probe = { x, y, t0: performance.now() };
        setQueue(built);
      }
    }
    dragPath = [];
    dragMoved = false;
    render();
  });

  canvas.addEventListener("mouseleave", () => {
    readout.textContent = "\u2014";
  });

  // ---------- search ----------

  searchBox.addEventListener("input", () => {
    const q = searchBox.value.trim().toLowerCase();
    if (!q) {
      filterActive = false;
      matchedIds = new Set();
    } else {
      filterActive = true;
      matchedIds = new Set(
        tracks.filter(t =>
          t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
        ).map(t => t.id)
      );
    }
    render();
  });

  // ---------- playlist builder ----------

  function openBuilder() {
    builderOverlay.classList.remove("hidden");
    builderSearch.value = "";
    renderBuilderResults("");
    renderSeeds();
    builderSearch.focus();
  }

  function closeBuilder() {
    builderOverlay.classList.add("hidden");
  }

  btnOpenBuilder.addEventListener("click", openBuilder);
  builderClose.addEventListener("click", closeBuilder);
  builderOverlay.addEventListener("click", (evt) => {
    if (evt.target === builderOverlay) closeBuilder();
  });
  window.addEventListener("keydown", (evt) => {
    if (evt.code === "Escape" && !builderOverlay.classList.contains("hidden")) closeBuilder();
  });

  function isSeeded(id) { return seeds.some(s => s.id === id); }

  // Small art-or-monogram thumbnail for a builder row. Reuses the browser's
  // own HTTP cache for /art_cache/ URLs - no need to route through the
  // pad's canvas-thumbnail baking pipeline, these are plain <img> tags.
  function builderThumbHtml(t) {
    if (t.art) {
      return `<img class="builder-thumb" src="${t.art}" alt="" loading="lazy">`;
    }
    const letter = (t.title || t.artist || "?").trim().charAt(0).toUpperCase() || "?";
    return `<div class="builder-thumb builder-thumb-mono">${escapeHtml(letter)}</div>`;
  }

  function renderBuilderResults(query) {
    const q = query.trim().toLowerCase();
    let matches;
    if (!q) {
      matches = tracks.slice(0, 25);
    } else {
      matches = tracks
        .filter(t => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q))
        .slice(0, 25);
    }

    builderResultsEl.innerHTML = "";
    if (matches.length === 0) {
      builderResultsEl.innerHTML = `<div class="builder-empty">No matches.</div>`;
      return;
    }

    for (const t of matches) {
      const added = isSeeded(t.id);
      const row = document.createElement("div");
      row.className = "builder-row";
      row.innerHTML = `
        ${builderThumbHtml(t)}
        <div class="builder-row-text">
          <div class="builder-row-title">${escapeHtml(t.title)}</div>
          <div class="builder-row-artist">${escapeHtml(t.artist)}</div>
        </div>
        <button class="row-btn${added ? " added" : ""}" title="${added ? "Added" : "Add"}">${added ? "\u2713" : "+"}</button>`;
      const btn = row.querySelector("button");
      if (!added) {
        btn.addEventListener("click", () => { addSeed(t); });
      }
      builderResultsEl.appendChild(row);
    }
  }

  function addSeed(t) {
    if (isSeeded(t.id)) return;
    seeds.push(t);
    renderSeeds();
    renderBuilderResults(builderSearch.value);
  }

  function removeSeed(id) {
    seeds = seeds.filter(s => s.id !== id);
    renderSeeds();
    renderBuilderResults(builderSearch.value);
  }

  function renderSeeds() {
    seedCountEl.textContent = seeds.length;
    builderSeedsEl.innerHTML = "";

    if (seeds.length === 0) {
      builderSeedsEl.innerHTML = `<div class="builder-empty">Add a few tracks you're in the mood for &mdash; the builder finds tracks that sound similar to them.</div>`;
    } else {
      for (const t of seeds) {
        const row = document.createElement("div");
        row.className = "builder-row";
        row.innerHTML = `
          ${builderThumbHtml(t)}
          <div class="builder-row-text">
            <div class="builder-row-title">${escapeHtml(t.title)}</div>
            <div class="builder-row-artist">${escapeHtml(t.artist)}</div>
          </div>
          <button class="row-btn remove" title="Remove">&times;</button>`;
        row.querySelector("button").addEventListener("click", () => removeSeed(t.id));
        builderSeedsEl.appendChild(row);
      }
    }

    builderBuildBtn.disabled = seeds.length === 0;
    builderBuildBtn.textContent = seeds.length
      ? `Build from ${seeds.length} track${seeds.length > 1 ? "s" : ""}`
      : "Add seed tracks first";
  }

  builderSearch.addEventListener("input", () => renderBuilderResults(builderSearch.value));
  builderSize.addEventListener("input", () => { builderSizeVal.textContent = builderSize.value; });

  function buildFromSeeds(seedTracks, size) {
    const seedIdSet = new Set(seedTracks.map(t => t.id));
    const candidates = tracks.filter(t => !seedIdSet.has(t.id));

    // Score every other track by its distance to the *closest* seed, not the
    // average of all seeds - that way a diverse set of seeds pulls in tracks
    // near each of them, rather than collapsing everything toward one blended
    // midpoint the seeds themselves might not even be near.
    const scored = candidates.map(t => {
      let minD = Infinity;
      for (const s of seedTracks) {
        const d = distance(t, s.x, s.y);
        if (d < minD) minD = d;
      }
      return { t, minD };
    });
    scored.sort((a, b) => a.minD - b.minD);

    const needed = Math.max(0, size - seedTracks.length);
    const picked = scored.slice(0, needed).map(s => s.t);
    return [...seedTracks, ...picked];
  }

  builderBuildBtn.addEventListener("click", () => {
    if (!seeds.length) return;
    const size = parseInt(builderSize.value, 10);
    const finalQueue = buildFromSeeds(seeds, size);

    builtIds = new Set(finalQueue.map(t => t.id));
    builtActive = true;
    probe = null;
    dragPath = [];

    setQueue(finalQueue);
    closeBuilder();
    render();
  });

  // ---------- keyboard shortcuts ----------

  window.addEventListener("keydown", (evt) => {
    if (document.activeElement === searchBox || document.activeElement === seek) return;
    if (evt.code === "Space") { evt.preventDefault(); btnPlay.click(); }
    if (evt.code === "ArrowRight") next();
    if (evt.code === "ArrowLeft") prev();
  });

  loadLibrary();
})();
