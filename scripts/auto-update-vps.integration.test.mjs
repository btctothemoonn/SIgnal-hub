import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

if(process.platform!=="linux") {
  console.log("skip - auto update integration requires Linux flock and timeout");
  process.exit(0);
}
const source=readFileSync(new URL("./auto-update-vps.sh",import.meta.url),"utf8");
const root=mkdtempSync(join(tmpdir(),"signal-auto-test-"));
try {
  const app=join(root,"app"), current=join(root,"current"), bin=join(root,"bin"), calls=join(root,"calls");
  mkdirSync(join(app,"scripts"),{recursive:true}); mkdirSync(bin);
  const git=(...args)=>{
    const result=spawnSync("git",args,{cwd:app,encoding:"utf8"});
    assert.equal(result.status,0,result.stderr); return result.stdout.trim();
  };
  git("init","-b","main","-q");
  git("config","user.name","Updater Test"); git("config","user.email","test@example.invalid");
  writeFileSync(join(app,"scripts/auto-update-vps.sh"),source);
  writeFileSync(join(app,"scripts/deploy-vps.sh"),`#!/usr/bin/env bash
set -euo pipefail
echo called >> "$TEST_CALLS"
[[ "$TEST_RESULT" != "failure" ]] || exit 9
[[ "$TEST_RESULT" != "busy" ]] || exit 75
git rev-parse HEAD > "$SIGNAL_HUB_CURRENT_LINK/.release-commit"
`);
  git("add","scripts"); git("commit","-qm","base");
  const base=git("rev-parse","HEAD"), old=join(root,base.slice(0,7)+"-old");
  mkdirSync(old); symlinkSync(old,current);
  git("remote","add","origin",app);
  writeFileSync(join(bin,"df"),'#!/usr/bin/env bash\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 100000000 1000000 ${TEST_DISK_KIB} 1%% /\\n"\n',{mode:0o755});
  const run=(result="success",disk="20000000",holdLock=false)=>spawnSync("bash",holdLock?
    ["-c",'flock "$SIGNAL_HUB_APP_DIR/.signal-hub-auto-update.lock" bash scripts/auto-update-vps.sh']:["scripts/auto-update-vps.sh"],{
      cwd:app,encoding:"utf8",timeout:15000,env:{...process.env,PATH:`${bin}:${process.env.PATH}`,SIGNAL_HUB_APP_DIR:app,SIGNAL_HUB_CURRENT_LINK:current,TEST_CALLS:calls,TEST_RESULT:result,TEST_DISK_KIB:disk},
    });
  const count=()=>existsSync(calls)?readFileSync(calls,"utf8").trim().split("\n").length:0;
  let result=run(); assert.equal(result.status,0,result.stderr); assert.match(result.stdout,/no build/); assert.equal(count(),0);
  git("commit","--allow-empty","-qm","new version");
  result=run("success","20000000",true); assert.equal(result.status,0); assert.match(result.stdout,/already running/); assert.equal(count(),0);
  result=run("success","1000"); assert.equal(result.status,1); assert.equal(count(),0);
  result=run("failure"); assert.equal(result.status,9,result.stderr); assert.equal(count(),1);
  result=run(); assert.equal(result.status,0); assert.match(result.stdout,/Previously failed/); assert.equal(count(),1);
  git("commit","--allow-empty","-qm","fixed version");
  result=run("busy"); assert.equal(result.status,0); assert.match(result.stdout,/Manual deployment/); assert.equal(count(),2);
  assert.equal(existsSync(join(app,".signal-hub-auto-update-attempt")),false);
  result=run(); assert.equal(result.status,0,result.stderr); assert.equal(count(),3);
  assert.equal(readFileSync(join(current,".release-commit"),"utf8").trim(),git("rev-parse","HEAD"));
  result=run(); assert.equal(result.status,0); assert.match(result.stdout,/no build/); assert.equal(count(),3);
  git("commit","--allow-empty","-qm","next version");
  writeFileSync(join(app,"scripts/deploy-vps.sh"),"local changes");
  result=run(); assert.equal(result.status,1); assert.match(result.stderr,/Tracked local changes/); assert.equal(count(),3);
  console.log("ok - unchanged skip, legacy release, update, retry suppression, busy lock, low disk, local edits and next commit recovery");

  // Separate real repositories reproduce private VPS commits and newer GitHub commits.
  const makeHistoryFixture=(name)=>{
    const directory=join(root,name), app=join(directory,"app"), remote=join(directory,"remote.git"), current=join(directory,"current"), calls=join(directory,"calls");
    mkdirSync(join(app,"scripts"),{recursive:true});
    const gitAt=(cwd,...args)=>{
      const result=spawnSync("git",args,{cwd,encoding:"utf8"});
      assert.equal(result.status,0,result.stderr); return result.stdout.trim();
    };
    const git=(...args)=>gitAt(app,...args);
    git("init","-b","main","-q");
    git("config","user.name","Updater Test"); git("config","user.email","test@example.invalid");
    writeFileSync(join(app,"scripts/auto-update-vps.sh"),source);
    writeFileSync(join(app,"scripts/deploy-vps.sh"),`#!/usr/bin/env bash
set -euo pipefail
echo called >> "$TEST_CALLS"
git pull --ff-only origin main
git rev-parse HEAD > "$SIGNAL_HUB_CURRENT_LINK/.release-commit"
`);
    git("add","scripts"); git("commit","-qm","base");
    const base=git("rev-parse","HEAD");
    gitAt(directory,"init","--bare","-q",remote);
    git("remote","add","origin",remote); git("push","-q","origin","main");
    const release=join(directory,"release"); mkdirSync(release); symlinkSync(release,current);
    writeFileSync(join(release,".release-commit"),`${base}\n`);
    const run=()=>spawnSync("bash",["scripts/auto-update-vps.sh"],{
      cwd:app,encoding:"utf8",timeout:15000,env:{...process.env,PATH:`${bin}:${process.env.PATH}`,SIGNAL_HUB_APP_DIR:app,SIGNAL_HUB_CURRENT_LINK:current,TEST_CALLS:calls,TEST_DISK_KIB:"20000000"},
    });
    const remoteCommit=()=>{
      const producer=join(directory,"producer");
      gitAt(directory,"clone","--no-local","--branch","main","-q",remote,producer);
      gitAt(producer,"config","user.name","Updater Test"); gitAt(producer,"config","user.email","test@example.invalid");
      gitAt(producer,"commit","--allow-empty","-qm","remote update");
      const latest=gitAt(producer,"rev-parse","HEAD"); gitAt(producer,"push","-q","origin","main"); return latest;
    };
    return {app,current,calls,base,git,run,remoteCommit,attempt:join(app,".signal-hub-auto-update-attempt")};
  };

  const ahead=makeHistoryFixture("ahead");
  ahead.git("commit","--allow-empty","-qm","private VPS release");
  const privateRevision=ahead.git("rev-parse","HEAD");
  writeFileSync(join(ahead.current,".release-commit"),`${privateRevision}\n`);
  result=ahead.run(); assert.equal(result.status,0,result.stderr); assert.match(result.stdout,/ahead of GitHub/);
  assert.equal(existsSync(ahead.calls),false,"a newer private VPS release must not be rebuilt");
  assert.equal(existsSync(ahead.attempt),false,"skipped ancestry must not suppress a future update");
  assert.equal(readFileSync(join(ahead.current,".release-commit"),"utf8").trim(),privateRevision);
  console.log("ok - a private VPS descendant is retained without rebuilding or failure suppression");

  const behind=makeHistoryFixture("behind");
  const latest=behind.remoteCommit();
  assert.notEqual(spawnSync("git",["cat-file","-e",`${latest}^{commit}`],{cwd:behind.app,encoding:"utf8"}).status,0,"remote revision must initially be absent");
  result=behind.run(); assert.equal(result.status,0,result.stderr);
  assert.equal(readFileSync(behind.calls,"utf8").trim(),"called");
  assert.equal(readFileSync(join(behind.current,".release-commit"),"utf8").trim(),latest);
  assert.equal(behind.git("rev-parse","HEAD"),latest);
  assert.equal(existsSync(behind.attempt),false);
  console.log("ok - an absent remote descendant is fetched and deployed successfully");

  const diverged=makeHistoryFixture("diverged");
  diverged.git("commit","--allow-empty","-qm","private VPS release");
  const localRevision=diverged.git("rev-parse","HEAD");
  writeFileSync(join(diverged.current,".release-commit"),`${localRevision}\n`);
  diverged.remoteCommit();
  result=diverged.run(); assert.equal(result.status,1,result.stderr); assert.match(result.stderr,/diverged/i);
  assert.equal(existsSync(diverged.calls),false,"diverged histories must not reach deployment");
  assert.equal(existsSync(diverged.attempt),false,"divergence must not create a failed-build marker");
  assert.equal(diverged.git("rev-parse","HEAD"),localRevision);
  assert.equal(readFileSync(join(diverged.current,".release-commit"),"utf8").trim(),localRevision);
  console.log("ok - diverged histories refuse deployment and preserve the active release");

  const unknown=makeHistoryFixture("unknown-active");
  writeFileSync(join(unknown.current,".release-commit"),`${"1".repeat(40)}\n`);
  result=unknown.run(); assert.equal(result.status,1,result.stderr); assert.match(result.stderr,/active.*commit.*unavailable/i);
  assert.equal(existsSync(unknown.calls),false);
  assert.equal(existsSync(unknown.attempt),false);
  console.log("ok - an unavailable active revision refuses deployment without a failed-build marker");
} finally {rmSync(root,{recursive:true,force:true});}
