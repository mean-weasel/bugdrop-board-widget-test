import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDirectory = await mkdtemp(join(repositoryRoot, ".server-runtime-"));
const entrypoints = [
  ["api/board-token.js", "handleBoardToken"],
  ["api/config.js", "handleConfig"],
  ["api/health.js", "handleHealth"],
  ["api/jwks.js", "handleJwks"],
];

try {
  compileServerFunctions(outputDirectory);

  for (const [relativePath, namedExport] of entrypoints) {
    const module = await import(
      pathToFileURL(join(outputDirectory, relativePath)).href
    );
    if (
      typeof module.default !== "function" ||
      typeof module[namedExport] !== "function"
    ) {
      throw new Error(
        `${relativePath} must export default and ${namedExport} handlers`,
      );
    }
  }

  process.stdout.write(
    `Verified compiled Node ESM imports for ${entrypoints.length} API handlers.\n`,
  );
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}

function compileServerFunctions(outputDirectory) {
  const compilerPath = join(repositoryRoot, "node_modules/typescript/bin/tsc");
  const result = spawnSync(
    process.execPath,
    [
      compilerPath,
      "--project",
      join(repositoryRoot, "tsconfig.server.json"),
      "--outDir",
      outputDirectory,
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  if (result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`Server TypeScript compilation exited ${result.status}`);
  }
}
