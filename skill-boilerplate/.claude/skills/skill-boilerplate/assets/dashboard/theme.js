// Runs before the first paint so a chosen theme never flashes the other one.
try {
  const saved = localStorage.getItem("review-theme");
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
} catch {
  // Storage is off. The system theme applies.
}
