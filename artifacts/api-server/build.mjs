import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function patchPinoWorkerPaths(appPath) {
  const source = await readFile(appPath, "utf8");
  const patched = source.replace(
    /const outputDir = "[^"]*";/,
    "const outputDir = globalThis.__dirname;",
  );
  if (patched === source) {
    throw new Error(
      "deploy staging failed: esbuild-plugin-pino outputDir string not found in app.mjs",
    );
  }
  await writeFile(appPath, patched);
}

async function stageDeployBundle(distDir) {
  const deployDir = path.resolve(artifactDir, "deploy");
  await rm(deployDir, { recursive: true, force: true });
  await mkdir(deployDir, { recursive: true });

  const staged = [];
  for (const file of await readdir(distDir)) {
    const isApp = file === "app.mjs";
    const isWorker =
      file.startsWith("pino-") || file.startsWith("thread-stream-");
    if ((!isApp && !isWorker) || file.endsWith(".map")) continue;
    await cp(path.join(distDir, file), path.join(deployDir, file));
    staged.push(file);
  }

  if (!staged.includes("app.mjs")) {
    throw new Error("deploy staging failed: dist/app.mjs missing");
  }

  await patchPinoWorkerPaths(path.join(deployDir, "app.mjs"));
  console.log(`Staged deploy bundle: ${staged.join(", ")}`);
}

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: {
      index: path.resolve(artifactDir, "src/index.ts"),
      app: path.resolve(artifactDir, "src/app.ts"),
    },
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "@kronsdk/kron-sdk",
      "@kronsdk/kron-sdk/*",
      "*.node",
      "kaspa-wasm",   // Node.js-only CJS WASM module; must stay external so __dirname resolves correctly
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  await stageDeployBundle(distDir);
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
