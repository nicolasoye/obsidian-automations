/** QuickAdd entry point. Read the shared implementation through the vault (also works on mobile). */
module.exports = async function applyWeeklySchedule(params) {
  const source = await params.app.vault.adapter.read("Scripts/create_weekly_planning.js");
  const shared = { exports: {} };
  new Function("module", "exports", source)(shared, shared.exports);
  return shared.exports.apply(params);
};
