# Project system usage guide

[project-system.js](project-system.js) provides three DataviewJS views for Obsidian: a project dashboard, a list of projects worked on during a calendar week, and a timeline of decisions and milestones.

## Setup

1. Keep the script at `Views/project-system.js` in your vault.
2. Enable Dataview and its JavaScript queries.
3. Add `type: project` to each project note's properties.
4. Copy one of the view blocks below into a note.

The views search the entire vault. Notes inside `Templates/` are excluded. If your templates live elsewhere, adjust `templateFolders` in the script.

Templater is needed to create notes using the supplied templates. Task dates can use the Tasks plugin's emoji format shown below.

## Project notes

Use these properties at the beginning of a project note:

```yaml
---
type: project
status: active
deadline: 2026-11-06
---
```

| Property | Meaning |
| --- | --- |
| `type` | Required: `project`. Matching ignores capitalization. |
| `status` | Optional; defaults to `active`. Any other value, such as `paused` or `completed`, places the project in the dashboard's Other projects table. Matching ignores capitalization. |
| `deadline` | Optional hard deadline, using `YYYY-MM-DD`. Used for the dashboard's deadline column and warnings. |

The following sections supply the information shown in the views:

```markdown
## Next actions
- [ ] Prepare the experiment plan 📅 2026-10-28
- [ ] Book lab time 📅 2026-10-30

## Project log
### 2026-W43
**Progress**
- Finished the initial measurements.

## Decisions
- 2026-10-23 — Use the revised measurement protocol.

## Milestones
- 2026-10-30 — Complete the pilot experiment.
```

Use level-two headings (`##`) with the names shown above. Heading names ignore capitalization. Each section continues until the next level-one or level-two heading, so you can use level-three subheadings inside it.

**Template detail:** the supplied [Project template](<../Templates/TemplaterTemplates/Project.md>) currently uses `## Notes & Decisions` and `## Milestones & Deadlines`. To make those sections appear in the timeline, rename them to `## Decisions` and `## Milestones`, or add separate sections with those names.

## Project dashboard

Copy this block into a dashboard note:

````markdown
```dataviewjs
await dv.view("Views/project-system", { mode: "dashboard" });
```
````

The dashboard contains two tables, each with a project count:

| Table | Columns | Order |
| --- | --- | --- |
| Active projects | Project link, last worked week, next actions, hard deadline, warnings | Projects with warnings first, then alphabetical by note name |
| Other projects | Project link, status, last worked week | By status, then alphabetical by note name |

### Next actions and deadlines

Next actions are unchecked tasks (`- [ ]`) inside `## Next actions`. The dashboard shows up to two, sorted by their intended completion dates, with undated tasks last. If there are more, it displays `+N more`.

Use a task date such as `📅 2026-10-28` for an intended completion date. The project note's `deadline` property supplies the separate hard deadline.

Active projects can display these warnings:

| Warning | When it appears |
| --- | --- |
| No next action | The project has no unchecked task under `## Next actions`. |
| Next actions missing date | One or more next actions have no recognized date. The warning includes their count. |
| Hard deadline passed | The project's deadline is before today. |
| Hard deadline within 7 days | The deadline is today or within the next seven days. |

`Last worked` is the latest week detected from project log headings or dated completed tasks. A dash means no activity week was detected. See the activity rules below.

## Projects worked on during a week

To show a specific week:

````markdown
```dataviewjs
await dv.view("Views/project-system", { mode: "weekly", week: "2026-W43" });
```
````

The view lists project links alphabetically. It includes projects of every status and shows each matching project once. If nothing matches, it displays `No projects detected for 2026-W43.`

Use ISO calendar weeks in `YYYY-Www` format, such as `2026-W43`. Weeks run Monday through Sunday. The year is the ISO week year, which can differ from the calendar year near New Year's Day.

### Automatic week selection

You can let the view choose the week:

````markdown
```dataviewjs
await dv.view("Views/project-system", { mode: "weekly" });
```
````

The first available value in this order determines the week:

