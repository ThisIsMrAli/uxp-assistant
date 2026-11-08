/**
 * Inventory copied from create-bolt-uxp src/index.ts at
 * bcc092f1b16c72cddbd2b88f106c33f09c089bcb (package 1.3.27).
 * acceptanceTested is this skill's run, not Bolt's claim.
 * Illustrator and After Effects are Bolt beta switches. The shared manifest
 * page retrieved for this skill listed PS, ID, premierepro, and ame.
 */
export const BOLT_FRAMEWORKS = [
  { id: "react", label: "React", acceptanceTested: true },
  { id: "vue", label: "Vue", acceptanceTested: false },
  { id: "svelte", label: "Svelte", acceptanceTested: false }
];

export const BOLT_APPS = [
  { id: "phxs", label: "Photoshop", manifestApp: "PS", starterMinVersion: "24.2.0", beta: false, acceptanceTested: true },
  { id: "idsn", label: "InDesign", manifestApp: "ID", starterMinVersion: "18.5", beta: false, acceptanceTested: false },
  { id: "ppro", label: "Premiere Pro", manifestApp: "premierepro", starterMinVersion: "22.3", beta: false, acceptanceTested: false },
  { id: "ame", label: "Media Encoder (Beta)", manifestApp: "ame", starterMinVersion: "22.3", beta: true, acceptanceTested: false },
  { id: "ilst", label: "Illustrator (Beta)", manifestApp: "AI", starterMinVersion: "27.0", beta: true, acceptanceTested: false, officialManifestEnum: false },
  { id: "aeft", label: "After Effects (Beta)", manifestApp: "aftereffects", starterMinVersion: "22.3", beta: true, acceptanceTested: false, officialManifestEnum: false }
];

export function stackInventory() {
  return {
    installer: "create-bolt-uxp@1.3.27",
    commit: "bcc092f1b16c72cddbd2b88f106c33f09c089bcb",
    frameworks: BOLT_FRAMEWORKS,
    apps: BOLT_APPS,
    crossProductTested: [{ framework: "react", app: "phxs" }],
    notCrossProductTested: true
  };
}

export function findFramework(id) {
  return BOLT_FRAMEWORKS.find((item) => item.id === id) || null;
}

export function findApp(id) {
  return BOLT_APPS.find((item) => item.id === id || item.manifestApp === id) || null;
}
