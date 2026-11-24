import type { CodeHighlighterPlugin, Components, HtmlOptions, PluginConfig } from '@pierre/words/html'
import { use, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { normalize } from '../shared/Math.ts'

type Words = typeof import('@pierre/words/html')

type Painter = ReturnType<Words['createDomRenderer']>

let words: Words | undefined

let reading: Promise<Words> | undefined

let plugins: PluginConfig | undefined

let loading: Promise<void> | undefined

const heard = new Set<() => void>()

const fence = /^ {0,3}(`{3,}|~{3,})/m

const components: Components = { a: (html) => html.replace('<a ', '<a rel="noreferrer" target="_blank" ') }

const controls = { code: { copy: true, download: false } }

const marks = { mark: ['class', 'data-me', 'data-swarm'] }

const spans = ['strong', 'em', 'code', 'del', 'mark', 'svg', 'g', 'text']

let inline: { line: ReturnType<Words['createHtmlRenderer']>; linked: ReturnType<Words['createHtmlRenderer']> } | undefined

function tell() {
  for (const listen of heard) listen()
}

export function provide(module: Words) {
  words = module
  tell()
}

export function read() {
  if (words) return Promise.resolve(words)
  return (reading ??= import('@pierre/words/html').then(
    (module) => {
      provide(module)
      return module
    },
    (error: unknown) => {
      reading = undefined
      throw error
    },
  ))
}

export function highlighted(plugin: CodeHighlighterPlugin) {
  plugins = { code: plugin }
  tell()
}

export function highlight() {
  if (plugins) return Promise.resolve()
  return (loading ??= import('./highlight.ts').then(
    (module) => highlighted(module.code),
    () => {
      loading = undefined
    },
  ))
}

function subscribe(listen: () => void) {
  heard.add(listen)
  return () => {
    heard.delete(listen)
  }
}

function loaded() {
  return words
}

function current() {
  return plugins
}

function quiet() {
  return () => {}
}

function yes() {
  return true
}

function no() {
  return false
}

function useHydrating() {
  return !useSyncExternalStore(quiet, yes, no)
}

function resolve(base: string | undefined) {
  return (url: string) => {
    const plain = words?.defaultUrlTransform ?? ((given: string) => given)
    if (!base || /^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(url)) return plain(url)
    try {
      return new URL(url, base).href
    } catch {
      return plain(url)
    }
  }
}

function lines(module: Words) {
  return (inline ??= {
    line: module.createHtmlRenderer({ allowedElements: spans, controls: false, math: true, unwrapDisallowed: true }),
    linked: module.createHtmlRenderer({ allowedElements: [...spans, 'a'], components, controls: false, math: true, unwrapDisallowed: true }),
  })
}

export function Markdown(props: { base?: string; compact?: boolean; marks?: boolean; streaming?: boolean; text: string }) {
  const id = useId()
  const hydrating = useHydrating()
  const highlighter = useSyncExternalStore(subscribe, current, current)
  const fenced = fence.test(props.text)
  const transform = useMemo(() => resolve(props.base), [props.base])
  const body = useMemo(() => normalize(props.text, false), [props.text])
  const active = props.streaming === true
  const options: HtmlOptions = {
    ...(props.marks ? { allowedHtml: marks } : {}),
    ...(fenced && highlighter ? { plugins: highlighter } : {}),
    components,
    controls,
    idPrefix: `${id}-`,
    lineNumbers: false,
    math: true,
    urlTransform: transform,
  }
  const [markup] = useState(() => {
    if (!words) return hydrating ? { __html: '' } : undefined
    const formatter = words.createHtmlRenderer(options)
    try {
      return { __html: formatter.render(body, active, active).html }
    } finally {
      formatter.dispose()
    }
  })
  if (!markup) use(read())
  const root = useRef<HTMLDivElement>(null)
  const painter = useRef<Painter | undefined>(undefined)
  const latest = useRef({ active, body, options })
  latest.current = { active, body, options }

  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    let live = true
    const attach = (module: Words) => {
      if (!live || painter.current) return
      const { active, body } = latest.current
      const options = { ...latest.current.options, ...(fence.test(body) && plugins ? { plugins } : {}) }
      const formatter = module.createHtmlRenderer(options)
      formatter.render(body, active, active)
      painter.current = module.createDomRenderer(element, options, formatter)
      formatter.dispose()
      painter.current.connect()
      painter.current.update(body, active, active, false, 'block')
    }
    const ready = fence.test(latest.current.body) && !plugins ? highlight().then(read) : read()
    if (words && !(fence.test(latest.current.body) && !plugins)) attach(words)
    else void ready.then(attach, () => {})
    return () => {
      live = false
      painter.current?.disconnect()
      painter.current = undefined
    }
  }, [])

  useLayoutEffect(() => {
    if (fenced && !highlighter) void highlight()
    painter.current?.configure(options)
    painter.current?.update(body, active, active, false, 'block')
  })

  return <div className="markdown" data-compact={props.compact || undefined} data-markdown="root" data-streaming={active || undefined} dangerouslySetInnerHTML={markup} ref={root} suppressHydrationWarning />
}

export function Inline(props: { className?: string; links?: boolean; text: string }) {
  const hydrating = useHydrating()
  const module = useSyncExternalStore(subscribe, loaded, loaded)
  const asked = `${props.links ? 'a' : 's'}${props.text}`
  const kept = useRef(!module && hydrating ? asked : undefined)
  if (module) kept.current = undefined
  if (!module && kept.current === undefined) use(read())
  useLayoutEffect(() => {
    if (!module) void read().catch(() => {})
  }, [module])
  const html = useMemo(() => (module ? (props.links ? lines(module).linked : lines(module).line).render(normalize(props.text, true), false).html.trim() : ''), [module, props.links, props.text])
  return <span className={props.className ? `inline ${props.className}` : 'inline'} dangerouslySetInnerHTML={{ __html: html }} suppressHydrationWarning />
}
