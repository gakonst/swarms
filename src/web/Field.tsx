import { type RefObject, useEffect, useRef, useState } from 'react'
import type { Mood } from '../shared/Status.ts'
import type { Field as Engine, Hive, Home } from './gl.ts'

export type { Hive, Home }

type Props = {
  avoid?: RefObject<HTMLElement | null> | undefined
  focus?: string | undefined
  group?: Mood | undefined
  hives: readonly Hive[]
  homes: Partial<Record<Home, RefObject<HTMLElement | null>>>
  ignore?: string | undefined
  onFail?: (() => void) | undefined
  onPick?: ((id: string | undefined) => void) | undefined
  surface: RefObject<HTMLElement | null>
  tags?: RefObject<HTMLElement | null> | undefined
}

function key(hives: readonly Hive[]) {
  return hives.map((hive) => [hive.id, hive.mood, hive.weight, hive.title, hive.detail, hive.home, hive.about, hive.facts, hive.fresh, hive.updated].join('\u0001')).join('\u0002')
}

export function Field(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const label = useRef<HTMLDivElement>(null)
  const engine = useRef<Engine | undefined>(undefined)
  const latest = useRef(props)
  latest.current = props
  const [ready, setReady] = useState(false)
  const hives = key(props.hives)

  useEffect(() => {
    let alive = true
    let detach = () => {}
    const fail = () => {
      if (alive) latest.current.onFail?.()
    }
    import('./gl.ts')
      .then((gl) => {
        const element = canvas.current
        if (!alive || !element) return
        const field = gl.start({
          avoid: () => [latest.current.avoid?.current],
          canvas: element,
          homes: () => ({ join: latest.current.homes.join?.current, start: latest.current.homes.start?.current }),
          label: label.current ?? undefined,
          onPick: (id) => latest.current.onPick?.(id),
          still: matchMedia('(prefers-reduced-motion: reduce)').matches,
          tags: latest.current.tags?.current,
        })
        if (!field) return fail()
        engine.current = field
        field.hives(latest.current.hives)
        field.focus(latest.current.focus)
        field.group(latest.current.group)
        let seen = true
        const sync = () => field.run(seen && document.visibilityState === 'visible')
        const watcher = new IntersectionObserver((entries) => {
          seen = entries.some((entry) => entry.isIntersecting)
          sync()
        })
        watcher.observe(element)
        document.addEventListener('visibilitychange', sync)
        const surface = latest.current.surface.current
        const sizer = new ResizeObserver(() => field.layout())
        if (surface) sizer.observe(surface)
        document.fonts?.ready.then(() => {
          if (alive) field.layout()
        })
        const move = (event: PointerEvent) => {
          const ignore = latest.current.ignore
          const over = ignore && event.target instanceof Element && event.target.closest(ignore)
          if (over) field.pointer(undefined, undefined)
          else field.pointer(event.clientX, event.clientY)
        }
        const leave = () => field.pointer(undefined, undefined)
        surface?.addEventListener('pointermove', move)
        surface?.addEventListener('pointerdown', move)
        surface?.addEventListener('pointerleave', leave)
        detach = () => {
          watcher.disconnect()
          sizer.disconnect()
          document.removeEventListener('visibilitychange', sync)
          surface?.removeEventListener('pointermove', move)
          surface?.removeEventListener('pointerdown', move)
          surface?.removeEventListener('pointerleave', leave)
        }
        requestAnimationFrame(() => {
          if (alive) setReady(true)
        })
      })
      .catch(fail)
    return () => {
      alive = false
      detach()
      engine.current?.stop()
      engine.current = undefined
    }
  }, [])

  useEffect(() => {
    engine.current?.hives(latest.current.hives)
  }, [hives])

  useEffect(() => {
    engine.current?.focus(props.focus)
  }, [props.focus])

  useEffect(() => {
    engine.current?.group(props.group)
  }, [props.group])

  return (
    <>
      <canvas aria-hidden="true" className="sky-field" data-ready={ready} ref={canvas} />
      <div aria-hidden="true" className="sky-label" data-shown="false" ref={label}>
        <b data-part="title" />
        <small data-part="detail" />
        <span data-part="about" />
        <small data-part="facts" />
      </div>
    </>
  )
}
