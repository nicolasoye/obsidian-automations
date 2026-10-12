const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sortInbox = require("../Scripts/sort_inbox.js");

const CONFIG_PATH = "Scripts/inbox_sorter_config.json";
const PC = "Inbox/Inbox PC.md";
const PHONE = "Inbox/Inbox Phone";
const LOG = "Inbox/inbox_log.txt";
const JOURNAL = "Inbox/inbox_sorter_state.json";
const WORK_WEEK = "PhD Notes/Planning/Weekly/Reviews/2026-W41.md";
const PERSONAL_WEEK = "Personal Notes/Planning/Weekly/Reviews/2026-W41.md";
const WORK_PROJECT = "PhD Notes/Projects/Alpha.md";
const PERSONAL_PROJECT = "Personal Notes/Projects/Beta.md";
const WORK_THOUGHTS = "PhD Notes/Thoughts.md";
const PERSONAL_THOUGHTS = "Personal Notes/Thoughts.md";

function configured() {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../Scripts/inbox_sorter_config.json"), "utf8"));
  config.inbox = { pcNote: PC, phoneFolder: PHONE, phoneRecursive: false, taskPrefix: "- [o]" };
  config.logPath = LOG;
  config.journalPath = JOURNAL;
  config.activeProject = { type: "project", status: "active" };
  for (const domain of ["work", "personal"]) {
    const folder = domain === "work" ? "PhD Notes" : "Personal Notes";
    config.domains[domain].weekly.folder = `${folder}/Planning/Weekly`;
    config.domains[domain].weekly.namingScheme = "[Reviews/]GGGG-[W]WW";
    config.domains[domain].weekly.templatePath = `Templates/${domain} Weekly.md`;
    config.domains[domain].weekly.appendHeading = "Tasks";
    config.domains[domain].projects.folder = `${folder}/Projects`;
    config.domains[domain].projects.templatePath = `Templates/${domain} Project.md`;
    config.domains[domain].projects.appendHeading = "Backlog";
    config.domains[domain].thoughts.notePath = domain === "work" ? WORK_THOUGHTS : PERSONAL_THOUGHTS;
  }
  return config;
}

