import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");
const errors = [];
const warnings = [];
const pending = [];
const ok = [];

const read = (path) => readFileSync(resolve(root, path), "utf8");
const exists = (path) => existsSync(resolve(root, path));

function tomlValue(toml, key) {
  const match = toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"));
  return match?.[1]?.trim() ?? "";
}

function gitRemote() {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

function githubRepoFromRemote(remote) {
  if (!remote) {
    return "";
  }

  const ssh = remote.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) {
    return `${ssh[1]}/${ssh[2]}`;
  }

  const https = remote.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (https) {
    return `${https[1]}/${https[2]}`;
  }

  return "";
}

if (!exists("package.json")) {
  errors.push("Missing package.json.");
} else {
  const pkg = JSON.parse(read("package.json"));
  for (const script of ["build", "deploy:web", "deploy:worker", "sync:prompt"]) {
    if (pkg.scripts?.[script]) {
      ok.push(`package script exists: ${script}`);
    } else {
      errors.push(`Missing package script: ${script}`);
    }
  }
}

if (!exists("apps/worker/wrangler.toml")) {
  errors.push("Missing apps/worker/wrangler.toml.");
} else {
  const wrangler = read("apps/worker/wrangler.toml");
  const provider = tomlValue(wrangler, "AI_PROVIDER") || "openai";
  const openaiModel = tomlValue(wrangler, "OPENAI_MODEL");
  const githubRepo = tomlValue(wrangler, "GITHUB_REPO");
  const githubBranch = tomlValue(wrangler, "GITHUB_BRANCH");
  const dryRun = tomlValue(wrangler, "DRY_RUN");
  const remoteRepo = githubRepoFromRemote(gitRemote());

  if (provider === "openai") {
    ok.push("AI provider is OpenAI.");
    pending.push("Set Cloudflare secret OPENAI_API_KEY.");
  } else if (provider === "workers-ai") {
    warnings.push("AI_PROVIDER is workers-ai; add an [ai] binding before deploying this mode.");
  } else {
    errors.push(`Unsupported AI_PROVIDER: ${provider || "(empty)"}.`);
  }

  if (openaiModel) {
    ok.push(`OpenAI model configured: ${openaiModel}`);
  } else {
    errors.push("OPENAI_MODEL is missing.");
  }

  if (!githubRepo || githubRepo === "owner/repo") {
    if (remoteRepo) {
      pending.push(`Set GITHUB_REPO in apps/worker/wrangler.toml to ${remoteRepo}.`);
    } else {
      pending.push("Set GITHUB_REPO in apps/worker/wrangler.toml to your GitHub owner/repo.");
    }
  } else {
    ok.push(`GitHub target configured: ${githubRepo}`);
    if (remoteRepo && githubRepo !== remoteRepo) {
      warnings.push(`GITHUB_REPO (${githubRepo}) differs from git origin (${remoteRepo}).`);
    }
  }

  if (githubBranch) {
    ok.push(`GitHub branch configured: ${githubBranch}`);
  } else {
    errors.push("GITHUB_BRANCH is missing.");
  }

  if (dryRun === "false") {
    pending.push("Set Cloudflare secret GITHUB_TOKEN before real publishing.");
  } else {
    warnings.push("DRY_RUN is not false; scheduled runs will not commit generated articles.");
  }

  pending.push("Set Cloudflare secret CRON_SECRET for manual /run requests.");
}

if (exists("apps/worker/.dev.vars")) {
  ok.push("Local Worker secret file exists: apps/worker/.dev.vars");
} else {
  pending.push("For local Worker dry runs, copy apps/worker/.dev.vars.example to apps/worker/.dev.vars and fill local values.");
}

if (!exists("apps/worker/.dev.vars.example")) {
  errors.push("Missing apps/worker/.dev.vars.example.");
}

console.log("Predeploy check");
console.log("===============");
for (const message of ok) {
  console.log(`OK: ${message}`);
}
for (const message of warnings) {
  console.log(`WARN: ${message}`);
}
for (const message of pending) {
  console.log(`USER: ${message}`);
}
for (const message of errors) {
  console.log(`ERROR: ${message}`);
}

if (errors.length > 0 || (strict && pending.length > 0)) {
  process.exitCode = 1;
}
