/**
 * Build Vercel Build Output from compiled dist/
 *
 * Vercel's @vercel/node uses ts.transpileModule which does not rewrite
 * TypeScript path aliases (@/...), so source .ts files cannot be used
 * directly. Instead, we package our tsc + tsc-alias output (which has
 * paths already rewritten to relative imports) into the Build Output API
 * structure that `vercel deploy --prebuilt` consumes.
 *
 * Uses @vercel/nft to trace all dependencies (including node_modules)
 * for each function entry point.
 *
 * Usage: node .github/vercel/build-vercel.mjs
 */

import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  rm,
} from "node:fs/promises";
import { join, dirname, relative, resolve, sep } from "node:path";
import { nodeFileTrace } from "@vercel/nft";

const DIST = "dist";
const OUTPUT = ".vercel/output";

const ENTRY_POINTS = [
  { src: "api/webhook.js", route: "api/webhook" },
  { src: "api/cron/daily-question.js", route: "api/cron/daily-question" },
];

const RUNTIME = "nodejs22.x";

const projectRoot = resolve(".");
const distRoot = resolve(DIST);

function normalize(p) {
  return p.split(sep).join("/");
}

function insideDir(absFile, dirAbs) {
  const rel = relative(dirAbs, absFile);
  return rel && !rel.startsWith("..") && !relative(dirAbs, absFile).startsWith(sep === "/" ? "../" : "..\\");
}

async function buildFunction(entry, pkgJson) {
  const funcDir = join(OUTPUT, "functions", `${entry.route}.func`);
  await rm(funcDir, { recursive: true, force: true });
  await mkdir(funcDir, { recursive: true });

  const entryAbs = resolve(DIST, entry.src);
  const traceResult = await nodeFileTrace([entryAbs], {
    base: projectRoot,
    processCwd: projectRoot,
    ts: true,
    mixedModules: true,
    moduleSyncCatchall: true,
  });

  let copied = 0;
  for (const relFile of traceResult.fileList) {
    const absFile = resolve(projectRoot, relFile);

    let destRel;
    if (insideDir(absFile, distRoot)) {
      destRel = normalize(relative(distRoot, absFile));
    } else if (insideDir(absFile, join(projectRoot, "node_modules"))) {
      destRel = normalize(relative(projectRoot, absFile));
    } else {
      continue;
    }

    if (destRel.includes("/.bin/")) continue;
    if (destRel.endsWith("/.package-lock.json")) continue;
    if (destRel.includes("/node_modules/.cache/")) continue;

    const destPath = join(funcDir, destRel);
    await mkdir(dirname(destPath), { recursive: true });
    await copyFile(absFile, destPath);
    copied++;
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

  return copied;
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
    const count = await buildFunction(entry, pkgJson);
    console.log(`  → ${count} files copied`);
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
