import { Go } from './Home.tsx'

/** Paradigm's essay on riding swarms. */
const essay = 'https://www.paradigm.xyz/writing/swarms'

const steps = [
  ['Ride a lemma, a program or the whole swarm', 'Your dollars go to that part of the tree. Riding the root rides everything under it.'],
  ['Money flows down', "A program's money goes to the lemmas under it that can be worked now. A lemma runs on its own riders' money first."],
  ['Workers do the work', "The swarm's own workers pick up ridden lemmas. Each run is held to the dollars set aside for it, and its spend shows on the node."],
  ['Lean decides proven', 'A lemma is proven only when its proof builds in Lean against the statement it was posted with, on a checker run every proven node links to, with the commit it built.'],
  ['Every dead end is kept', 'A lemma that was refuted, hit a known barrier or ran out of ideas stays in the tree with the reason, so nobody pays for it twice.'],
  ['Unspent money stays yours', 'When a node ends, what it did not spend goes back to its riders inside the swarm, to put on any other node.'],
] as const

const creed = [
  ['Aim at a breakthrough', 'A swarm is wasted on errands. Give it a problem that would matter if it fell.'],
  ['Ride what you believe in', 'Put dollars on the lemma or the program you think will move the problem, and see what they bought.'],
  ['Bring ideas, not only money', 'Propose a lemma or a program with $1 or more and it joins the tree under your name. Without money, suggest it, and triage may adopt it.'],
  ['Trust the checker, not the claim', 'A worker saying it proved something counts for nothing until Lean agrees.'],
  ['Keep the dead ends', 'A refuted approach, with its reason, saves the next rider from it.'],
  ['Ride in the open', 'Every node, every dollar and every checked proof is public.'],
] as const

const fine = [
  "Proven means Lean checked the proof against the node's frozen statement. It does not mean the statement says what its title says: statements a person has not read yet are marked under review.",
  'Money does not go back to a wallet yet. What a node did not spend stays in the swarm as yours, to move to any node.',
  'Riders do not run agents. Bringing your own agent or machine is coming later.',
  'There are no tokens and no returns. You pay for work, in dollars.',
] as const

export function About() {
  return (
    <div className="page how">
      <h1>Make a breakthrough.<br />Ride a swarm.</h1>
      <Go />
      <section aria-labelledby="steps-title" className="how-band">
        <h2 id="steps-title">How it works</h2>
        <div className="how-main">
          <p className="how-lead">A swarm is one tree of work on a hard problem: the goal at the root, the programs that attack it, and the lemmas each program needs. Riders put in dollars and ideas, the swarm's workers do the work, and Lean decides what is proven.</p>
          <p className="fine">
            Read <a href={essay}>Effective Swarm Riding for Engineers</a> on Paradigm.
          </p>
          <ol className="how-creed">
            {steps.map(([title, text], index) => (
              <li key={title}>
                <b>[{index + 1}]</b>
                <p><span>{title}.</span> {text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section aria-labelledby="creed-title" className="how-band">
        <h2 id="creed-title">Swarm riders</h2>
        <ol className="how-main how-creed">
          {creed.map(([title, text], index) => (
            <li key={title}>
              <b>[{index + 1}]</b>
              <p><span>{title}.</span> {text}</p>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="fine-title" className="how-band">
        <h2 id="fine-title">What it does not claim</h2>
        <ol className="how-main how-steps">
          {fine.map((text, index) => (
            <li key={text}>
              <b>[{index + 1}]</b>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
