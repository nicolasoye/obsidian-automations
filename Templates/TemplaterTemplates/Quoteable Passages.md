<%*
//const paper = await tp.system.prompt("Which paper is the quotable section from?");
//await tp.file.move(`PhD Notes/Quotables/${paper}`);
/*
Run-only template (renders nothing). Creates/updates other notes via vault API.
If this still errors before prompting, the issue is usually how the note is created
(e.g., a plugin/hotkey creating an “unnamed” file with empty path). See notes below.
*/

if (!tp.file || !tp.file.path) {
  // If templater is running without a current file context, abort cleanly.
  new Notice("No current file context. Create/open a note first, then run the template.");
  tR = "";
  return;
}
const PAPERS_FOLDER = "Literature/Papers";
const QUOTES_FOLDER = "Literature/Quoteables";

/*function escapeRegExp(s){
	return s.replace(/[.*+?^${}()|[$\$]/g, "\\$&"); 
}
function sanitizeFileName(name){
  // minimal sanitization for Obsidian paths
  return name.replace(/[\\\/:\*\?"<>\|]/g, " - ").trim();
}
*/
async function ensureFolder(path) {
  try { await app.vault.createFolder(path); } catch (e) {}
}
const exists = (path) => !!app.vault.getAbstractFileByPath(path);

async function getMarkdownFilesInFolder(folder) {
  const fo = app.vault.getAbstractFileByPath(folder);
  if (!fo || !fo.children) return [];
  return fo.children.filter(ch => ch.extension === "md");
}

async function ensurePaper(paperBasename) {
  const paperPath = `${PAPERS_FOLDER}/${paperBasename}.md`;
  if (!exists(paperPath)) {
    await app.vault.create(paperPath, `# ${paperBasename}\n\n## Quoteables\n`);
  }
  return paperPath;
}

async function appendToPaper(paperPath, quoteBasename) {
  const f = app.vault.getAbstractFileByPath(paperPath);
  let content = await app.vault.read(f);

  if (!content.includes("## Quoteables")) {
    content = content.trimEnd() + "\n\n## Quoteables\n";
  }
  if (!content.includes(`[[${quoteBasename}]]`)) {
    content = content.trimEnd() + `\n- [[${quoteBasename}]]\n`;
  }
  await app.vault.modify(f, content);
}

// --- main ---
// await ensureFolder(PAPERS_FOLDER);
//await ensureFolder(QUOTES_FOLDER);

const rawPaperName = await tp.system.prompt("Paper name");
if (!rawPaperName) { tR = ""; return; }

const paperBasename = rawPaperName.trim();

// 1) Ensure paper note exists
const paperPath = await ensurePaper(paperBasename);

// 2) Count quoteables notes whose title contains the *paperName* text (sanitized for regex)
const quoteFiles = await getMarkdownFilesInFolder(QUOTES_FOLDER);
const re = new RegExp(paperBasename, "i");
const note_count = quoteFiles.filter(f => re.test(f.basename)).length;

// 3) Create quote note with X = note_count+1 (avoid collisions)
let idx = note_count + 1;
let quoteBasename = `${paperBasename}_quote_${idx}`;
let quotePath = `${QUOTES_FOLDER}/${quoteBasename}.md`;
while (exists(quotePath)) {
  idx += 1;
  quoteBasename = `${paperBasename}_quote_${idx}`;
  quotePath = `${QUOTES_FOLDER}/${quoteBasename}.md`;
}
//await tp.system.prompt("1");
await tp.file.move(`${QUOTES_FOLDER}/${quoteBasename}`);
//await tp.system.prompt("1");
/*await app.vault.create(
  quotePath,
`# ${quoteBasename}

Paper: [[${paperBasename}]]

> Quote:

Source / page:
- 
`
);*/
// 4) Append link to paper
await appendToPaper(paperPath, quoteBasename);

// Optional: open the new quote
//const created = app.vault.getAbstractFileByPath(quotePath);
//if (created) await app.workspace.getLeaf(true).openFile(created);

tR = "";
%>
Paper: [[<%paperBasename%>]] 
#quoteables