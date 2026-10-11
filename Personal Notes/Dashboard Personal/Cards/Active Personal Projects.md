```dataviewjs
const settings = dv.page("Dashboard/Dashboard Settings");
const folder = String(settings?.project_folder ?? "Projects");
const pages = dv.pages(`"${folder}"`)
  .where((page) =>
    page.type === "project" &&
    !["done", "completed", "archived", "cancelled"].includes(
      String(page.status ?? "active").toLowerCase()
    )
  )
  .sort((page) => page.review ?? "9999-12-31", "asc");

if (pages.length === 0) {
  dv.paragraph(`_No active projects found in **${folder}**._`);
  dv.paragraph("Create one from [[Templates/Project]] or adjust [[Dashboard/Dashboard Settings]].");
  return;
}

const formatDate = (value) => {
  if (!value) return "—";
  if (typeof value.toFormat === "function") return value.toFormat("yyyy-MM-dd");
  return String(value);
};

dv.table(
  ["Project", "Status", "Next review"],
  pages.map((page) => [
    page.file.link,
    page.status ?? "active",
    formatDate(page.review)
  ])
);
```
