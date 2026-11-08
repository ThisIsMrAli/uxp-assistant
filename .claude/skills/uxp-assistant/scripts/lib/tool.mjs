const GRACE_MS = 60 * 1000;

/**
 * Every source file strictly newer than the package, past the 60 second grace,
 * is listed. Equal timestamps are not "newer". The report does not collapse
 * them to whichever path a walker saw last.
 */
export function newerSources(sources, packageMtimeMs, graceMs = GRACE_MS) {
  return [...(sources || [])]
    .filter((file) => Number(file.mtimeMs) > Number(packageMtimeMs) + graceMs)
    .map((file) => file.rel)
    .sort();
}

export function checkStale(sources, packages, graceMs = GRACE_MS) {
  const findings = [];
  for (const pkg of packages || []) {
    const newer = newerSources(sources, pkg.mtimeMs, graceMs);
    if (!newer.length) continue;
    findings.push({
      id: "package-stale",
      package: pkg.rel,
      files: newer,
      message: `${pkg.rel} is older than ${newer.join(", ")}. Build and package again.`
    });
  }
  return findings;
}
