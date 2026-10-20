/**
 * Sort one-line inbox captures through Templater dialogs.
 * Invoke after template execution: await tp.user.sort_inbox(tp, configPath).
 * Uses Obsidian APIs only; no filesystem or Node.js dependencies.
 */
const DEFAULT_CONFIG_PATH = ".obsidian/Scripts/inbox_sorter_config.json";
const LOCK_KEY = Symbol.for("notes.inbox-sorter.running");
const JOURNAL_VERSION = 2;

class Cancelled extends Error {}

function notice(tp, message) {
  if (tp?.obsidian?.Notice) new tp.obsidian.Notice(message, 10000);
}

function required(value, name) {
  if (typeof value !== "string" || !value.trim() || /^TODO(?:_|\b)/i.test(value.trim())) {
    throw new Error(`Fill in ${name} in the inbox sorter configuration.`);
  }
  return value.trim();
}

function vaultPath(value, name) {
  const path = required(value, name).replace(/\\/g, "/");
  const parts = path.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || /[<>:"|?*\x00-\x1f]/.test(part))) {
    throw new Error(`${name} must be a relative path inside the vault: ${path}`);
  }
  return path;
}

function within(path, folder) {
  return path.startsWith(`${folder}/`);
}

function canonicalPath(ctx, path) {
  const exact = ctx.app.vault.getAbstractFileByPath(path);
  if (exact) return exact.path;
  let loaded;
  let resolved = "";
  for (const part of path.split("/")) {
    const candidate = resolved ? `${resolved}/${part}` : part;
    const entry = ctx.app.vault.getAbstractFileByPath(candidate);
    if (entry) {
      resolved = entry.path;
      continue;
    }
    loaded ??= ctx.app.vault.getAllLoadedFiles?.() ?? [];
    const matches = loaded.filter(file => file.path.toLowerCase() === candidate.toLowerCase());
    if (matches.length > 1) throw new Error(`Ambiguous path capitalization: ${candidate}. Use an exact vault path.`);
    resolved = matches[0]?.path ?? candidate;
  }
  return resolved;
}

function fileAt(ctx, path) {
  const entry = ctx.app.vault.getAbstractFileByPath(canonicalPath(ctx, path));
  if (entry && Array.isArray(entry.children)) throw new Error(`Expected a file at ${path}, but found a folder.`);
  return entry;
}

function safeDestination(ctx, path) {
  path = canonicalPath(ctx, vaultPath(path, "destination"));
  const protectedPaths = [ctx.configPath, ctx.config.inbox.pcNote, ctx.config.logPath, ctx.config.journalPath].map(value => canonicalPath(ctx, value));
  if (protectedPaths.includes(path) || within(path, ctx.config.inbox.phoneFolder)) {
    throw new Error(`The destination overlaps an inbox or sorter file: ${path}`);
  }
  if (!path.toLowerCase().endsWith(".md")) throw new Error(`Destination notes must end in .md: ${path}`);
  return path;
}

function validateConfig(ctx) {
  const config = ctx.config;
  if (config.version !== 1) throw new Error("Unsupported inbox sorter configuration version; expected 1.");
  if (!config.inbox || !config.domains?.work || !config.domains?.personal) {
    throw new Error("Configuration must contain inbox, domains.work, and domains.personal.");
  }
  config.inbox.pcNote = canonicalPath(ctx, vaultPath(config.inbox.pcNote, "inbox.pcNote"));
  config.inbox.phoneFolder = canonicalPath(ctx, vaultPath(config.inbox.phoneFolder, "inbox.phoneFolder"));
  // Older vaults with the single-prefix setting also recognize the new checkbox.
  const prefixes = config.inbox.taskPrefixes ?? [config.inbox.taskPrefix, "- [c]"];
  if (!Array.isArray(prefixes) || prefixes.length === 0) throw new Error("inbox.taskPrefixes must be a nonempty list.");
  config.inbox.taskPrefixes = prefixes.map((prefix, index) => required(prefix, `inbox.taskPrefixes[${index}]`));
  if (typeof config.inbox.phoneRecursive !== "boolean") throw new Error("inbox.phoneRecursive must be true or false.");
  config.logPath = canonicalPath(ctx, vaultPath(config.logPath, "logPath"));
  config.journalPath = canonicalPath(ctx, vaultPath(config.journalPath, "journalPath"));
  const paths = [ctx.configPath, config.inbox.pcNote, config.logPath, config.journalPath];
  if (new Set(paths).size !== paths.length || paths.some(path => within(path, config.inbox.phoneFolder))) {
    throw new Error("Inbox, configuration, log, and journal paths must be distinct and outside the phone folder.");
  }
}

