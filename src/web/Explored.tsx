import { useState } from 'react'
import * as Answer from '../shared/Answer.ts'
import type { Branch } from '../shared/Api.ts'
import { Markdown } from './Markdown.tsx'

type Node = Branch & { children: Node[] }

type Look = 'exploring' | 'found' | 'dead' | 'stopped'

const words: Record<Look, string> = { dead: 'Dead end', exploring: 'Exploring', found: 'Found something', stopped: 'Stopped' }

function look(branch: Branch): Look {
  if (branch.state === 'pending' || branch.state === 'running') return 'exploring'
  if (branch.result && branch.state !== 'failed') return 'found'
  if (branch.state === 'failed' || branch.error) return 'dead'
  return 'stopped'
}

export function name(role: string) {
  const words = role.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'A direction'
}

function grow(branches: readonly Branch[]) {
  const nodes = new Map<number, Node>(branches.map((branch) => [branch.id, { ...branch, children: [] }]))
  const roots: Node[] = []
  for (const node of [...nodes.values()].sort((a, b) => a.id - b.id)) {
    const parent = node.parent === null ? undefined : nodes.get(node.parent)
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

function Twig(props: { node: Node }) {
  const node = props.node
  const state = look(node)
  const [open, setOpen] = useState(false)
  const said = state === 'found' ? node.result : state === 'dead' ? node.error : null
  const line = said ? Answer.excerpt(said, 180) : Answer.excerpt(node.task, 160)
  return (
    <li className="twig" data-look={state}>
      <button aria-expanded={said ? open : undefined} className="twig-card" disabled={!said} onClick={() => setOpen(!open)} type="button">
        <span className="twig-top">
          <i aria-hidden="true" className="twig-dot" />
          <b>{name(node.role)}</b>
          <span className="twig-state">{words[state]}</span>
        </span>
        <span className="twig-line">{line}</span>
      </button>
      {open && said && <div className="twig-more"><Markdown text={said} /></div>}
      {node.children.length > 0 && <ol className="twigs">{node.children.map((child) => <Twig key={child.id} node={child} />)}</ol>}
    </li>
  )
}

export function Explored(props: { branches: readonly Branch[] | undefined; running: boolean; title: string }) {
  const branches = props.branches ?? []
  const roots = grow(branches)
  const counts = branches.reduce((sum, branch) => ({ ...sum, [look(branch)]: sum[look(branch)] + 1 }), { dead: 0, exploring: 0, found: 0, stopped: 0 } as Record<Look, number>)
  if (!props.branches) return <div className="explored explored-wait" aria-busy="true" />
  return (
    <div className="explored">
      <div className="explored-root" data-live={props.running}>
        <i aria-hidden="true" />
        <span>
          <b>{props.title}</b>
          <small>
            {branches.length
              ? [counts.exploring && `${counts.exploring} exploring`, counts.found && `${counts.found} found something`, counts.dead && `${counts.dead} dead end${counts.dead === 1 ? '' : 's'}`, counts.stopped && `${counts.stopped} stopped`].filter(Boolean).join(' · ')
              : props.running
                ? 'The AI is working on it directly'
                : 'No directions tried yet'}
          </small>
        </span>
      </div>
      {roots.length > 0 && <ol className="twigs twigs-root">{roots.map((node) => <Twig key={node.id} node={node} />)}</ol>}
    </div>
  )
}
