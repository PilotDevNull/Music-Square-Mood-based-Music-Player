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

  let tracks = [];           // full library
  let filterActive = false;
  let matchedIds = new Set();
  let queue = [];            // array of track objects, current playing order
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

  const COLORS = {
    tl: [95, 208, 198],   // calm + joyful -> cyan
    tr: [232, 163, 61],   // exciting + joyful -> amber
    bl: [108, 127, 224],  // calm + sad -> indigo
    br: [217, 72, 122],   // exciting + sad -> magenta
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

  // Samples the now-playing album art down to a tiny canvas, averages the
  // pixels (skipping near-black/near-white extremes so borders/backgrounds
  // don't wash out the read), and derives a Material-You-style two-tone
  // accent palette + dark background wash from the dominant hue.
  function applyDynamicTheme(imgEl) {
    try {
      const cctx = colorSampler.getContext("2d");
      cctx.drawImage(imgEl, 0, 0, 16, 16);
      const data = cctx.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const rr = data[i], gg = data[i + 1], bb = data[i + 2];
        const lum = (rr + gg + bb) / 3;
        if (lum < 12 || lum > 248) continue;
        r += rr; g += gg; b += bb; n++;
      }
      if (n === 0) { r = data[0]; g = data[1]; b = data[2]; n = 1; }
      r /= n; g /= n; b /= n;

      const [h, s] = rgbToHsl(r, g, b);
      const root = document.documentElement.style;
      root.setProperty("--dyn-bg", hslCss(h, Math.min(s * 0.9, 0.55), 0.16));
      root.setProperty("--dyn-bg-2", hslCss(h, Math.min(s * 0.85, 0.5), 0.09));
      root.setProperty("--dyn-accent", hslCss(h, Math.min(s + 0.15, 0.75), 0.72));
      root.setProperty("--dyn-accent-2", hslCss((h + 150) % 360, Math.min(s * 0.6 + 0.15, 0.55), 0.68));
    } catch (e) {
      resetDynamicTheme();
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

  function dataToPx(x, y) {
    const W = canvas.width, H = canvas.height;
    return [((x + 1) / 2) * W, ((1 - y) / 2) * H];
  }

  function pxToData(px, py) {
    const W = canvas.width, H = canvas.height;
    return [(px / W) * 2 - 1, 1 - (py / H) * 2];
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

  function drawTracks() {
    for (const t of tracks) {
      const [px, py] = dataToPx(t.x, t.y);
      const dim = filterActive && !matchedIds.has(t.id);
      ctx.globalAlpha = dim ? 0.10 : 0.75;
      ctx.fillStyle = blendColor(t.x, t.y);
      ctx.beginPath();
      ctx.arc(px, py, dim ? 2 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawBuiltHighlights() {
    if (!builtActive || builtIds.size === 0) return;
    const seedIds = new Set(seeds.map(s => s.id));
    for (const t of tracks) {
      if (!builtIds.has(t.id)) continue;
      const [px, py] = dataToPx(t.x, t.y);
      const isSeed = seedIds.has(t.id);
      ctx.beginPath();
      ctx.arc(px, py, isSeed ? 7 : 4.5, 0, Math.PI * 2);
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

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid();
    drawTracks();
    drawBuiltHighlights();
    drawDragPath();
    drawProbe();
  }

  // ---------- data ----------

  async function loadLibrary() {
    try {
      const res = await fetch("/api/library");
      const data = await res.json();
      tracks = data.tracks;
      libinfo.textContent = `${data.count} tracks mapped`;
      render();
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
    renderQueueList();
    queueCount.textContent = queue.length;
    if (queue.length) playIndex(0);
  }

  function renderQueueList() {
    queueList.innerHTML = "";
    queue.forEach((t, i) => {
      const item = document.createElement("div");
      item.className = "queue-item" + (i === currentIndex ? " active" : "");
      item.innerHTML = `
        <div class="queue-dot" style="background:${blendColor(t.x, t.y)}"></div>
        <div class="queue-text">
          <div class="queue-title">${escapeHtml(t.title)}</div>
          <div class="queue-artist">${escapeHtml(t.artist)}</div>
        </div>`;
      item.addEventListener("click", () => playIndex(i));
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
    player.src = `/api/audio/${t.id}`;
    player.play().catch(() => {});
    npTitle.textContent = t.title;
    npArtist.textContent = t.artist;
    const khz = (t.samplerate / 1000).toFixed(1);
    npFormat.textContent = `${khz} kHz \u2022 ${t.bitrate_kbps || "?"} kbps \u2022 FLAC`;
    npStats.textContent = `${t.tempo || "?"} BPM   x ${t.x.toFixed(2)}   y ${t.y.toFixed(2)}`;

    if (t.art) {
      npArt.onload = () => applyDynamicTheme(npArt);
      npArt.onerror = () => { npArt.hidden = true; npGlyph.style.display = "flex"; resetDynamicTheme(); };
      npArt.src = t.art;
      npArt.hidden = false;
      npGlyph.style.display = "none";
    } else {
      npArt.hidden = true;
      npGlyph.style.display = "flex";
      resetDynamicTheme();
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
  player.addEventListener("play", () => btnPlay.textContent = "\u23F8");
  player.addEventListener("pause", () => btnPlay.textContent = "\u25B6");

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

  // ---------- pad interaction ----------

  canvas.addEventListener("mousedown", (evt) => {
    isDragging = true;
    dragMoved = false;
    builtActive = false;
    const [px, py] = canvasPoint(evt);
    const [x, y] = pxToData(px, py);
    dragPath = [[x, y]];
  });

  canvas.addEventListener("mousemove", (evt) => {
    const [px, py] = canvasPoint(evt);
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
