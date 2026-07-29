import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import ts from "typescript";

const scriptPath = fileURLToPath(import.meta.url);
const defaultAppRoot = resolve(dirname(scriptPath), "..");
export const h5EntrypointBudgetBytes = 650 * 1024;
export const weappPackageBudgetBytes = 2 * 1024 * 1024;

const forbiddenProductionPatterns = [
  /developmentFixturePort/u,
  /synthetic-boundary/u,
  /synthetic-targets/u,
  /合成边界示例/u,
  /@ai-crm\/api-client(?:["'])/u,
  /internalOperations/u,
  /\/auth\/pc/u,
  /client_secret/u,
  /session_key/u,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/u,
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return nested.flat();
}

function moduleSpecifiers(content, file) {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, false, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const specifiers = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression !== undefined && ts.isStringLiteralLike(node.moduleReference.expression)) {
      specifiers.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return specifiers;
}

function propertyName(node) {
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : undefined;
}

function externalAliasTarget(configSource, configFile) {
  const source = ts.createSourceFile(configFile, configSource, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  let targetIdentifier;
  function findAlias(node) {
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === "@ai-crm/api-client/external" && ts.isIdentifier(node.initializer)) {
      targetIdentifier = node.initializer.text;
    }
    ts.forEachChild(node, findAlias);
  }
  findAlias(source);
  if (targetIdentifier === undefined) throw new Error("External client alias is missing or is not a statically resolved path.");
  let relativeTarget;
  function findDeclaration(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === targetIdentifier &&
      node.initializer !== undefined && ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === "fileURLToPath") {
      const urlCall = node.initializer.arguments[0];
      if (urlCall !== undefined && ts.isNewExpression(urlCall) && ts.isIdentifier(urlCall.expression) &&
        urlCall.expression.text === "URL" && urlCall.arguments?.length === 2 &&
        ts.isStringLiteralLike(urlCall.arguments[0])) relativeTarget = urlCall.arguments[0].text;
    }
    ts.forEachChild(node, findDeclaration);
  }
  findDeclaration(source);
  if (relativeTarget === undefined) throw new Error("External client alias target is not a static file URL.");
  return resolve(dirname(configFile), relativeTarget);
}

function attribute(tag, name) {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, "iu").exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function initialReferences(html) {
  const references = [];
  for (const tag of html.match(/<script\b[^>]*>/giu) ?? []) {
    const source = attribute(tag, "src");
    if (source !== undefined) references.push(source);
  }
  for (const tag of html.match(/<link\b[^>]*>/giu) ?? []) {
    const relation = attribute(tag, "rel")?.toLowerCase().split(/\s+/u) ?? [];
    const href = attribute(tag, "href");
    if (relation.includes("stylesheet") && href !== undefined) references.push(href);
  }
  return [...new Set(references)];
}

async function resolveAsset(root, rootReal, reference) {
  if (reference.includes("\\")) throw new Error(`H5 reference contains a forbidden backslash: ${reference}`);
  let parsed;
  const base = new URL("https://external-portal.invalid/index.html");
  try { parsed = new URL(reference, base); } catch { throw new Error(`H5 reference is invalid: ${reference}`); }
  if (parsed.origin !== base.origin || parsed.username !== "" || parsed.password !== "") throw new Error(`External H5 asset URL is forbidden: ${reference}`);
  let pathname;
  try { pathname = decodeURIComponent(parsed.pathname); } catch { throw new Error(`H5 reference encoding is invalid: ${reference}`); }
  if (pathname.split("/").includes("..")) throw new Error(`H5 reference escapes output: ${reference}`);
  const candidate = resolve(root, `.${pathname}`);
  const candidateRelative = relative(root, candidate);
  if (candidateRelative === "" || candidateRelative === ".." || candidateRelative.startsWith(`..${sep}`) || isAbsolute(candidateRelative)) throw new Error(`H5 reference escapes output: ${reference}`);
  let candidateReal;
  try { candidateReal = await realpath(candidate); } catch { throw new Error(`H5 entrypoint asset is missing: ${reference}`); }
  const realRelative = relative(rootReal, candidateReal);
  if (realRelative === "" || realRelative === ".." || realRelative.startsWith(`..${sep}`) || isAbsolute(realRelative)) throw new Error(`H5 asset resolves outside output: ${reference}`);
  return candidateReal;
}

async function scanProductionFiles(files, appRoot) {
  const sourceMaps = files.filter((file) => file.endsWith(".map"));
  if (sourceMaps.length > 0) throw new Error(`Production source maps are forbidden: ${sourceMaps.map((file) => relative(appRoot, file)).join(", ")}`);
  for (const file of files.filter((candidate) => /\.(?:js|json|html|wxml|wxss)$/u.test(candidate))) {
    const content = await readFile(file, "utf8");
    const pattern = forbiddenProductionPatterns.find((candidate) => candidate.test(content));
    if (pattern !== undefined) throw new Error(`Forbidden external artifact content ${String(pattern)} in ${relative(appRoot, file)}`);
  }
}

export async function checkArtifacts({ appRoot = defaultAppRoot, h5BudgetBytes = h5EntrypointBudgetBytes, weappBudgetBytes = weappPackageBudgetBytes } = {}) {
  const sourceFiles = await walk(join(appRoot, "src"));
  for (const file of sourceFiles.filter((candidate) => /\.[cm]?[jt]sx?$/u.test(candidate))) {
    const content = await readFile(file, "utf8");
    const clientImports = moduleSpecifiers(content, file).filter((specifier) => specifier === "@ai-crm/api-client" || specifier.startsWith("@ai-crm/api-client/"));
    if (clientImports.some((specifier) => specifier !== "@ai-crm/api-client/external")) throw new Error(`External source imports a non-allowlisted API client: ${relative(appRoot, file)}`);
  }
  const configFile = join(appRoot, "config", "index.ts");
  const configSource = await readFile(configFile, "utf8");
  const configuredExternalClient = await realpath(externalAliasTarget(configSource, configFile));
  const reviewedExternalClient = await realpath(resolve(appRoot, "../../packages/api-client/src/external.ts"));
  if (configuredExternalClient !== reviewedExternalClient) {
    throw new Error("External client alias must resolve only to the generated external allowlist source.");
  }

  const h5Root = await realpath(join(appRoot, "dist", "h5"));
  const weappRoot = await realpath(join(appRoot, "dist", "weapp"));
  const h5Files = await walk(h5Root);
  const weappFiles = await walk(weappRoot);
  await scanProductionFiles([...h5Files, ...weappFiles], appRoot);

  const html = await readFile(join(h5Root, "index.html"), "utf8");
  if (!/<meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex/iu.test(html) || !/<meta\s+name=["']referrer["'][^>]*content=["']no-referrer["']/iu.test(html)) {
    throw new Error("External H5 index must fail closed for indexing and referrer disclosure.");
  }
  const references = initialReferences(html);
  if (!references.some((reference) => new URL(reference, "https://external-portal.invalid/").pathname.endsWith(".js"))) throw new Error("H5 index has no initial JavaScript entrypoint.");
  if (!references.some((reference) => new URL(reference, "https://external-portal.invalid/").pathname.endsWith(".css"))) throw new Error("H5 index has no initial stylesheet entrypoint.");
  const resolved = await Promise.all(references.map((reference) => resolveAsset(h5Root, h5Root, reference)));
  const entrypointFiles = [...new Set(resolved)];
  const h5EntrypointBytes = (await Promise.all(entrypointFiles.map(async (file) => (await stat(file)).size))).reduce((sum, size) => sum + size, 0);
  if (h5EntrypointBytes > h5BudgetBytes) throw new Error(`External H5 entrypoint is ${h5EntrypointBytes} bytes; budget is ${h5BudgetBytes} bytes.`);

  for (const required of ["app.js", "app.json"]) {
    if (!weappFiles.some((file) => relative(weappRoot, file).replaceAll("\\", "/") === required)) throw new Error(`Weapp artifact is missing ${required}.`);
  }
  const appJson = JSON.parse(await readFile(join(weappRoot, "app.json"), "utf8"));
  if (typeof appJson === "object" && appJson !== null && ("permission" in appJson || "requiredPrivateInfos" in appJson)) throw new Error("Weapp artifact requests an unapproved private capability.");
  const weappBytes = (await Promise.all(weappFiles.map(async (file) => (await stat(file)).size))).reduce((sum, size) => sum + size, 0);
  if (weappBytes > weappBudgetBytes) throw new Error(`External weapp package is ${weappBytes} bytes; budget is ${weappBudgetBytes} bytes.`);
  return { h5EntrypointBytes, weappBytes };
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await checkArtifacts();
  process.stdout.write(`External portal artifacts passed (H5 ${result.h5EntrypointBytes}/${h5EntrypointBudgetBytes}; weapp ${result.weappBytes}/${weappPackageBudgetBytes} bytes).\n`);
}
