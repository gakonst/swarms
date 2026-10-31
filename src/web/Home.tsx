import * as Api from './api.ts'
import { usePoll } from './hooks.ts'
import { Link } from './router.tsx'
import { World } from './World.tsx'

export function Home() {
  const [list] = usePoll(() => Api.swarms(), 5000, 'swarms')

  return (
    <div className="page home research-home">
      <section className="game-intro">
        <div>
          <p className="label">A world of open questions</p>
          <h1>Discovery is a team sport.</h1>
          <p>Fund a swarm. Follow the adventure.</p>
        </div>
        <Link className="btn btn-high" to="/new">Start a quest <span aria-hidden="true">↗</span></Link>
      </section>
      <World error={list.error} loading={!list.data} swarms={list.data?.swarms ?? []} />
    </div>
  )
}
