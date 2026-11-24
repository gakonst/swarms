import { createHtmlRenderer } from '@pierre/words/html'
import { type CodeHighlighterPlugin, type Components, defaultUrlTransform, type PluginConfig, Markdown as Words } from '@pierre/words/react'
import { useEffect, useMemo, useSyncExternalStore } from 'react'

let plugins: PluginConfig | undefined

let loading: Promise<void> | undefined

const heard = new Set<() => void>()

const fence = /^ {0,3}(`{3,}|~{3,})/m

const components: Components = { a: (html) => html.replace('<a ', '<a rel="noreferrer" target="_blank" ') }

const controls = { code: { copy: true, download: false } }

const marks = { mark: ['class', 'data-me', 'data-swarm'] }

const line = createHtmlRenderer({ allowedElements: ['strong', 'em', 'code', 'del', 'mark'], controls: false, unwrapDisallowed: true })

export function highlighted(plugin: CodeHighlighterPlugin) {
  plugins = { code: plugin }
  for (const listen of heard) listen()
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

function current() {
  return plugins
}

function resolve(base: string | undefined) {
  return (url: string) => {
    if (!base || /^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(url)) return defaultUrlTransform(url)
    try {
      return new URL(url, base).href
    } catch {
      return defaultUrlTransform(url)
    }
  }
}

export function Markdown(props: { base?: string; compact?: boolean; marks?: boolean; streaming?: boolean; text: string }) {
  const loaded = useSyncExternalStore(subscribe, current, current)
  const fenced = fence.test(props.text)
  const transform = useMemo(() => resolve(props.base), [props.base])
  useEffect(() => {
    if (fenced && !loaded) void highlight()
  }, [fenced, loaded])
  return (
    <Words
      {...(props.marks ? { allowedHtml: marks } : {})}
      {...(fenced && loaded ? { plugins: loaded } : {})}
      caret="block"
      className="markdown"
      components={components}
      controls={controls}
      data-compact={props.compact || undefined}
      isAnimating={props.streaming === true}
      lineNumbers={false}
      math
      mode={props.streaming === undefined ? 'static' : 'streaming'}
      urlTransform={transform}
    >
      {props.text}
    </Words>
  )
}

export function Inline(props: { className?: string; text: string }) {
  const html = useMemo(() => line.render(props.text, true).html.trim(), [props.text])
  return <span className={props.className ? `inline ${props.className}` : 'inline'} dangerouslySetInnerHTML={{ __html: html }} />
}
