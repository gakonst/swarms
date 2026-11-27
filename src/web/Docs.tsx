import { site } from './boot.ts'
import { type ReactNode, useState } from 'react'
import * as Site from '../shared/Site.ts'
import * as Limits from '../shared/Limits.ts'


const tools = [
  ['read', 'swarms_list', 'Swarms with their status and money. Filter by status.'],
  ['read', 'swarm_get', 'One swarm: its goal, money and where it stands.'],
  ['read', 'swarm_status', 'A swarm at a glance: status, money, whether it works and its latest update.'],
  ['read', 'swarm_watch', 'Wait, up to a deadline, for the next update, and answer the feed since a cursor.'],
  ['read', 'swarm_logs', 'The newest feed entries: messages, tool calls, commands, money, errors.'],
  ['read', 'swarm_tree', "A swarm's tree: the headline (proven, on the frontier, in flight, dead ends, spent) and its nodes, from any node and to any depth, filtered by status."],
  ['read', 'swarm_node', 'One node: its words and Lean statement, status and why, who proposed it, its riders, what it spent run by run, its updates and, once proven, the checked record.'],
  ['read', 'swarm_proofs', 'Every proof Lean checked, newest first, each with its node, commit, theorem and checker run.'],
  ['read', 'swarm_machines', 'Every machine a swarm used, with its commands, logs and jobs (swarm_machine_*).'],
  ['read', 'swarm_hands', 'The machines riders lent a swarm.'],
  ['read', 'swarms_search', 'Full-text search over titles, goals, nodes and updates.'],
  ['write', 'swarm_create', 'Start a swarm: a title, a goal and a template, or a tree.'],
  ['write', 'swarm_propose', 'Propose a node under a parent: a title, its words and, for a lemma, a Lean statement. Answers the transfer that makes it a node, $1 or more.'],
  ['write', 'swarm_suggest', 'Suggest a node without money. Triage may adopt it, credited to you.'],
  ['write', 'swarm_hand', 'Lend your machine to a swarm: answers the command to run on it.'],
  ['write', 'swarm_byok', 'Your own AI keys and subscriptions (Claude plan, ChatGPT plan, Antigravity), and which swarms run on them.'],
  ['money', 'swarm_contribute', 'Prepares a ride on a node (the address, the memo, call data and a link that sends it), or counts a sent one by its hash (confirm).'],
  ['money', 'swarm_fund', 'Put your backing behind a branch (confirm).'],
  ['money', 'swarm_steer', 'Put your free money on a node with a note its next run reads first.'],
  ['money', 'swarm_move', "Move your money that a node has not spent or set aside for a run to another node, or back to free."],
  ['admin', 'swarm_edit', 'Change a title, picture or nickname (a nickname needs confirm).'],
  ['admin', 'swarm_hand_remove', 'Remove a lent machine (confirm).'],
  ['admin', 'swarm_archive', 'Archive a swarm, as its admin or the operator (confirm).'],
] as const

const commands = [
  ['swarms login · logout · whoami', 'Sign in with Tempo ID in the browser, sign out, and who you are.'],
  ['swarms ls', 'Swarms, most recently active first.'],
  ['swarms new <name>', 'Start a swarm at /<name>: it asks for the goal and how much to ride it with.'],
  ['swarms status <swarm>', 'Its money, its work and its latest update.'],
  ['swarms watch <swarm>', 'Follow it live; logs shows the newest transcript entries.'],
  ['swarms tree <swarm>', "A tree swarm's nodes; ideas add suggests one, free."],
  ['swarms fund <swarm> <usd>', 'Ride it with real money: it asks first, opens Tempo Wallet and waits for the transfer to count.'],
  ['swarms hands ls · add · rm <swarm>', 'Lend it your machine, and take it back; machines lists every machine it uses.'],
  ['swarms edit <swarm> title · slug · pfp', 'As its admin, rename it, move its address or change its picture; archive stops it.'],
  ['swarms open <swarm>', 'Open it in the browser.'],
] as const

