# Inbox sorter

This Templater workflow processes tasks first, then thoughts, from `Inbox/Inbox PC.md` and the individual Markdown files in `Inbox/Inbox Phone`.

Each nonblank PC line is one capture. Each phone file must contain exactly one nonblank line. Blank phone files are left alone. Tasks start with exactly `- [o]` (the letter **o**), while thoughts use `- thought text`. The task check matches the full checkbox prefix, so a leading `-` on a thought does not make it a task. Older nonblank captures without a bullet are also accepted as thoughts. Captures should contain no frontmatter or extra headings.

## Setup

1. Copy `Scripts/sort_inbox.js`, `Scripts/inbox_sorter_config.json`, and `Templates/TemplaterTemplates/Sort Inbox.md` into your vault, preserving those paths.
2. Enable Templater and set its **Script files folder location** to `Scripts`. If you already use another script folder, place the JavaScript there. Update the configuration path in the launcher if you move the JSON file.
3. Put the launcher in your Templater templates folder (`Templates/TemplaterTemplates` in this vault). Open an ordinary control note, such as `Inbox/Process Inbox.md`, and use **Templater: Insert template**, selecting **Sort Inbox**. You can also assign the launcher a Templater template hotkey.
4. Replace the relevant `TODO_...` values in `Scripts/inbox_sorter_config.json`. Paths are relative to the vault root and include `.md` for notes and templates. Verify the supplied work and personal folder paths match your vault.

The launcher starts the sorter through `tp.hooks.on_all_templates_executed`, after Templater has finished updating the launch note. It does not insert a processing report into that note.

If launching produces a blank note without dialogs, check **Settings → Templater → Script files folder location**. It must be `Scripts` for this setup. With an empty setting, Templater does not expose `tp.user.sort_inbox`. The launcher now shows a notification when that function is missing and reports errors from its completion callback. After changes to the plugin's settings file outside Obsidian, disable and re-enable Templater, or restart Obsidian, to reload its saved settings. Use a Templater command to execute the launcher.

This is the sorter's own vault configuration. The Codex `config.toml` linked in the conversation is an editor/agent setting and does not need changes for this workflow.

## Configuration

| Setting | Meaning |
| --- | --- |
| `inbox.pcNote` | PC inbox note, including `.md` |
| `inbox.phoneFolder` | Folder of individual phone captures |
| `inbox.phoneRecursive` | Include phone subfolders when `true`; defaults to `false` |
| `inbox.taskPrefix` | Exact task prefix; configured as `- [o]` |
| `logPath` | Text log of original captures and destinations |
| `journalPath` | Recovery journal for the current operation |
| `activeProject.type`, `activeProject.status` | Required project frontmatter values; defaults to `project` and `active` |
| `domains.<domain>.weekly.folder` | Root folder for weekly notes |
| `domains.<domain>.weekly.namingScheme` | Moment filename format used by `tp.date.now`, including optional subfolders |
| `domains.<domain>.weekly.templatePath` | Template for a missing weekly note |
| `domains.<domain>.weekly.appendHeading` | Heading receiving individual tasks |
| `domains.<domain>.projects.folder` | Folder searched for active projects, including its subfolders |
| `domains.<domain>.projects.templatePath` | Template used to create a new project |
| `domains.<domain>.projects.appendHeading` | Heading receiving project tasks |
| `domains.<domain>.thoughts.notePath` | Thought note; created empty if missing |

`<domain>` is `work` or `personal`. Work defaults to folders under `PhD Notes`; personal defaults to folders under `Personal Notes`.

Both weekly naming schemes are `[Reviews/]GGGG-[W]WW`. For example, a work task sorted during ISO week 41 of 2026 goes to `PhD Notes/Planning/Weekly/Reviews/2026-W41.md`. `GGGG` is the ISO week year, so the filename also works across calendar-year boundaries. The current week is computed when each individual task is routed, regardless of its capture date or due date. Templates receive that weekly filename as the new note's title.

Only settings needed by the chosen route must be filled in. Skip and Delete work with all destination placeholders intact. An existing weekly note needs its heading setting, but not a template path. A missing template or unresolved placeholder stops processing before moving that item.

Existing vault paths are resolved using their actual capitalization. For example, `Personal notes/Thoughts.md` resolves to the existing `Personal Notes` folder, preventing a duplicate-folder error on Windows. Use exact capitalization in configuration where possible. Folder creation also checks the filesystem and tolerates a folder appearing between lookup and creation; other creation failures still stop processing.

Headings accept either a name, such as `Backlog`, or Markdown with a level, such as `## Backlog`. A missing heading is created at the end of the note, using level 2 unless specified. Items are appended directly under the matching heading, before its next heading or subheading. Headings in frontmatter and fenced code are ignored. Multiple matching headings or unclosed frontmatter/code fences cause an error so the item is not placed in an ambiguous or hidden section.

