# Weekly planning

Reload Obsidian after syncing these files so QuickAdd and Tasks reload their settings. Kanban is installed and enabled in this vault, and the `quickadd-buttons` CSS snippet is enabled.

1. Click **Create weekly planning board** at the bottom of a note made from `Templates/TemplaterTemplates/Weekly work review.md`, or **Plan this week** on the dashboard. Existing review notes do not gain the template button automatically; the same command is available through QuickAdd.
2. Drag task cards between the eight columns. Keep the Apply schedule control in Overdue. Keep task cards intact, including their hidden identity comments.
3. Click **Apply schedule** in Overdue, or run the **Apply weekly schedule** QuickAdd command. The completed log opens after application and cleanup.

Creating the board adds temporary block IDs to eligible tasks that lack an ID. It does not reschedule tasks. Applying replaces only the due date and removes IDs created by that session; pre-existing IDs stay intact. Nested tasks are independent, and continuation lines stay in their source notes.

## Configuration

Both entry points read `Scripts/weekly_planning_config.json`. The exclusion lists are empty so you can configure them later:

```json
{
  "excludedFolders": ["Folder to skip directly"],
  "excludedFolderTrees": ["Folder to skip with all descendants"]
}
```

Use vault-relative paths. Temporary files and logs are always excluded recursively, regardless of those lists. Tasks must have exactly the configured status (`o`) and exactly one valid due date (`📅 YYYY-MM-DD`). Undated tasks, other statuses, invalid or ambiguous dates, frontmatter and fenced code examples are excluded. Current-week Saturday and Sunday tasks are excluded; older weekend dates count as overdue.

The board stores the creation day's current Monday–Friday dates, following Monday, and first Monday of the next calendar month. Application keeps using those dates after midnight or in a later week. Moving an existing overdue task out of Overdue assigns a date; moving another task into Overdue is rejected. A move that resolves to the existing date does not produce a change-log row.

The Tasks global query excludes `_WeeklyPlanning/` using a path filter. If you change `temporaryFolder`, update that global query too. Dataview task views need their own equivalent exclusion. Do not change the temporary folder or move source notes during an unfinished session. The session snapshots the other settings for recovery.

## Conflicts and recovery

Application validates every card and source task before its first source write. A conflict leaves the session available and names the affected card or note. Restore the task line or board card to its original state and retry. Unrelated edits elsewhere in a source note are allowed.

An interrupted run keeps `_WeeklyPlanning/session.json`. Run **Create weekly planning board** and choose **Reopen / resume planning session** to finish interrupted creation, reopen the board, or resume application. **Apply weekly schedule** also resumes application. Once application starts, keep the saved card placements unchanged until it finishes.

Updates use [Obsidian's `Vault.process()`](https://docs.obsidian.md/Plugins/Vault) for each note. There is no transaction across notes: if a later note fails, earlier notes may already have their new dates. The manifest records intended dates before writing and checkpoints each note afterward. Recovery recognizes a write that succeeded before its checkpoint, completes one session log, and continues cleanup. Errors are retained in that log.

To abandon planning before application, run **Create weekly planning board** and choose **Discard planning session**. This removes only temporary IDs from the source notes, preserves other edits and existing IDs, and deletes the temporary board and manifest. Once date application has begun, use Apply to finish the recorded changes and cleanup before creating another session.

Use one active Obsidian instance/device for this workflow. The session file enforces one unfinished session, and an in-memory lock prevents overlapping commands in one app; it cannot coordinate simultaneous writes from multiple devices.

Logs are ordinary Markdown in `Reviews/Rescheduling logs/`. They contain changed tasks, old/new dates, destinations, unchanged-task counts, application errors and links to source notes or pre-existing permanent blocks. They do not link to a weekly review.

## Files and verification

- `Scripts/create_weekly_planning.js`: creation, validation, application, discard and recovery implementation; exports the create entry point.
- `Scripts/apply_weekly_schedule.js`: the apply entry point; loads the shared implementation through the vault API so it does not depend on desktop Node paths.
- `Scripts/weekly_planning_config.json`: shared configuration.
- `.obsidian/plugins/quickadd/data.json`: the two registered macros.
- `.obsidian/plugins/obsidian-tasks-plugin/data.json`: global board exclusion.
- `.obsidian/snippets/quickadd-buttons.css`: styling for the review, dashboard and board buttons.

Run the isolated tests with:

```sh
node --test Scripts/tests/weekly_planning.test.cjs
```

The tests use an in-memory vault and cover calendar boundaries, exclusions, card/source conflicts, duplicate descriptions, recurrence and nesting preservation, write races, interrupted creation/application/logging/cleanup, discard and the shared lock. They do not edit real tasks. After reloading Obsidian, check that the review button opens a Kanban board, drag one card, and verify its source date and generated log after applying.
