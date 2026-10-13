<%*
const week = tp.date.now("GGGG-[W]WW");
const file = app.workspace.getActiveFile();
const existing = file ? await app.vault.cachedRead(file) : "";
const alreadyLogged = existing.split("\n").some(line => line.trim() === `### ${week}`);
if (alreadyLogged) {
  tR = ""; // Do not create a second entry for the same week.
} else {
  tR = `### ${week}\n\n**Progress**\n- \n\n**Learned**\n- \n\n**Blockers**\n- \n\n**Next**\n- \n\n`;
}
%>
