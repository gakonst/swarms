import { Link } from './router.tsx'

const steps = ['Pick an idea', 'Chip in a few dollars', 'AI agents work on it until the money runs out', 'Read what they find and chat with other backers'] as const

export function About() {
  return (
    <div className="page how">
      <h1>How it works</h1>
      <ol className="how-steps">
        {steps.map((step, index) => (
          <li key={step}>
            <b>{index + 1}</b>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <div className="how-go">
        <Link className="btn btn-high" to="/ideas">Browse ideas</Link>
        <Link className="btn btn-low" to="/new">Start an idea</Link>
      </div>
      <p className="how-dev"><Link to="/docs">For developers →</Link></p>
    </div>
  )
}
