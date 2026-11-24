import { useEffect, useState } from 'react'
import type { Config, Profile as Read } from '../shared/Api.ts'
import * as Nickname from '../shared/Nickname.ts'
import { short, usd } from './format.ts'
import { message, usePoll, useWallet } from './hooks.ts'
import * as Api from './api.ts'
import { Lost } from './Lost.tsx'
import { Inline } from './Markdown.tsx'
import { Avatar } from './Room.tsx'
import { Link, navigate } from './router.tsx'
import { Mark } from './Tree.tsx'
import * as Wallet from './wallet.ts'

function cut(amount: string) {
  return usd(amount).replace(/\.00$/, '')
}

export function whose(who: string) {
  return decodeURIComponent(who).trim().replace(/^@/, '').toLowerCase()
}

export function mine(account: { name: string | null } | undefined, address: string) {
  return `/u/${account?.name ?? address}`
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

export function Profile(props: { who: string }) {
  const who = whose(props.who)
  const [read] = usePoll(() => Api.rider(who), null, `rider:${who}`)
  const wallet = useWallet()
  const data: Read | undefined = read.data
  const handle = data ? (data.rider.name ? `@${data.rider.name}` : data.rider.handle) : undefined
  useEffect(() => {
    if (handle) document.title = `${handle} · Swarms`
  }, [handle])
  if (!data)
    return read.error ? (
      <Lost title={/no rider/i.test(read.error) ? 'No rider by this name.' : 'This page did not load.'}>
        <Link className="lost-row" to="/ideas">All swarms <span aria-hidden="true">→</span></Link>
      </Lost>
    ) : (
      <section aria-busy="true" className="page lost"><span className="lost-orbit" aria-hidden="true"><i /><i /><i /></span></section>
    )
  const own = wallet.address === data.rider.address.toLowerCase()
  const titles = new Map(data.swarms.map((swarm) => [swarm.id, swarm]))
  const made = data.items.filter((item) => item.created).length
  return (
    <div className="page rider">
      <header className="rider-head">
        <Avatar address={data.rider.address} handle={data.rider.handle} />
        <div className="rider-name">
          <h1>{handle}</h1>
          {data.rider.name && <p className="rider-address">{short(data.rider.address)}</p>}
        </div>
      </header>
      <dl className="rider-stats">
        <div><dt>ridden</dt><dd>{cut(data.ridden)}</dd></div>
        <div><dt>{data.swarms.length === 1 ? 'swarm' : 'swarms'}</dt><dd>{data.swarms.length}</dd></div>
        <div><dt>{made === 1 ? 'idea' : 'ideas'}</dt><dd>{made}</dd></div>
      </dl>
      {data.swarms.length > 0 ? (
        <section aria-labelledby="rider-swarms" className="rider-band">
          <h2 id="rider-swarms">Swarms</h2>
          <ul className="rider-list">
            {data.swarms.map((swarm) => (
              <li key={swarm.id}>
                <Link className="rider-row" to={Nickname.path(swarm)}>
                  <Inline className="rider-title" text={swarm.title} />
                  <span className="rider-meta">{plural(swarm.riders, 'rider')} · {cut(swarm.balance)} in{swarm.started ? ' · started it' : ''}</span>
                  <b className="rider-money">{cut(swarm.ridden)}</b>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="rider-none">{own ? <Link to="/ideas">Ride your first swarm →</Link> : 'Nothing ridden yet.'}</p>
      )}
      {data.items.length > 0 && (
        <section aria-labelledby="rider-items" className="rider-band">
          <h2 id="rider-items">Board</h2>
          <ul className="rider-list">
            {data.items.map((item) => {
              const swarm = titles.get(item.swarm)
              return (
                <li key={`${item.swarm}:${item.node}`}>
                  <Link className="rider-row" to={`${Nickname.path(swarm ?? { id: item.swarm, nickname: null })}/t/${item.node}`}>
                    <span className="rider-title"><Mark status={item.status} /> <Inline text={item.title} /></span>
                    <span className="rider-meta">{item.created ? (own ? 'Your idea · ' : 'Their idea · ') : ''}{swarm?.title ?? item.swarm}</span>
                    <b className="rider-money">{Number(item.ridden) > 0 ? cut(item.ridden) : ''}</b>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

export function Me(props: { config: Config | undefined }) {
  const wallet = useWallet()
  const [error, setError] = useState<string>()
  const address = wallet.address
  const name = wallet.account?.name
  useEffect(() => {
    if (address) navigate(mine(wallet.account, address), { replace: true })
  }, [address, name])
  if (address || wallet.pending) return <section aria-busy="true" className="page lost"><span className="lost-orbit" aria-hidden="true"><i /><i /><i /></span></section>
  return (
    <Lost title={error ?? 'Sign in to see your profile.'}>
      <button className="lost-row" onClick={() => props.config && Wallet.signIn(props.config).catch((reason: unknown) => setError(message(reason)))} type="button">Sign in <span aria-hidden="true">→</span></button>
    </Lost>
  )
}
