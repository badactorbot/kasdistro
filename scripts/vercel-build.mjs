process.env.PORT ||= "22434";
process.env.BASE_PATH ||= "/";

const { spawnSync } = await import("node:child_process");

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
