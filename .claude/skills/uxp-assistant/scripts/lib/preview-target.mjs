import path from "node:path";

/** Screenshots land beside the package, or in --out. They do not use the repo evidence folder unless that is the path you passed. */
export function previewTarget({ ccx, out }) {
  const evidence = out ? path.resolve(out) : path.join(path.dirname(path.resolve(ccx)), "preview");
  return { evidence, capturedOn: "this machine", hostExecuted: false, mocked: true };
}
