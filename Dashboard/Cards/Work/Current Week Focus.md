```dataviewjs
const settings = dv.page("Dashboard/Settings/Work");

if (!settings) {
  dv.paragraph("⚠️ Dashboard settings were not found.");
  return;
}

const folder = String(settings.weekly_note_folder ?? "")
  .replace(/^\/+|\/+$/g, "");
const format = String(settings.weekly_note_format ?? "GGGG-[W]WW");
const basis = String(settings.weekly_note_date_basis ?? "current_date");
const heading = String(settings.weekly_focus_heading ?? "What is your focus?");
const weeklyMoment = basis === "iso_week_start"
  ? moment().startOf("isoWeek")
  : moment();
const weeklyTitle = weeklyMoment.format(format);
const weeklyPath = folder ? `${folder}/${weeklyTitle}` : weeklyTitle;

let markdown = null;
try {
  markdown = await dv.io.load(`${weeklyPath}.md`);
} catch (_) {
  try {
    markdown = await dv.io.load(weeklyPath);
  } catch (_) {
    markdown = null;
  }
}

if (!markdown) {
  dv.paragraph(`⚠️ Weekly note not found: [[${weeklyPath}]]`);
  dv.paragraph("Update `weekly_note_folder` and `weekly_note_format` in [[Dashboard/Settings/Work]].");
  return;
}

const normalize = (value) => value
  .replace(/\s+#+\s*$/, "")
  .trim()
  .toLowerCase();

const lines = markdown.split(/\r?\n/);
let start = -1;
let level = 0;

for (let index = 0; index < lines.length; index += 1) {
  const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
  if (match && normalize(match[2]) === normalize(heading)) {
    start = index + 1;
    level = match[1].length;
    break;
  }
}

if (start === -1) {
  dv.paragraph(`⚠️ Heading “${heading}” was not found in [[${weeklyPath}]].`);
  return;
}

let end = lines.length;
for (let index = start; index < lines.length; index += 1) {
  const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
  if (match && match[1].length <= level) {
    end = index;
    break;
  }
}

const section = lines.slice(start, end).join("\n").trim();
if (section) {
  dv.paragraph(section);
} else {
  dv.paragraph("_The Focus section is empty._");
}

dv.paragraph(`[[${weeklyPath}|Open current weekly note and review]]`);
```
