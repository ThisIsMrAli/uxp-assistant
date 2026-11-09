// Runs before the first paint so a chosen theme never flashes the other one.
try {
  const key = "skill-boilerplate-theme";
  let saved = localStorage.getItem(key);
  if (!saved) {
    saved = localStorage.getItem("review-theme") || localStorage.getItem("session-theme");
    if (saved) localStorage.setItem(key, saved);
  }
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
} catch {
  // Storage is off. The system theme applies.
}
