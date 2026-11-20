# A recorded run

This is `npm run example` and `npm test` on a Linux box with Node v26.13.1, using the pinned release, nanocode-ts build-b7a4da2.

The timeline mixes three kinds of line: a worker's own report (`w1` to `w3`), an action by the lead (`lead`), and a phase change the lead saw on the board (`board`). Three moments matter:

- **The kill and takeover.** At +1.839s the lead kills `w2` with SIGKILL while it holds `count-2`. That lease runs out 1.5 s after its last renewal. At +3.274s, `w3` claims `count-2` with `tookOver=true`, and the board counts it as the second attempt.
- **The steer.** At +6.386s the lead steers `report` (event seq 48). The holder heeds it up to seq 48, and the report lists the top 5 words instead of 10.
- **The end.** Every task is done, the lead finishes the goal, and the surviving workers exit.

```
> example
> node --no-warnings src/lead.ts

timeline
  +0.003s  lead   posted     goal      tasks=7
  +0.004s  lead   claimed    goal      
  +0.019s  board  open       corpus    stage=open attempts=0
  +0.019s  board  open       count-1   stage=open attempts=0
  +0.019s  board  open       count-2   stage=open attempts=0
  +0.019s  board  open       count-3   stage=open attempts=0
  +0.019s  board  open       digest    stage=open attempts=0
  +0.019s  board  claimed    goal      stage=held holder=agent:lead attempts=1
  +0.019s  board  open       merge     stage=open attempts=0
  +0.019s  board  open       report    stage=open attempts=0
  +0.130s  w1     started              
  +0.132s  w1     claimed    corpus    tookOver=false untilMs=1795165989330 attempts=0
  +0.134s  w3     started              
  +0.147s  w2     started              
  +0.222s  board  claimed    corpus    stage=held holder=agent:w1 attempts=1
  +0.635s  w1     renewed    corpus    
  +0.744s  w1     finished   corpus    outcome={"done":"3 shards of 4000 words"} ok=true
  +0.745s  w1     claimed    count-3   tookOver=false untilMs=1795165989944 attempts=0
  +0.754s  w2     claimed    digest    tookOver=false untilMs=1795165989952 attempts=0
  +0.828s  board  done       corpus    stage=done attempts=1
  +0.828s  board  claimed    count-3   stage=held holder=agent:w1 attempts=1
  +0.828s  board  claimed    digest    stage=held holder=agent:w2 attempts=1
  +0.845s  w3     claimed    count-1   tookOver=false untilMs=1795165990042 attempts=0
  +0.928s  board  claimed    count-1   stage=held holder=agent:w3 attempts=1
  +1.248s  w1     renewed    count-3   
  +1.258s  w2     renewed    digest    
  +1.269s  w2     finished   digest    outcome={"done":"3 files checksummed"} ok=true
  +1.270s  w2     claimed    count-2   tookOver=false untilMs=1795165990468 attempts=0
  +1.333s  board  claimed    count-2   stage=held holder=agent:w2 attempts=1
  +1.333s  board  done       digest    stage=done attempts=1
  +1.351s  w3     renewed    count-1   
  +1.652s  w1     finished   count-3   outcome={"done":"shard 3: 30 distinct words"} ok=true
  +1.738s  board  done       count-3   stage=done attempts=1
  +1.758s  w3     finished   count-1   outcome={"done":"shard 1: 30 distinct words"} ok=true
  +1.773s  w2     renewed    count-2   
  +1.839s  board  done       count-1   stage=done attempts=1
  +1.839s  lead   killed     count-2   target=w2 signal=SIGKILL
  +3.274s  w3     claimed    count-2   tookOver=true untilMs=1795165992472 attempts=1
  +3.355s  board  claimed    count-2   stage=held holder=agent:w3 attempts=2
  +3.778s  w3     renewed    count-2   
  +4.282s  w3     renewed    count-2   
  +4.785s  w3     renewed    count-2   
  +5.288s  w3     renewed    count-2   
  +5.693s  w3     finished   count-2   outcome={"done":"shard 2: 30 distinct words"} ok=true
  +5.694s  w3     claimed    merge     tookOver=false untilMs=1795165994892 attempts=0
  +5.780s  board  done       count-2   stage=done attempts=2
  +5.780s  board  claimed    merge     stage=held holder=agent:w3 attempts=1
  +6.197s  w3     renewed    merge     
  +6.311s  w3     finished   merge     outcome={"done":"30 words ranked"} ok=true
  +6.312s  w3     claimed    report    tookOver=false untilMs=1795165995510 attempts=0
  +6.385s  board  done       merge     stage=done attempts=1
  +6.385s  board  claimed    report    stage=held holder=agent:w3 attempts=1
  +6.386s  lead   steered    report    text=List only the top 5 words seq=48
  +6.415s  w3     heeded     report    steers=["List only the top 5 words"] upto=48 ok=true
  +6.817s  w3     renewed    report    
  +7.321s  w3     renewed    report    
  +7.824s  w3     renewed    report    
  +8.328s  w3     renewed    report    
  +8.329s  w3     finished   report    outcome={"done":"report.md lists the top 5 words"} ok=true
  +8.406s  board  done       report    stage=done attempts=1
  +8.407s  lead   finished   goal      outcome={"done":"7 tasks done: corpus (3 shards of 4000 words); count-1 (shard 1: 30 distinct words); count-2 (shard 2: 30 distinct words); count-3 (shard 3: 30 distinct words); digest (3 files checksummed); merge (30 words ranked); report (report.md lists the top 5 words)"}
  +8.430s  w3     exited               
  +8.502s  w1     exited               
  +8.522s  board  done       goal      stage=done attempts=1

summary
{
  "ok": true,
  "goal": "Write a word-frequency report over a generated payments corpus",
  "elapsedMs": 8522,
  "leaseMs": 1500,
  "db": "~/lanes-swarms/rel/examples/board-swarm/output/run/board.db",
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
      "by": "w1",
      "attempts": 1,
      "outcome": "3 shards of 4000 words"
    },
    {
      "id": "count-1",
      "phase": "done",
      "by": "w3",
      "attempts": 1,
      "outcome": "shard 1: 30 distinct words"
    },
    {
      "id": "count-2",
      "phase": "done",
      "by": "w3",
      "attempts": 2,
      "outcome": "shard 2: 30 distinct words"
    },
    {
      "id": "count-3",
      "phase": "done",
      "by": "w1",
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
      "by": "w3",
      "attempts": 1,
      "outcome": "30 words ranked"
    },
    {
      "id": "report",
      "phase": "done",
      "by": "w3",
      "attempts": 1,
      "outcome": "report.md lists the top 5 words"
    }
  ],
  "allDone": true,
  "killed": {
    "worker": "w2",
    "task": "count-2",
    "atMs": 1795165989538
  },
  "takeover": {
    "task": "count-2",
    "by": "w3",
    "tookOver": true,
    "afterKillMs": 1435
  },
  "steer": {
    "task": "report",
    "text": "List only the top 5 words",
    "seq": 48,
    "heededBy": "w3",
    "heededUpto": 48,
    "finishedBy": "w3",
    "reportTop": 5
  },
  "workers": [
    {
      "name": "w1",
      "pid": 17756,
      "exit": "code 0"
    },
    {
      "name": "w2",
      "pid": 17757,
      "exit": "SIGKILL"
    },
    {
      "name": "w3",
      "pid": 17763,
      "exit": "code 0"
    }
  ]
}
```

```
$ npm test
✔ the swarm finishes every task, survives a killed worker and heeds a steer (18057.687209ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ duration_ms 18134.959893
```
