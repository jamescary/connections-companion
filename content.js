/**
 * Connections Companion
 *
 * Lets the player pre-assign all four groups to colors, then submits them in
 * reverse rainbow order (Purple, Blue, Green, Yellow). If any submission is
 * wrong the run stops immediately: the offending group is marked red and no
 * further guesses are spent until the player fixes it and resubmits.
 */
(() => {
  "use strict";

  // Reverse rainbow submission order. `level` matches the game's data-level
  // on solved rows (0 = yellow ... 3 = purple).
  const COLORS = [
    { key: "purple", label: "Purple", hex: "#ba81c5", level: 3 },
    { key: "blue",   label: "Blue",   hex: "#b0c4ef", level: 2 },
    { key: "green",  label: "Green",  hex: "#a0c35a", level: 1 },
    { key: "yellow", label: "Yellow", hex: "#f9df6d", level: 0 },
  ];
  const COLOR_BY_LEVEL = Object.fromEntries(COLORS.map(c => [c.level, c.label]));

  const SEL = {
    board: '[data-testid="connections-board"]',
    cardLabel: '[data-testid="card-label"]',
    submit: '[data-testid="submit-btn"]',
    deselect: '[data-testid="deselect-btn"]',
    bubble: '[data-testid="mistake-bubble"]',
    solved: '[data-testid="solved-category-container"]',
  };

  /** @type {Record<string, {words: string[], status: string, note: string}>} */
  const groups = {};
  for (const c of COLORS) groups[c.key] = { words: [], status: "empty", note: "" };
  let running = false;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  // The game ignores plain .click(); it needs a full pointer event sequence.
  function press(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const opts = type => ({
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
      pointerId: 1, pointerType: "mouse", isPrimary: true,
      button: 0, buttons: type === "down" ? 1 : 0,
    });
    el.dispatchEvent(new PointerEvent("pointerdown", opts("down")));
    el.dispatchEvent(new MouseEvent("mousedown", opts("down")));
    el.dispatchEvent(new PointerEvent("pointerup", opts("up")));
    el.dispatchEvent(new MouseEvent("mouseup", opts("up")));
    el.dispatchEvent(new MouseEvent("click", opts("up")));
  }

  const findLabel = word => $$(SEL.cardLabel).find(l => l.dataset.flipId === word);
  // The game tracks selection via a "selected" class on the label; the hidden
  // checkbox's checked property can drift out of sync, so don't trust it.
  const selectedWords = () =>
    $$(SEL.cardLabel).filter(l => /selected/i.test(l.className)).map(l => l.dataset.flipId);
  const bubbleCount = () => $$(SEL.bubble).length;
  const solvedCount = () => $$(SEL.solved).length;

  function assignedTo(word) {
    for (const c of COLORS) if (groups[c.key].words.includes(word)) return c.key;
    return null;
  }

  function markTiles(key, on) {
    for (const w of groups[key].words) {
      const label = findLabel(w);
      if (!label) continue;
      if (!on) {
        delete label.dataset.ccColor;
        delete label.dataset.ccError;
        continue;
      }
      label.dataset.ccColor = key;
      if (groups[key].status === "error") label.dataset.ccError = "true";
      else delete label.dataset.ccError;
    }
  }

  function setStatus(text, kind) {
    const el = $("#cc-status");
    if (!el) return;
    el.textContent = text;
    el.className = kind ? `cc-${kind}` : "";
  }

  // ---------- assignment / reset ----------

  function assign(key) {
    if (running) return;
    const words = selectedWords();
    if (words.length !== 4) {
      setStatus(`Select exactly 4 tiles on the board first (you have ${words.length}).`, "error");
      return;
    }
    const taken = words.filter(w => assignedTo(w) && assignedTo(w) !== key);
    if (taken.length) {
      setStatus(`Already assigned to another color: ${taken.join(", ")}. Clear that group first.`, "error");
      return;
    }
    clearGroup(key, true);
    groups[key] = { words, status: "assigned", note: "" };
    markTiles(key, true);
    press($(SEL.deselect));
    render();
    setStatus("");
  }

  function clearGroup(key, quiet) {
    if (running) return;
    const g = groups[key];
    if (g.status === "solved") return;
    markTiles(key, false);
    groups[key] = { words: [], status: "empty", note: "" };
    if (!quiet) { render(); setStatus(""); }
  }

  function clearAll() {
    if (running) return;
    for (const c of COLORS) clearGroup(c.key, true);
    render();
    setStatus("");
  }

  // ---------- submission ----------

  async function selectGroup(words) {
    const deselect = $(SEL.deselect);
    if (deselect && !deselect.disabled) { press(deselect); await sleep(300); }
    for (const w of words) {
      const label = findLabel(w);
      if (!label) return false;
      press(label);
      await sleep(120);
    }
    await sleep(250);
    return selectedWords().sort().join("|") === [...words].sort().join("|");
  }

  // Resolve one submission by watching the DOM: a new solved row means
  // correct; a lost mistake bubble means wrong.
  async function waitForResult(preSolved, preBubbles) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (solvedCount() > preSolved) return "correct";
      if (bubbleCount() < preBubbles) return "incorrect";
      await sleep(150);
    }
    return "timeout";
  }

  function toastText() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode.textContent.trim();
      if (/one away|already guessed/i.test(t)) return t;
    }
    return "";
  }

  async function submitAll() {
    if (running) return;
    const queue = COLORS.filter(c => groups[c.key].status === "assigned");
    if (!queue.length) {
      setStatus("Nothing to submit — assign at least one group.", "error");
      return;
    }
    running = true;
    render();
    try {
      for (const color of queue) {
        const g = groups[color.key];
        g.status = "submitting";
        render();
        setStatus(`Submitting ${color.label}…`);
        if (!(await selectGroup(g.words))) {
          g.status = "error";
          g.note = "Couldn't select these tiles on the board.";
          markTiles(color.key, true);
          render();
          setStatus(`Stopped: couldn't select the ${color.label} group. Fix it and submit again.`, "error");
          return;
        }
        const preSolved = solvedCount();
        const preBubbles = bubbleCount();
        press($(SEL.submit));
        const result = await waitForResult(preSolved, preBubbles);

        if (result === "correct") {
          const row = $$(SEL.solved).pop();
          const actual = row ? Number(row.dataset.level) : color.level;
          g.status = "solved";
          g.mismatch = actual !== color.level;
          if (g.mismatch) {
            g.note = `Solved, but it was actually ${COLOR_BY_LEVEL[actual]} — reverse rainbow is off.`;
          }
          render();
          await sleep(1800); // let the solve animation finish before the next group
          continue;
        }

        // Wrong guess (or the game never responded): stop spending guesses.
        const toast = toastText();
        g.status = "error";
        g.note = result === "timeout"
          ? "No response from the game (repeat guess or out of tries?)."
          : (toast || "Not a group.");
        markTiles(color.key, true);
        render();
        // Leave the board deselected so the player's next manual selection
        // starts clean.
        await sleep(400);
        const stray = $(SEL.deselect);
        if (stray && !stray.disabled) press(stray);
        const remaining = bubbleCount();
        setStatus(
          `Stopped on ${color.label}: ${g.note}\n` +
          `${remaining} mistake${remaining === 1 ? "" : "s"} remaining. ` +
          `Reset the red group, reassign, then submit again.`, "error");
        return;
      }
      const left = COLORS.filter(c => groups[c.key].status === "assigned" || groups[c.key].status === "error");
      const offRainbow = COLORS.some(c => groups[c.key].mismatch);
      if (left.length) setStatus("Done with this batch.", "success");
      else if (offRainbow) setStatus("All groups solved, but we didn't get reverse rainbow today — maybe tomorrow!");
      else setStatus("All groups solved — reverse rainbow run complete! 🌈", "success");
    } finally {
      running = false;
      for (const c of COLORS) {
        if (groups[c.key].status === "submitting") groups[c.key].status = "assigned";
      }
      render();
    }
  }

  // ---------- UI ----------

  function render() {
    for (const c of COLORS) {
      const g = groups[c.key];
      const row = $(`#cc-row-${c.key}`);
      if (!row) continue;
      row.dataset.status = g.status;
      row.querySelector(".cc-row-words").textContent =
        g.words.length ? g.words.join(", ") : "Select 4 tiles, then click the swatch.";
      row.querySelector(".cc-row-note").textContent = g.note;
      const title = row.querySelector(".cc-row-title");
      title.textContent = c.label + (g.status === "solved" ? " ✓" : g.status === "error" ? " ✗" : "");
      const swatch = row.querySelector(".cc-swatch");
      swatch.disabled = running || g.status === "solved";
      swatch.textContent = g.status === "empty" ? "+" : "✓";
      row.querySelector(".cc-x").style.visibility =
        !running && (g.status === "assigned" || g.status === "error") ? "visible" : "hidden";
      markTiles(c.key, g.words.length > 0 && g.status !== "solved");
    }
    const assigned = COLORS.filter(c => groups[c.key].status === "assigned").length;
    const errored = COLORS.some(c => groups[c.key].status === "error");
    const submit = $("#cc-submit");
    if (submit) {
      submit.disabled = running || assigned === 0 || errored;
      submit.textContent = running ? "Submitting…" : `Submit ${assigned || ""} in 🌈 reverse`.replace("  ", " ");
    }
    const clear = $("#cc-clear");
    if (clear) clear.disabled = running;
    const banked = COLORS.filter(c => groups[c.key].status !== "empty").length;
    const badge = $("#cc-badge");
    if (badge) badge.textContent = banked ? `${banked}/4` : "";
  }

  // Drag the panel by its header; a plain click (no movement) toggles
  // collapse. Position and collapsed state persist across visits.
  function makeDraggable(panel, header) {
    const KEY = "cc-panel-state";
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* fresh start */ }
    header.setAttribute("role", "button");
    header.tabIndex = 0;
    const apply = () => {
      if (typeof saved.left === "number") {
        panel.style.left = Math.min(Math.max(saved.left, 0), window.innerWidth - 80) + "px";
        panel.style.top = Math.min(Math.max(saved.top, 0), window.innerHeight - 40) + "px";
        panel.style.right = "auto";
        panel.style.bottom = "auto";
      }
      panel.classList.toggle("cc-collapsed", !!saved.collapsed);
      header.setAttribute("aria-expanded", String(!saved.collapsed));
    };
    apply();
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* private mode */ } };
    let drag = null;
    header.addEventListener("pointerdown", e => {
      const r = panel.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
      header.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    header.addEventListener("pointermove", e => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      saved.left = drag.left + dx;
      saved.top = drag.top + dy;
      apply();
    });
    header.addEventListener("pointerup", () => {
      if (!drag) return;
      if (!drag.moved) {
        saved.collapsed = !panel.classList.contains("cc-collapsed");
        apply();
      }
      save();
      drag = null;
    });
    header.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      saved.collapsed = !panel.classList.contains("cc-collapsed");
      apply();
      save();
    });
  }

  function buildPanel() {
    if ($("#cc-panel")) return;
    const panel = document.createElement("div");
    panel.id = "cc-panel";

    const header = document.createElement("div");
    header.id = "cc-header";
    header.title = "Drag to move · click to collapse";
    header.innerHTML = `<span>Connections Companion</span><span class="cc-header-right"><span id="cc-badge" class="cc-badge"></span><span class="cc-chevron">▾</span></span>`;
    panel.appendChild(header);
    makeDraggable(panel, header);

    const body = document.createElement("div");
    body.id = "cc-body";
    const hint = document.createElement("p");
    hint.className = "cc-hint";
    hint.textContent = "Select 4 tiles on the board, then click a swatch to bank them. Submits Purple → Blue → Green → Yellow, and pauses on any miss.";
    body.appendChild(hint);

    for (const c of COLORS) {
      const row = document.createElement("div");
      row.className = "cc-row";
      row.id = `cc-row-${c.key}`;
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "cc-swatch";
      swatch.style.background = c.hex;
      swatch.title = `Assign selected tiles to ${c.label}`;
      swatch.setAttribute("aria-label", `Assign selected tiles to ${c.label}`);
      swatch.textContent = "+";
      swatch.addEventListener("click", () => assign(c.key));
      const main = document.createElement("div");
      main.className = "cc-row-main";
      main.innerHTML = `<div class="cc-row-title"></div><div class="cc-row-words"></div><div class="cc-row-note"></div>`;
      const x = document.createElement("button");
      x.type = "button";
      x.className = "cc-x";
      x.title = `Reset ${c.label} group`;
      x.setAttribute("aria-label", `Reset ${c.label} group`);
      x.textContent = "✕";
      x.addEventListener("click", () => clearGroup(c.key));
      row.append(swatch, main, x);
      body.appendChild(row);
    }

    const actions = document.createElement("div");
    actions.className = "cc-actions";
    const submit = document.createElement("button");
    submit.type = "button";
    submit.id = "cc-submit";
    submit.className = "cc-btn";
    submit.addEventListener("click", submitAll);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.id = "cc-clear";
    clear.className = "cc-btn cc-secondary";
    clear.textContent = "Clear";
    clear.addEventListener("click", clearAll);
    actions.append(submit, clear);
    body.appendChild(actions);

    const status = document.createElement("div");
    status.id = "cc-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    body.appendChild(status);

    panel.appendChild(body);
    document.body.appendChild(panel);
    render();
  }

  // The board only exists after the player clicks Play on the welcome screen.
  const bootTimer = setInterval(() => {
    if ($(SEL.board)) {
      clearInterval(bootTimer);
      buildPanel();
    }
  }, 500);
})();