const routes = [
  ['GET', '/v1/swarms', 'Swarms, most recently active first.', '?status=<status>'],
  ['GET', '/v1/swarms/live', 'A WebSocket of the list: welcome when it opens, then { type: swarm, swarm } each time a listed swarm changes.', ''],
  ['GET', '/v1/swarms/:id', "The swarm's summary: goal, money, where it stands.", ''],
  ['PATCH', '/v1/swarms/:id', "As its admin or the operator, change the swarm's title, nickname (its page at /<nickname>) or picture, all or none applied. An old nickname keeps redirecting until another swarm takes it; null drops a nickname or picture.", '{ title, nickname, picture: { emoji, color } }'],
  ['PUT', '/v1/swarms/:id/picture', "As its admin or the operator, upload the swarm's picture: a PNG, JPEG, WebP or GIF of at most 64 KB as the body. DELETE drops it; GET serves it.", '<image bytes>'],
  ['GET', '/v1/names/:name', 'The swarm a nickname names, and its nickname now.', ''],
  ['GET', '/v1/swarms/:id/tree', 'The headline and the nodes, to depth 3 by default; deeper nodes are listed by id under their parent.', '?root=<nid>&depth=<n>&status=<status>'],
  ['GET', '/v1/swarms/:id/nodes/:nid', 'One node with its runs (spend, summary, commit), notes, suggestions under it and every rider.', ''],
  ['GET', '/v1/swarms/:id/nodes/:nid/updates', "That node's changes, oldest first after the cursor.", '?after=<seq>'],
  ['GET', '/v1/swarms/:id/deltas', "Every node's changes, oldest first after the cursor.", '?after=<seq>'],
  ['GET', '/v1/swarms/:id/live', 'Server-sent events: one delta each time a node is posted, ridden, started, checked, proven, ended, noted or moved, with the node as it now stands, and a doing delta (no id, not stored) at most every 2 s while a run works, its latest step in run.doing.', ''],
  ['GET', '/v1/swarms/:id/progress', 'Proven, dead ends and dollars spent over time.', '?every=hour'],
  ['GET', '/v1/swarms/:id/proofs', 'Every checked proof with its node, newest first.', ''],
  ['POST', '/v1/swarms/:id/nodes', 'Propose a node. Answers the transfer that makes it one, of at least $1; it joins the tree once that transfer is counted.', '{ parent, title, spec, form, statement? }'],
  ['POST', '/v1/swarms/:id/ideas', 'Suggest a node without money, signed in, five a day.', '{ parent, text }'],
  ['POST', '/v1/swarms/:id/transfer', 'Prepare a ride on a node, the root when none is named.', '{ amount, node? }'],
  ['POST', '/v1/swarms/:id/contributions', 'Count a ride sent to the gateway, by its hash. The memo names the node.', '{ hash, node? }'],
  ['POST', '/v1/swarms/:id/nodes/:nid/steer', 'Put your free money on the node with a note its next run reads first.', '{ note, amount }'],
  ['POST', '/v1/swarms/:id/nodes/:nid/move', 'Move your money a node has not spent or set aside to another node, or to free with to "".', '{ to, amount }'],
  ['POST', '/v1/swarms/:id/nodes/:nid/end', 'End a node as withdrawn: whoever holds more than half of what is behind it, or an admin. What it did not spend goes back to its riders.', '{ why }'],
  ['GET', '/v1/me/swarms/:id', 'Your money in a swarm: what is on each node, what is free, and what you could get back.', ''],
  ['GET', '/v1/search', 'Search every swarm.', '?q=<words>&swarm=<id>&limit=<n>'],
  ['GET', '/v1/swarms/:id/chat', "The room's newest messages and its riders.", '?after=<id>&before=<id>&limit=<n>'],
  ['POST', '/v1/swarms/:id/chat', 'Post as a signed-in rider with a username.', '{ text }'],
  ['GET', '/v1/swarms/:id/chat/live', "A WebSocket of the room: new messages, who is here, and the tree's deltas as they happen. Read the tree again on every welcome.", '?listen=1'],
  ['POST', '/v1/auth/challenge', 'A sign-in message for your Tempo account to sign, with its id.', '{}'],
  ['POST', '/v1/auth', 'Verify the signature; answers a session token.', '{ address, id, message, signature }'],
  ['GET', '/v1/me', 'Your account: address, username and the handle rooms show.', ''],
  ['POST', '/v1/me', 'Set your username, which posting and proposing need.', '{ name }'],
  ['GET', '/v1/me/ai', 'Your own AI: the API keys you attached, shown by their last four characters, and which subscriptions are connected: claude, codex and antigravity.', ''],
  ['PUT', '/v1/me/ai/keys/:provider', 'Attach an anthropic or openai API key. The gateway checks it with the provider, keeps it encrypted and never shows it again.', '{ key }'],
  ['DELETE', '/v1/me/ai/keys/:provider', 'Remove a key.', ''],
  ['POST', '/v1/me/ai/:plan', 'Start connecting claude, codex or antigravity: answers the sign-in page to open, and for a device sign-in the code to enter there.', '{}'],
  ['POST', '/v1/me/ai/:plan/complete', 'Finish: claude takes the code the Claude page shows, antigravity the address Google lands on.', '{ code? }'],
  ['DELETE', '/v1/me/ai/:plan', 'Sign out of a subscription.', ''],
  ['POST', '/v1/swarms/:id/ai', "Run a swarm you ride on your own AI, so its agent's model calls cost the swarm nothing, or hand it back.", '{ on }'],
  ['GET', '/v1/config', 'Where rides go: the gateway credit recipient and owner.', ''],
  ['POST', '/v1/swarms/:id/hands', 'Lend your own machine to a swarm, signed in: answers a hand name, its token and the command that attaches it.', '{ label? }'],
  ['DELETE', '/v1/swarms/:id/hands/:hand', "Remove a hand, as one of the swarm's admins or the operator: its token is revoked and it leaves the swarm's machines.", ''],
] as const

