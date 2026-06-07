/**
 * Build Vercel Build Output from compiled dist/
 *
 * Vercel's @vercel/node uses ts.transpileModule which does not rewrite
 * TypeScript path aliases (@/...), so source .ts files cannot be used
 * directly. Instead, we package our tsc + tsc-alias output (which has
 * paths already rewritten to relative imports) into the Build Output API
 * structure that `vercel deploy --prebuilt` consumes.
 *
 * Usage: node .github/vercel/build-vercel.mjs
 */

import { readFile, writeFile, mkdir, copyFile, stat, rm } from "node:fs/promises";
import { join, dirname, resolve, relative, sep } from "node:path";

const DIST = "dist";
const OUTPUT = ".vercel/output";

const ENTRY_POINTS = [
  { src: "api/webhook.js", route: "api/webhook" },
  { src: "api/cron/daily-question.js", route: "api/cron/daily-question" },
];

const RUNTIME = "nodejs22.x";

const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)(?:\s+[^"';]*?\s+from)?\s*["']([^"']+)["']|(?:^|\n)\s*import\s*\(["']([^"']+)["']\)/g;

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function normalizeSlashes(path) {
  return path.split(sep).join("/");
}

async function resolveImport(fromFile, spec) {
  if (!spec.startsWith(".")) return null;

  const fromDir = dirname(fromFile);
  const base = resolve(DIST, fromDir, spec);

  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}.ts`,
    `${base}.mts`,
    join(base, "index.js"),
    join(base, "index.ts"),
  ];

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return normalizeSlashes(relative(DIST, candidate));
    }
  }
  return null;
}

async function trace(file, traced = new Set()) {
  if (traced.has(file)) return traced;
  traced.add(file);

  const distPath = join(DIST, file);
  if (!(await exists(distPath))) return traced;

  const content = await readFile(distPath, "utf-8");
  const mapFile = file.endsWith(".js") ? `${file}.map` : null;
  if (mapFile && (await exists(join(DIST, mapFile)))) {
    traced.add(mapFile);
  }

  for (const match of content.matchAll(IMPORT_RE)) {
    const spec = match[1] || match[2];
    if (!spec) continue;
    const resolved = await resolveImport(file, spec);
    if (resolved) {
      await trace(resolved, traced);
    }
  }

  return traced;
}

async function buildFunction(entry, pkgJson) {
  const funcDir = join(OUTPUT, "functions", `${entry.route}.func`);
  await rm(funcDir, { recursive: true, force: true });
  await mkdir(funcDir, { recursive: true });

  const files = await trace(entry.src);

  for (const file of files) {
    const src = join(DIST, file);
    const dest = join(funcDir, file);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
  }

  const vcConfig = {
    handler: entry.src,
    runtime: RUNTIME,
    architecture: "x86_64",
    environment: {},
    shouldDisableAutomaticFetchInstrumentation: false,
    launcherType: "Nodejs",
    shouldAddHelpers: true,
    shouldAddSourcemapSupport: true,
    awsLambdaHandler: "",
  };
  await writeFile(
    join(funcDir, ".vc-config.json"),
    JSON.stringify(vcConfig, null, "\t"),
  );

  await writeFile(
    join(funcDir, "package.json"),
    JSON.stringify(pkgJson, null, "\t"),
  );
}

async function main() {
  const vercelConfig = JSON.parse(await readFile("vercel.json", "utf-8"));
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));

  const pkgJson = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    type: pkg.type,
    main: pkg.main,
    dependencies: pkg.dependencies,
    devDependencies: pkg.devDependencies,
    engines: pkg.engines,
  };

  await rm(OUTPUT, { recursive: true, force: true });
  await mkdir(OUTPUT, { recursive: true });

  for (const entry of ENTRY_POINTS) {
    console.log(`Building function: ${entry.route}`);
    await buildFunction(entry, pkgJson);
  }

  const config = {
    version: 3,
    crons: vercelConfig.crons ?? [],
  };
  await writeFile(
    join(OUTPUT, "config.json"),
    JSON.stringify(config, null, "\t"),
  );

  console.log(`\n✓ Built ${ENTRY_POINTS.length} functions in ${OUTPUT}/`);
  console.log("Next: vercel deploy --prebuilt --prod");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