Active projects are Markdown notes within the selected domain's project folder with this frontmatter:

```yaml
---
type: project
status: active
---
```

New projects are created from their configured template and receive the configured `type` and `status`. Other template properties are preserved. Configured templates are excluded from active-project selection even if stored in a project folder. Project filenames cannot contain folders or reserved filename characters, and existing files are never overwritten. Templates should leave newly created notes at the requested path.

## Processing

Each item offers **Work**, **Personal**, **Delete**, **Skip / Later**, and **Edit before routing**. Editing returns to that menu. Task editing changes the text after `- [o]`, retaining the task prefix. Thought editing changes the text after its `-` bullet, retaining that prefix. The edit prompt accepts the body or the complete prefixed line without doubling its prefix.

The routing suggester keeps its searchable choices and shows the complete capture in a wrapping, scrollable heading above the search box. Escape closes the dialog and leaves the current capture in the inbox.

- **Skip / Later** leaves the source exactly as captured, including any original text replaced temporarily in the edit dialog.
- **Work / Personal tasks** offer the current weekly note, an active project, or a new project.
- **Work / Personal thoughts** are appended to that domain's thought note.
- **Delete** logs the original capture with `[deleted]` as its destination, then removes it.
- Closing any selection or edit dialog stops the run and leaves that item unchanged. Previously completed items stay processed.

Each move writes the destination, writes the log, and then removes the source. PC cleanup removes only the selected occurrence, preserving blank lines and line endings. Phone files are removed through Obsidian's configured trash behavior; their folders remain.

The log uses the original capture even if you edited it:

```text
- [o] Original task -> PhD Notes/Projects/Example.md
- Original thought -> Personal Notes/Thoughts.md
Discarded capture -> [deleted]
```

## Interrupted operations

The recovery journal is a temporary record for the current move. It stores the original/edited capture and the expected before/after contents of the source, destination, and log. For example, if appending a task succeeds but inbox cleanup fails, a retry sees that the destination already matches its saved after-content and continues with logging/cleanup instead of appending again. Two identical captures remain separate because each move starts from its own before-content. No identifiers or recovery comments are inserted into notes.

For a newly created note, its rendered template content is recorded before the capture is appended. Journal version 2 uses these destination snapshots. Empty version 1 journals are accepted; a pending version 1 move stops for inspection rather than risking a duplicate insertion during an upgrade.

Run the launcher again after a write or trash failure. The sorter first attempts to finish the pending operation, then collects the remaining captures. The log is checked against the saved snapshots to avoid duplicate entries. A completed journal has `"pending": null`.

Run the sorter on one device at a time and avoid editing or capturing into an inbox file while processing it. If the source, destination, or log changes unexpectedly, the sorter stops rather than overwriting new content. For a pending operation, inspect `source.before`, `source.after`, `destination.snapshot.before`, `destination.snapshot.after`, `log.before`, and `log.after` in the journal. Preserve new content separately before restoring an expected snapshot and rerunning. Do not clear a pending journal without checking whether the destination or log was already written.

The source check compares the entire original PC inbox note, not just the current line. Direct edits to any line, added captures, or changed line endings can therefore trigger `Source changed during sorting` while a move is pending. **Edit before routing** changes the outgoing text without changing that source snapshot. Editing the log during a pending move similarly triggers its log check. If a failed move never wrote its destination or log entry, its journal can be backed up and the pending entry cleared after verifying those facts; the current inbox can then be collected again without undoing your edits.

If template creation is interrupted after the new file appears but before successful creation is recorded, automatic recovery stops for inspection. Preserve any needed content from that new note, remove only that unconfirmed note if appropriate, and rerun to recreate it. Source captures are retained until destination and log writes succeed.

The script retains capture text, tags, dates, and link syntax. Relative Markdown links may need adjustment when their containing folder changes. Phone notes with multiple nonblank lines cause the run to stop before processing; split them into individual captures first.

## Verification

Run the dependency-free simulated-vault tests with Node.js:

```powershell
node --test tests/sort_inbox.test.cjs tests/sort_inbox_launcher.test.cjs
```

The tests exercise routing, editing, skipping, cancellation, duplicate captures, section insertion, project creation, and recovery from partial writes. Obsidian and Templater's actual rendering, editor integration, and trash behavior still need a first run with sample captures in your vault.

References: [Templater user scripts](https://silentvoid13.github.io/Templater/user-functions/script-user-functions.html), [template execution hooks](https://silentvoid13.github.io/Templater/internal-functions/internal-modules/hooks-module.html), [Templater file creation](https://silentvoid13.github.io/Templater/internal-functions/internal-modules/file-module.html), and [Obsidian API](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts).
