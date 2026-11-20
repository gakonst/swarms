# A recorded run

This is `npm run example` and `npm test` on a Linux box with Node v26.13.1, using the pinned release, nanocode-ts build-b7a4da2.

The timeline mixes three kinds of line: a worker's own report (`w1` to `w3`), an action by the lead (`lead`), and a phase change the lead saw on the board (`board`). Three moments matter:

- **The kill and takeover.** At +1.461s the lead kills `w1` with SIGKILL while it holds `count-2`. That lease runs out 1.5 s after its last renewal. At +2.895s, `w2` claims `count-2` with `tookOver=true`, and the board counts it as the second attempt.
- **The steer.** At +6.001s the lead steers `report` (event seq 47). The holder heeds it up to seq 47, and the report lists the top 5 words instead of 10.
- **The end.** Every task is done, the lead finishes the goal, and the surviving workers exit.

Which worker gets killed and which one takes over depends on who claims `count-2` first, so those names change from run to run.

```
> example
> node --no-warnings src/lead.ts

timeline
  +0.006s  lead   posted     goal      tasks=7
  +0.007s  lead   claimed    goal      
  +0.044s  board  open       corpus    stage=open attempts=0
  +0.044s  board  open       count-1   stage=open attempts=0
  +0.044s  board  open       count-2   stage=open attempts=0
  +0.044s  board  open       count-3   stage=open attempts=0
  +0.044s  board  open       digest    stage=open attempts=0
  +0.044s  board  claimed    goal      stage=held holder=agent:lead attempts=1
  +0.044s  board  open       merge     stage=open attempts=0
  +0.044s  board  open       report    stage=open attempts=0
  +0.242s  w2     started              
  +0.248s  w2     claimed    corpus    tookOver=false untilMs=1795167671882 attempts=0
  +0.260s  w1     started              
  +0.266s  w3     started              
  +0.348s  board  claimed    corpus    stage=held holder=agent:w2 attempts=1
  +0.754s  w2     renewed    corpus    
  +0.863s  w2     finished   corpus    outcome={"done":"3 shards of 4000 words"} ok=true
  +0.864s  w2     claimed    digest    tookOver=false untilMs=1795167672499 attempts=0
  +0.873s  w1     claimed    count-2   tookOver=false untilMs=1795167672507 attempts=0
  +0.881s  w3     claimed    count-3   tookOver=false untilMs=1795167672513 attempts=0
  +0.955s  board  done       corpus    stage=done attempts=1
  +0.955s  board  claimed    count-2   stage=held holder=agent:w1 attempts=1
  +0.955s  board  claimed    count-3   stage=held holder=agent:w3 attempts=1
  +0.955s  board  claimed    digest    stage=held holder=agent:w2 attempts=1
  +1.369s  w2     renewed    digest    
  +1.379s  w2     finished   digest    outcome={"done":"3 files checksummed"} ok=true
  +1.381s  w2     claimed    count-1   tookOver=false untilMs=1795167673015 attempts=0
  +1.381s  w1     renewed    count-2   
  +1.387s  w3     renewed    count-3   
  +1.461s  board  claimed    count-1   stage=held holder=agent:w2 attempts=1
  +1.461s  board  done       digest    stage=done attempts=1
  +1.461s  lead   killed     count-2   target=w1 signal=SIGKILL
  +1.792s  w3     finished   count-3   outcome={"done":"shard 3: 30 distinct words"} ok=true
  +1.865s  board  done       count-3   stage=done attempts=1
  +1.884s  w2     renewed    count-1   
  +2.289s  w2     finished   count-1   outcome={"done":"shard 1: 30 distinct words"} ok=true
  +2.369s  board  done       count-1   stage=done attempts=1
  +2.895s  w2     claimed    count-2   tookOver=true untilMs=1795167674531 attempts=1
  +2.975s  board  claimed    count-2   stage=held holder=agent:w2 attempts=2
  +3.398s  w2     renewed    count-2   
  +3.902s  w2     renewed    count-2   
  +4.405s  w2     renewed    count-2   
  +4.909s  w2     renewed    count-2   
  +5.313s  w2     finished   count-2   outcome={"done":"shard 2: 30 distinct words"} ok=true
  +5.313s  w2     claimed    merge     tookOver=false untilMs=1795167676949 attempts=0
  +5.395s  board  done       count-2   stage=done attempts=2
  +5.395s  board  claimed    merge     stage=held holder=agent:w2 attempts=1
  +5.817s  w2     renewed    merge     
  +5.927s  w2     finished   merge     outcome={"done":"30 words ranked"} ok=true
  +5.928s  w2     claimed    report    tookOver=false untilMs=1795167677564 attempts=0
  +6.000s  board  done       merge     stage=done attempts=1
  +6.000s  board  claimed    report    stage=held holder=agent:w2 attempts=1
  +6.001s  lead   steered    report    text=List only the top 5 words seq=47
  +6.031s  w2     heeded     report    steers=["List only the top 5 words"] upto=47 ok=true
  +6.434s  w2     renewed    report    
  +6.937s  w2     renewed    report    
  +7.441s  w2     renewed    report    
  +7.944s  w2     renewed    report    
  +7.945s  w2     finished   report    outcome={"done":"report.md lists the top 5 words"} ok=true
  +8.017s  board  done       report    stage=done attempts=1
  +8.017s  lead   finished   goal      outcome={"done":"7 tasks done: corpus (3 shards of 4000 words); count-1 (shard 1: 30 distinct words); count-2 (shard 2: 30 distinct words); count-3 (shard 3: 30 distinct words); digest (3 files checksummed); merge (30 words ranked); report (report.md lists the top 5 words)"}
  +8.040s  w3     exited               
  +8.046s  w2     exited               
  +8.063s  board  done       goal      stage=done attempts=1

summary
{
  "ok": true,
  "goal": "Write a word-frequency report over a generated payments corpus",
  "elapsedMs": 8064,
  "leaseMs": 1500,
  "db": "~/swarms/examples/board-swarm/output/run/board.db",
  "root": {
    "id": "goal",
    "phase": "done",
    "by": "lead",
    "attempts": 1,
    "outcome": "7 tasks done: corpus (3 shards of 4000 words); count-1 (shard 1: 30 distinct words); count-2 (shard 2: 30 distinct words); count-3 (shard 3: 30 distinct words); digest (3 files checksummed); merge (30 words ranked); report (report.md lists the top 5 words)"
  },
  "tasks": [
    {
      "id": "corpus",
      "phase": "done",
      "by": "w2",
      "attempts": 1,
      "outcome": "3 shards of 4000 words"
    },
    {
      "id": "count-1",
      "phase": "done",
      "by": "w2",
      "attempts": 1,
      "outcome": "shard 1: 30 distinct words"
    },
    {
      "id": "count-2",
      "phase": "done",
      "by": "w2",
      "attempts": 2,
      "outcome": "shard 2: 30 distinct words"
    },
    {
      "id": "count-3",
      "phase": "done",
      "by": "w3",
      "attempts": 1,
      "outcome": "shard 3: 30 distinct words"
    },
    {
      "id": "digest",
      "phase": "done",
      "by": "w2",
      "attempts": 1,
      "outcome": "3 files checksummed"
    },
    {
      "id": "merge",
      "phase": "done",
      "by": "w2",
      "attempts": 1,
      "outcome": "30 words ranked"
    },
    {
      "id": "report",
      "phase": "done",
      "by": "w2",
      "attempts": 1,
      "outcome": "report.md lists the top 5 words"
    }
  ],
  "allDone": true,
  "killed": {
    "worker": "w1",
    "task": "count-2",
    "atMs": 1795167671597
  },
  "takeover": {
    "task": "count-2",
    "by": "w2",
    "tookOver": true,
    "afterKillMs": 1434
  },
  "steer": {
    "task": "report",
    "text": "List only the top 5 words",
    "seq": 47,
    "heededBy": "w2",
    "heededUpto": 47,
    "finishedBy": "w2",
    "reportTop": 5
  },
  "workers": [
    {
      "name": "w1",
      "pid": 24826,
      "exit": "SIGKILL"
    },
    {
      "name": "w2",
      "pid": 24832,
      "exit": "code 0"
    },
    {
      "name": "w3",
      "pid": 24840,
      "exit": "code 0"
    }
  ]
}
```

```
$ npm test
✔ the swarm finishes every task, survives a killed worker and heeds a steer (18657.121667ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 18803.550269
```