1. The explicit `week` argument passed to the view.
2. The containing note's `week` property, for example `week: 2026-W43`.
3. A week identifier found in the containing note's filename, such as `2026-W43` or `Review 2026-W43`.
4. The current ISO week.

Set the week explicitly or include it in the note's properties or filename to keep older reviews tied to their intended week when reopened.

### What counts as worked on

A project matches a week when either of these exists in that project note:

- A heading such as `### 2026-W43` inside `## Project log`.
- A completed task with a completion date in that week, anywhere in the note. For example: `- [x] Finish measurements ✅ 2026-10-23`.

A project log heading counts even if the entry underneath it is empty. Completed tasks need a recognized completion date. The view uses Dataview's task date information when available and also recognizes `✅ YYYY-MM-DD` in task text.

Editing a note, adding an undated completed task, or recording a dated decision or milestone does not by itself add a worked-on week.

### Review the previous week

The [Weekly work review template](<../Templates/TemplaterTemplates/Weekly work review.md>) already contains this block:

````markdown
```dataviewjs
const previousWeek = moment(dv.current().file.name, "GGGG-[W]WW", true)
  .subtract(1, "week")
  .format("GGGG-[W]WW");
await dv.view("Views/project-system", { mode: "weekly", week: previousWeek });
```
````

This block requires the review note's filename to be exactly an ISO week identifier, such as `2026-W44`. The template assigns that name when creating the note.

| Review note | Projects shown from |
| --- | --- |
| `2026-W44` | `2026-W43` |
| `2026-W01` | `2025-W52` |
| `2027-W01` | `2026-W53` |

The displayed week follows the note's filename, so reopening the review later keeps the same target week. The project list still reflects the current contents of the project notes; it is a live view rather than a saved snapshot.

## Decisions and milestones timeline

Copy this block into a note:

````markdown
```dataviewjs
await dv.view("Views/project-system", { mode: "timeline" });
```
````

The timeline combines dated entries from `## Decisions` and `## Milestones` across all project statuses. It displays Date, Type, Project link, and Event, with the newest dates first. Events on the same date are ordered by project note name.

Write each event as a single bullet with a date, a dash, and a description:

```markdown
## Decisions
- 2026-10-23 — Use the revised measurement protocol.

## Milestones
- 2026-10-30 — Complete the pilot experiment.
```

Dates must be valid `YYYY-MM-DD` dates. Both `-` and `*` bullet markers work. The separator after the date can be a hyphen (`-`), en dash (`–`), or em dash (`—`), with spaces around it.

When there are no matching entries, the view displays `No dated decisions or milestones found.`

## Adding project logs with the supplied templates

The Project template includes an **＋ Add project log** button. Clicking it creates an entry for the current ISO week with Progress, Learned, Blockers, and Next prompts. It reports when that week's heading already exists, preventing duplicate entries.

The button inserts entries after `<!-- PROJECT_LOG_ENTRIES -->` under `## Project log`. Keep that marker in project notes created from the template.

The [Weekly project log entry template](<../Templates/TemplaterTemplates/Weekly project log entry.md>) can also insert the current week's prompts. It skips insertion when that week's heading already exists in the note.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| A project is missing from every view | Give it `type: project` and keep it outside `Templates/`. |
| The dashboard reports no next action | Put unchecked tasks under `## Next actions`. |
| A task appears without a date | Use a valid task date such as `📅 2026-10-28`. |
| A project is missing from a weekly list | Add a matching week heading under `## Project log`, or a dated completed task in the project note. |
| A weekly view shows the wrong week | Check the selection order above. An explicit `week` argument takes priority over note properties and filenames. |
| A previous-week review shows no projects for `Invalid date` | Name the review note exactly like `2026-W44`. |
| Decisions or milestones are missing | Check the exact section headings and the dated bullet format. The supplied Project template's longer headings need adapting for the timeline. |
| The log button reports a missing insertion marker | Restore `<!-- PROJECT_LOG_ENTRIES -->` under `## Project log`. |
| The view reports an unknown mode | Use `dashboard`, `weekly`, or `timeline`. Omitting `mode` selects the dashboard. |
