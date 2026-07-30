import { lstat, readdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const FORBIDDEN_NAMES = new Set([".turbo", "coverage", "src", "test-fixtures"]);
const ERROR = Object.freeze({
  artifactRootInvalid: "artifact_root_invalid",
  forbiddenPath: "artifact_forbidden_path",
  linkEscape: "artifact_link_escape",
  linkUnresolved: "artifact_link_unresolved",
  noWorkspaceRoots: "artifact_workspace_roots_missing",
  packageRootEscape: "artifact_package_root_escape",
  packageRootInvalid: "artifact_package_root_invalid",
  pathEscape: "artifact_path_escape",
  removeEscape: "artifact_remove_escape",
  scopeInvalid: "artifact_workspace_scope_invalid",
  storeEscape: "artifact_pnpm_store_escape",
  storeInvalid: "artifact_pnpm_store_invalid",
});

const normalizedRelative = (root, path) => relative(root, path).split(sep).join("/");

const isContained = (root, path) => {
  const value = relative(root, path);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
};

const forbidden = (name) => {
  const normalized = name.toLowerCase();
  return FORBIDDEN_NAMES.has(normalized) || normalized.endsWith(".map") || normalized.includes(".test.") || normalized.endsWith(".tsbuildinfo");
};

const safeStatus = async (path) => {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
};

const assertArtifactRoot = async (argument) => {
  try {
    const requested = resolve(argument);
    const status = await lstat(requested);
    if (!status.isDirectory() || status.isSymbolicLink()) throw new Error(ERROR.artifactRootInvalid);
    return await realpath(requested);
  } catch (error) {
    if (error instanceof Error && error.message === ERROR.artifactRootInvalid) throw error;
    throw new Error(ERROR.artifactRootInvalid);
  }
};

const discoverWorkspaceRoots = async (artifactRoot, errors) => {
  const store = resolve(artifactRoot, "node_modules", ".pnpm");
  const storeStatus = await safeStatus(store);
  if (!storeStatus) return [];
  if (!storeStatus.isDirectory() || storeStatus.isSymbolicLink()) {
    errors.push(ERROR.storeInvalid);
    return [];
  }
  let canonicalStore;
  try {
    canonicalStore = await realpath(store);
  } catch {
    errors.push(ERROR.storeInvalid);
    return [];
  }
  if (!isContained(artifactRoot, canonicalStore)) {
    errors.push(ERROR.storeEscape);
    return [];
  }

  const roots = [];
  for (const entry of await readdir(canonicalStore, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const scope = resolve(canonicalStore, entry.name, "node_modules", "@ai-crm");
    const scopeStatus = await safeStatus(scope);
    if (!scopeStatus) continue;
    if (!scopeStatus.isDirectory() || scopeStatus.isSymbolicLink()) {
      errors.push(ERROR.scopeInvalid);
      continue;
    }
    let canonicalScope;
    try {
      canonicalScope = await realpath(scope);
    } catch {
      errors.push(ERROR.scopeInvalid);
      continue;
    }
    if (!isContained(artifactRoot, canonicalScope) || !isContained(canonicalStore, canonicalScope)) {
      errors.push(ERROR.scopeInvalid);
      continue;
    }
    for (const packageEntry of await readdir(canonicalScope, { withFileTypes: true })) {
      const packageRoot = resolve(canonicalScope, packageEntry.name);
      if (!packageEntry.isDirectory() && !packageEntry.isSymbolicLink()) {
        errors.push(ERROR.packageRootInvalid);
        continue;
      }
      let canonicalPackageRoot;
      try {
        canonicalPackageRoot = await realpath(packageRoot);
      } catch {
        errors.push(ERROR.packageRootInvalid);
        continue;
      }
      if (!isContained(artifactRoot, canonicalPackageRoot) || !isContained(canonicalStore, canonicalPackageRoot)) {
        errors.push(ERROR.packageRootEscape);
        continue;
      }
      const targetStatus = await lstat(canonicalPackageRoot);
      if (!targetStatus.isDirectory() || targetStatus.isSymbolicLink()) {
        errors.push(ERROR.packageRootInvalid);
        continue;
      }
      roots.push(canonicalPackageRoot);
    }
  }
  return [...new Set(roots)].sort();
};

const inspectSymlink = async (artifactRoot, path, errors) => {
  let target;
  try {
    target = await realpath(path);
  } catch {
    errors.push(ERROR.linkUnresolved);
    return;
  }
  if (!isContained(artifactRoot, target)) {
    errors.push(ERROR.linkEscape);
  }
};

const walkOwnedRoot = async ({ artifactRoot, ownedRoot, clean, errors, removed }) => {
  const visit = async (path) => {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      const candidate = resolve(path, entry.name);
      if (!isContained(artifactRoot, candidate) || !isContained(ownedRoot, candidate)) {
        errors.push(ERROR.pathEscape);
        continue;
      }
      const status = await lstat(candidate);
      const isDirectory = status.isDirectory() && !status.isSymbolicLink();
      if (forbidden(entry.name)) {
        if (clean) {
          const parent = await realpath(dirname(candidate));
          if (!isContained(artifactRoot, parent) || !isContained(ownedRoot, parent)) {
            errors.push(ERROR.removeEscape);
            continue;
          }
          await rm(candidate, { force: true, recursive: isDirectory });
          removed.push(normalizedRelative(artifactRoot, candidate));
        } else {
          errors.push(`${ERROR.forbiddenPath}:${normalizedRelative(artifactRoot, candidate)}`);
        }
        continue;
      }
      if (status.isSymbolicLink()) {
        await inspectSymlink(artifactRoot, candidate, errors);
        continue;
      }
      if (isDirectory) await visit(candidate);
    }
  };
  await visit(ownedRoot);
};

const inspectArtifact = async (artifactRootArgument, clean) => {
  const artifactRoot = await assertArtifactRoot(artifactRootArgument);
  const errors = [];
  const removed = [];
  const workspaceRoots = await discoverWorkspaceRoots(artifactRoot, errors);
  if (workspaceRoots.length === 0) errors.push(ERROR.noWorkspaceRoots);
  await walkOwnedRoot({ artifactRoot, ownedRoot: artifactRoot, clean, errors, removed });
  for (const ownedRoot of workspaceRoots) {
    await walkOwnedRoot({ artifactRoot, ownedRoot, clean, errors, removed });
  }
  return { artifactRoot, errors: [...new Set(errors)], removed: [...new Set(removed)].sort(), workspaceRoots };
};

export const verifyApplicationArtifactHygiene = (artifactRoot) => inspectArtifact(artifactRoot, false);

export const sanitizeApplicationArtifact = async (artifactRoot) => {
  const cleaned = await inspectArtifact(artifactRoot, true);
  if (cleaned.errors.length > 0) return cleaned;
  const verified = await inspectArtifact(artifactRoot, false);
  return { ...verified, removed: cleaned.removed };
};
