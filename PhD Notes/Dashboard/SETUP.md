# Dashboard setup

## 1. Copy the files

Copy the `Dashboard`, `Projects`, `Meetings`, and `Templates` folders into the root of your Obsidian vault. Existing folders can be merged.

## 2. Install and enable plugins

The dashboard uses:

- Tasks
- Dataview
- Templater
- QuickAdd — your existing task-capture workflow
- Homepage
- ICS
- Full Calendar

The functional task dashboard works without Full Calendar, but the visual week calendar requires both ICS and Full Calendar.

## 3. Configure Outlook

In **Settings → ICS**:

1. Add a calendar.
2. Select `Remote URL`.
3. Paste your Outlook ICS URL.
4. Save and run `ICS: Import events` once to verify the connection.

Keep the ICS URL private. It belongs in the plugin settings and is intentionally not stored in these notes.

## 4. Configure the weekly note

Open [[Dashboard/Dashboard Settings]] and set:

- `weekly_note_folder`
- `weekly_note_format`
- `weekly_note_date_basis`
- `weekly_focus_heading`

The default filename format is `GGGG-[W]WW`, which produces names such as `2026-W31`.

Examples:

| Weekly filename | Format | Date basis |
|---|---|---|
| `2026-W31` | `GGGG-[W]WW` | `current_date` |
| `2026-31` | `GGGG-WW` | `current_date` |
| `2026 Week 31` | `GGGG [Week] WW` | `current_date` |
| `2026-07-27` (Monday date) | `YYYY-MM-DD` | `iso_week_start` |

The current weekly note must contain a heading matching `weekly_focus_heading`, normally `Focus`.

## 5. Configure folders and navigation

In [[Dashboard/Dashboard Settings]], change the project and meeting paths when they differ from the supplied defaults.

The dashboard creates:

- [[Projects/Projects]] as a project index
- [[Meetings/Meeting Notes]] as a recent-meetings index
- [[Project_unused]] as a minimal project template

Your existing meeting template is not replaced.

## 6. Choose a homepage

In the Homepage plugin settings, test each version:

- Markdown: `Dashboard/Home.md`
- Canvas: `Dashboard/Home.canvas`

The Canvas version embeds the same card notes used by the Markdown version, so task and calendar logic is maintained in one place.

## 7. Project workflow

A project note needs these properties:

```yaml
---
type: project
status: active
review: 2026-08-03
---
```

Tasks may live in the project note, a weekly note, or any other note. To associate an external task with a project, mention or link the project in the task description:

```markdown
- [o] Draft methods section for [[Project Alpha]] 📅 2026-08-04
```

The global dashboard queries find the task by due date. The Tasks query in the project note finds tasks stored in that note or mentioning its name.

## 8. Expected date behavior

- **Overdue:** unfinished tasks due before today.
- **Today:** unfinished tasks due today, plus today’s Outlook events.
- **Next seven days:** tomorrow through seven days from now, for tasks and Outlook events.
- **Focus:** the content under the `Focus` heading in the current weekly note, regardless of whether those tasks have due dates.

## Optional CSS later

CSS is not required. A small snippet could later:

- place Today and Next seven days side by side on desktop;
- make the Markdown dashboard use more screen width;
- visually emphasize overdue tasks;
- reduce query spacing and metadata noise;
- make embedded sections look like consistent cards.

The Canvas version already provides spatial grouping without CSS, so test it before adding styling complexity.

## Troubleshooting

- **Weekly note not found:** correct the folder and filename format in Dashboard Settings.
- **Focus heading not found:** ensure the heading text matches exactly.
- **No events:** test `ICS: Import events`, check the ICS plugin calendar settings, and re-open the dashboard.
- **Blank visual calendar:** switch calendar view once. Full Calendar documents a first-render issue for inline calendars in some configurations.
- **No active projects:** create a project note with `type: project` and an active status.