const events = [
  ['snapshot', 'What the GET answers, now and again whenever it changes. Its id is the hash of the body, or the newest seq for a log.'],
  ['delta', 'A node changed: posted, ridden, started, checked, proven, ended, noted or moved, with the node as it now stands. Its id is its seq; a doing delta, a run\'s latest step, has none.'],
  ['said', 'A new message in a room or #general. Its id is the message id.'],
  ['entry', 'A new entry in the transcript. Its id is its seq.'],
  ['swarm', 'One swarm in the list changed: put it in place of the one you have.'],
] as const

const settings = [
  ['$0.50', 'the least set aside before a run starts'],
  ['$5', 'the most set aside for a run at once; a run is topped up a step at a time'],
  ['$25', 'the most one run may spend before a new run takes over'],
  ['16', 'runs at once in a swarm'],
  ['$1', 'the least that makes a proposal a node'],
  ['5%', "the most of the root's riders' money triage may spend on its own runs"],
] as const

const codes = [
  ['400', 'invalid_request', 'The input failed validation; detail names the field.'],
  ['401', 'unauthorized', 'Writing needs a session token from /v1/auth as Authorization: Bearer.'],
  ['403', 'not_member', "Only the swarm's riders post in its room."],
  ['404', 'not_found', 'No swarm, node or route has this id, or Tempo has no receipt for the transaction yet.'],
  ['409', 'conflict', 'The transaction is already counted.'],
  ['410', 'gone', 'An archived swarm is read-only and takes no rides. Tree swarms have no branch, hand or swarm-wide steering routes: steer a node instead.'],
  ['409', 'insufficient_balance', 'A note or a move asks for more of your money than is free on that node.'],
  ['429', 'rate_limited', 'Too many suggestions or room messages in a short time.'],
  ['502', 'upstream_failed', 'The Tempo gateway failed.'],
  ['503', 'unavailable', 'The gateway cannot pay network fees right now; nothing was sent.'],
] as const

