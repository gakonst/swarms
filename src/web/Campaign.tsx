import { useEffect, useState } from 'react'
import type { Artifact, Detail, Member, Said } from '../shared/Api.ts'
import * as Answer from '../shared/Answer.ts'
import { BranchBar, relist, tree, useBranches } from './Branches.tsx'
import { Markdown } from './Markdown.tsx'
import { Avatar } from './Room.tsx'
import { short, usd } from './format.ts'

export function Campaign(props: {
  swarm: Detail; members: readonly Member[]; messages: readonly Said[]; artifacts: readonly Artifact[]
  onFund: () => void; onCommunity: () => void; onArtifact: (slug: string) => void; onResearch: (who: string) => void
}) {
  const { swarm } = props
  const branches = useBranches(swarm.id, swarm.status === 'running')
  const [saved, setSaved] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    try { setSaved(localStorage.getItem(`following:${swarm.id}`) !== null) } catch {}
  }, [swarm.id])
  const follow = () => {
    try {
      if (saved) localStorage.removeItem(`following:${swarm.id}`)
      else localStorage.setItem(`following:${swarm.id}`, swarm.title)
      setSaved(!saved)
      setNotice(saved ? 'Removed from your followed swarms.' : 'Saved on this device. Find it under Following on Explore.')
    } catch { setNotice('This browser could not save your follow. Bookmark this page instead.') }
  }
  const share = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/s/${swarm.id}`)
      setNotice('Link copied. Invite someone to help make progress.')
    } catch { setNotice('Copy this page’s address to invite someone.') }
  }
  const backers = props.members.filter((member) => Number(member.backed) > 0)
  const updates = props.messages.filter((message) => !message.author && !message.artifact && message.text.trim()).slice(-6).reverse()
  const all = branches.data?.branches ?? []
  return <div className="campaign">
    <section className="campaign-intro">
      <span className="campaign-eyebrow">A shared mission</span>
      <h2>Help move this idea forward.</h2>
      <p>{swarm.goal.split('\n\n')[0]}</p>
      <div className="campaign-people">
        <span className="campaign-avatars">{backers.slice(0, 6).map((member) => <Avatar key={member.address} address={member.address} handle={member.handle} size="small" />)}</span>
        <span>{swarm.contributors ? `${swarm.contributors} ${swarm.contributors === 1 ? 'person is' : 'people are'} backing this mission` : 'Be the first to back this mission'}</span>
      </div>
      <div className="campaign-actions">
        <button className="btn btn-high" onClick={props.onFund} type="button">Chip in</button>
        <button className="btn btn-low" aria-pressed={saved} onClick={follow} type="button">{saved ? 'Following ✓' : 'Follow'}</button>
        <button className="btn btn-low" onClick={() => void share()} type="button">Invite friends ↗</button>
      </div>
      <p className="campaign-caption">No expertise needed. Your contribution supports the swarm’s work. Suggesting a direction is optional.</p>
      {notice && <p role="status" className="campaign-caption">{notice}</p>}
    </section>
    <section className="campaign-section">
      <span className="campaign-eyebrow">Where we are</span>
      <h2>{swarm.answer ? 'The latest finding' : 'The work starts here'}</h2>
      {swarm.answer ? <><p className="campaign-finding">{Answer.gist(swarm.answer.text)}</p><details><summary>Read the full update</summary><Markdown text={swarm.answer.text} /></details></> : <p>Back this mission to help the swarm explore approaches and publish its findings here.</p>}
      <p className="campaign-caption">Findings are reported by the swarm. Completed work is not automatically independently verified.</p>
      <div className="campaign-results">{props.artifacts.map((artifact) => <button key={artifact.slug} onClick={() => props.onArtifact(artifact.slug)} type="button"><span className="campaign-eyebrow">Published result · v{artifact.version}</span><b>{artifact.title} ↗</b>{artifact.summary && <span>{artifact.summary}</span>}</button>)}</div>
    </section>
    <section className="campaign-section">
      <span className="campaign-eyebrow">What happens next</span>
      <h2>{swarm.status === 'running' ? 'Exploring together' : swarm.why === 'idle' ? 'Choose the next direction' : swarm.why === 'rest' ? 'An obstacle needs attention' : 'Help fund the next step'}</h2>
      <p>{swarm.status === 'running' ? 'The swarm is working on this mission. New findings and research branches appear here as they are published.' : swarm.why === 'idle' ? 'The swarm is paused. Read the latest findings, share a useful source, or sponsor a new research direction.' : swarm.why === 'rest' ? 'The last attempts hit errors. Read the activity before deciding whether to sponsor another attempt.' : 'Contributions pay for the models, machines, and services used to pursue this mission.'}</p>
      <p className="campaign-caption">{usd(swarm.raised)} raised · {usd(swarm.spent)} spent · {usd(swarm.remaining)} available. Funding is not a measure of scientific progress.</p>
      <button className="campaign-link" onClick={props.onCommunity} type="button">Discuss an idea or share a source →</button>
    </section>
    <section className="campaign-section">
      <span className="campaign-eyebrow">Research map</span>
      <h2>Follow the paths we explore.</h2>
      <p className="campaign-caption">Open a path to see its work, supporters, result, and funding controls. A finished run is not proof of a breakthrough.</p>
      {branches.error && <p role="status">Research paths could not be loaded. <button onClick={() => relist(swarm.id)} type="button">Try again</button></p>}
      {!all.length && <p>{branches.data ? 'No separate research paths yet. The main swarm’s findings will appear above.' : 'Loading research paths…'}</p>}
      <div className="campaign-paths">{tree(all).map((branch) => <BranchBar key={branch.id} all={all} branch={branch} onChanged={() => relist(swarm.id)} onPick={props.onResearch} swarm={swarm} />)}</div>
    </section>
    <section className="campaign-section">
      <span className="campaign-eyebrow">Community progress</span>
      <h2>Small contributions. Shared discoveries.</h2>
      <div className="campaign-feed">
        {swarm.contributions.slice(-5).reverse().map((contribution, index) => <div key={`${contribution.hash}-${index}`} className="campaign-event"><span className="campaign-eyebrow">Backed the mission</span><p>{props.members.find((member) => member.address === contribution.contributor)?.handle ?? short(contribution.contributor)} chipped in {usd(contribution.amount)}{contribution.note ? ` — ${contribution.note}` : ''}</p></div>)}
        {updates.map((update) => <details className="campaign-event" key={update.id}><summary>{Answer.gist(update.text) || 'Research update'}</summary><Markdown text={update.text} /></details>)}
        {!swarm.contributions.length && !updates.length && <p>The story is just beginning. Join the community and help it take the first step.</p>}
      </div>
      <button className="campaign-link" onClick={props.onCommunity} type="button">Join the conversation →</button>
    </section>
  </div>
}
