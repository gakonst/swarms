import type { Detail } from '../shared/Api.ts'
import * as Drive from '../shared/Drive.ts'
import * as Status from '../shared/Status.ts'
import * as Limits from '../shared/Limits.ts'

type Shown = { mood: Drive.Mood | 'new'; reason: string | null; text: string }

export function shown(swarm: Detail): Shown | null {
  const board = swarm.board
  if (!board) return null
  if (board.halt) return { ...Drive.pill(board), reason: Drive.reason(board.halt) }
  if (swarm.status === 'paused' || (swarm.status === 'funding' && swarm.why)) {
    const waiting = Status.waiting(swarm)
    if (waiting) return { mood: 'stuck', reason: swarm.reason, text: 'Waiting on ' + Status.on(waiting) }
    if (swarm.why === 'money' || swarm.why === 'unfunded') return { mood: 'money', reason: swarm.reason, text: 'Needs money' }
    return { mood: 'stuck', reason: swarm.reason, text: 'Paused' }
  }
  return { ...Drive.pill(board), reason: null }
}

function source(board: Drive.Board) {
  if (board.source === 'plan' && board.plan) return "On the creator's " + Drive.planName(board.plan) + ' plan'
  if (board.source === 'credit') return "On riders' credit"
  return 'Starts on its next turn'
}

const labels: Record<Drive.ItemState, string> = { dead: 'Dead end', done: 'Done', flying: 'Now', open: 'Next' }

export function BoardPin(props: { lit: boolean; onOpen?: (() => void) | undefined; swarm: Detail }) {
  const board = props.swarm.board
  const pill = shown(props.swarm)
  if (!board || !pill) return null
  const next = board.items.filter((item) => Drive.open(item.state)).slice(0, Limits.WebBoardPin.shown)
  const counts = board.counts
  return (
    <section aria-label="Board" className="board-pin" data-lit={props.lit || undefined}>
      <header className="board-pin-head">
        <b className="board-pin-name">
          <span aria-hidden="true" className="board-pin-mark" />
          Board
        </b>
        <span className="pill" data-mood={pill.mood}>
          <i />
          {pill.text}
        </span>
      </header>
      <p className="board-pin-goal">{props.swarm.goal}</p>
      {pill.reason && <p className="board-pin-why">{pill.reason}</p>}
      {next.length > 0 ? (
        <ol className="board-pin-items">
          {next.map((item) => (
            <li data-source={item.source} data-state={item.state} key={item.id}>
              <small>{labels[item.state]}</small>
              <span>{item.title}</span>
              {item.source === 'human' && <em>rider</em>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="board-pin-empty">
          {board.halt ? 'Nothing is in flight.' : 'No open item: the lead plans the next ones from the goal, its results and its dead ends.'}
        </p>
      )}
      <footer className="board-pin-foot">
        <span>
          {counts.flying} in flight · {counts.open} next · {counts.done} done · {counts.dead} dead {counts.dead === 1 ? 'end' : 'ends'}
        </span>
        <span>
          {source(board)}
          {board.cap !== null ? ' · ' + board.turns + ' of ' + board.cap + ' turns' : ''}
        </span>
        {props.onOpen && (
          <button className="board-pin-open" onClick={props.onOpen} type="button">
            Open the Board thread →
          </button>
        )}
      </footer>
    </section>
  )
}
