import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const sha = "a".repeat(40);

async function deploymentFixture(scenario: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "feud-deploy-test-"));
  await mkdir(path.join(directory, "scripts"));
  await mkdir(path.join(directory, "migrations"));
  await mkdir(path.join(directory, "bin"));
  await copyFile(new URL("../scripts/deploy-insforge.mjs", import.meta.url), path.join(directory, "scripts/deploy-insforge.mjs"));
  await writeFile(path.join(directory, "migrations/20261106230944_add-feud-storage.sql"), "SELECT 1;");
  await writeFile(path.join(directory, "scripts/seed-insforge.ts"), 'console.log(JSON.stringify({imported:2000,stored:2000}));');
  await writeFile(path.join(directory, "bin/git"), `#!/usr/bin/env node
console.log(process.argv[2] === "rev-parse" ? "${sha}" : "");
`);
  await writeFile(path.join(directory, "bin/npx"), `#!/usr/bin/env node
const fs=require("node:fs");
const args=process.argv.slice(2);
const command=args.slice(2,5).join(" ");
fs.appendFileSync(process.env.FEUD_TEST_TRACE,command+"\\n");
let result;
if(args[2]==="link") result={success:true};
else if(command==="db migrations list") result={migrations:process.env.FEUD_TEST_SCENARIO==="baseline"?[]:[{version:"20261106230944"}]};
else if(command==="db migrations up") result={appliedMigrations:[]};
else if(args[2]==="db"&&args[3]==="tables") result=["rooms"];
else if(args[2]==="deployments"&&args[3]==="deploy") {
  fs.writeFileSync(process.env.FEUD_TEST_DEPLOY_ENV,args[args.indexOf("--env")+1]);
  result={id:"deployment-1",status:process.env.FEUD_TEST_SCENARIO==="remote-error"?"BUILDING":"READY",timedOut:process.env.FEUD_TEST_SCENARIO==="remote-error"};
}
else if(args[2]==="deployments"&&args[3]==="status") result={id:"deployment-1",status:"ERROR"};
else if(args[2]==="deployments"&&args[3]==="metadata") result={currentDeploymentId:"deployment-1",defaultDomainUrl:process.env.FEUD_TEST_ORIGIN};
else {console.error("unexpected command");process.exit(1);}
console.log(JSON.stringify(result));
`);
  await chmod(path.join(directory, "bin/git"), 0o755);
  await chmod(path.join(directory, "bin/npx"), 0o755);
  let healthRequests = 0;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url?.startsWith("/api/health")) {
      healthRequests += 1;
      response.end(JSON.stringify({
        ok: true, questionCount: 2000, environment: "staging",
        commitSha: scenario === "health-propagation" && healthRequests === 1 ? "b".repeat(40) : sha,
      }));
    } else {
      response.end(JSON.stringify({ object: { sha: scenario === "stale" ? "b".repeat(40) : sha } }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["scripts/deploy-insforge.mjs", "--checked-sha", sha], {
        cwd: directory,
        env: {
          ...process.env,
          PATH: path.join(directory, "bin") + path.delimiter + process.env.PATH,
          GITHUB_ACTIONS: "true", GITHUB_REF_NAME: "staging", GITHUB_REPOSITORY: "owner/game",
          GITHUB_SHA: sha, GITHUB_API_URL: origin, GITHUB_TOKEN: "test-github-key",
          INSFORGE_URL: origin, INSFORGE_API_KEY: "test-insforge-key",
          GITHUB_OUTPUT: path.join(directory, "output"), GITHUB_STEP_SUMMARY: path.join(directory, "summary"),
          FEUD_TEST_SCENARIO: scenario, FEUD_TEST_ORIGIN: origin,
          FEUD_TEST_TRACE: path.join(directory, "trace"), FEUD_TEST_DEPLOY_ENV: path.join(directory, "deploy-env"),
        },
      });
      let output = "";
      child.stdout.on("data", (data) => { output += data; });
      child.stderr.on("data", (data) => { output += data; });
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, output }));
    });
    const trace = await readFile(path.join(directory, "trace"), "utf8").catch(() => "");
    const deploymentEnv = await readFile(path.join(directory, "deploy-env"), "utf8").catch(() => "");
    const outputs = await readFile(path.join(directory, "output"), "utf8").catch(() => "");
    return { ...result, trace, deploymentEnv, outputs, healthRequests };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}

test("deploy confirms the stable URL's exact release after health propagation", async () => {
  const result = await deploymentFixture("health-propagation");
  assert.equal(result.code, 0, result.output);
  assert.equal(result.healthRequests, 2);
  assert.ok(result.trace.indexOf("db migrations up") < result.trace.indexOf("deployments deploy"));
  assert.deepEqual(JSON.parse(result.deploymentEnv), { FEUD_COMMIT_SHA: sha, FEUD_ENVIRONMENT: "staging" });
  assert.match(result.outputs, /deployment_id=deployment-1/);
});

test("a stale branch commit skips all InsForge calls", async () => {
  const result = await deploymentFixture("stale");
  assert.equal(result.code, 0, result.output);
  assert.equal(result.trace, "");
  assert.equal(result.healthRequests, 0);
  assert.match(result.output, /Skipping/);
});

test("CLI timeout with exit zero still fails when the remote build ends in ERROR", async () => {
  const result = await deploymentFixture("remote-error");
  assert.equal(result.code, 1);
  assert.match(result.output, /status ERROR/);
  assert.equal(result.outputs, "");
  assert.equal(result.healthRequests, 0);
});

test("existing Feud tables need a registered baseline before applying migrations", async () => {
  const result = await deploymentFixture("baseline");
  assert.equal(result.code, 1);
  assert.match(result.output, /no baseline migration record/);
  assert.equal(result.trace.includes("db migrations up"), false);
  assert.equal(result.trace.includes("deployments deploy"), false);
});