function parseYaml(text) {
  return Object.fromEntries(text.split("\n").filter(line => /^[a-zA-Z_]+:/.test(line)).map(line => {
    const split = line.indexOf(":");
    return [line.slice(0, split), line.slice(split + 1).trim().replace(/^["']|["']$/g, "")];
  }));
}

function harness({ files = {}, answers = [], prompts = [], config = configured(), weeklyName = "Reviews/2026-W41", caseInsensitiveFilesystem = false } = {}) {
  const storage = new Map(Object.entries({
    [CONFIG_PATH]: JSON.stringify(config),
    [PC]: "",
    "Templates/work Weekly.md": "# {{title}}\n\n## Tasks\n\n## Review\nkeep\n",
    "Templates/personal Weekly.md": "# {{title}}\n\n## Tasks\n",
    "Templates/work Project.md": "---\ntype: template\nstatus: draft\nowner: me\n---\n# {{title}}\n\n## Backlog\n\n## Decisions\n",
    "Templates/personal Project.md": "---\ntype: template\nstatus: draft\n---\n# {{title}}\n\n## Backlog\n",
    ...files
  }));
  const folders = new Set([PHONE]);
  for (const filename of storage.keys()) {
    const parts = filename.split("/").slice(0, -1);
    for (let index = 1; index <= parts.length; index++) folders.add(parts.slice(0, index).join("/"));
  }
  const state = { storage, folders, answers: [...answers], prompts: [...prompts], dialogs: [], notices: [], trashed: [], templates: [], operations: [], fault: null };
  function file(filename) {
    if (folders.has(filename)) return { path: filename, children: [] };
    if (!storage.has(filename)) return null;
    const name = filename.split("/").at(-1);
    return { path: filename, name, basename: name.replace(/\.[^.]+$/, ""), extension: name.split(".").at(-1) };
  }
  function checkpoint(op, filename, when, content) {
    const event = { op, path: filename, when, content };
    state.operations.push(event);
    if (state.fault) state.fault(event);
  }
  const app = {
    vault: {
      getAbstractFileByPath: file,
      getAllLoadedFiles: () => [...folders, ...storage.keys()].map(file),
      getMarkdownFiles: () => [...storage.keys()].filter(filename => filename.endsWith(".md")).map(file),
      read: async entry => { assert.ok(storage.has(entry.path)); return storage.get(entry.path); },
      createFolder: async filename => {
        checkpoint("createFolder", filename, "before");
        assert.ok(!storage.has(filename));
        if ([...folders].some(folder => folder === filename || (caseInsensitiveFilesystem && folder.toLowerCase() === filename.toLowerCase()))) throw new Error("folder already exists");
        folders.add(filename);
        checkpoint("createFolder", filename, "after");
      },
      create: async (filename, content) => {
        checkpoint("create", filename, "before", content);
        assert.ok(!storage.has(filename), `File collision at ${filename}`);
        storage.set(filename, content);
        checkpoint("create", filename, "after", content);
        return file(filename);
      },
      process: async (entry, transform) => {
        checkpoint("process", entry.path, "before", storage.get(entry.path));
        const content = transform(storage.get(entry.path));
        storage.set(entry.path, content);
        checkpoint("process", entry.path, "after", content);
        return content;
      },
      adapter: {
        exists: async filename => storage.has(filename) || folders.has(filename),
        stat: async filename => {
          const equal = candidate => candidate === filename || (caseInsensitiveFilesystem && candidate.toLowerCase() === filename.toLowerCase());
          if ([...folders].some(equal)) return { type: "folder" };
          if ([...storage.keys()].some(equal)) return { type: "file" };
          return null;
        },
        read: async filename => { assert.ok(storage.has(filename), `Missing file ${filename}`); return storage.get(filename); },
        write: async (filename, content) => {
          checkpoint("adapter.write", filename, "before", content);
          storage.set(filename, content);
          checkpoint("adapter.write", filename, "after", content);
        }
      }
    },
    fileManager: {
      trashFile: async entry => {
        checkpoint("trash", entry.path, "before", storage.get(entry.path));
        state.trashed.push({ path: entry.path, content: storage.get(entry.path) });
        storage.delete(entry.path);
        checkpoint("trash", entry.path, "after");
      },
      processFrontMatter: async (entry, change) => {
        const current = storage.get(entry.path);
        const match = current.match(/^---\n([\s\S]*?)\n---\n/);
        const properties = match ? parseYaml(match[1]) : {};
        change(properties);
        const body = match ? current.slice(match[0].length) : current;
        storage.set(entry.path, `---\n${Object.entries(properties).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n${body}`);
      }
    }
  };
  const tp = {
    app,
    obsidian: { parseYaml, Notice: class { constructor(message) { state.notices.push(message); } } },
    system: {
      suggester: async (labels, values, _, title) => {
        state.dialogs.push({ labels, values, title });
        assert.ok(state.answers.length, `Unexpected dialog: ${title}`);
        const answer = state.answers.shift();
        if (typeof answer === "function") return answer(values);
        if (answer !== null) assert.ok(values.includes(answer), `Unavailable choice: ${answer}`);
        return answer;
      },
      prompt: async (title, initial) => {
        state.dialogs.push({ title, initial });
        assert.ok(state.prompts.length, `Unexpected prompt: ${title}`);
        return state.prompts.shift();
      }
    },
    date: {
      now: scheme => {
        state.namingScheme = scheme;
        return weeklyName;
      }
    },
    file: {
      create_new: async (template, filename, openNew, folder) => {
        state.templates.push({ path: template.path, filename, openNew, folder });
        return app.vault.create(`${folder}/${filename}.md`, storage.get(template.path).replaceAll("{{title}}", filename));
      }
    }
  };
  state.tp = tp;
  state.run = () => sortInbox(tp);
  state.pending = () => storage.has(JOURNAL) ? JSON.parse(storage.get(JOURNAL)).pending : null;
  state.assertConsumed = () => { assert.deepEqual(state.answers, []); assert.deepEqual(state.prompts, []); };
  return state;
}

function occurrences(text, value) { return text.split(value).length - 1; }

test("tasks are processed before thoughts from both inboxes, with correct work/personal destinations", async () => {
  const state = harness({
    files: {
      [PC]: "work idea\r\n- [o] work task\r\npersonal idea\r\n- [o] personal task\r\n",
      [`${PHONE}/task.md`]: "- [o] phone task\n",
      [`${PHONE}/idea.md`]: "phone idea\n",
      [PERSONAL_PROJECT]: "---\ntype: project\nstatus: active\n---\n## Backlog\n\n## Decisions\n"
    },
    answers: ["work", "weekly", "personal", "existing", PERSONAL_PROJECT, "work", "weekly", "work", "personal", "personal"]
  });
  const result = await state.run();
  assert.equal(result.status, "completed");
  assert.equal(result.processed, 6);
  assert.equal(state.storage.get(PC), "");
  assert.equal(state.trashed.length, 2);
  assert.ok(state.storage.get(WORK_WEEK).includes("- [o] work task"));
  assert.ok(state.storage.get(WORK_WEEK).includes("- [o] phone task"));
  assert.ok(state.storage.get(PERSONAL_PROJECT).includes("- [o] personal task"));
  assert.ok(state.storage.get(WORK_THOUGHTS).includes("work idea"));
  assert.ok(state.storage.get(PERSONAL_THOUGHTS).includes("personal idea"));
  assert.ok(state.storage.get(PERSONAL_THOUGHTS).includes("phone idea"));
  const classifications = state.dialogs.filter(dialog => dialog.values?.includes("edit"));
  assert.ok(classifications.slice(0, 3).every(dialog => dialog.title.includes("· task ·")));
  assert.ok(classifications.slice(3).every(dialog => dialog.title.includes("· thought ·")));
  assert.equal(state.pending(), null);
  state.assertConsumed();
});

test("identical PC captures retain their individual occurrence when one is skipped", async () => {
  const state = harness({ files: { [PC]: "- [o] same\r\nidea\r\n- [o] same\r\n" }, answers: ["skip", "work", "weekly", "delete"] });
  const result = await state.run();
  assert.equal(result.status, "completed");
  assert.equal(result.skipped, 1);
  assert.equal(state.storage.get(PC), "- [o] same\r\n");
  assert.equal(occurrences(state.storage.get(WORK_WEEK), "- [o] same"), 1);
  assert.equal(state.storage.get(LOG), `- [o] same -> ${WORK_WEEK}\nidea -> [deleted]\n`);
});

test("editing task and thought changes destination text while log and cleanup use the original", async () => {
  const state = harness({
    files: { [PC]: "- [o] old task\nold idea\n" },
    answers: ["edit", "work", "weekly", "edit", "personal"],
    prompts: ["New [[Project]] task 📅 2026-10-12 #tag", "A corrected thought"]
  });
  assert.equal((await state.run()).status, "completed");
  assert.ok(state.storage.get(WORK_WEEK).includes("- [o] New [[Project]] task 📅 2026-10-12 #tag"));
  assert.ok(state.storage.get(PERSONAL_THOUGHTS).includes("A corrected thought"));
  assert.equal(state.storage.get(LOG), `- [o] old task -> ${WORK_WEEK}\nold idea -> ${PERSONAL_THOUGHTS}\n`);
  assert.equal(state.storage.get(PC), "");
});

test("bullet thoughts from PC and phone are classified separately from checkbox tasks", async () => {
  const state = harness({
    files: { [PC]: "- work idea\n- [o] task\n- personal idea\n", [`${PHONE}/thought.md`]: "- phone idea\n" },
    answers: ["work", "weekly", "work", "personal", "personal"]
  });
  assert.equal((await state.run()).status, "completed");
  assert.ok(state.storage.get(WORK_THOUGHTS).includes("- work idea\n"));
  assert.ok(state.storage.get(PERSONAL_THOUGHTS).includes("- personal idea\n"));
  assert.ok(state.storage.get(PERSONAL_THOUGHTS).includes("- phone idea\n"));
  assert.ok(state.storage.get(LOG).includes(`- work idea -> ${WORK_THOUGHTS}\n`));
  for (const filename of [WORK_WEEK, WORK_THOUGHTS, PERSONAL_THOUGHTS]) assert.ok(!state.storage.get(filename).includes("<!-- inbox-sorter:"));
});

test("thought editing preserves the bullet when given a body or a complete bullet line", async () => {
  const state = harness({ files: { [PC]: "- original thought\n" }, answers: ["edit", "edit", "work"], prompts: ["first revision", "- final revision"] });
  assert.equal((await state.run()).status, "completed");
  assert.equal(state.dialogs.find(dialog => dialog.title === "Edit thought").initial, "original thought");
  assert.equal(state.storage.get(WORK_THOUGHTS), "- final revision\n");
  assert.equal(state.storage.get(LOG), `- original thought -> ${WORK_THOUGHTS}\n`);
});

test("editing a task with a complete checkbox line does not double the task prefix", async () => {
  const state = harness({ files: { [PC]: "- [o] original\n" }, answers: ["edit", "work", "weekly"], prompts: ["- [o] revised"] });
  assert.equal((await state.run()).status, "completed");
  assert.ok(state.storage.get(WORK_WEEK).includes("- [o] revised\n"));
  assert.ok(!state.storage.get(WORK_WEEK).includes("- [o] - [o]"));
});

test("an edit followed by Skip leaves the original capture and creates no log or journal", async () => {
  const state = harness({ files: { [PC]: "original\n" }, answers: ["edit", "skip"], prompts: ["edited"] });
  assert.equal((await state.run()).skipped, 1);
  assert.equal(state.storage.get(PC), "original\n");
  assert.ok(!state.storage.has(LOG));
  assert.ok(!state.storage.has(JOURNAL));
});

for (const scenario of [
  { name: "classification", answers: [null] },
  { name: "edit", answers: ["edit"], prompts: [null] },
  { name: "destination", answers: ["work", null] },
  { name: "project picker", answers: ["work", "existing", null], files: { [WORK_PROJECT]: "---\ntype: project\nstatus: active\n---\n## Backlog\n" } },
  { name: "project name", answers: ["work", "new"], prompts: [null] }
]) {
  test(`canceling ${scenario.name} leaves current capture unchanged`, async () => {
    const state = harness({ ...scenario, files: { ...scenario.files, [PC]: "- [o] task\n" } });
    assert.equal((await state.run()).status, "cancelled");
    assert.equal(state.storage.get(PC), "- [o] task\n");
    assert.ok(!state.storage.has(LOG));
    assert.equal(state.pending(), null);
  });
}

test("active project selection filters domain, type and status and ignores stale metadata caches", async () => {
  const config = configured();
  config.domains.work.projects.templatePath = "PhD Notes/Projects/Template.md";
  const state = harness({
    config,
    files: {
      [PC]: "- [o] task\n",
      [WORK_PROJECT]: "---\ntype: project\nstatus: active\n---\n## Backlog\n",
      "PhD Notes/Projects/Archived.md": "---\ntype: project\nstatus: archived\n---\n",
      "PhD Notes/Projects/Index.md": "---\ntype: index\nstatus: active\n---\n",
      "PhD Notes/Projects/Template.md": "---\ntype: project\nstatus: active\n---\n## Backlog\n",
      [PERSONAL_PROJECT]: "---\ntype: project\nstatus: active\n---\n## Backlog\n"
    }, answers: ["work", "existing", WORK_PROJECT]
  });
  assert.equal((await state.run()).status, "completed");
  const picker = state.dialogs.find(dialog => dialog.title === "Project for work task");
  assert.deepEqual(picker.values, [WORK_PROJECT]);
});

test("a newly created project retains template properties and becomes selectable immediately", async () => {
  const target = "PhD Notes/Projects/New project.md";
  const state = harness({ files: { [PC]: "- [o] first\n- [o] second\n" }, answers: ["work", "new", "work", "existing", target], prompts: ["New project"] });
  assert.equal((await state.run()).status, "completed");
  const content = state.storage.get(target);
  assert.ok(content.includes("type: project\nstatus: active\nowner: me"));
  assert.ok(content.includes("- [o] first"));
  assert.ok(content.includes("- [o] second"));
  assert.equal(state.templates.length, 1);
  assert.deepEqual(state.templates[0], { path: "Templates/work Project.md", filename: "New project", openNew: false, folder: "PhD Notes/Projects" });
});

test("invalid and colliding project names are rejected without overwriting notes", async () => {
  const state = harness({ files: { [PC]: "- [o] task\n", [WORK_PROJECT]: "keep this" }, answers: ["work", "new"], prompts: ["../bad", "CON", "Alpha", "Valid.md"] });
  assert.equal((await state.run()).status, "completed");
  assert.equal(state.storage.get(WORK_PROJECT), "keep this");
  assert.ok(state.storage.has("PhD Notes/Projects/Valid.md"));
  assert.equal(state.templates.length, 1);
  state.assertConsumed();
});

test("no active projects returns to the destination dialog", async () => {
  const state = harness({ files: { [PC]: "- [o] task\n" }, answers: ["personal", "existing", "weekly"] });
  assert.equal((await state.run()).status, "completed");
  assert.ok(state.storage.get(PERSONAL_WEEK).includes("- [o] task"));
});

test("weekly creation uses the configured format and Templater's ISO week year at the year boundary", async () => {
  const state = harness({ files: { [PC]: "- [o] task\n" }, answers: ["work", "weekly"], weeklyName: "Reviews/2026-W53" });
  assert.equal((await state.run()).status, "completed");
  assert.equal(state.namingScheme, "[Reviews/]GGGG-[W]WW");
  assert.ok(state.storage.has("PhD Notes/Planning/Weekly/Reviews/2026-W53.md"));
  assert.deepEqual(state.templates[0], { path: "Templates/work Weekly.md", filename: "2026-W53", openNew: false, folder: "PhD Notes/Planning/Weekly/Reviews" });
});

test("existing weekly notes need no template and insertion respects fences, subheadings and CRLF", async () => {
  const config = configured();
  config.domains.work.weekly.templatePath = "TODO_WORK_WEEKLY_TEMPLATE.md";
  const existing = "# Week\r\n```md\r\n## Tasks\r\n```\r\n## Tasks\r\n- [o] existing\r\n### Later\r\nkeep\r\n## Review\r\nkeep too\r\n";
  const state = harness({ config, files: { [PC]: "- [o] new\r\n", [WORK_WEEK]: existing }, answers: ["work", "weekly"] });
  assert.equal((await state.run()).status, "completed");
  const content = state.storage.get(WORK_WEEK);
  assert.ok(content.indexOf("- [o] new") < content.indexOf("### Later"));
  assert.ok(content.includes("```md\r\n## Tasks\r\n```"));
  assert.ok(content.includes("## Review\r\nkeep too"));
  assert.ok(!/(?<!\r)\n/.test(content));
  assert.equal(state.templates.length, 0);
});

test("missing headings are created, and ambiguous headings leave the source untouched", async () => {
  const state = harness({ files: { [PC]: "- [o] new\n", [WORK_WEEK]: "# Existing\n" }, answers: ["work", "weekly"] });
  assert.equal((await state.run()).status, "completed");
  assert.ok(state.storage.get(WORK_WEEK).includes("## Tasks\n"));
  const ambiguous = harness({ files: { [PC]: "- [o] new\n", [WORK_WEEK]: "## Tasks\nA\n## Tasks\nB\n" }, answers: ["work", "weekly"] });
  const result = await ambiguous.run();
  assert.equal(result.status, "error");
  assert.match(result.error, /More than one matching heading/);
  assert.equal(ambiguous.storage.get(PC), "- [o] new\n");
  assert.equal(ambiguous.storage.get(WORK_WEEK), "## Tasks\nA\n## Tasks\nB\n");
  assert.ok(!ambiguous.storage.has(JOURNAL));
});

test("unclosed frontmatter and code fences cannot hide newly appended captures", async () => {
  for (const malformed of ["---\ntype: weekly\n## Tasks\n", "```md\n## Tasks\n"]) {
    const state = harness({ files: { [PC]: "- [o] task\n", [WORK_WEEK]: malformed }, answers: ["work", "weekly"] });
    assert.equal((await state.run()).status, "error");
    assert.equal(state.storage.get(WORK_WEEK), malformed);
    assert.equal(state.storage.get(PC), "- [o] task\n");
    assert.ok(!state.storage.has(JOURNAL));
  }
});

test("placeholders fail only for the selected route; skip and delete still work", async () => {
  const config = configured();
  config.domains.work.weekly.appendHeading = "TODO_WORK_WEEKLY_HEADING";
  const state = harness({ config, files: { [PC]: "- [o] task\n" }, answers: ["work", "weekly"] });
  const result = await state.run();
  assert.equal(result.status, "error");
  assert.match(result.error, /Fill in domains.work.weekly.appendHeading/);
  assert.equal(state.storage.get(PC), "- [o] task\n");
  assert.ok(!state.storage.has(JOURNAL));
  const available = harness({ config, files: { [PC]: "- [o] keep\nremove\n" }, answers: ["skip", "delete"] });
  assert.equal((await available.run()).status, "completed");
  assert.equal(available.storage.get(PC), "- [o] keep\n");
  assert.equal(available.storage.get(LOG), "remove -> [deleted]\n");
});

test("a missing template is detected before journal, log or source mutation", async () => {
  const state = harness({ files: { [PC]: "- [o] task\n" }, answers: ["work", "weekly"] });
  state.storage.delete("Templates/work Weekly.md");
  const result = await state.run();
  assert.equal(result.status, "error");
  assert.match(result.error, /Template not found/);
  assert.equal(state.storage.get(PC), "- [o] task\n");
  assert.ok(!state.storage.has(JOURNAL));
});

test("phone captures are trashed only after the exact mapping was logged", async () => {
  const source = `${PHONE}/delete.md`;
  const state = harness({ files: { [source]: "discard\n" }, answers: ["delete"] });
  state.fault = event => {
    if (event.op === "trash" && event.when === "before") assert.equal(state.storage.get(LOG), "discard -> [deleted]\n");
  };
  assert.equal((await state.run()).status, "completed");
  assert.deepEqual(state.trashed, [{ path: source, content: "discard\n" }]);
});

test("differently capitalized thought folders reuse the actual folder on Windows", async () => {
  const config = configured();
  config.domains.personal.thoughts.notePath = "Personal notes/Thoughts.md";
  const state = harness({ config, caseInsensitiveFilesystem: true, files: { [PC]: "personal idea\n", "Personal Notes/Keep.md": "keep" }, answers: ["personal"] });
  assert.equal((await state.run()).status, "completed");
  assert.ok(state.storage.get(PERSONAL_THOUGHTS).includes("personal idea"));
  assert.equal(state.storage.get(LOG), `personal idea -> ${PERSONAL_THOUGHTS}\n`);
  assert.ok(!state.storage.has("Personal notes/Thoughts.md"));
  assert.ok(!state.operations.some(event => event.op === "createFolder" && event.path === "Personal notes"));
});

test("case aliases reuse existing notes and project folders", async () => {
  const config = configured();
  config.domains.personal.thoughts.notePath = "personal notes/thoughts.md";
  config.domains.personal.projects.folder = "personal notes/PROJECTS";
  const state = harness({ config, files: { [PC]: "- [o] task\nidea\n", [PERSONAL_THOUGHTS]: "keep this thought\n", [PERSONAL_PROJECT]: "---\ntype: project\nstatus: active\n---\n## Backlog\n" }, answers: ["personal", "existing", PERSONAL_PROJECT, "personal"] });
  assert.equal((await state.run()).status, "completed");
  assert.ok(state.storage.get(PERSONAL_PROJECT).includes("- [o] task"));
  assert.ok(state.storage.get(PERSONAL_THOUGHTS).startsWith("keep this thought\n"));
  assert.ok(!state.storage.has("personal notes/thoughts.md"));
});

test("a folder appearing between lookup and creation does not stop a move", async () => {
  const config = configured();
  config.domains.personal.thoughts.notePath = "Personal Notes/Fresh Folder/Thoughts.md";
  const state = harness({ config, files: { [PC]: "idea\n", "Personal Notes/Keep.md": "keep" }, answers: ["personal"] });
  state.fault = event => {
    if (event.op === "createFolder" && event.path === "Personal Notes/Fresh Folder" && event.when === "before") state.folders.add(event.path);
  };
  assert.equal((await state.run()).status, "completed");
  assert.ok(state.storage.get(config.domains.personal.thoughts.notePath).includes("idea"));
});

test("filesystem folder checks handle delayed vault indexing without swallowing real failures", async () => {
  const config = configured();
  config.domains.personal.thoughts.notePath = "Personal Notes/Fresh Folder/Thoughts.md";
  const state = harness({ config, files: { [PC]: "idea\n", "Personal Notes/Fresh Folder/Keep.md": "keep" }, answers: ["personal"] });
  const lookup = state.tp.app.vault.getAbstractFileByPath;
  state.tp.app.vault.getAbstractFileByPath = filename => filename === "Personal Notes/Fresh Folder" ? null : lookup(filename);
  assert.equal((await state.run()).status, "completed");
  const failing = harness({ config, files: { [PC]: "idea\n", "Personal Notes/Keep.md": "keep" }, answers: ["personal"] });
  failing.fault = event => {
    if (event.op === "createFolder" && event.path === "Personal Notes/Fresh Folder") throw new Error("Permission denied");
  };
  const result = await failing.run();
  assert.equal(result.status, "error");
  assert.equal(result.error, "Permission denied");
  assert.equal(failing.storage.get(PC), "idea\n");
});

test("a pending destination with old capitalization can finish using the actual folder", async () => {
  const state = harness({ files: { [PC]: "idea\n", "Personal Notes/Keep.md": "keep" }, answers: ["personal"] });
  state.fault = event => { if (event.op === "create" && event.path === PERSONAL_THOUGHTS && event.when === "before") throw new Error("Interrupted creation"); };
  assert.equal((await state.run()).status, "error");
  const pending = state.pending();
  pending.destination.path = "Personal notes/Thoughts.md";
  pending.log.after = pending.log.after.replace(PERSONAL_THOUGHTS, pending.destination.path);
  state.storage.set(JOURNAL, JSON.stringify({ version: 2, pending }));
  state.fault = null;
  assert.equal((await state.run()).status, "completed");
  assert.ok(state.storage.get(PERSONAL_THOUGHTS).includes("idea"));
  assert.equal(state.storage.get(PC), "");
});

test("different capitalization cannot bypass protection of the PC inbox", async () => {
  const config = configured();
  config.domains.work.thoughts.notePath = "inbox/inbox pc.md";
  const state = harness({ config, files: { [PC]: "idea\n" }, answers: ["work"] });
  assert.equal((await state.run()).status, "error");
  assert.equal(state.storage.get(PC), "idea\n");
  assert.ok(!state.storage.has(JOURNAL));
});

for (const recursive of [false, true]) {
  test(`phone subfolders are ${recursive ? "included" : "excluded"} by configuration`, async () => {
    const config = configured();
    config.inbox.phoneRecursive = recursive;
    const nested = `${PHONE}/nested/capture.md`;
    const state = harness({ config, files: { [nested]: "idea\n" }, answers: recursive ? ["work"] : [] });
    assert.equal((await state.run()).status, "completed");
    assert.equal(state.storage.has(nested), !recursive);
  });
}

test("a multiline phone capture prevents processing before any source is modified", async () => {
  const state = harness({ files: { [PC]: "- [o] task\n", [`${PHONE}/bad.md`]: "one\ntwo\n" } });
  const result = await state.run();
  assert.equal(result.status, "error");
  assert.match(result.error, /one nonblank line/);
  assert.equal(state.dialogs.length, 0);
  assert.equal(state.storage.get(PC), "- [o] task\n");
  assert.ok(!state.storage.has(LOG));
});

test("edits to the PC inbox during dialogs are preserved and prevent any move", async () => {
  const state = harness({ files: { [PC]: "- [o] task\n" }, answers: ["work", () => { state.storage.set(PC, "- [o] task\nnew capture\n"); return "weekly"; }] });
  const result = await state.run();
  assert.equal(result.status, "error");
  assert.match(result.error, /Source changed/);
  assert.equal(state.storage.get(PC), "- [o] task\nnew capture\n");
  assert.ok(!state.storage.has(WORK_WEEK));
  assert.ok(!state.storage.has(JOURNAL));
});

for (const scenario of [
  { name: "destination write", op: "process", path: WORK_WEEK, when: "before" },
  { name: "destination write before its acknowledgement", op: "process", path: WORK_WEEK, when: "after" },
  { name: "log write", op: "process", path: LOG, when: "before" },
  { name: "log write before its acknowledgement", op: "process", path: LOG, when: "after" },
  { name: "source cleanup", op: "process", path: PC, when: "before" },
  { name: "source cleanup before its acknowledgement", op: "process", path: PC, when: "after" },
  { name: "journal clearing", op: "adapter.write", path: JOURNAL, when: "before", clearing: true }
]) {
  test(`retry after failed ${scenario.name} does not duplicate the task or log`, async () => {
    const state = harness({ files: { [PC]: "- [o] retry\n", [WORK_WEEK]: "## Tasks\n" }, answers: ["work", "weekly"] });
    state.fault = event => {
      if (event.op === scenario.op && event.path === scenario.path && event.when === scenario.when && (!scenario.clearing || JSON.parse(event.content).pending === null)) {
        throw new Error("Injected write failure");
      }
    };
    assert.equal((await state.run()).status, "error");
    assert.ok(state.pending());
    if (scenario.path !== PC && !scenario.clearing) assert.equal(state.storage.get(PC), "- [o] retry\n");
    state.fault = null;
    const result = await state.run();
    assert.equal(result.status, "completed");
    assert.equal(result.recovered, 1);
    assert.equal(state.storage.get(PC), "");
    assert.equal(occurrences(state.storage.get(WORK_WEEK), "- [o] retry"), 1);
    assert.ok(!state.storage.get(WORK_WEEK).includes("<!-- inbox-sorter:"));
    assert.equal(state.storage.get(LOG), `- [o] retry -> ${WORK_WEEK}\n`);
    assert.equal(state.pending(), null);
    state.assertConsumed();
  });
}

test("an interrupted phone trash is recovered without duplicating thought or log", async () => {
  const source = `${PHONE}/idea.md`;
  const state = harness({ files: { [source]: "idea\n" }, answers: ["personal"] });
  state.fault = event => { if (event.op === "trash" && event.when === "after") throw new Error("Interrupted trash"); };
  assert.equal((await state.run()).status, "error");
  assert.ok(!state.storage.has(source));
  state.fault = null;
  assert.equal((await state.run()).recovered, 1);
  assert.equal(state.storage.get(PERSONAL_THOUGHTS), "idea\n");
  assert.equal(state.storage.get(LOG), `idea -> ${PERSONAL_THOUGHTS}\n`);
  assert.equal(state.trashed.length, 1);
});

test("a changed source during a pending move blocks cleanup and further appends", async () => {
  const state = harness({ files: { [PC]: "- [o] task\n", [WORK_WEEK]: "## Tasks\n" }, answers: ["work", "weekly"] });
  state.fault = event => {
    if (event.op === "process" && event.path === WORK_WEEK && event.when === "after") {
      state.storage.set(PC, "- [o] task\nnew capture\n");
    }
  };
  assert.equal((await state.run()).status, "error");
  state.fault = null;
  assert.equal((await state.run()).status, "error");
  assert.equal(state.storage.get(PC), "- [o] task\nnew capture\n");
  assert.equal(occurrences(state.storage.get(WORK_WEEK), "- [o] task"), 1);
  state.storage.set(PC, state.pending().source.before);
  assert.equal((await state.run()).status, "completed");
  assert.equal(occurrences(state.storage.get(WORK_WEEK), "- [o] task"), 1);
});

test("two identical captures routed to the same destination remain distinct through recovery", async () => {
  const state = harness({ files: { [PC]: "- [o] same\n- [o] same\n", [WORK_WEEK]: "## Tasks\n" }, answers: ["work", "weekly", "work", "weekly"] });
  let writes = 0;
  state.fault = event => {
    if (event.op === "process" && event.path === LOG && event.when === "after" && ++writes === 2) throw new Error("Second log acknowledgement interrupted");
  };
  assert.equal((await state.run()).status, "error");
  assert.ok(!state.storage.get(WORK_WEEK).includes("<!-- inbox-sorter:"));
  assert.equal(occurrences(state.pending().destination.snapshot.after, "- [o] same"), 2);
  state.fault = null;
  assert.equal((await state.run()).status, "completed");
  assert.equal(state.storage.get(PC), "");
  assert.equal(occurrences(state.storage.get(WORK_WEEK), "- [o] same"), 2);
  assert.equal(state.storage.get(LOG), `- [o] same -> ${WORK_WEEK}\n- [o] same -> ${WORK_WEEK}\n`);
});

test("changed destination snapshots block recovery without overwriting manual edits", async () => {
  const state = harness({ files: { [PC]: "- [o] task\n", [WORK_WEEK]: "## Tasks\n" }, answers: ["work", "weekly"] });
  state.fault = event => {
    if (event.op === "process" && event.path === WORK_WEEK && event.when === "after") {
      state.storage.set(WORK_WEEK, event.content + "Manual addition\n");
      throw new Error("Interrupted after destination write");
    }
  };
  assert.equal((await state.run()).status, "error");
  const edited = state.storage.get(WORK_WEEK);
  state.fault = null;
  const result = await state.run();
  assert.equal(result.status, "error");
  assert.match(result.error, /Destination changed/);
  assert.equal(state.storage.get(WORK_WEEK), edited);
  assert.equal(state.storage.get(PC), "- [o] task\n");
  assert.ok(!state.storage.has(LOG));
  state.storage.set(WORK_WEEK, state.pending().destination.snapshot.after);
  assert.equal((await state.run()).status, "completed");
  assert.equal(occurrences(state.storage.get(WORK_WEEK), "- [o] task"), 1);
});

test("empty old journals remain usable while pending old journals stop before any mutation", async () => {
  const empty = harness({ files: { [PC]: "- thought\n", [JOURNAL]: JSON.stringify({ version: 1, pending: null }) }, answers: ["work"] });
  assert.equal((await empty.run()).status, "completed");
  assert.equal(JSON.parse(empty.storage.get(JOURNAL)).version, 2);
  const pending = harness({ files: { [PC]: "- thought\n", [JOURNAL]: JSON.stringify({ version: 1, pending: { id: "old" } }) } });
  const result = await pending.run();
  assert.equal(result.status, "error");
  assert.match(result.error, /older sorter move/);
  assert.equal(pending.storage.get(PC), "- thought\n");
  assert.equal(pending.dialogs.length, 0);
});

test("unexpected log edits block cleanup without overwriting the log", async () => {
  const state = harness({ files: { [PC]: "- [o] task\n", [WORK_WEEK]: "## Tasks\n", [LOG]: "previous mapping\n" }, answers: ["work", "weekly"] });
  state.fault = event => {
    if (event.op === "process" && event.path === WORK_WEEK && event.when === "after") state.storage.set(LOG, "previous mapping\nexternal entry\n");
  };
  assert.equal((await state.run()).status, "error");
  assert.equal(state.storage.get(LOG), "previous mapping\nexternal entry\n");
  assert.equal(state.storage.get(PC), "- [o] task\n");
  state.fault = null;
  assert.equal((await state.run()).status, "error");
  assert.equal(occurrences(state.storage.get(WORK_WEEK), "- [o] task"), 1);
});

test("unconfirmed template creation requires inspection instead of overwriting the partial note", async () => {
  const state = harness({ files: { [PC]: "- [o] task\n" }, answers: ["work", "weekly"] });
  state.fault = event => { if (event.op === "create" && event.path === WORK_WEEK && event.when === "after") throw new Error("Template interrupted"); };
  assert.equal((await state.run()).status, "error");
  const created = state.storage.get(WORK_WEEK);
  state.fault = null;
  const result = await state.run();
  assert.equal(result.status, "error");
  assert.match(result.error, /Template creation was interrupted/);
  assert.equal(state.storage.get(WORK_WEEK), created);
  assert.equal(state.storage.get(PC), "- [o] task\n");
  state.storage.delete(WORK_WEEK);
  assert.equal((await state.run()).status, "completed");
  assert.equal(occurrences(state.storage.get(WORK_WEEK), "- [o] task"), 1);
});

test("overlapping destinations and malformed recovery journals cannot remove captures", async () => {
  const config = configured();
  config.domains.work.thoughts.notePath = PC;
  const overlap = harness({ config, files: { [PC]: "idea\n" }, answers: ["work"] });
  assert.equal((await overlap.run()).status, "error");
  assert.equal(overlap.storage.get(PC), "idea\n");
  const malformed = harness({ files: { [PC]: "idea\n", [JOURNAL]: JSON.stringify({ version: 1, pending: { id: "bad" } }) } });
  assert.equal((await malformed.run()).status, "error");
  assert.equal(malformed.storage.get(PC), "idea\n");
  assert.equal(malformed.dialogs.length, 0);
});

test("simultaneous invocations are rejected, and the lock is released after cancellation", async () => {
  let release;
  const state = harness({ files: { [PC]: "idea\n" }, answers: [() => new Promise(resolve => { release = resolve; })] });
  const first = state.run();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const second = await state.run();
  assert.equal(second.status, "error");
  assert.match(second.error, /already running/);
  release(null);
  assert.equal((await first).status, "cancelled");
  state.answers.push("skip");
  assert.equal((await state.run()).status, "completed");
});
