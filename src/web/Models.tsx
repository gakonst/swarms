import { useState } from 'react'
import type { Config } from '../shared/Api.ts'
import * as Setup from '../shared/Setup.ts'

export function price(config: Config | undefined, choice: Setup.Choice) {
  const resolved = Setup.resolve(choice)
  if (typeof resolved === 'string' || !config?.models.length) return undefined
  const priced = Setup.priced(resolved, new Map(config.models.map((model) => [model.id, model])))
  return typeof priced === 'string' ? undefined : priced
}

export function dollars(units: string) {
  const value = Number(units) / 1_000_000
  return '$' + String(Number(value.toFixed(value < 0.01 ? 4 : value < 1 ? 3 : 2)))
}

function cost(setup: Setup.Setup | undefined) {
  return setup ? `about ${dollars(setup.step)} a step` : ''
}

const harnessNames: Record<Setup.Harness, string> = { claude: 'Claude Code', codex: 'Codex' }

function toggled<T>(list: readonly T[], item: T) {
  return list.includes(item) ? list.filter((value) => value !== item) : [...list, item]
}

export function Models(props: { config: Config | undefined; onChange: (choice: Setup.Choice) => void; value: Setup.Choice }) {
  const models = props.config?.models ?? []
  const [open, setOpen] = useState(false)
  const custom = props.value.template === 'custom' ? props.value : undefined
  const picked = price(props.config, props.value)
  const offer = custom?.subagents ?? { harnesses: [], models: [] }
  const pick = (template: Setup.Template) => {
    if (!open) return setOpen(true)
    setOpen(false)
    if (template !== props.value.template) props.onChange(template === 'custom' ? { harness: 'claude', model: Setup.opus, subagents: null, template } : { template })
  }
  const edit = (next: Partial<Setup.Choice>) => props.onChange({ ...props.value, ...next, template: 'custom' })
  const offering = (harnesses: Setup.Harness[], picks: string[]) => edit({ subagents: harnesses.length || picks.length ? { harnesses, models: picks } : null })

  return (
    <section aria-label="Models" className="models">
      <h2 className="models-head">Models</h2>
      <ol className="tiles-swarm models-list" role="radiogroup">
        {Setup.templates.filter((template) => open || template === props.value.template).map((template) => {
          const chosen = props.value.template === template
          const preset = template === 'custom' ? undefined : Setup.presets[template]
          const shown = template === 'custom' ? (chosen ? picked : undefined) : price(props.config, { template })
          return (
            <li data-open={chosen} key={template}>
              <button aria-checked={chosen} aria-expanded={chosen ? open : undefined} className="tile-swarm" onClick={() => pick(template)} role="radio" type="button">
                <i className="tile-mark" data-tone={chosen ? 0 : 'more'} />
                <span className="tile-title">{Setup.labels[template]}{template === Setup.fallback ? ' (default)' : ''}</span>
                <span className="tile-raised">{cost(shown)}{open ? '' : ' ▾'}</span>
              </button>
              {chosen && !open && preset && <p className="models-hint">{preset.hint}{shown ? ` Needs ${dollars(shown.most)} to start a step.` : ''}</p>}
              {chosen && !open && custom && (
                <div className="models-custom">
                  <label>
                    Lead harness
                    <select onChange={(event) => edit({ harness: event.target.value as Setup.Harness })} value={custom.harness ?? 'claude'}>
                      {Setup.harnesses.map((harness) => <option key={harness} value={harness}>{harnessNames[harness]}</option>)}
                    </select>
                  </label>
                  <label>
                    Lead model
                    <select onChange={(event) => edit({ model: event.target.value })} value={custom.model ?? ''}>
                      {models.map((model) => <option key={model.id} value={model.id}>{Setup.name(model.id)} · {dollars(String(Setup.units(Setup.step(model))))} a step</option>)}
                    </select>
                  </label>
                  <fieldset>
                    <legend>Subagent harnesses</legend>
                    {Setup.harnesses.map((harness) => (
                      <label className="models-check" key={harness}>
                        <input checked={offer.harnesses.includes(harness)} onChange={() => offering(toggled(offer.harnesses, harness), offer.models)} type="checkbox" />
                        {harnessNames[harness]}
                      </label>
                    ))}
                  </fieldset>
                  <fieldset>
                    <legend>Subagent models</legend>
                    {models.map((model) => (
                      <label className="models-check" key={model.id}>
                        <input checked={offer.models.includes(model.id)} onChange={() => offering(offer.harnesses, toggled(offer.models, model.id))} type="checkbox" />
                        {Setup.name(model.id)} <em>{dollars(String(Setup.units(Setup.step(model))))}</em>
                      </label>
                    ))}
                  </fieldset>
                  <p className="models-hint">
                    {custom.subagents ? (custom.subagents.harnesses.length && custom.subagents.models.length ? 'Subagents may use only the checked harnesses and models.' : 'Check at least one harness and one model, or none for any.') : 'Nothing checked: subagents may use any model and harness.'}
                    {picked ? ` Needs ${dollars(picked.most)} to start a step.` : ''}
                  </p>
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {open && <p className="models-note">A step is one model call at a {Setup.context.toLocaleString('en-US')}-token context, mostly cached. A turn takes many steps.</p>}
    </section>
  )
}

export function Facts(props: { setup: Setup.Setup | null }) {
  const setup = props.setup
  if (!setup) return <div className="about-wide"><dt>Models</dt><dd>The gateway's default (it started before swarms had model setups)</dd></div>
  return (
    <>
      <div className="about-wide"><dt>Models</dt><dd>{Setup.labels[setup.template]}, about {dollars(setup.step)} a step</dd></div>
      <div className="about-wide"><dt>Lead</dt><dd>{harnessNames[setup.harness]} on {Setup.name(setup.model)}</dd></div>
      <div className="about-wide">
        <dt>Subagents</dt>
        <dd>{setup.subagents ? `${setup.subagents.harnesses.map((harness) => harnessNames[harness]).join(' or ')} on ${setup.subagents.models.map((model) => `${Setup.name(model)}${setup.steps[model] ? ` (${dollars(setup.steps[model])})` : ''}`).join(', ')}` : 'Any model and harness'}</dd>
      </div>
    </>
  )
}

export function ready(choice: Setup.Choice) {
  if (choice.template !== 'custom') return true
  const offer = choice.subagents
  return !!choice.harness && !!choice.model && (!offer || (offer.harnesses.length > 0 && offer.models.length > 0))
}
