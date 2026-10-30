/**
 * Sort markdown notes that have no topic property into Personal or work topics.
 * Invoke from Templater: await tp.user.sort_notes(tp, configPath).
 */
const DEFAULT_CONFIG_PATH = "Scripts/note_sorter_config.json";
const LOCK_KEY = Symbol.for("notes.note-sorter.running");

class Cancelled extends Error {}

function notice(tp, message) {
  if (tp?.obsidian?.Notice) new tp.obsidian.Notice(message, 10000);
}

function required(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Fill in ${name} in the note sorter configuration.`);
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

function folderAt(ctx, path) {
  const entry = ctx.app.vault.getAbstractFileByPath(path);
  if (entry && !Array.isArray(entry.children)) throw new Error(`Expected a folder at ${path}, but found a file.`);
  return entry ?? null;
}

async function ensureFolder(ctx, path) {
  path = canonicalPath(ctx, path);
  const parts = path.split("/");
  for (let index = 1; index <= parts.length; index++) {
    const current = parts.slice(0, index).join("/");
    const entry = ctx.app.vault.getAbstractFileByPath(current);
    if (entry) {
      if (!Array.isArray(entry.children)) throw new Error(`A file occupies the required folder ${current}.`);
      continue;
    }
    const stat = await ctx.app.vault.adapter.stat?.(current);
    if (stat) {
      if (stat.type !== "folder") throw new Error(`A file occupies the required folder ${current}.`);
      continue;
    }
    try {
      await ctx.app.vault.createFolder(current);
    } catch (error) {
      const created = ctx.app.vault.getAbstractFileByPath(current);
      const refreshed = !created ? await ctx.app.vault.adapter.stat?.(current) : null;
      if (!Array.isArray(created?.children) && refreshed?.type !== "folder") throw error;
    }
  }
}

function validateConfig(ctx) {
  const config = ctx.config;
  if (config.version !== 1 || !config.domains?.personal || !config.domains?.work) {
    throw new Error("Configuration must have version 1 and domains.personal and domains.work.");
  }
  for (const domain of ["personal", "work"]) {
    config.domains[domain].root = canonicalPath(ctx, vaultPath(config.domains[domain].root, `domains.${domain}.root`));
    config.domains[domain].topicsFolder = canonicalPath(ctx, vaultPath(config.domains[domain].topicsFolder, `domains.${domain}.topicsFolder`));
    if (config.domains[domain].topicsFolder !== `${config.domains[domain].root}/Topics`) {
      throw new Error(`domains.${domain}.topicsFolder must be ${config.domains[domain].root}/Topics.`);
    }
  }
  for (const key of ["excludedFoldersIncludingSubfolders", "excludedFoldersExact"]) {
    if (!Array.isArray(config[key])) throw new Error(`${key} must be a list of vault folder paths.`);
    config[key] = config[key].map((folder, index) => canonicalPath(ctx, vaultPath(folder, `${key}[${index}]`)));
  }
  config.templatePath = canonicalPath(ctx, vaultPath(config.templatePath, "templatePath"));
}

function topicPropertyIsEmpty(value) {
  return value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

async function frontmatter(ctx, file) {
  const content = await ctx.app.vault.read(file);
  const rows = content.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? [];
  if (rows[0]?.replace(/(?:\r\n|\n|\r)$/, "") !== "---") return {};
  const end = rows.findIndex((row, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(row.replace(/(?:\r\n|\n|\r)$/, "")));
  if (end < 0) throw new Error(`Unclosed frontmatter in ${file.path}.`);
  return ctx.tp.obsidian.parseYaml(rows.slice(1, end).map(row => row.replace(/(?:\r\n|\n|\r)$/, "")).join("\n")) ?? {};
}

function isExcluded(path, ctx) {
  if (ctx.config.excludedFoldersIncludingSubfolders.some(folder => path === folder || within(path, folder))) return true;
  if (ctx.config.excludedFoldersExact.some(folder => path.slice(0, path.lastIndexOf("/")) === folder)) return true;
  // Topic hubs live beside their topic folders and are not notes to be sorted.
  return Object.values(ctx.config.domains).some(domain => path === domain.topicsFolder || within(path, domain.topicsFolder));
}

async function collectNotes(ctx) {
  const ignoredRoot = ctx.context
    ? ctx.config.domains[ctx.context === "work" ? "personal" : "work"].root
    : null;
  const files = ctx.app.vault.getMarkdownFiles()
    .filter(file => !isExcluded(file.path, ctx) && (!ignoredRoot || !within(file.path, ignoredRoot)))
    .sort((a, b) => a.path.localeCompare(b.path));
  const notes = [];
  for (const file of files) {
    const properties = await frontmatter(ctx, file);
    if (topicPropertyIsEmpty(properties.topic)) notes.push({ file, content: await ctx.app.vault.read(file) });
  }
  return notes;
}

async function existingTopics(ctx, domain) {
  const topicsPath = domain.topicsFolder;
  const folder = folderAt(ctx, topicsPath);
  if (!folder) return [];
  const topicFolders = folder.children.filter(entry => Array.isArray(entry.children));
  const hubFiles = folder.children.filter(entry => !Array.isArray(entry.children) && entry.extension === "md" && / hub\.md$/i.test(entry.name));
  const topics = new Map();
  for (const topicFolder of topicFolders) {
    if (!/ notes$/i.test(topicFolder.name)) throw new Error(`Unexpected folder in ${topicsPath}: ${topicFolder.name}. Topic folders must end in " notes".`);
    const name = topicFolder.name.replace(/ notes$/i, "");
    if (!name) throw new Error(`Invalid topic folder name: ${topicFolder.path}`);
    topics.set(name.toLowerCase(), { name, folder: topicFolder.path, hub: null });
  }
  const hubs = new Map();
  for (const file of hubFiles) {
    const name = file.basename.replace(/ hub$/i, "");
    hubs.set(name.toLowerCase(), file.path);
  }
  for (const [key, topic] of topics) {
    topic.hub = hubs.get(key) ?? null;
    if (!topic.hub) throw new Error(`Topic folder has no matching hub: ${topic.folder}`);
    hubs.delete(key);
  }
  if (hubs.size) throw new Error(`Topic hub has no matching " notes" folder: ${[...hubs.values()][0]}`);
  return [...topics.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function chooseNoteRoute(ctx, note, index, total) {
  const { FuzzySuggestModal } = ctx.tp.obsidian;
  const previewText = note.content.length > 3000 ? `${note.content.slice(0, 3000)}\n…` : note.content;
  const options = [
    { label: "1. Work", value: "work" },
    { label: "2. Personal", value: "personal" },
    { label: "3. Skip / Later", value: "skip" },
    { label: "4. Delete", value: "delete" }
  ];
  const answer = await new Promise(resolve => {
    class NoteRouteModal extends FuzzySuggestModal {
      constructor(app) {
        super(app);
        this.submitted = false;
        this.setPlaceholder("Choose a domain");
        this.setTitle(`${index + 1}/${total} · ${note.file.basename}`);
      }
      getItems() { return options; }
      getItemText(option) { return option.label; }
      onOpen() {
        super.onOpen();
        const preview = this.modalEl.createDiv();
        preview.setText(`${index + 1}/${total} note\n${note.file.path}\n\n${previewText}`);
        preview.style.whiteSpace = "pre-wrap";
        preview.style.overflowWrap = "anywhere";
        preview.style.maxHeight = "45vh";
        preview.style.overflowY = "auto";
        preview.style.fontSize = "var(--font-ui-small)";
        preview.style.padding = "0.75em 1em";
        preview.style.borderBottom = "1px solid var(--background-modifier-border)";
        this.modalEl.prepend(preview);
      }
      selectSuggestion(match, event) { this.submitted = true; super.selectSuggestion(match, event); }
      onChooseItem(option) { resolve(option.value); }
      onClose() { if (!this.submitted) resolve(null); }
    }
    new NoteRouteModal(ctx.app).open();
  });
  if (answer == null) throw new Cancelled();
  return answer;
}

async function chooseTopic(ctx, domain, topics, note, index, total) {
  const choices = [{ label: "New topic", value: "new" }, ...topics.map(topic => ({ label: topic.name, value: topic }))];
  const counter = `${index + 1}/${total}`;
  const answer = await ctx.tp.system.suggester(choices.map(choice => choice.label), choices.map(choice => choice.value), false, `Topic for ${domain} · ${counter} · ${note.file.basename}`);
  if (answer == null) throw new Cancelled();
  if (answer !== "new") return answer;

  for (;;) {
    const input = await ctx.tp.system.prompt(`New ${domain} topic name · ${counter} · ${note.file.basename}`, "", false, false);
    if (input == null) throw new Cancelled();
    const name = input.trim();
    if (!name || /[\\/<>:"|?*\x00-\x1f]/.test(name) || /^[. ]|[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
      notice(ctx.tp, "Enter a valid topic name without folder separators or reserved filename characters.");
      continue;
    }
    if (topics.some(topic => topic.name.toLowerCase() === name.toLowerCase())) {
      notice(ctx.tp, "That topic already exists. Select it from the topic list.");
      continue;
    }
    return { name, isNew: true };
  }
}

async function createTopic(ctx, domain, topic) {
  const topicsPath = domain.topicsFolder;
  const folderPath = `${topicsPath}/${topic.name} notes`;
  const hubPath = `${topicsPath}/${topic.name} hub.md`;
  if (ctx.app.vault.getAbstractFileByPath(folderPath) || await ctx.app.vault.adapter.exists(folderPath)
    || ctx.app.vault.getAbstractFileByPath(hubPath) || await ctx.app.vault.adapter.exists(hubPath)) {
    throw new Error(`A topic folder or hub already exists for "${topic.name}". Check ${topicsPath}.`);
  }
  const template = ctx.app.vault.getAbstractFileByPath(ctx.config.templatePath);
  if (!template) throw new Error(`Topic hub template not found: ${ctx.config.templatePath}`);
  await ensureFolder(ctx, topicsPath);
  await ctx.app.vault.createFolder(folderPath);
  try {
    const hub = await ctx.tp.file.create_new(template, `${topic.name} hub`, false, topicsPath);
    if (!hub || hub.path !== hubPath) throw new Error(`Topic hub was created at an unexpected path; expected ${hubPath}.`);
  } catch (error) {
    const createdHub = ctx.app.vault.getAbstractFileByPath(hubPath);
    if (createdHub) await ctx.app.vault.delete(createdHub);
    const createdFolder = ctx.app.vault.getAbstractFileByPath(folderPath);
    if (Array.isArray(createdFolder?.children) && createdFolder.children.length === 0) await ctx.app.vault.delete(createdFolder);
    throw error;
  }
  return { name: topic.name, folder: folderPath, hub: hubPath };
}

async function assignAndMove(ctx, note, topic) {
  const destination = `${topic.folder}/${note.file.name}`;
  if (destination !== note.file.path && (ctx.app.vault.getAbstractFileByPath(destination) || await ctx.app.vault.adapter.exists(destination))) {
    throw new Error(`A note already exists at ${destination}.`);
  }
  const hubLink = `[[${topic.hub.slice(0, -3)}]]`;
  await ctx.app.fileManager.processFrontMatter(note.file, properties => { properties.topic = [hubLink]; });
  if (destination === note.file.path) return;
  try {
    await ctx.app.fileManager.renameFile(note.file, destination);
  } catch (error) {
    await ctx.app.fileManager.processFrontMatter(note.file, properties => { delete properties.topic; });
    throw error;
  }
}

module.exports = async function sortNotes(tp, configPath = DEFAULT_CONFIG_PATH, options = {}) {
  const result = { status: "completed", processed: 0, skipped: 0, deleted: 0 };
  const locks = globalThis[LOCK_KEY] ?? (globalThis[LOCK_KEY] = new WeakSet());
  const app = tp?.app;
  if (!app || locks.has(app)) {
    result.status = "error";
    result.error = app ? "Note sorting is already running." : "Pass Templater's tp object to the sorter.";
    notice(tp, result.error);
    return result;
  }
  locks.add(app);
  try {
    configPath = canonicalPath({ app }, vaultPath(configPath, "configuration path"));
    if (options.context != null && !["work", "personal"].includes(options.context)) throw new Error("Invalid note sorting context.");
    const ctx = { tp, app, configPath, context: options.context, config: JSON.parse(await app.vault.adapter.read(configPath)) };
    validateConfig(ctx);
    const template = app.vault.getAbstractFileByPath(ctx.config.templatePath);
    if (!template || template.extension !== "md") throw new Error(`Topic hub template not found: ${ctx.config.templatePath}`);
    const notes = await collectNotes(ctx);
    let topicCache = { personal: null, work: null };
    for (let index = 0; index < notes.length; index++) {
      const note = notes[index];
      const domainName = await chooseNoteRoute(ctx, note, index, notes.length);
      if (domainName === "skip") { result.skipped++; continue; }
      if (domainName === "delete") {
        if (typeof app.fileManager?.trashFile !== "function") throw new Error("This workflow requires Obsidian's FileManager.trashFile API.");
        await app.fileManager.trashFile(note.file);
        result.deleted++;
        continue;
      }
      const domain = ctx.config.domains[domainName];
      topicCache[domainName] ??= await existingTopics(ctx, domain);
      let topic = await chooseTopic(ctx, domainName, topicCache[domainName], note, index, notes.length);
      if (topic.isNew) {
        topic = await createTopic(ctx, domain, topic);
        topicCache[domainName].push(topic);
        topicCache[domainName].sort((a, b) => a.name.localeCompare(b.name));
      }
      await assignAndMove(ctx, note, topic);
      result.processed++;
    }
    notice(tp, notes.length ? "Note sorting finished." : "No unsorted notes found.");
  } catch (error) {
    if (error instanceof Cancelled) {
      result.status = "cancelled";
      notice(tp, "Note sorting stopped. The current note was left untouched.");
    } else {
      result.status = "error";
      result.error = error.message;
      notice(tp, `Note sorting stopped: ${error.message}`);
    }
  } finally {
    locks.delete(app);
  }
  return result;
};