async function ensureParents(ctx, path) {
  path = canonicalPath(ctx, path);
  const parts = path.split("/").slice(0, -1);
  for (let index = 1; index <= parts.length; index++) {
    const folder = parts.slice(0, index).join("/");
    const entry = ctx.app.vault.getAbstractFileByPath(folder);
    if (entry) {
      if (!Array.isArray(entry.children)) throw new Error(`A file occupies the required folder ${folder}.`);
    } else {
      const stat = await ctx.app.vault.adapter.stat?.(folder);
      if (stat) {
        if (stat.type !== "folder") throw new Error(`A file occupies the required folder ${folder}.`);
        continue;
      }
      try {
        await ctx.app.vault.createFolder(folder);
      } catch (error) {
        const current = ctx.app.vault.getAbstractFileByPath(folder);
        const refreshed = !current ? await ctx.app.vault.adapter.stat?.(folder) : null;
        // A filesystem watcher or another creator may have supplied the folder.
        if (!Array.isArray(current?.children) && refreshed?.type !== "folder") throw error;
      }
    }
  }
}

async function saveJournal(ctx, pending) {
  await ensureParents(ctx, ctx.config.journalPath);
  await ctx.app.vault.adapter.write(ctx.config.journalPath, JSON.stringify({ version: JOURNAL_VERSION, pending }, null, 2));
}

async function readJournal(ctx) {
  if (!await ctx.app.vault.adapter.exists(ctx.config.journalPath)) return null;
  const state = JSON.parse(await ctx.app.vault.adapter.read(ctx.config.journalPath));
  if (![1, JOURNAL_VERSION].includes(state?.version) || !Object.hasOwn(state, "pending")
    || (state.pending !== null && (typeof state.pending !== "object" || Array.isArray(state.pending)))) {
    throw new Error("The recovery journal has an unsupported format.");
  }
  if (state.version === 1 && state.pending !== null) {
    throw new Error("An older sorter move is still pending. Inspect its journal before switching to recovery without note identifiers.");
  }
  return state.pending;
}