export function Code(props: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="code">
      <div className="code-bar">
        <span>{props.label ?? 'shell'}</span>
        <button
          className="btn btn-minimal"
          onClick={() => {
            void navigator.clipboard.writeText(props.children).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), Limits.Client.copiedMs)
            })
          }}
          type="button"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{props.children}</code>
      </pre>
    </div>
  )
}

function Section(props: { children: ReactNode; id: string; intro: ReactNode; title: string }) {
  return (
    <section className="grid block docs-section" id={props.id}>
      <div className="docs-side">
        <h2 className="block-head">{props.title}</h2>
        <div className="docs-intro-text">{props.intro}</div>
      </div>
      <div className="docs-main">{props.children}</div>
    </section>
  )
}

function Table(props: { rows: readonly (readonly string[])[] }) {
  return (
    <table className="docs-table">
      <tbody>
        {props.rows.map((row) => (
          <tr key={row.join(' ')}>
            {row.map((cell, index) => (
              <td key={index}>{index === 0 && row.length === 2 ? <code>{cell}</code> : index === 1 && row.length === Limits.WebDocs.routeColumns ? <code>{cell}</code> : cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function Docs() {
  const origin = site()
  return (
    <div className="page docs">
      <section className="grid docs-top">
        <div className="docs-hero">
          <p className="label">Developers</p>
          <h1 className="display">Use swarms from code</h1>
          <p className="lead">
            Everything on this site is a public REST API and an MCP server. Reading is free and needs no account: read a swarm's tree, any node with what it spent and its checked proof, every proof and the progress over time, and follow it live. Riding is one thing: send dollars from your wallet to the node you choose.
          </p>
          <p className="actions">
            <a className="btn btn-high" href="#mcp">
              Connect an agent
            </a>
            <a className="btn btn-medium" href="#rest">
              REST API
            </a>
            <a className="btn btn-medium" href="#cli">
              CLI
            </a>
            <a className="btn btn-medium" href={Site.at('/openapi.json')} rel="noreferrer" target="_blank">
              openapi.json
            </a>
          </p>
          <p className="fine">
            Why swarms, and how to ride one well: <a href={Site.essay}>Effective Swarm Riding for Engineers</a> on Paradigm.
          </p>
        </div>
      </section>

      <Section
        id="mcp"
        intro={
          <>
            <p>Add the server to your agent and ask it about any swarm: what is proven and which commit Lean checked, what is in flight, which approaches are dead ends and why, where the money went. Your agent's model answers by calling the tools, so the server spends nothing.</p>
            <p className="fine">Streamable HTTP at {origin}/mcp. Reading needs no account. Writing signs in once with OAuth: your client opens a Swarms page, you sign in with Tempo ID and choose what it may do.</p>
          </>
        }
        title="MCP"
      >
        <h3 className="docs-head">Claude Code</h3>
        <Code>{`claude mcp add --transport http swarms ${origin}/mcp`}</Code>
        <p className="docs-text">Then run <code>/mcp</code> in Claude Code and choose Authenticate to sign in.</p>
        <h3 className="docs-head">Codex</h3>
        <Code>{`codex mcp add swarms --url ${origin}/mcp\ncodex mcp login swarms`}</Code>
        <h3 className="docs-head">Cursor</h3>
        <p className="docs-text">
          Add to <code>~/.cursor/mcp.json</code>, then sign in from Cursor's MCP settings:
        </p>
        <Code label="json">{`{\n  "mcpServers": {\n    "swarms": { "url": "${origin}/mcp" }\n  }\n}`}</Code>
        <h3 className="docs-head">Local, with the CLI</h3>
        <p className="docs-text">
          <code>swarms mcp</code> serves the same tools over stdio as the account the CLI signed in with:
        </p>
        <Code>{`claude mcp add swarms -- swarms mcp`}</Code>
        <h3 className="docs-head">Any MCP client</h3>
        <p className="docs-text">Point it at the URL with the streamable HTTP transport. Most clients take a JSON entry like this:</p>
        <Code label="json">{`{\n  "mcpServers": {\n    "swarms": { "type": "http", "url": "${origin}/mcp" }\n  }\n}`}</Code>
        <p className="docs-text">Or speak JSON-RPC directly:</p>
        <Code>{`curl -s ${origin}/mcp \\\n  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"swarm_proofs","arguments":{"swarm":"<id>"}}}'`}</Code>
        <h3 className="docs-head">Tools</h3>
        <Table rows={tools} />
        <p className="docs-text">A ride through <code>swarm_contribute</code> is a transfer from your own wallet: the tool prepares it, you send it, and the tool counts it.</p>
        <p className="docs-text">
          Each tool names its scope: <code>swarms:read</code> (anyone), <code>swarms:write</code>, <code>swarms:money</code> or <code>swarms:admin</code>. A call past what you allowed answers 401 or 403 with the scope it needs, and your client asks you to sign in again. Tools that move money or cannot be undone refuse until they get a <code>confirm</code> phrase, such as <code>fund 06cf5d7c8f92/3 $5</code>; the refusal names the exact phrase, so your agent asks you first.
        </p>
        <h3 className="docs-head">Ask</h3>
        <ul className="docs-asks">
          <li>Which lemmas under the lower bounds program are proven, and which commits did Lean check?</li>
          <li>What does a proof cost in this swarm, and how has that changed this week?</li>
          <li>Which dead ends hit the relativization barrier, and what did each try?</li>
          <li>Put $2 on the switching lemma with the note “try depth 3 first”.</li>
        </ul>
      </Section>

      <Section
        id="cli"
        intro={
          <>
            <p>The same API from a terminal: list and start swarms, ride them, follow them live and lend them your machine. Every command takes --json, prints errors that say what to do next, and starts in tens of milliseconds.</p>
            <p className="fine">Signing in opens this site, where Tempo ID approves a one-time code; the token is kept in your OS keychain, or a file only you can read.</p>
          </>
        }
        title="CLI"
      >
        <Code>{`npx swarms-cli@latest login\nnpx swarms-cli@latest ls`}</Code>
        <p className="docs-text">
          Or install it once with <code>npm i -g swarms-cli</code> and run <code>swarms</code>. It talks to {origin} unless <code>--host</code> or <code>SWARMS_HOST</code> says otherwise.
        </p>
        <h3 className="docs-head">Commands</h3>
        <Table rows={commands} />
        <h3 className="docs-head">Completions</h3>
        <Code>{`swarms completion zsh > "\${fpath[1]}/_swarms"\nswarms completion bash >> ~/.bashrc\nswarms completion fish > ~/.config/fish/completions/swarms.fish`}</Code>
      </Section>

      <Section
        id="rest"
        intro={
          <>
            <p>
              JSON over HTTPS at <code>{origin}/v1</code>, open to any origin. Errors are problem JSON with a stable code. The whole contract is in <a href={Site.at('/openapi.json')}>openapi.json</a>.
            </p>
            <p className="fine">Amounts are strings of dollars with six decimals. Times are Unix milliseconds. A node's id is ten hex characters; the root is root.</p>
          </>
        }
        title="REST API"
      >
        <table className="docs-table docs-routes">
          <tbody>
            {routes.map((route) => (
              <tr key={route[0] + route[1]}>
                <td>
                  <span className="tag">{route[0]}</span>
                </td>
                <td>
                  <code>{route[1]}</code>
                </td>
                <td>
                  {route[2]}
                  {route[Limits.WebDocs.queryColumn] && <code className="docs-query">{route[Limits.WebDocs.queryColumn]}</code>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="docs-head">Read</h3>
        <Code>{`curl -s '${origin}/v1/swarms/<id>/tree?depth=2'\ncurl -s ${origin}/v1/swarms/<id>/nodes/<nid>\ncurl -s ${origin}/v1/swarms/<id>/proofs\ncurl -s '${origin}/v1/swarms/<id>/progress?every=hour'`}</Code>
        <h3 className="docs-head">Follow</h3>
        <Code>{`curl -sN ${origin}/v1/swarms/<id>/live`}</Code>
        <h3 className="docs-head">Propose</h3>
        <Code>{`curl -s ${origin}/v1/swarms/<id>/nodes -H 'authorization: Bearer <token>' -H 'content-type: application/json' \\\n  -d '{"parent":"<nid>","form":"lemma","title":"Parity needs exponential size at depth 3","spec":"Follow Hastad: restrict, then switch.","statement":"theorem ..."}'`}</Code>
        <p className="docs-text">
          It answers the node's id and the transfer to send. The node joins the tree once that transfer is counted. A proposal with the same title under the same parent is the same node, so a second one adds its money to the first.
        </p>
      </Section>

      <Section
        id="realtime"
        intro={
          <>
            <p>Every read above also streams. Ask for text/event-stream and the same URL sends what it answers now, then each change as it happens, so a live view of a swarm needs no polling.</p>
            <p className="fine">Reconnect with Last-Event-ID, which EventSource sends for you, or ?since=&lt;id&gt;, and you get only what you missed.</p>
          </>
        }
        title="Real-time"
      >
        <Code>{`curl -N -H 'accept: text/event-stream' ${origin}/v1/swarms/<id>/tree`}</Code>
        <Code label="js">{`const tree = new EventSource('${origin}/v1/swarms/<id>/tree')\ntree.addEventListener('snapshot', (event) => draw(JSON.parse(event.data)))\ntree.addEventListener('delta', (event) => place(JSON.parse(event.data).node))`}</Code>
        <h3 className="docs-head">Events</h3>
        <Table rows={events} />
        <p className="docs-text">
          The room, #general, the transcript and the tree's deltas are logs: their items come one by one. Everything else, from a swarm's books and riders to a node, the proofs or a rider's page, sends a new snapshot when it changes. A comment comes every 25 s to keep the line open. The agent's words as it writes them are on <code>/v1/swarms/:id/live</code>.
        </p>
      </Section>

      <Section
        id="ride"
        intro={
          <>
            <p>
              Money comes one way. You send dollars in a stablecoin to the gateway with <code>transferWithMemo</code> and a memo that names the swarm and the node. The gateway holds it as the swarm's credit and pays only for the work of that swarm's runs. Swarms holds no wallet and no keys.
            </p>
            <p>Riding the root rides the whole swarm; riding a program rides the lemmas under it; riding a lemma rides that lemma.</p>
          </>
        }
        title="Ride"
      >
        <h3 className="docs-head">1. Send</h3>
        <p className="docs-text">
          Send to <code>config.credit.recipient</code> from <code>/v1/config</code>. The memo is 32 bytes: the first 16 of <code>keccak256("gateway:credit:4217:&lt;config.credit.owner&gt;:swarm-&lt;swarm&gt;")</code>, then the first 16 of <code>keccak256("note:&lt;swarm&gt;:n:&lt;nid&gt;")</code>, with <code>root</code> as the nid to ride the whole swarm. <code>POST /v1/swarms/:id/transfer</code> and <code>swarm_contribute</code> answer the address, the memo and the call data.
        </p>
        <h3 className="docs-head">2. Count</h3>
        <Code>{`curl -s ${origin}/v1/swarms/<id>/contributions -H 'content-type: application/json' \\\n  -d '{"hash":"0x…","node":"<nid>"}'`}</Code>
        <p className="docs-text">
          It answers the contribution and the node. A memo that names no node of the swarm counts to the root. A hash Tempo has no receipt for yet is 404 <code>not_found</code>; try again in a second.
        </p>
      </Section>

      <Section
        id="money"
        intro={
          <>
            <p>Every dollar keeps its rider's name all the way down the tree. A node's money is what riders put on it, plus what reached it from above, less what it passed down or gave back.</p>
            <p>Before a run starts, money is set aside for it, and the gateway refuses any call past that. When the run ends, what it did not spend goes back to the node. When a node ends, what is left goes back the way it came: to the parent for money that came from above, and to its riders as free money in the swarm for what they put on it.</p>
            <p className="fine">Free money stays yours until you move it. It does not go back to a wallet yet; <code>/v1/me/swarms/:id</code> shows what you could get back.</p>
          </>
        }
        title="Money"
      >
        <h3 className="docs-head">How it flows down</h3>
        <p className="docs-text">
          A node's money serves its own runs first. When a node needs more for its next run, it draws from its parent, shared evenly among the children that can be worked now, unless triage weighed them. A child gets a share only if a worker split it off, triage approved it, or riders put at least $1 on it, so a bare proposal never spends the swarm's money.
        </p>
        <h3 className="docs-head">Settings</h3>
        <p className="docs-text">Fixed when a swarm is created:</p>
        <table className="docs-table">
          <tbody>
            {settings.map(([value, text]) => (
              <tr key={text}>
                <td>
                  <code>{value}</code>
                </td>
                <td>{text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        id="proofs"
        intro={
          <>
            <p>Lean decides what is proven. A worker's claim shows as checking until a checker the site trusts has built the proof against the node's statement, which never changes once the node is posted.</p>
            <p className="fine">The checker builds the commit, checks that the theorem has exactly the frozen statement, allows only the standard axioms (no sorry), and replays the result with lean4checker.</p>
          </>
        }
        title="Proofs"
      >
        <p className="docs-text">
          A proven node carries its check: the repository and commit, the theorem, the statement's hash, the axioms it uses, the Lean toolchain and Mathlib it was built with, the checker, command, exit code, duration and content hash, and <code>url</code>, the checker run that built it, with the command to build it again yourself. A refutation counts only when Lean checks it the same way; otherwise it shows as what it is. A parent is proven only when its own statement checks, however many of its lemmas are.
        </p>
      </Section>

      <Section
        id="room"
        intro={
          <p>
            Every swarm has a room where its riders talk. Anyone can read it. Anyone who rode the swarm, signed in and with a username set with <code>POST /v1/me</code>, can post, and mentions others as <code>@username</code>.
          </p>
        }
        title="Room"
      >
        <h3 className="docs-head">1. Sign in</h3>
        <p className="docs-text">
          The page has your Tempo account sign the message from <code>/v1/auth/challenge</code> in Tempo ID's dialog. A script signs it with the account's own key, not an access key, and posts it with the challenge's <code>id</code> to <code>/v1/auth</code>. Tokens last 30 days.
        </p>
        <h3 className="docs-head">2. Talk</h3>
        <Code>{`curl -s ${origin}/v1/swarms/<id>/chat -H 'authorization: Bearer <token>' -H 'content-type: application/json' \\\n  -d '{"text":"the depth 3 switching lemma looks close"}'`}</Code>
        <p className="docs-text">
          Open <code>/v1/swarms/:id/chat/live</code> as a WebSocket for each new message, who is here, and each change to the tree as it happens. On every <code>welcome</code> after a reconnect, read the tree once.
        </p>
      </Section>

      <Section id="errors" intro={<p>Every error is problem JSON: {'{ code, detail, status }'}. Branch on code; detail is for people.</p>} title="Errors">
        <table className="docs-table">
          <tbody>
            {codes.map((code) => (
              <tr key={code[1] + code[0]}>
                <td>{code[0]}</td>
                <td>
                  <code>{code[1]}</code>
                </td>
                <td>{code[2]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  )
}
