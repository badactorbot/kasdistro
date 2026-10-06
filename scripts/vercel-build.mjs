process.env.PORT ||= "22434";
process.env.BASE_PATH ||= "/";

const { spawnSync } = await import("node:child_process");

const apiBuild = spawnSync(
  "pnpm",
  ["--filter", "@workspace/api-server", "run", "build"],
  {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  },
);

if ((apiBuild.status ?? 1) !== 0) {
  process.exit(apiBuild.status ?? 1);
}

const result = spawnSync(
  "pnpm",
  ["--filter", "@workspace/kaspa-disperse", "run", "build"],
  {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  },
);

process.exit(result.status ?? 1);