function rowsOf(content) {
  let offset = 0;
  return (content.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? []).filter(Boolean).map(raw => {
    const row = { raw, text: raw.replace(/(?:\r\n|\n|\r)$/, ""), offset };
    offset += raw.length;
    return row;
  });
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function collectItems(ctx) {
  const pcFile = fileAt(ctx, ctx.config.inbox.pcNote);
  if (!pcFile) throw new Error(`PC inbox not found: ${ctx.config.inbox.pcNote}`);
  const phoneFolder = ctx.app.vault.getAbstractFileByPath(ctx.config.inbox.phoneFolder);
  if (!phoneFolder || !Array.isArray(phoneFolder.children)) throw new Error(`Phone inbox folder not found: ${ctx.config.inbox.phoneFolder}`);
  const phoneFiles = ctx.app.vault.getMarkdownFiles().filter(file => {
    if (!within(file.path, ctx.config.inbox.phoneFolder)) return false;
    return ctx.config.inbox.phoneRecursive || file.path.slice(ctx.config.inbox.phoneFolder.length + 1).indexOf("/") === -1;
  }).sort((a, b) => a.path.localeCompare(b.path));
  const tasks = [];
  const thoughts = [];
  for (const [kind, file] of [["pc", pcFile], ...phoneFiles.map(file => ["phone", file])]) {
    const content = await ctx.app.vault.read(file);
    const doc = { kind, path: file.path, content, rows: rowsOf(content) };
    const captures = doc.rows.filter(row => row.text.trim());
    if (kind === "phone" && captures.length > 1) throw new Error(`Phone capture must contain one nonblank line: ${file.path}`);
    for (const row of captures) {
      row.id = newId();
      const taskPrefix = ctx.config.inbox.taskPrefixes.find(prefix => row.text.startsWith(prefix));
      const item = { id: row.id, doc, original: row.text, text: row.text, taskPrefix, kind: taskPrefix ? "task" : "thought" };
      (item.kind === "task" ? tasks : thoughts).push(item);
    }
  }
  return [...tasks, ...thoughts];
}

async function choose(ctx, choices, title) {
  const answer = await ctx.tp.system.suggester(choices.map(choice => choice.label), choices.map(choice => choice.value), false, title);
  if (answer == null) throw new Cancelled();
  return answer;
}

async function chooseCaptureRoute(ctx, choices, item, index, total) {
  const { FuzzySuggestModal } = ctx.tp.obsidian;
  const answer = await new Promise(resolve => {
    class CaptureRouteModal extends FuzzySuggestModal {
      constructor(app) {
        super(app);
        this.submitted = false;
        this.setPlaceholder("Choose a route");
        this.setTitle(`${index + 1}/${total} · ${item.kind}`);
      }

      getItems() { return choices; }
      getItemText(choice) { return choice.label; }

      onOpen() {
        super.onOpen();
        const preview = this.modalEl.createDiv();
        preview.setText((index + 1) + "/" + total + " " + item.kind + "\n" + item.text);
        preview.style.whiteSpace = "pre-wrap";
        preview.style.overflowWrap = "anywhere";
        preview.style.maxHeight = "40vh";
        preview.style.overflowY = "auto";
        preview.style.fontSize = "var(--font-ui-medium)";
        preview.style.fontWeight = "normal";
        preview.style.padding = "0.75em 1em";
        preview.style.borderBottom = "1px solid var(--background-modifier-border)";
        this.modalEl.prepend(preview);
      }

      selectSuggestion(match, event) {
        this.submitted = true;
        super.selectSuggestion(match, event);
      }

      onChooseItem(choice) { resolve(choice.value); }
      onClose() { if (!this.submitted) resolve(null); }
    }
    new CaptureRouteModal(ctx.app).open();
  });
  if (answer == null) throw new Cancelled();
  return answer;
}

async function classify(ctx, item, index, total) {
  for (;;) {
    const choice = await chooseCaptureRoute(ctx, [
      { label: "1. Work", value: "work" },
      { label: "2. Personal", value: "personal" },
      { label: "3. Delete", value: "delete" },
      { label: "4. Skip / Later", value: "skip" },
      { label: "5. Edit before routing", value: "edit" }
    ], item, index, total);
    if (choice !== "edit") return choice;
    const taskPrefix = item.taskPrefix;
    const prefix = item.kind === "task" ? `${taskPrefix} ` : item.text.match(/^([ \t]*-[ \t]*)/)?.[1] ?? "";
    const initial = item.kind === "task" ? item.text.slice(taskPrefix.length).trimStart() : item.text.slice(prefix.length);
    const edited = await ctx.tp.system.prompt(`Edit ${item.kind}`, initial, false, false);
    if (edited == null) throw new Cancelled();
    if (!edited.trim() || /[\r\n]/.test(edited)) {
      notice(ctx.tp, "Enter one nonblank line. The item has not been changed.");
      continue;
    }
    let body = edited.trim();
    if (item.kind === "task") {
      const enteredPrefix = ctx.config.inbox.taskPrefixes.find(candidate => body.startsWith(candidate));
      if (enteredPrefix) body = body.slice(enteredPrefix.length).trimStart();
    } else if (prefix && body.startsWith("- ")) body = body.slice(2).trimStart();
    if (!body) {
      notice(ctx.tp, "Enter text after the capture prefix. The item has not been changed.");
      continue;
    }
    item.text = prefix + body;
  }
}

function headingSpec(value, name) {
  const heading = required(value, name);
  if (/[\r\n]/.test(heading)) throw new Error(`${name} must contain one heading.`);
  const match = heading.match(/^(#{1,6})\s+(.+)$/);
  return match ? { text: match[2].replace(/\s+#+\s*$/, "").trim(), level: match[1].length } : { text: heading, level: null };
}

async function weeklyDestination(ctx, domain) {
  const config = ctx.config.domains[domain].weekly;
  const key = `domains.${domain}.weekly`;
  const folder = canonicalPath(ctx, vaultPath(config?.folder, `${key}.folder`));
  const naming = required(config?.namingScheme, `${key}.namingScheme`);
  const heading = headingSpec(config?.appendHeading, `${key}.appendHeading`);
  // tp.date.now uses the sorting date, including the ISO week year in GGGG.
  const rendered = ctx.tp.date.now(naming);
  const path = safeDestination(ctx, `${folder}/${rendered}${rendered.toLowerCase().endsWith(".md") ? "" : ".md"}`);
  const creation = fileAt(ctx, path) ? null : { kind: "weekly", templatePath: vaultPath(config?.templatePath, `${key}.templatePath`) };
  return { path, heading, creation, creationConfirmed: !creation };
}

async function projectFrontmatter(ctx, file) {
  const content = await ctx.app.vault.read(file);
  const rows = rowsOf(content);
  if (rows[0]?.text !== "---") return {};
  const end = rows.findIndex((row, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(row.text));
  if (end < 0) throw new Error(`Unclosed frontmatter in ${file.path}.`);
  return ctx.tp.obsidian.parseYaml(rows.slice(1, end).map(row => row.text).join("\n")) ?? {};
}

async function existingProjectDestination(ctx, domain) {
  const config = ctx.config.domains[domain].projects;
  const key = `domains.${domain}.projects`;
  const folder = canonicalPath(ctx, vaultPath(config?.folder, `${key}.folder`));
  const heading = headingSpec(config?.appendHeading, `${key}.appendHeading`);
  const type = required(ctx.config.activeProject?.type, "activeProject.type");
  const status = required(ctx.config.activeProject?.status, "activeProject.status");
  const templates = new Set(Object.values(ctx.config.domains).flatMap(domainConfig => [
    domainConfig.weekly?.templatePath, domainConfig.projects?.templatePath
  ]).filter(value => typeof value === "string").map(value => value.replace(/\\/g, "/")));
  const files = ctx.app.vault.getMarkdownFiles().filter(file => within(file.path, folder) && !templates.has(file.path));
  const active = [];
  for (const file of files) {
    const frontmatter = await projectFrontmatter(ctx, file);
    if (String(frontmatter.type).toLowerCase() === type.toLowerCase() && String(frontmatter.status).toLowerCase() === status.toLowerCase()) {
      safeDestination(ctx, file.path);
      active.push(file);
    }
  }
  active.sort((a, b) => a.path.localeCompare(b.path));
  const path = await choose(ctx, [{ label: "Create new project", value: "new" }, ...active.map(file => ({ label: `${file.basename} — ${file.path}`, value: file.path }))], `Project for ${domain} task`);
  if (path === "new") return newProjectDestination(ctx, domain);
  return { path, heading, creation: null, creationConfirmed: true };
}

async function newProjectDestination(ctx, domain) {
  const config = ctx.config.domains[domain].projects;
  const key = `domains.${domain}.projects`;
  const folder = canonicalPath(ctx, vaultPath(config?.folder, `${key}.folder`));
  const heading = headingSpec(config?.appendHeading, `${key}.appendHeading`);
  const templatePath = vaultPath(config?.templatePath, `${key}.templatePath`);
  const properties = { type: required(ctx.config.activeProject?.type, "activeProject.type"), status: required(ctx.config.activeProject?.status, "activeProject.status") };
  for (;;) {
    const input = await ctx.tp.system.prompt(`New ${domain} project name`, "", false, false);
    if (input == null) throw new Cancelled();
    const name = input.trim().replace(/\.md$/i, "");
    if (!name || /[\\/<>:"|?*\x00-\x1f]/.test(name) || /^[. ]|[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
      notice(ctx.tp, "Enter a valid project filename, without folders or reserved filename characters.");
      continue;
    }
    const path = safeDestination(ctx, `${folder}/${name}.md`);
    if (ctx.app.vault.getAbstractFileByPath(path) || await ctx.app.vault.adapter.exists(path)) {
      notice(ctx.tp, `${path} already exists. Enter another name, or cancel to select it on the next run.`);
      continue;
    }
    return { path, heading, creation: { kind: "project", templatePath, properties }, creationConfirmed: false };
  }
}

async function destinationFor(ctx, item, domain) {
  if (item.kind === "thought") {
    const path = safeDestination(ctx, vaultPath(ctx.config.domains[domain].thoughts?.notePath, `domains.${domain}.thoughts.notePath`));
    const creation = fileAt(ctx, path) ? null : { kind: "plain" };
    return { path, heading: null, creation, creationConfirmed: !creation };
  }
  for (;;) {
    const choice = await choose(ctx, [
      { label: "1. Individual task → current weekly note", value: "weekly" },
      { label: "2. Project", value: "project" }
    ], `Destination for ${domain} task · ${item.text}`);
    if (choice === "weekly") return weeklyDestination(ctx, domain);
    return existingProjectDestination(ctx, domain);
  }
}

function markdownHeadings(content) {
  const rows = rowsOf(content);
  const headings = [];
  let fence = null;
  let frontmatter = rows[0]?.text === "---";
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (frontmatter) {
      if (index > 0 && /^(---|\.\.\.)\s*$/.test(row.text)) frontmatter = false;
      continue;
    }
    const fenced = row.text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (fenced && fenced[1][0] === fence.char && fenced[1].length >= fence.length && !fenced[2].trim()) fence = null;
      continue;
    }
    if (fenced) { fence = { char: fenced[1][0], length: fenced[1].length }; continue; }
    const match = row.text.match(/^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/);
    if (match) headings.push({ text: match[2].replace(/\s+#+\s*$/, "").trim(), level: match[1].length, offset: row.offset });
  }
  if (frontmatter || fence) throw new Error(`Destination contains ${frontmatter ? "unclosed frontmatter" : "an unclosed fenced code block"}. Close it before sorting.`);
  return headings;
}

function appendBlock(content, text, heading) {
  const eol = content.match(/\r\n|\n|\r/)?.[0] ?? "\n";
  const block = `${text}${eol}`;
  const separate = prefix => prefix ? prefix + (prefix.endsWith(eol + eol) ? "" : prefix.endsWith(eol) ? eol : eol + eol) : "";
  const headings = markdownHeadings(content);
  if (!heading) return separate(content) + block;
  const matches = headings.filter(found => found.text === heading.text && (heading.level == null || found.level === heading.level));
  if (matches.length > 1) throw new Error(`More than one matching heading '${heading.text}'. Specify its heading level or make it unique.`);
  if (!matches.length) return `${separate(content)}${"#".repeat(heading.level ?? 2)} ${heading.text}${eol}${eol}${block}`;
  const found = matches[0];
  // Keep new items directly under the requested heading, before any subheading.
  const boundary = headings.find(candidate => candidate.offset > found.offset)?.offset ?? content.length;
  const before = content.slice(0, boundary);
  const after = content.slice(boundary);
  return before + (before.endsWith(eol) ? "" : eol) + block + (after ? eol : "") + after;
}

async function assertSource(ctx, source, allowAfter) {
  const file = fileAt(ctx, source.path);
  if (!file) {
    if (allowAfter && source.kind === "phone") return;
    throw new Error(`Source note is missing: ${source.path}`);
  }
  const content = await ctx.app.vault.read(file);
  if (content !== source.before && !(allowAfter && source.kind === "pc" && content === source.after)) {
    throw new Error(`Source changed during sorting: ${source.path}. Inspect the inbox and any pending recovery journal before retrying.`);
  }
}

async function preparePending(ctx, item, destination) {
  const source = {
    kind: item.doc.kind, path: item.doc.path, before: item.doc.content,
    after: item.doc.kind === "pc" ? item.doc.rows.filter(row => row.id !== item.id).map(row => row.raw).join("") : null
  };
  await assertSource(ctx, source, false);
  if (source.kind === "phone" && typeof ctx.app.fileManager.trashFile !== "function") throw new Error("This workflow requires Obsidian's FileManager.trashFile API.");
  if (destination?.creation?.templatePath) {
    const template = fileAt(ctx, destination.creation.templatePath);
    if (!template) throw new Error(`Template not found: ${destination.creation.templatePath}`);
    if (template.path === destination.path) throw new Error("A template cannot also be its destination note.");
  }
  if (destination && fileAt(ctx, destination.path)) {
    const before = await ctx.app.vault.read(fileAt(ctx, destination.path));
    destination.snapshot = { before, after: appendBlock(before, item.text, destination.heading) };
  }
  const logFile = fileAt(ctx, ctx.config.logPath);
  const before = logFile ? await ctx.app.vault.read(logFile) : "";
  const eol = before.match(/\r\n|\n|\r/)?.[0] ?? "\n";
  const after = before + (before && !/[\r\n]$/.test(before) ? eol : "") + `${item.original} -> ${destination?.path ?? "[deleted]"}${eol}`;
  const pending = { id: item.id, original: item.original, text: item.text, source, destination, log: { path: ctx.config.logPath, before, after } };
  await saveJournal(ctx, pending);
  return pending;
}

function validatePending(ctx, pending) {
  const source = pending?.source;
  if (!/^[a-zA-Z0-9-]+$/.test(pending?.id ?? "") || typeof pending.text !== "string" || /[\r\n]/.test(pending.text)
    || typeof source?.before !== "string" || !["pc", "phone"].includes(source.kind)
    || (source.kind === "pc" && (source.path !== ctx.config.inbox.pcNote || typeof source.after !== "string"))
    || (source.kind === "phone" && (!within(vaultPath(source.path, "journal source"), ctx.config.inbox.phoneFolder) || source.after !== null))
    || pending.log?.path !== ctx.config.logPath || typeof pending.log?.before !== "string" || typeof pending.log?.after !== "string") {
    throw new Error("Recovery journal is invalid or its source/log paths differ from the configuration.");
  }
  if (pending.destination) {
    safeDestination(ctx, pending.destination.path);
    const snapshot = pending.destination.snapshot;
    if (snapshot ? typeof snapshot.before !== "string" || typeof snapshot.after !== "string"
      : !pending.destination.creation || pending.destination.creationConfirmed) {
      throw new Error("The destination recovery snapshot is missing or invalid.");
    }
  }
}

async function createDestination(ctx, pending) {
  const destination = pending.destination;
  const path = safeDestination(ctx, destination.path);
  let file = fileAt(ctx, path);
  if (file) {
    if (destination.creation && !destination.creationConfirmed) {
      throw new Error(`Template creation was interrupted at ${destination.path}. Inspect the new note, remove it if safe, then rerun to recreate it.`);
    }
    return file;
  }
  if (!destination.creation || destination.creationConfirmed) throw new Error(`Destination note was removed: ${destination.path}`);
  await ensureParents(ctx, path);
  if (destination.creation.kind === "plain") {
    file = await ctx.app.vault.create(path, "");
  } else {
    const template = fileAt(ctx, destination.creation.templatePath);
    if (!template) throw new Error(`Template not found: ${destination.creation.templatePath}`);
    const split = path.lastIndexOf("/");
    const folder = split < 0 ? "" : path.slice(0, split);
    const filename = path.slice(split + 1, -3);
    file = await ctx.tp.file.create_new(template, filename, false, folder);
    if (!file || file.path !== path) throw new Error(`Template created an unexpected file; expected ${path}.`);
    if (destination.creation.kind === "project") {
      await ctx.app.fileManager.processFrontMatter(file, frontmatter => {
        frontmatter.type = destination.creation.properties.type;
        frontmatter.status = destination.creation.properties.status;
      });
    }
  }
  destination.creationConfirmed = true;
  const before = await ctx.app.vault.read(file);
  destination.snapshot = { before, after: appendBlock(before, pending.text, destination.heading) };
  await saveJournal(ctx, pending);
  return file;
}

async function completePending(ctx, pending) {
  validatePending(ctx, pending);
  await assertSource(ctx, pending.source, true);
  if (pending.destination) {
    const file = await createDestination(ctx, pending);
    const snapshot = pending.destination.snapshot;
    await ctx.app.vault.process(file, content => {
      if (content === snapshot.after) return content;
      if (content !== snapshot.before) throw new Error(`Destination changed during sorting: ${file.path}. Inspect the pending recovery journal before retrying.`);
      return snapshot.after;
    });
  }
  let log = fileAt(ctx, pending.log.path);
  if (!log) {
    if (pending.log.before) throw new Error(`Log file was removed: ${pending.log.path}`);
    await ensureParents(ctx, pending.log.path);
    log = await ctx.app.vault.create(pending.log.path, "");
  }
  await ctx.app.vault.process(log, content => {
    if (content === pending.log.after) return content;
    if (content !== pending.log.before) throw new Error(`Log changed during sorting: ${pending.log.path}. Inspect the pending journal before retrying.`);
    return pending.log.after;
  });
  const source = fileAt(ctx, pending.source.path);
  if (pending.source.kind === "phone") {
    if (source) {
      await assertSource(ctx, pending.source, false);
      await ctx.app.fileManager.trashFile(source);
    }
  } else {
    if (!source) throw new Error(`PC inbox was removed: ${pending.source.path}`);
    await ctx.app.vault.process(source, content => {
      if (content === pending.source.after) return content;
      if (content !== pending.source.before) throw new Error(`Source changed during sorting: ${pending.source.path}. Inspect the pending journal before retrying.`);
      return pending.source.after;
    });
  }
  await saveJournal(ctx, null);
}

/** @param {object} tp Templater's function object. @param {string} configPath Vault-relative JSON configuration path. */
module.exports = async function sortInbox(tp, configPath = DEFAULT_CONFIG_PATH) {
  const result = { status: "completed", processed: 0, skipped: 0, recovered: 0 };
  const locks = globalThis[LOCK_KEY] ?? (globalThis[LOCK_KEY] = new WeakSet());
  const app = tp?.app;
  if (!app || locks.has(app)) {
    result.status = "error";
    result.error = app ? "Inbox sorting is already running." : "Pass Templater's tp object to the sorter.";
    notice(tp, result.error);
    return result;
  }
  locks.add(app);
  try {
    configPath = canonicalPath({ app }, vaultPath(configPath, "configuration path"));
    const ctx = { tp, app, configPath, config: JSON.parse(await app.vault.adapter.read(configPath)) };
    validateConfig(ctx);
    const pending = await readJournal(ctx);
    if (pending) {
      notice(tp, "Finishing an interrupted inbox move.");
      await completePending(ctx, pending);
      result.recovered++;
    }
    const items = await collectItems(ctx);
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const category = await classify(ctx, item, index, items.length);
      if (category === "skip") { result.skipped++; continue; }
      const destination = category === "delete" ? null : await destinationFor(ctx, item, category);
      const transaction = await preparePending(ctx, item, destination);
      await completePending(ctx, transaction);
      if (item.doc.kind === "pc") {
        item.doc.content = transaction.source.after;
        item.doc.rows = item.doc.rows.filter(row => row.id !== item.id);
      }
      result.processed++;
    }
    notice(tp, items.length ? "Inbox sorting finished." : "Inbox is empty.");
  } catch (error) {
    if (error instanceof Cancelled) {
      result.status = "cancelled";
      notice(tp, "Inbox sorting stopped. The current item was left untouched.");
    } else {
      result.status = "error";
      result.error = error.message;
      notice(tp, `Inbox sorting stopped: ${error.message}`);
    }
  } finally {
    locks.delete(app);
  }
  return result;
};
