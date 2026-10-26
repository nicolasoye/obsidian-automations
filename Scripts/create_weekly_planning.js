/**
 * QuickAdd: Create weekly planning board.
 * Shared implementation for both entry points; no Node APIs or plugin required.
 * Source note writes always use Vault.process. The journal precedes every phase.
 */
const CONFIG_PATH = "Scripts/weekly_planning_config.json";
const LOCK = Symbol.for("obsidian.weekly-planning.running");
const COLUMNS = ["Overdue", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Next week", "Next month"];
const APPLY_CHOICE = "Apply weekly schedule";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function path(value) {
  assert(typeof value === "string" && value.trim(), "Folder paths must be nonempty strings.");
  const result = value.replace(/\\/g, "/").replace(/\/+$/, "");
  assert(!result.startsWith("/") && !result.split("/").some(p => !p || p === "." || p === ".." || p.startsWith(".") || /[:\n\r]/.test(p)), `Invalid vault folder: ${value}`);
  return result;
}

async function config(vault) {
  const c = JSON.parse(await vault.adapter.read(CONFIG_PATH));
  assert(c.version === 1, "Unsupported weekly planning configuration version.");
  assert(typeof c.openStatus === "string" && /^[^\s\[\]]$/.test(c.openStatus), "openStatus must be a single checkbox character.");
  assert(typeof c.dueDateMarker === "string" && c.dueDateMarker.trim() && !/[\r\n]/.test(c.dueDateMarker), "Invalid dueDateMarker.");
  for (const key of ["excludedFolders", "excludedFolderTrees"]) {
    assert(Array.isArray(c[key]), `${key} must be a list.`);
    c[key] = c[key].map(path);
  }
  c.temporaryFolder = path(c.temporaryFolder);
  c.logFolder = path(c.logFolder);
  assert(!inside(c.temporaryFolder, c.logFolder) && !inside(c.logFolder, c.temporaryFolder), "Temporary and log folders must not overlap.");
  return c;
}

function inside(note, folder) { return note === folder || note.startsWith(folder + "/"); }
function excluded(note, c) {
  const parent = note.includes("/") ? note.slice(0, note.lastIndexOf("/")) : "";
  return c.excludedFolders.includes(parent) || [...c.excludedFolderTrees, c.temporaryFolder, c.logFolder].some(folder => inside(note, folder));
}
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function iso(d) { return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; }
function date(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T12:00:00Z");
  return Number.isFinite(d.getTime()) && iso(d) === s ? d : null;
}
function addDays(s, days) { const d = date(s); d.setUTCDate(d.getUTCDate() + days); return iso(d); }
function planningDates(now) {
  // Convert the user's local calendar day into UTC before calendar arithmetic (DST safe).
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const monday = addDays(today, -((date(today).getUTCDay() + 6) % 7));
  const nextMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1, 12));
  nextMonth.setUTCDate(1 + ((8 - nextMonth.getUTCDay()) % 7));
  return { monday, friday: addDays(monday, 4), nextWeek: addDays(monday, 7), nextMonth: iso(nextMonth) };
}
function columnFor(due, dates) {
  if (due < dates.monday) return "Overdue";
  for (let i = 0; i < 5; i++) if (due === addDays(dates.monday, i)) return COLUMNS[i + 1];
  return null;
}
function targetDate(column, task, dates) {
  if (column === task.initialColumn) return task.originalDate;
  assert(column !== "Overdue", `Cannot move into Overdue: ${task.sourcePath} — ${task.description}`);
  if (column === "Next week") return dates.nextWeek;
  if (column === "Next month") return dates.nextMonth;
  return addDays(dates.monday, COLUMNS.indexOf(column) - 1);
}

