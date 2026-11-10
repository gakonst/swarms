(() => {
  const here = new URL('.', location.href)
  const theme = new URL('swarm.css', document.currentScript?.src ?? location.href).href
  const svg = 'http://www.w3.org/2000/svg'
  const colors = [
    ['#161616', '#161616'],
    ['#0a82e1', '#0a6cbb'],
    ['#e0449c', '#b02a76'],
    ['#7a52e0', '#5a38b8'],
    ['#e8742c', '#b3541a'],
    ['#1fa39c', '#167a75'],
  ]
  const states = { 'dead end': 'dead', 'dead-end': 'dead', done: 'done', exploring: 'exploring', promising: 'promising' }

  const css = `
.ar{max-width:1040px;margin:0 auto;padding:24px 24px 48px}
.ar h1{margin:0;font-size:28px;font-weight:400;line-height:1.1;letter-spacing:-.03em}
.ar .eyebrow{margin:24px 0 0;font:12px var(--mono);letter-spacing:.02em;color:var(--muted)}
.ar .big{margin:6px 0 0;font-size:56px;line-height:1;font-weight:400;letter-spacing:-.03em}
.ar .sub{margin:12px 0 0;color:var(--muted)}
.ar .sub b{color:var(--fg);font-weight:400}
.ar .goal{margin:16px 0 0;max-width:420px}
.ar .bar{height:3px;background:var(--line);overflow:hidden}
.ar .bar i{display:block;height:100%;background:var(--fg)}
.ar .goal p{margin:8px 0 0;color:var(--muted);font:12px var(--mono);letter-spacing:.02em}
.ar section{margin-top:48px}
.ar h2{margin:0 0 16px;font:16px/1.25 var(--serif);letter-spacing:0;color:var(--fg)}
.ar h2 span{color:var(--muted)}
.ar .plot{position:relative;width:100%;overflow:hidden;padding:0;background:none;border:0}
.ar .plot svg{display:block;width:100%}
.ar .plot text{font:11px var(--mono);fill:var(--muted)}
.ar .plot .label{fill:var(--t)}
.ar .legend{display:flex;flex-wrap:wrap;gap:4px 16px;margin:12px 0 0;padding:0;list-style:none;color:var(--muted);font:12px var(--mono);letter-spacing:.02em}
.ar .legend li{display:flex;align-items:center;gap:6px}
.ar .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--c);flex:none}
.ar .dot.grey{background:var(--edge)}
.ar .dash{display:inline-block;width:16px;border-top:2px solid var(--c);flex:none}
.ar .dash.goal{border-top-style:dashed;border-color:var(--muted)}
.ar .note{margin:8px 0 0;color:var(--muted);font:12px var(--mono);letter-spacing:.02em}
.ar ol{margin:0;padding:0;list-style:none;background:none;border:0}
.ar ol li{padding:12px 0;border-top:1px solid var(--line)}
.ar ol li:first-child{border-top:0;padding-top:0}
.ar .row{display:flex;align-items:baseline;gap:8px;min-width:0}
.ar .row .name{font-size:16px;overflow-wrap:anywhere}
.ar .row .end{margin-left:auto;white-space:nowrap;font:12px var(--mono);letter-spacing:.02em}
.ar .chip{display:inline-block;padding:0 8px;border-radius:12px;background:var(--glass);color:var(--fg);font:11px/20px var(--mono);letter-spacing:.02em;white-space:nowrap}
.ar .chip.promising{background:rgba(0,255,0,.16)}
.ar .chip.done{background:var(--high);color:var(--bg)}
.ar .chip.dead{color:var(--muted);text-decoration:line-through}
.ar .meta{margin:3px 0 0;color:var(--muted);overflow-wrap:anywhere}
.ar .delta{font:12px var(--mono);letter-spacing:.02em;color:var(--fg);min-width:72px}
.ar .what{overflow-wrap:anywhere}
.ar footer{margin-top:48px;color:var(--muted)}
.ar footer a{color:inherit}
.ar .empty{margin:18px 0 0;color:var(--muted)}
html[data-cover] .ar{display:flex;flex-direction:column;max-width:none;height:100%;padding:24px}
html[data-cover] .ar .eyebrow{margin-top:0}
html[data-cover] .ar .big{font-size:72px}
html[data-cover] .ar .plot{flex:1;min-height:0;margin-top:16px}
`

  let loaded
  let last = ''
  let stamp = 0
  let root
  let plot
  const cover = document.documentElement.hasAttribute('data-cover') || new URLSearchParams(location.search).has('cover')

  function node(tag, attrs, ...children) {
    const made = document.createElement(tag)
    for (const [key, value] of Object.entries(attrs ?? {})) if (value != null && value !== false) made.setAttribute(key, value)
    for (const child of children.flat(Infinity)) if (child != null && child !== false) made.append(child)
    return made
  }

  function shape(tag, attrs, ...children) {
    const made = document.createElementNS(svg, tag)
    for (const [key, value] of Object.entries(attrs ?? {})) if (value != null && value !== false) made.setAttribute(key, value)
    for (const child of children.flat(Infinity)) if (child != null && child !== false) made.append(child)
    return made
  }

  async function get(path) {
    const response = await fetch(new URL(path, here), { cache: 'no-cache' })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`${path} answered ${response.status}.`)
    const modified = Date.parse(response.headers.get('last-modified') ?? '')
    if (modified > stamp) stamp = modified
    return response.text()
  }

  function file(branch) {
    const name = typeof branch.results === 'string' ? branch.results : `${String(branch.name ?? 'results').toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}.tsv`
    return /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*){0,3}$/.test(name) && !name.includes('..') ? name : null
  }

  async function load() {
    const raw = await get('data.json')
    let config = {}
    if (raw) {
      try {
        config = JSON.parse(raw) ?? {}
      } catch {
        throw new Error('data.json is not valid JSON.')
      }
    }
    const listed = Array.isArray(config.branches) && config.branches.length ? config.branches.filter((branch) => branch && typeof branch === 'object') : [{ name: 'main', results: 'results.tsv' }]
    const texts = await Promise.all(listed.map((branch) => (file(branch) ? get(file(branch)).catch(() => null) : null)))
    return { config, listed, texts }
  }

  function parse(text, metric) {
    const lines = (text ?? '').split(/\r?\n/).filter((line) => line.trim())
    if (!lines.length) return { rows: [] }
    const head = lines[0].split('\t').map((cell) => cell.trim())
    const names = head.map((cell) => cell.toLowerCase())
    const at = (name) => names.indexOf(name)
    const named = metric ? at(String(metric).toLowerCase()) : -1
    const column = named >= 0 ? named : at('metric') >= 0 ? at('metric') : head.length > 1 ? 1 : -1
    if (column < 0) return { missing: true, rows: [] }
    const status = at('status')
    const rows = lines.slice(1).map((line, index) => {
      const cells = line.split('\t').map((cell) => cell.trim())
      const value = Number.parseFloat(cells[column])
      const word = status < 0 ? '' : (cells[status] ?? '').toLowerCase()
      return {
        commit: at('commit') < 0 ? '' : (cells[at('commit')] ?? ''),
        description: at('description') < 0 ? '' : (cells[at('description')] ?? ''),
        n: index + 1,
        status: !Number.isFinite(value) || /^(crash|fail|error|timeout)/.test(word) ? 'crash' : status < 0 ? null : /^(keep|kept)/.test(word) ? 'keep' : 'discard',
        value,
      }
    })
    return { metric: head[column], rows }
  }

  function study({ config, listed, texts }) {
    const lower = String(config.better ?? 'lower').toLowerCase() !== 'higher'
    const gain = (value, than) => (lower ? than - value : value - than)
    let metric = typeof config.metric === 'string' ? config.metric : undefined
    const branches = listed.map((branch, index) => {
      const parsed = parse(texts[index], metric)
      metric ??= parsed.metric
      let best = null
      let start = null
      const wins = []
      const steps = []
      for (const row of parsed.rows) {
        if (row.status === 'crash') continue
        if (row.status === null) row.status = best === null || gain(row.value, best) > 0 ? 'keep' : 'discard'
        if (row.status !== 'keep') continue
        if (best === null) {
          best = start = row.value
          steps.push([row.n, best])
          continue
        }
        const delta = gain(row.value, best)
        if (delta > 0) best = row.value
        wins.push({ ...row, delta })
        steps.push([row.n, best])
      }
      if (start === null) {
        const first = parsed.rows.find((row) => row.status !== 'crash')
        if (first) start = first.value
      }
      const [dot, text] = colors[index % colors.length]
      return {
        best,
        color: dot,
        crashed: parsed.rows.filter((row) => row.status === 'crash').length,
        explores: typeof branch.explores === 'string' ? branch.explores : '',
        found: typeof branch.found === 'string' ? branch.found : '',
        kept: parsed.rows.filter((row) => row.status === 'keep').length,
        missing: parsed.missing,
        name: String(branch.name ?? `branch ${index + 1}`),
        rows: parsed.rows,
        start,
        state: states[String(branch.state ?? '').toLowerCase()] ? String(branch.state).toLowerCase() : '',
        steps,
        text,
        wins,
      }
    })
    const numeric = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
    const baseline = numeric(config.baseline) ?? branches.find((branch) => branch.start !== null)?.start ?? null
    const best = branches.reduce((found, branch) => (branch.best === null ? found : found === null || gain(branch.best, found) > 0 ? branch.best : found), null)
    const winner = branches.find((branch) => branch.best !== null && branch.best === best)
    const span = baseline !== null && best !== null ? Math.abs(baseline - best) : 0
    return {
      baseline,
      best,
      branches,
      config,
      crashed: branches.reduce((sum, branch) => sum + branch.crashed, 0),
      experiments: branches.reduce((sum, branch) => sum + branch.rows.length, 0),
      gain,
      goal: numeric(config.goal),
      kept: branches.reduce((sum, branch) => sum + branch.kept, 0),
      lower,
      metric: metric ?? 'metric',
      places: digits(span || Math.abs(best ?? baseline ?? 1) / 100),
      title: typeof config.title === 'string' && config.title ? config.title : 'Autoresearch progress',
      winner,
    }
  }

  function digits(span) {
    return Math.max(0, Math.min(6, Math.ceil(-Math.log10(Math.abs(span) || 1)) + 2))
  }

  function format(value, places) {
    return value.toLocaleString('en-US', { maximumFractionDigits: places, minimumFractionDigits: places })
  }

  function ticks(low, high, count) {
    const raw = (high - low) / count
    const power = 10 ** Math.floor(Math.log10(raw))
    const step = [1, 2, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= raw) ?? raw
    const out = []
    for (let tick = Math.ceil(low / step) * step; tick <= high + step * 1e-9; tick += step) out.push(Number(tick.toPrecision(12)))
    return { step, ticks: out }
  }

  function ago(time) {
    const minutes = Math.round((Date.now() - time) / 60_000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes} min ago`
    if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`
    return new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  }

  function cut(text, length) {
    return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text
  }

  function headline(data) {
    const plain = (value) => format(value, data.places)
    const better = data.lower ? 'lower is better' : 'higher is better'
    const parts = [node('p', { class: 'eyebrow' }, `${data.metric}, ${better}`)]
    if (data.best === null) {
      parts.push(node('p', { class: 'big' }, 'No experiments yet'), node('p', { class: 'sub' }, 'The baseline runs first: the code as it is, on the fixed budget. This page fills in as experiments finish.'))
      return parts
    }
    parts.push(node('p', { class: 'big' }, plain(data.best)))
    const improved = data.baseline === null ? 0 : data.gain(data.best, data.baseline)
    const share = data.baseline ? Math.abs(improved / data.baseline) * 100 : 0
    const facts = [
      improved > 0 ? [node('b', null, `${format(share, share >= 10 ? 1 : 2)}% better`), ` than the baseline ${plain(data.baseline)}`] : `No gain on the baseline ${plain(data.baseline)} yet`,
      ` · ${data.experiments} experiments, ${data.kept} kept${data.crashed ? `, ${data.crashed} crashed` : ''}`,
      data.branches.length > 1 && data.winner ? ` · best on ${data.winner.name}` : '',
    ]
    parts.push(node('p', { class: 'sub' }, facts))
    if (data.goal !== null && data.baseline !== null) {
      const whole = data.gain(data.goal, data.baseline)
      const reached = data.gain(data.best, data.goal) >= 0
      const fraction = reached ? 1 : whole > 0 ? Math.max(0, Math.min(1, improved / whole)) : 0
      const words = reached ? `Goal reached: ${plain(data.best)} against a goal of ${plain(data.goal)}.` : `${Math.round(fraction * 100)}% of the way from the baseline to the goal of ${plain(data.goal)}: ${plain(Math.abs(data.best - data.goal))} to go.`
      parts.push(node('div', { class: 'goal' }, node('div', { class: 'bar' }, node('i', { style: `width:${(fraction * 100).toFixed(1)}%` })), node('p', null, words)))
    }
    return parts
  }

  function chart(data, width) {
    const narrow = width < 560
    const height = cover ? Math.max(160, Math.round(plot.clientHeight)) : Math.round(Math.min(420, Math.max(230, width * 0.46)))
    const pad = { bottom: 34, left: narrow ? 52 : 72, right: 12, top: narrow ? 12 : 30 }
    const valid = data.branches.flatMap((branch) => branch.rows.filter((row) => row.status !== 'crash'))
    const anchors = [data.baseline, data.best, data.goal].filter((value) => value !== null)
    if (!anchors.length) return null
    let low = Math.min(...anchors)
    let high = Math.max(...anchors)
    if (high - low <= 0) {
      for (const row of valid) {
        low = Math.min(low, row.value)
        high = Math.max(high, row.value)
      }
    }
    const span = high - low || Math.abs(high) * 0.02 || 1
    low -= span * 0.15
    high += span * 0.15
    const last = Math.max(2, ...data.branches.map((branch) => branch.rows.length))
    const x = (n) => pad.left + ((n - 1) / (last - 1)) * (width - pad.left - pad.right)
    const y = (value) => pad.top + ((high - value) / (high - low)) * (height - pad.top - pad.bottom)
    const inside = (value) => value >= low && value <= high
    const scale = ticks(low, high, 5)
    const places = Math.max(0, -Math.floor(Math.log10(scale.step) + 1e-9))
    const grid = scale.ticks.map((tick) => [
      shape('line', { style: 'stroke:var(--line)', x1: pad.left, x2: width - pad.right, y1: y(tick), y2: y(tick) }),
      shape('text', { 'text-anchor': 'end', x: pad.left - 8, y: y(tick) + 4 }, format(tick, places)),
    ])
    const across = ticks(1, last, narrow ? 4 : 8).ticks.filter((tick) => Number.isInteger(tick) && tick >= 1)
    const axis = [
      shape('line', { style: 'stroke:var(--rule)', x1: pad.left, x2: width - pad.right, y1: height - pad.bottom, y2: height - pad.bottom }),
      ...across.map((tick) => shape('text', { 'text-anchor': 'middle', x: x(tick), y: height - pad.bottom + 16 }, String(tick))),
      shape('text', { 'text-anchor': 'middle', x: pad.left + (width - pad.left - pad.right) / 2, y: height - 4 }, 'Experiment #'),
      !narrow && shape('text', { 'text-anchor': 'middle', transform: `translate(14 ${(pad.top + (height - pad.top - pad.bottom) / 2).toFixed(1)}) rotate(-90)` }, `${data.metric} (${data.lower ? 'lower' : 'higher'} is better)`),
    ]
    const goal = data.goal !== null ? [
      shape('line', { 'stroke-dasharray': '4 4', style: 'stroke:var(--muted)', x1: pad.left, x2: width - pad.right, y1: y(data.goal), y2: y(data.goal) }),
      shape('text', { 'text-anchor': 'end', x: width - pad.right - 4, y: y(data.goal) - 5 }, `goal ${format(data.goal, data.places)}`),
    ] : []
    const discarded = data.branches.flatMap((branch) => branch.rows.filter((row) => row.status === 'discard' && inside(row.value)).map((row) => shape('circle', { cx: x(row.n), cy: y(row.value), 'fill-opacity': 0.7, r: 2.6, style: 'fill:var(--edge)' })))
    const lines = data.branches.filter((branch) => branch.steps.length).map((branch) => {
      const steps = [...branch.steps, [Math.max(branch.rows.length, branch.steps.at(-1)[0]), branch.steps.at(-1)[1]]]
      const path = steps.map(([n, value], index) => (index ? `H${x(n).toFixed(1)}V${y(value).toFixed(1)}` : `M${x(n).toFixed(1)} ${y(value).toFixed(1)}`)).join('')
      return shape('path', { d: path, fill: 'none', 'stroke-linejoin': 'round', 'stroke-opacity': 0.75, 'stroke-width': 2, stroke: branch.color })
    })
    const kept = data.branches.flatMap((branch) => branch.rows.filter((row) => row.status === 'keep' && inside(row.value)).map((row) => shape('circle', { cx: x(row.n), cy: y(row.value), fill: branch.color, r: 4.5, 'stroke-width': 1.5, style: 'stroke:var(--bg)' }, shape('title', null, `#${row.n} ${row.description} (${row.value})`))))
    const labels = []
    if (!narrow && !cover) {
      const placed = []
      const wins = data.branches.flatMap((branch) => branch.wins.filter((row) => row.description && inside(row.value)).map((row) => ({ branch, row })))
      for (const { branch, row } of wins.sort((a, b) => b.row.delta - a.row.delta)) {
        const left = { x: x(row.n) + 6, y: y(row.value) - 6 }
        const room = Math.floor((width - pad.right - left.x) / 0.866 / 5.6)
        if (room < 10) continue
        const text = cut(row.description, Math.min(44, room))
        const at = { ...left, length: text.length * 5.6 }
        const clash = placed.some((other) => {
          const dx = at.x - other.x
          const dy = at.y - other.y
          const along = dx * 0.866 - dy * 0.5
          return Math.abs(dx * 0.5 + dy * 0.866) < 12 && along > -at.length && along < other.length
        })
        if (clash || placed.length >= 24) continue
        placed.push(at)
        labels.push(shape('text', { class: 'label', style: `--t:${branch.text}`, transform: `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)}) rotate(-30)` }, text))
      }
    }
    const hidden = valid.filter((row) => !inside(row.value)).length
    const picture = shape('svg', { 'aria-label': `${data.experiments} experiments, ${data.kept} kept improvements`, height, role: 'img', viewBox: `0 0 ${width} ${height}`, width }, grid, axis, goal, discarded, lines, kept, labels)
    return { hidden, picture }
  }

  function legend(data) {
    const many = data.branches.length > 1
    return node(
      'ul',
      { class: 'legend' },
      many
        ? data.branches.map((branch) => node('li', null, node('span', { class: 'dot', style: `--c:${branch.color}` }), branch.name))
        : node('li', null, node('span', { class: 'dot', style: `--c:${data.branches[0].color}` }), 'Kept'),
      node('li', null, node('span', { class: 'dot grey' }), 'Discarded'),
      node('li', null, node('span', { class: 'dash', style: `--c:${data.branches[0].color}` }), 'Running best'),
      data.goal !== null && node('li', null, node('span', { class: 'dash goal' }), 'Goal'),
    )
  }

  function map(data) {
    return node(
      'section',
      null,
      node('h2', null, 'Branches ', node('span', null, 'the parts of the design space explored so far')),
      node(
        'ol',
        null,
        data.branches.map((branch) => {
          const improved = branch.best !== null && data.baseline !== null ? data.gain(branch.best, data.baseline) : 0
          const facts = [
            `${branch.rows.length} ${branch.rows.length === 1 ? 'experiment' : 'experiments'}`,
            `${branch.kept} kept`,
            branch.crashed ? `${branch.crashed} crashed` : '',
            improved > 0 && data.baseline ? `${format(Math.abs(improved / data.baseline) * 100, 2)}% better than the baseline` : '',
            branch.missing ? `its results have no ${data.metric} column` : '',
          ].filter(Boolean)
          return node(
            'li',
            null,
            node(
              'div',
              { class: 'row' },
              node('span', { class: 'dot', style: `--c:${branch.color}` }),
              node('span', { class: 'name' }, branch.name),
              branch.state && node('span', { class: `chip ${states[branch.state]}` }, branch.state),
              node('span', { class: 'end' }, branch.best === null ? 'no results yet' : format(branch.best, data.places)),
            ),
            branch.explores && node('p', { class: 'meta' }, branch.explores),
            branch.found && node('p', { class: 'meta' }, branch.found),
            (branch.rows.length > 0 || branch.missing) && node('p', { class: 'meta' }, facts.join(' · ')),
          )
        }),
      ),
    )
  }

  function worked(data) {
    const wins = data.branches.flatMap((branch) => branch.wins.filter((row) => row.delta > 0).map((row) => ({ branch, row }))).sort((a, b) => b.row.delta - a.row.delta).slice(0, 10)
    if (!wins.length) return null
    const places = Math.min(6, data.places + 1)
    const many = data.branches.length > 1
    return node(
      'section',
      null,
      node('h2', null, 'What worked ', node('span', null, 'the kept changes, biggest gain first')),
      node(
        'ol',
        null,
        wins.map(({ branch, row }) =>
          node(
            'li',
            null,
            node('div', { class: 'row' }, node('span', { class: 'delta' }, `${data.lower ? '−' : '+'}${format(row.delta, places)}`), node('span', { class: 'what' }, row.description || 'no description')),
            node('p', { class: 'meta' }, [many ? branch.name : '', `experiment ${row.n}`, row.commit].filter(Boolean).join(' · ')),
          ),
        ),
      ),
    )
  }

  function drawPlot() {
    if (!plot || !loaded) return
    const width = Math.max(280, Math.round(plot.clientWidth))
    const drawn = chart(loaded, width)
    plot.replaceChildren(...(drawn ? [drawn.picture] : []))
    const note = root.querySelector('.ar-hidden')
    if (note) note.textContent = drawn && drawn.hidden ? `${drawn.hidden} ${drawn.hidden === 1 ? 'run' : 'runs'} worse than the baseline ${drawn.hidden === 1 ? 'is' : 'are'} off the chart.` : ''
  }

  function updated() {
    const time = Date.parse(loaded?.config.updated ?? '') || stamp
    return time ? `Updated ${ago(time)}. ` : ''
  }

  function draw() {
    const data = loaded
    if (!document.title) document.title = data.title
    plot = node('div', { class: 'plot' })
    if (cover) {
      root.replaceChildren(...[headline(data).slice(0, 2), data.best !== null && plot].flat().filter(Boolean))
      return drawPlot()
    }
    const body = [node('h1', null, data.title), headline(data)]
    if (data.best !== null) {
      body.push(node('section', null, node('h2', null, `${data.experiments} experiments, ${data.kept} kept improvements`), plot, legend(data), node('p', { class: 'note ar-hidden' })))
    }
    if (data.branches.length > 1 || data.branches.some((branch) => branch.explores || branch.state)) body.push(map(data))
    body.push(worked(data))
    body.push(
      node(
        'footer',
        null,
        node('span', { class: 'ar-updated' }, updated()),
        'Each dot is one experiment on a fixed budget: a change that improves the metric is kept and the next one builds on it; the rest are reverted. ',
        node('a', { href: 'https://github.com/karpathy/autoresearch', rel: 'noopener', target: '_blank' }, 'How autoresearch works'),
      ),
    )
    root.replaceChildren(...body.flat().filter(Boolean))
    drawPlot()
  }

  function fail(error) {
    if (loaded) return
    root.replaceChildren(node('h1', null, 'Autoresearch progress'), node('p', { class: 'empty' }, error instanceof Error ? error.message : String(error)))
  }

  async function tick() {
    try {
      const fresh = await load()
      const key = JSON.stringify([fresh.config, fresh.texts])
      if (key !== last) {
        last = key
        loaded = study(fresh)
        draw()
      } else {
        const stamped = root.querySelector('.ar-updated')
        if (stamped) stamped.textContent = updated()
      }
    } catch (error) {
      fail(error)
    }
  }

  function start() {
    if (![...document.querySelectorAll('link[rel=stylesheet]')].some((link) => link.href === theme)) document.head.append(node('link', { href: theme, rel: 'stylesheet' }))
    document.head.append(node('style', null, css))
    if (cover) document.documentElement.setAttribute('data-cover', '')
    root = document.querySelector('main.ar') ?? document.body.appendChild(node('main', { class: 'ar' }))
    let width = 0
    new ResizeObserver(() => {
      const next = Math.round(plot?.clientWidth ?? 0)
      if (next && next !== width) {
        width = next
        drawPlot()
      }
    }).observe(root)
    void tick()
    setInterval(tick, 60_000)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
