import { execFile, spawn } from "node:child_process";
import { appendFile, cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const execFileAsync = promisify(execFile);
const { values } = parseArgs({ options: { "checked-sha": { type: "string" } } });
const root = process.cwd();
const branch = process.env.GITHUB_REF_NAME;
const environment = { main: "production", staging: "staging" }[branch];
const repository = process.env.GITHUB_REPOSITORY;
const cliPackage = "@insforge/cli@0.2.8";
const failureStates = new Set(["ERROR", "CANCELED", "CANCELLED", "FAILED"]);
const secrets = [process.env.INSFORGE_API_KEY, process.env.GITHUB_TOKEN].filter(Boolean);
let workspace;

function redact(value) {
  return secrets.reduce((text, secret) => text.replaceAll(secret, "[redacted]"), String(value));
}

async function capture(command, args, cwd = root) {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      env: process.env,
      timeout: 10 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return result.stdout.trim();
  } catch (error) {
    const detail = error.stderr || error.stdout || `exit ${error.code ?? "unknown"}`;
    throw new Error(`${path.basename(command)} failed. ${redact(detail).slice(0, 2000)}`);
  }
}

async function runCheck(args) {
  await new Promise((resolve, reject) => {
    const child = spawn("npm", args, { cwd: root, env: process.env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`npm ${args.join(" ")} failed with exit ${code}.`)));
  });
}

async function cli(args) {
  const output = await capture("npx", ["-y", cliPackage, ...args, "--json", "--yes"], workspace);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`InsForge ${args.slice(0, 2).join(" ")} did not return valid JSON.`);
  }
}

async function branchIsCurrent(sha) {
  const apiBase = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const response = await fetch(`${apiBase}/repos/${repository}/git/ref/heads/${branch}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Could not verify the branch head (GitHub HTTP ${response.status}).`);
  const head = await response.json();
  if (typeof head.object?.sha !== "string") throw new Error("GitHub did not return the branch commit.");
  return head.object.sha === sha;
}

async function waitForDeployment(initial, deadline) {
  if (!initial.id) throw new Error("InsForge did not return a deployment ID.");
  let deployment = initial;
  while (Date.now() < deadline) {
    const status = String(deployment.status).toUpperCase();
    if (failureStates.has(status)) throw new Error(`Deployment ${deployment.id} ended with status ${status}.`);
    if (status === "READY") return deployment;
    await delay(5000);
    deployment = await cli(["deployments", "status", initial.id, "--sync"]);
  }
  throw new Error(`Deployment ${initial.id} timed out before reaching READY.`);
}

function publicUrl(value) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password) {
    throw new Error("InsForge returned an invalid deployment URL.");
  }
  return url;
}

async function stableDeploymentUrl(deploymentId) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const metadata = await cli(["deployments", "metadata"]);
    if (metadata.currentDeploymentId === deploymentId && metadata.defaultDomainUrl) {
      return publicUrl(metadata.defaultDomainUrl).href;
    }
    await delay(3000);
  }
  throw new Error("The stable managed URL does not reference this deployment.");
}

async function verifyHealth(base, sha, questionCount) {
  const url = new URL("/api/health", base);
  url.searchParams.set("deployment", sha);
  const deadline = Date.now() + 120_000;
  let observed = "unavailable";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(10_000),
      });
      const health = await response.json();
      if (response.ok && health.ok === true && health.questionCount === questionCount &&
          health.commitSha === sha && health.environment === environment) return;
      observed = JSON.stringify({
        status: response.status, questionCount: health.questionCount,
        environment: health.environment, commitSha: health.commitSha,
      });
    } catch {
      observed = "unreachable";
    }
    await delay(3000);
  }
  throw new Error(`Stable URL health did not match ${environment} commit ${sha}. Observed ${observed}.`);
}