// Keep line endings verbatim. Ignore YAML and both kinds of fenced code, including indented fences.
function lines(text) {
  const result = [];
  const re = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let m;
  while ((m = re.exec(text)) && m[0]) result.push({ text: m[1], eol: m[2], eligible: false });
  let frontmatter = result[0]?.text.replace(/^\uFEFF/, "").trim() === "---";
  let fence = null;
  result.forEach((line, index) => {
    const s = line.text;
    if (frontmatter) {
      if (index > 0 && /^(---|\.\.\.)\s*$/.test(s)) frontmatter = false;
      return;
    }
    const f = s.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (f && f[1][0] === fence.char && f[1].length >= fence.length && !f[2].trim()) fence = null;
      return;
    }
    if (f) { fence = { char: f[1][0], length: f[1].length }; return; }
    line.eligible = true;
  });
  return result;
}
function join(items) { return items.map(l => l.text + l.eol).join(""); }
function blockId(line) { return line.match(/(?:^|\s)\^([A-Za-z0-9-]+)\s*$/)?.[1] || null; }
function parseTask(line, c) {
  const checkbox = line.match(/^(\s*(?:[-+*]|\d+[.)])\s+)\[([^\]])\](?:[ \t]+|$)(.*)$/);
  if (!checkbox || checkbox[2] !== c.openStatus) return null;
  const re = new RegExp(escapeRegex(c.dueDateMarker) + "[ \\t]+(\\d{4}-\\d{2}-\\d{2})(?![\\d-])", "g");
  const matches = [...line.matchAll(re)];
  // Multiple date markers are ambiguous, even if only one has a valid value.
  if (matches.length !== 1 || line.split(c.dueDateMarker).length !== 2 || !date(matches[0][1])) return null;
  return { due: matches[0][1], dueOffset: matches[0].index + matches[0][0].length - 10, body: checkbox[3], blockId: blockId(line) };
}
function description(body, c) {
  return body
    .replace(/\s+\^[A-Za-z0-9-]+\s*$/, "")
    .replace(new RegExp(escapeRegex(c.dueDateMarker) + "[ \\t]+\\d{4}-\\d{2}-\\d{2}", "g"), "")
    .replace(/[📅⏳🛫➕✅❌]️?\s*\d{4}-\d{2}-\d{2}/gu, "")
    .replace(/🔁[^📅⏳🛫➕✅❌🔺⏫🔼🔽⏬🆔⛔🏁#]*/gu, "")
    .replace(/(?:🆔|⛔)\s*[\w,-]+/gu, "")
    .replace(/🏁\s*\w+/gu, "")
    .replace(/🔺|⏫|🔼|🔽|⏬/gu, "")
    .replace(/\s+/g, " ").trim() || "(Untitled task)";
}
function plain(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_[\]#|~]/g, "\\$&");
}
function noteLink(sourcePath, id, label = "Source") {
  // Markdown links avoid ambiguous wikilinks when a filename contains | or ].
  const destination = sourcePath.split("/").map(encodeURIComponent).join("/") + (id ? "#%5E" + encodeURIComponent(id) : "");
  return `[${label}](${destination})`;
}
function card(task, session) {
  return `${plain(task.description)} · Original due: ${task.originalDate} · ${noteLink(task.sourcePath, task.blockId)} <!-- wp:${session.id}:${task.key} -->`;
}
function control() {
  return `[Apply schedule](obsidian://quickadd?choice=${encodeURIComponent(APPLY_CHOICE)})`;
}
function boardText(s) {
  const out = ["---", "kanban-plugin: board", "cssclasses:", "  - weekly-planning-board", "---", ""];
  for (const col of COLUMNS) {
    out.push(`## ${col}`, "");
    for (const task of s.tasks.filter(t => t.initialColumn === col)) out.push(`- [ ] ${card(task, s)}`);
    if (col === "Overdue") out.push(`- [ ] ${control()}`);
    out.push("", "");
  }
  out.push("%% kanban:settings", "```", JSON.stringify({ "kanban-plugin": "board", "show-checkboxes": false, "new-card-insertion-method": "append", "move-task-metadata": false, "move-dates": false, "move-tags": false }), "```", "%%", "");
  return out.join("\n");
}

function placements(text, s) {
  const errors = [];
  const found = new Map();
  const expected = new Map(s.tasks.map(t => [card(t, s), t]));
  const seenColumns = new Set();
  let col = null;
  let controls = 0;
  let settings = false;
  for (const l of lines(text)) {
    const line = l.text.trim();
    if (line === "%% kanban:settings") { settings = true; continue; }
    if (settings) continue;
    if (!l.eligible || !line) continue;
    if (line.startsWith("## ")) {
      col = line.slice(3).trim();
      if (!COLUMNS.includes(col)) errors.push(`Unknown column: ${col}`);
      else if (seenColumns.has(col)) errors.push(`Duplicate column: ${col}`);
      seenColumns.add(col);
      continue;
    }
    const m = line.match(/^- \[ \] (.*)$/);
    if (!m) { errors.push(`Unexpected or edited board content: ${line.slice(0, 100)}`); continue; }
    if (m[1] === control()) { controls++; if (col !== "Overdue") errors.push("Keep the Apply schedule control in Overdue."); continue; }
    const task = expected.get(m[1]);
    if (!task) { errors.push(`Added or edited task card: ${m[1].slice(0, 100)}`); continue; }
    if (found.has(task.key)) errors.push(`Duplicate task card: ${task.description}`);
    found.set(task.key, col);
    if (!COLUMNS.includes(col)) errors.push(`Task outside a scheduling column: ${task.description}`);
    if (col === "Overdue" && task.initialColumn !== "Overdue") errors.push(`Move this card out of Overdue: ${task.description} (${task.sourcePath})`);
  }
  for (const col of COLUMNS) if (!seenColumns.has(col)) errors.push(`Missing column: ${col}`);
  for (const task of s.tasks) if (!found.has(task.key)) errors.push(`Missing or archived task card: ${task.description} (${task.sourcePath})`);
  if (controls !== 1) errors.push("The Apply schedule control must appear exactly once.");
  // Settings are not allowed to hide an archive or injected cards after the parser stops.
  const tail = text.split("%% kanban:settings");
  if (tail.length !== 2 || !/^\s*```\s*\n[\s\S]*?\n```\s*\n%%\s*$/.test(tail[1])) errors.push("Invalid Kanban settings block.");
  else {
    try { JSON.parse(tail[1].match(/```\s*\n([\s\S]*?)\n```/)[1]); }
    catch { errors.push("Invalid Kanban settings JSON."); }
  }
  assert(!errors.length, "Board validation failed:\n" + errors.join("\n"));
  return found;
}

async function folder(vault, folderPath) {
  let current = "";
  for (const part of folderPath.split("/")) {
    current += (current ? "/" : "") + part;
    const existing = vault.getAbstractFileByPath(current);
    if (!existing) await vault.createFolder(current);
    else assert(!existing.extension && Array.isArray(existing.children), `A file blocks folder creation: ${current}`);
  }
}
function file(vault, p) {
  const f = vault.getAbstractFileByPath(p);
  assert(f && typeof f.extension === "string", `File not found: ${p}`);
  return f;
}
async function save(vault, s) {
  const data = JSON.stringify(s, null, 2) + "\n";
  const f = vault.getAbstractFileByPath(s.manifestPath);
  if (f) await vault.process(f, () => data);
  else await vault.create(s.manifestPath, data);
}
async function session(vault, c) {
  const p = `${c.temporaryFolder}/session.json`;
  const f = vault.getAbstractFileByPath(p);
  if (!f) return null;
  const s = JSON.parse(await vault.read(f));
  assert(s.version === 1 && s.manifestPath === p && Array.isArray(s.tasks), "Invalid weekly planning session manifest.");
  return s;
}
async function open(app, p) { await app.workspace.getLeaf(false).openFile(file(app.vault, p)); }
function group(tasks) {
  const result = new Map();
  for (const t of tasks) {
    if (!result.has(t.sourcePath)) result.set(t.sourcePath, []);
    result.get(t.sourcePath).push(t);
  }
  return result;
}
function withId(task, line = task.originalLine) { return task.addedId ? `${line} ^${task.blockId}` : line; }
function updatedLine(task) {
  return task.originalLine.slice(0, task.dueOffset) + task.targetDate + task.originalLine.slice(task.dueOffset + 10);
}
function locate(items, task) {
  const matches = items.map((l, i) => blockId(l.text) === task.blockId ? i : -1).filter(i => i >= 0);
  assert(matches.length === 1, `${task.sourcePath}: block ^${task.blockId} ${matches.length ? "is duplicated" : "is missing"} (${task.description}).`);
  const index = matches[0];
  assert(items[index].eligible, `${task.sourcePath}: task ^${task.blockId} is inside frontmatter or a code block.`);
  return index;
}
function checkTask(items, task, s, allowApplied) {
  const i = locate(items, task);
  const text = items[i].text;
  const original = withId(task);
  const applied = task.targetDate ? withId(task, updatedLine(task)) : null;
  const noteDone = s.notes[task.sourcePath]?.applied;
  assert((!noteDone && text === original) || (allowApplied && text === applied), `${task.sourcePath}: task text, status or metadata changed: ${task.description} (^${task.blockId}).`);
  return i;
}

async function collect(vault, c, now) {
  const id = `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const s = {
    version: 1, id, phase: "creating", createdAt: now.toISOString(), dates: planningDates(now), config: c,
    manifestPath: `${c.temporaryFolder}/session.json`, boardPath: `${c.temporaryFolder}/Weekly planning.md`,
    logPath: `${c.logFolder}/Weekly rescheduling ${id}.md`, tasks: [], notes: {}, errors: []
  };
  for (const f of vault.getMarkdownFiles().filter(f => !excluded(f.path, c)).sort((a, b) => a.path.localeCompare(b.path))) {
    const content = await vault.read(f);
    const items = lines(content);
    const allIds = new Set(items.map(l => blockId(l.text)).filter(Boolean));
    items.forEach((l, lineIndex) => {
      const t = l.eligible && parseTask(l.text, c);
      if (!t) return;
      const initialColumn = columnFor(t.due, s.dates);
      if (!initialColumn) return;
      const key = `t${s.tasks.length.toString(36)}`;
      const newId = `wp-${id}-${key}`;
      assert(t.blockId || !allIds.has(newId), `Generated block ID already exists in ${f.path}.`);
      s.tasks.push({ key, sourcePath: f.path, blockId: t.blockId || newId, addedId: !t.blockId,
        originalLine: l.text, originalDate: t.due, dueOffset: t.dueOffset, lineIndex, initialColumn, description: description(t.body, c) });
    });
  }
  return s;
}

async function finishCreation(app, s) {
  const vault = app.vault;
  for (const [p, tasks] of group(s.tasks)) {
    await vault.process(file(vault, p), content => {
      const items = lines(content);
      const used = new Set();
      for (const t of tasks) {
        const identified = items.map((l, i) => blockId(l.text) === t.blockId ? i : -1).filter(i => i >= 0);
        if (identified.length) {
          const i = locate(items, t);
          assert(items[i].text === withId(t), `Task changed during board creation: ${p} — ${t.description}`);
          used.add(i);
          continue;
        }
        assert(t.addedId, `Existing block ID is missing in ${p}: ^${t.blockId}`);
        const candidates = items.map((l, i) => !used.has(i) && l.eligible && l.text === t.originalLine ? i : -1).filter(i => i >= 0);
        const i = candidates.includes(t.lineIndex) ? t.lineIndex : candidates[0];
        assert(i !== undefined, `Task changed during board creation: ${p} — ${t.description}`);
        items[i].text = withId(t);
        used.add(i);
      }
      return join(items);
    });
  }
  if (!vault.getAbstractFileByPath(s.boardPath)) await vault.create(s.boardPath, boardText(s));
  s.phase = "planning";
  await save(vault, s);
  await open(app, s.boardPath);
}

async function validateSources(vault, s, allowApplied) {
  const errors = [];
  for (const [p, tasks] of group(s.tasks)) {
    try {
      const items = lines(await vault.read(file(vault, p)));
      for (const t of tasks) {
        try { checkTask(items, t, s, allowApplied); } catch (e) { errors.push(e.message); }
      }
    } catch (e) { errors.push(e.message); }
  }
  assert(!errors.length, "Source validation failed:\n" + errors.join("\n"));
}
function tableCell(s) { return s.replace(/\|/g, "&#124;").replace(/[\r\n]/g, " "); }
function logText(s, status) {
  const changed = s.tasks.filter(t => t.targetDate !== t.originalDate);
  const out = ["# Weekly rescheduling", "", `Session: ${s.id}`, `Planning week: ${s.dates.monday}–${addDays(s.dates.monday, 6)}`,
    `Application started: ${s.applicationStartedAt || "Not started"}`, `Status: ${status}`, "",
    "| Task | Source | Previous due date | New due date | Destination | Applied |",
    "| --- | --- | --- | --- | --- | --- |"];
  for (const t of changed) out.push(`| ${tableCell(plain(t.description))} | ${noteLink(t.sourcePath, t.addedId ? null : t.blockId, tableCell(plain(t.sourcePath.replace(/\.md$/, ""))))} | ${t.originalDate} | ${t.targetDate} | ${t.destination} | ${s.notes[t.sourcePath]?.applied ? "Yes" : "Pending"} |`);
  out.push("", `Changed tasks: ${changed.length}`, `Unchanged tasks: ${s.tasks.length - changed.length}`, "", "## Application errors", "");
  if (!s.errors.length) out.push("None.");
  for (const error of s.errors) out.push(`- ${error.at}: ${plain(error.message).replace(/\r?\n/g, " · ")}`);
  out.push("");
  return out.join("\n");
}
async function writeLog(vault, s, status) {
  await folder(vault, s.config.logFolder);
  const f = vault.getAbstractFileByPath(s.logPath);
  const text = logText(s, status);
  if (f) {
    await vault.process(f, current => {
      assert(current.includes(`Session: ${s.id}`), `Another file occupies the session log path: ${s.logPath}`);
      return text;
    });
  } else await vault.create(s.logPath, text);
}

async function removeIds(vault, s, discard = false) {
  for (const [p, tasks] of group(s.tasks.filter(t => t.addedId))) {
    if (s.notes[p]?.cleaned) continue;
    // A deleted source note cannot contain IDs that still need removing during discard.
    if (discard && !vault.getAbstractFileByPath(p)) continue;
    await vault.process(file(vault, p), content => {
      const items = lines(content);
      for (const t of tasks) {
        const matches = items.map((l, i) => blockId(l.text) === t.blockId ? i : -1).filter(i => i >= 0);
        assert(matches.length <= 1, `Temporary ID is duplicated in ${p}: ^${t.blockId}`);
        if (!matches.length) continue; // A previous cleanup write may have succeeded before its checkpoint.
        const i = matches[0];
        if (!discard) assert(items[i].text === withId(t, updatedLine(t)), `Task changed before cleanup in ${p}: ${t.description}`);
        // Discard preserves user edits and removes exactly the suffix that this session appended.
        items[i].text = items[i].text.replace(new RegExp(" \\^" + escapeRegex(t.blockId) + "(?=\\s*$)"), "");
        assert(blockId(items[i].text) !== t.blockId, `Temporary ID was reformatted in ${p}: ^${t.blockId}`);
      }
      return join(items);
    });
    s.notes[p] = { ...s.notes[p], cleaned: true };
    await save(vault, s);
  }
}
async function deleteTemporary(vault, s) {
  const board = vault.getAbstractFileByPath(s.boardPath);
  if (board) await vault.delete(board);
  const manifest = vault.getAbstractFileByPath(s.manifestPath);
  if (manifest) await vault.delete(manifest);
}

async function applySession(app, s) {
  const vault = app.vault;
  assert(s.phase !== "creating", "Board creation was interrupted. Run Create weekly planning board to finish it first.");
  assert(s.phase !== "discarding", "Discard was interrupted. Run Create weekly planning board and choose Discard again.");
  if (s.phase === "planning" || s.phase === "applying") {
    const found = placements(await vault.read(file(vault, s.boardPath)), s);
    if (s.phase === "applying") {
      for (const t of s.tasks) assert(t.destination === found.get(t.key), `The saved schedule changed after application began: ${t.description}. Restore the card to ${t.destination} to resume.`);
    } else {
      for (const t of s.tasks) { t.destination = found.get(t.key); t.targetDate = targetDate(t.destination, t, s.dates); }
    }
    // All notes are checked before the first due-date write.
    await validateSources(vault, s, s.phase === "applying");
    s.phase = "applying";
    s.applicationStartedAt ||= new Date().toISOString();
    await save(vault, s); // Freeze placements and expected post-write content before writing notes.
    for (const [p, tasks] of group(s.tasks)) {
      if (s.notes[p]?.applied) continue;
      await vault.process(file(vault, p), content => {
        const items = lines(content);
        for (const t of tasks) {
          const i = checkTask(items, t, s, true);
          items[i].text = withId(t, updatedLine(t));
        }
        return join(items);
      });
      s.notes[p] = { ...s.notes[p], applied: true };
      await save(vault, s);
    }
    await writeLog(vault, s, "Date updates complete; cleanup pending");
    s.phase = "cleanup";
    await save(vault, s);
  }
  assert(s.phase === "cleanup", `Unknown session phase: ${s.phase}`);
  await removeIds(vault, s);
  s.completedAt ||= new Date().toISOString();
  await save(vault, s);
  await writeLog(vault, s, `Completed ${s.completedAt}`);
  // Open before deleting recovery information, so a workspace failure is recoverable too.
  await open(app, s.logPath);
  await deleteTemporary(vault, s);
  return { status: "complete", logPath: s.logPath, changed: s.tasks.filter(t => t.targetDate !== t.originalDate).length };
}
async function discardSession(app, s) {
  assert(!["applying", "cleanup"].includes(s.phase), "Date application has already started. Use Apply weekly schedule to resume and complete its log and cleanup.");
  s.phase = "discarding";
  await save(app.vault, s);
  await removeIds(app.vault, s, true);
  await deleteTemporary(app.vault, s);
  return { status: "discarded" };
}

async function run(params, action) {
  const { app, obsidian, quickAddApi } = params;
  assert(app?.vault, "Run weekly planning through QuickAdd.");
  const locks = globalThis[LOCK] ?? (globalThis[LOCK] = new WeakSet());
  const notify = message => { if (obsidian?.Notice) new obsidian.Notice(message, 20000); };
  if (locks.has(app)) { notify("Weekly planning is already running."); return { status: "busy" }; }
  locks.add(app);
  let s;
  try {
    const c = await config(app.vault);
    s = await session(app.vault, c);
    if (action === "apply") {
      assert(s, "No weekly planning session exists. Create a board first.");
      const result = await applySession(app, s);
      notify(`Weekly schedule applied. ${result.changed} task date(s) changed.`);
      return result;
    }
    if (s) {
      const selected = await quickAddApi.suggester(["Reopen / resume planning session", "Discard planning session"], ["reopen", "discard"]);
      if (!selected) return { status: "cancelled" };
      if (selected === "discard") {
        const result = await discardSession(app, s);
        notify("Weekly planning session discarded. Temporary IDs removed.");
        return result;
      }
      if (s.phase === "creating") await finishCreation(app, s);
      else if (["applying", "cleanup"].includes(s.phase)) return await applySession(app, s);
      else if (s.phase === "discarding") return await discardSession(app, s);
      else await open(app, s.boardPath);
      return { status: "reopened", boardPath: s.boardPath };
    }
    assert(app.plugins?.getPlugin?.("obsidian-kanban") || app.plugins?.plugins?.["obsidian-kanban"], "Enable the Kanban plugin before creating a planning board.");
    await folder(app.vault, c.temporaryFolder);
    assert(!app.vault.getAbstractFileByPath(`${c.temporaryFolder}/Weekly planning.md`), "A planning board exists without its manifest. Restore session.json or move the orphan board before creating a session.");
    s = await collect(app.vault, c, new Date());
    await save(app.vault, s); // Must succeed before adding any source block IDs.
    await finishCreation(app, s);
    notify(`Weekly planning board created with ${s.tasks.length} task(s).`);
    return { status: "created", boardPath: s.boardPath, count: s.tasks.length };
  } catch (error) {
    if (s && app.vault.getAbstractFileByPath(s.manifestPath)) {
      s.errors.push({ at: new Date().toISOString(), message: error.message });
      try { await save(app.vault, s); }
      catch (journalError) { error.message += `\nCould not save recovery progress: ${journalError.message}`; }
      if (s.applicationStartedAt) {
        try { await writeLog(app.vault, s, "Interrupted — resume with Apply weekly schedule"); }
        catch (logError) { error.message += `\nCould not update log: ${logError.message}`; }
      }
    }
    notify(`Weekly planning: ${error.message}`);
    console.error("Weekly planning:", error);
    return { status: "error", error: error.message };
  } finally { locks.delete(app); }
}

module.exports = params => run(params, "create");
module.exports.apply = params => run(params, "apply");
// Pure helpers are exported for deterministic tests without touching the real vault.
module.exports.helpers = { planningDates, columnFor, targetDate, parseTask, lines, excluded, placements, boardText, description };
