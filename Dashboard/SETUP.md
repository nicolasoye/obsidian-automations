# Dashboard

Open [[Dashboard/Home.canvas|Home]] after reloading Obsidian. The selector at the top switches the entire canvas between **Work** (`PhD Notes/`) and **Personal** (`Personal Notes/`). It remembers the selected state through its Context card reference. All dashboard cards and settings live under `Dashboard/`.

Both states share card positions and sizes. Personal keeps weekly focus blank and has no calendar. Switching back to Work restores the calendar at its previous position. `Layout.json` preserves the inactive calendar's geometry and connections; keep it beside the canvas. The switch briefly reopens dashboard tabs to save pending layout edits and refresh every card together.

Groups: Priorities (focus and overdue), Today, Coming up (next seven days), Calendar (Work only), and Projects and actions (projects, navigation, inbox and planning).

## Plugins and commands

Enable Tasks, Dataview with JavaScript queries, QuickAdd, Templater, and Kanban. The existing Work calendar also needs ICS; its visual week view needs Full Calendar. These calendar plugins are optional and are currently not installed. Their absence does not affect task or project cards. Configure only Work calendar feeds in ICS; the existing integration displays all events supplied by that plugin. Store feed URLs in plugin settings.

This vault's QuickAdd configuration includes the following macros. On another installation, register each as a Macro with one User Script command and enable its command-palette toggle:

| QuickAdd choice | User script |
| --- | --- |
| Switch dashboard context | `Scripts/switch_dashboard.js` |
| Sort Inbox Button | `Scripts/start_inbox_sorting.js` |
| Sort Notes Button | `Scripts/start_note_sorting.js` |
| Create weekly planning board | `Scripts/create_weekly_planning.js` |
| Apply weekly schedule | `Scripts/apply_weekly_schedule.js` |

The selector and action links pass `value-dashboardContext=work` or `personal` through QuickAdd's URI handler. Running the switch command without a value asks which context to open.

The inbox sorter retains its original shared inbox and per-item routing. The dashboard's Sort notes link restricts eligible notes and topic destinations to the selected context; running Sort Notes Button without a context retains the original vault-wide behavior.

## Settings

- [[Dashboard/Settings/Work]] contains the existing PhD weekly-review settings and navigation destinations.
- [[Dashboard/Settings/Personal]] contains personal navigation settings. Personal weekly reviews are disabled; its focus card is deliberately empty.
- Work tasks and projects are restricted to `PhD Notes/`; Personal queries are restricted to `Personal Notes/`. Shared inbox tasks appear after routing into one of those roots.
- Both project cards use `Views/project-system.js`, including active and other projects, next actions, deadlines, and warnings. The optional `folder` argument also works in weekly and timeline views.
- Navigation includes context-specific topic hubs. Configure meeting-note links only if the destination exists.

## Planning and recovery

The Plan week link creates or resumes the selected context's session under `_WeeklyPlanning/work/` or `_WeeklyPlanning/personal/`. Each board's Apply link carries its own context; changing the dashboard does not change an existing board's tasks. A generic Apply command uses the active board's context first. Logs are separated under `Reviews/Rescheduling logs/work/` and `personal/`.

The previous `_WeeklyPlanning/session.json` and board remain recoverable. Open [[_WeeklyPlanning/Weekly planning|the existing board]] and run Create weekly planning board to resume/discard it, or Apply weekly schedule to apply it. Opening a legacy board explicitly selects that legacy session. Do not move its source notes before completing or discarding it.

See [[WEEKLY_PLANNING]] for task eligibility, conflict checks, and interrupted-session recovery.

## Verification

Run `node --test Scripts/tests/*.test.cjs`. Automated checks use in-memory vaults and do not reschedule real notes.

After reloading Obsidian:

1. Open Home and check the Work tasks, project scope, focus, and calendar messages.
2. Resize or move a card, switch to Personal, and check that its geometry is retained and that Work events and tasks disappear.
3. Check the blank personal focus and absence of the Calendar group. Switch back and check the calendar position.
4. Create one planning session per context; apply a board after changing the dashboard and verify that only that board's context changes.
5. Check that Sort inbox still offers its existing routing choices.

Old Work/Personal canvases and Markdown dashboards have been removed. Use this canvas as the homepage.
