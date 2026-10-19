---
type: project
status: active
created: <% tp.date.now("YYYY-MM-DD") %>
deadline:
---
## Description & Direction

## Next actions


## Backlog


## Notes & Decisions


## Milestones & Deadlines


## Meetings


## Project log

```dataviewjs
const filePath = dv.current().file.path;
const button = dv.el("button", "＋ Add project log");

button.addEventListener("click", async () => {
  const file = app.vault.getAbstractFileByPath(filePath);
  const week = moment().format("GGGG-[W]WW");

  if (!file || file.extension !== "md") {
    new Notice("Project note not found.");
    return;
  }

  const entry = `### ${week}

**Progress**
-

**Learned**
-

**Blockers**
-

**Next**
-
`;

  let result = "added";

  await app.vault.process(file, content => {
    const marker = /^<!-- PROJECT_LOG_ENTRIES -->[ \t]*$/m.exec(content);

    if (!marker) {
      result = "missing";
      return content;
    }

    const position = marker.index + marker[0].length;
    const remaining = content.slice(position);

    const nextSection = remaining.search(/^#{1,2}[ \t]+/m);
    const logSection = nextSection < 0
      ? remaining
      : remaining.slice(0, nextSection);

    if (logSection.split(/\r?\n/).some(
      line => line.trim() === `### ${week}`
    )) {
      result = "exists";
      return content;
    }

    return content.slice(0, position)
      + "\n\n" + entry + "\n"
      + remaining;
  });

  if (result === "exists") {
    new Notice(`Log for ${week} already exists.`);
  } else if (result === "missing") {
    new Notice("Project log insertion marker missing.");
  } else {
    new Notice(`Created project log for ${week}.`);
  }
});
```

<!-- PROJECT_LOG_ENTRIES -->