async function deploy() {
  if (!environment || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) {
    throw new Error("Deploy from the main or staging GitHub branch with GITHUB_REPOSITORY configured.");
  }
  const sha = await capture("git", ["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("The source commit is invalid.");
  if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== sha) throw new Error("Checkout does not match the workflow commit.");
  if (!(await branchIsCurrent(sha))) {
    console.log("A newer commit is on this branch. Skipping this deployment.");
    return;
  }
  const dirty = await capture("git", ["status", "--porcelain", "--untracked-files=all"]);
  if (dirty) throw new Error("Commit all source changes before deploying.");
  if (values["checked-sha"]) {
    if (process.env.GITHUB_ACTIONS !== "true" || values["checked-sha"] !== sha) {
      throw new Error("The successful checks must belong to this exact GitHub Actions commit.");
    }
  } else {
    await runCheck(["run", "build:vercel"]);
    await runCheck(["run", "typecheck"]);
    await runCheck(["test"]);
  }
  if (!(await branchIsCurrent(sha))) {
    console.log("A newer commit arrived during checks. Skipping this deployment.");
    return;
  }

  const apiUrl = process.env.INSFORGE_URL;
  const apiKey = process.env.INSFORGE_API_KEY;
  if (!apiUrl || !apiKey) throw new Error("Configure the environment's INSFORGE_URL and INSFORGE_API_KEY secrets.");
  publicUrl(apiUrl);
  workspace = await mkdtemp(path.join(tmpdir(), "feud-insforge-"));
  await cp(path.join(root, "migrations"), path.join(workspace, "migrations"), { recursive: true });
  await cli(["link", "--api-base-url", apiUrl, "--api-key", apiKey]);
  if (!(await branchIsCurrent(sha))) {
    console.log("A newer commit arrived before database preparation. Skipping this deployment.");
    return;
  }
  const files = (await readdir(path.join(workspace, "migrations"))).filter((file) => file.endsWith(".sql")).sort();
  const baselineVersion = files[0]?.split("_")[0];
  const history = await cli(["db", "migrations", "list"]);
  if (!baselineVersion || !Array.isArray(history.migrations)) throw new Error("The database migration history is unavailable.");
  if (!history.migrations.some((migration) => migration.version === baselineVersion)) {
    const tables = await cli(["db", "tables"]);
    if (!Array.isArray(tables)) throw new Error("The database table list is unavailable.");
    if (tables.some((table) => ["rooms", "rate_limits", "question_bank"].includes(table))) {
      throw new Error("An existing Feud schema has no baseline migration record. Register its verified baseline before enabling deployment.");
    }
  }
  console.log("Applying pending database migrations through the native migration ledger.");
  await cli(["db", "migrations", "up", "--all"]);
  console.log("Importing the validated question bank.");
  const imported = JSON.parse(await capture(process.execPath, ["--experimental-strip-types", "scripts/seed-insforge.ts"]));
  if (!Number.isInteger(imported.imported) || imported.imported < 1 || imported.imported !== imported.stored) {
    throw new Error("The question bank import did not confirm its stored count.");
  }
  if (!(await branchIsCurrent(sha))) {
    console.log("A newer commit arrived before upload. Skipping this deployment.");
    return;
  }
  const deadline = Date.now() + 10 * 60 * 1000;
  const initial = await cli([
    "deployments", "deploy", root,
    "--env", JSON.stringify({ FEUD_COMMIT_SHA: sha, FEUD_ENVIRONMENT: environment }),
    "--meta", JSON.stringify({
      githubCommitSha: sha, githubCommitRef: branch, githubRepository: repository,
      feudEnvironment: environment,
      ...(process.env.INSFORGE_PROJECT_ID ? { insforgeProjectId: process.env.INSFORGE_PROJECT_ID } : {}),
    }),
  ]);
  const deployment = await waitForDeployment(initial, deadline);
  const stableUrl = await stableDeploymentUrl(deployment.id);
  await verifyHealth(stableUrl, sha, imported.stored);
  console.log(`Verified ${environment} commit ${sha} at ${stableUrl}`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `url=${stableUrl}\ndeployment_id=${deployment.id}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `Deployed \`${sha}\` to [${environment}](${stableUrl}). Health confirmed ${imported.stored} rounds.\n`);
  }
}

try {
  await deploy();
} catch (error) {
  console.error(redact(error.message));
  process.exitCode = 1;
} finally {
  if (workspace) await rm(workspace, { recursive: true, force: true });
}
