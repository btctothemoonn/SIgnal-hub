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
} finally {rmSync(root,{recursive:true,force:true});}
