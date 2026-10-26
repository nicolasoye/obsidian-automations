// Shared DataviewJS view for project dashboard, weekly review, and timeline.
// Call: await dv.view("Views/project-system", { mode: "dashboard" | "weekly" | "timeline" });

const mode = input?.mode ?? "dashboard";
const sourceFolder = String(input?.folder ?? "").replace(/^\/+|\/+$/g, "");
// Change this if you use a different templates folder.
const templateFolders = ["Templates/"];
const isoWeek = date => moment(date).format("GGGG-[W]WW");

function isoDate(value) {
  if (!value) return null;
  const raw = typeof value.toISODate === "function"
    ? value.toISODate()
    : typeof value.toISOString === "function"
      ? value.toISOString().slice(0, 10)
      : String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && moment(raw, "YYYY-MM-DD", true).isValid()
    ? raw : null;
}

function taskDate(task, field, emoji) {
  // Use Dataview metadata first; fall back to Tasks' emoji in task text.
  const indexed = isoDate(task[field]);
  if (indexed) return indexed;
  const match = String(task.text ?? "").match(new RegExp(`${emoji}\\uFE0F?\\s*(\\d{4}-\\d{2}-\\d{2})`, "u"));
  return match ? isoDate(match[1]) : null;
}
const taskDue = task => taskDate(task, "due", "📅");
const taskCompletion = task => taskDate(task, "completion", "✅");

function section(lines, heading) {
  const start = lines.findIndex(line => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s+/.test(lines[i])) { end = i; break; }
  }
  return { start: start + 1, end };
}

function logWeeks(lines) {
  const range = section(lines, "Project log");
  if (!range) return [];
  const found = [];
  for (let i = range.start; i < range.end; i++) {
    const match = lines[i].match(/^###\s+(\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3]))\s*$/);
    if (match) found.push(match[1]);
  }
  return found;
}

function events(lines, heading) {
  const range = section(lines, heading);
  if (!range) return [];
  const result = [];
  for (let i = range.start; i < range.end; i++) {
    const match = lines[i].match(/^\s*[-*]\s+(\d{4}-\d{2}-\d{2})\s+[—–-]\s+(.+?)\s*$/);
    if (match && isoDate(match[1])) result.push({ date: match[1], text: match[2] });
  }
  return result;
}

function warnings(info) {
  if (info.status !== "active") return [];
  const result = [];
  if (info.next.length === 0) result.push("No next action");
  if (info.undated.length) result.push(`${info.undated.length} next action(s) missing date`);
  if (info.deadline) {
    const days = moment(info.deadline).startOf("day")
      .diff(moment().startOf("day"), "days");
    if (days < 0) result.push("Hard deadline passed");
    else if (days <= 7) result.push("Hard deadline within 7 days");
  }
  return result;
}

function conciseNextActions(info) {
  if (!info.next.length) return "—";
  const sorted = [...info.next].sort((a, b) =>
    (taskDue(a) ?? "9999-12-31").localeCompare(taskDue(b) ?? "9999-12-31"));
  const visible = sorted.slice(0, 2).map(task => {
    const title = String(task.text ?? "").replace(/📅\uFE0F?\s*\d{4}-\d{2}-\d{2}/gu, "").trim();
    return `${title} (${taskDue(task) ?? "no date"})`;
  }).join("; ");
  return sorted.length > 2 ? `${visible}; +${sorted.length - 2} more` : visible;
}

const pages = dv.pages()
  .where(page => String(page.type ?? "").toLowerCase() === "project"
    && (!sourceFolder || page.file.path.startsWith(sourceFolder + "/"))
    && !templateFolders.some(folder => page.file.path.startsWith(folder)))
  .array();

const projects = await Promise.all(pages.map(async page => {
  const file = app.vault.getAbstractFileByPath(page.file.path);
  if (!file) return null;
  const lines = (await app.vault.cachedRead(file)).split(/\r?\n/);
  const range = section(lines, "Next actions");
  const next = range
    ? [...(page.file.tasks ?? [])].filter(task =>
        task.line >= range.start && task.line < range.end && task.status === "o")
    : [];
  const doneWeeks = [...(page.file.tasks ?? [])]
    .filter(task => task.status === "c")
    .map(taskCompletion).filter(Boolean).map(isoWeek);
  const activityWeeks = [...new Set([...logWeeks(lines), ...doneWeeks])].sort();
  return {
    page,
    lines,
    status: String(page.status ?? "active").toLowerCase(),
    next,
    undated: next.filter(task => !taskDue(task)),
    deadline: isoDate(page.deadline),
    activityWeeks,
    lastWorked: activityWeeks.at(-1) ?? "—"
  };
}));
const infos = projects.filter(Boolean);

if (mode === "dashboard") {
  const active = infos.filter(info => info.status === "active")
    .sort((a, b) => Number(warnings(b).length > 0) - Number(warnings(a).length > 0)
      || a.page.file.name.localeCompare(b.page.file.name));
  dv.header(3, `Active projects (${active.length})`);
  if (!active.length) dv.paragraph("No active projects.");
  else dv.table(
    ["Project", "Last worked", "Next actions (intended-by)", "Hard deadline", "Warnings"],
    active.map(info => [
      info.page.file.link,
      info.lastWorked,
      conciseNextActions(info),
      info.deadline ?? "—",
      warnings(info).join(" · ") || "—"
    ])
  );
  const other = infos.filter(info => info.status !== "active")
    .sort((a, b) => a.status.localeCompare(b.status) || a.page.file.name.localeCompare(b.page.file.name));
  dv.header(3, `Other projects (${other.length})`);
  if (!other.length) dv.paragraph("None.");
  else dv.table(["Project", "Status", "Last worked"], other.map(info => [
    info.page.file.link, info.status, info.lastWorked
  ]));
} else if (mode === "weekly") {
  // A weekly note's `week` property wins, so old weekly notes remain historically correct.
  const current = dv.current();
  const week = String(input?.week ?? current?.week
    ?? current?.file?.name?.match(/\d{4}-W\d{2}/)?.[0]
    ?? isoWeek(moment()));
  const worked = infos.filter(info => info.activityWeeks.includes(week))
    .sort((a, b) => a.page.file.name.localeCompare(b.page.file.name));
  if (!worked.length) dv.paragraph(`No projects detected for ${week}.`);
  else dv.list(worked.map(info => info.page.file.link));
} else if (mode === "timeline") {
  const all = infos.flatMap(info => [
    ...events(info.lines, "Decisions").map(event => ({ ...event, kind: "Decision", page: info.page })),
    ...events(info.lines, "Milestones").map(event => ({ ...event, kind: "Milestone", page: info.page }))
  ]).sort((a, b) => b.date.localeCompare(a.date) || a.page.file.name.localeCompare(b.page.file.name));
  if (!all.length) dv.paragraph("No dated decisions or milestones found.");
  else dv.table(["Date", "Type", "Project", "Event"], all.map(event => [
    event.date, event.kind, event.page.file.link, event.text
  ]));
} else {
  dv.paragraph(`Unknown project-system mode: ${mode}`);
}
