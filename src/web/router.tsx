import { type MouseEvent, type ReactNode, useSyncExternalStore } from 'react'
import { fixture } from './api.ts'
import { here } from './boot.ts'

function subscribe(listener: () => void) {
  addEventListener('popstate', listener)
  return () => removeEventListener('popstate', listener)
}

export function usePath() {
  return useSyncExternalStore(subscribe, () => location.pathname, () => here().pathname)
}

export function href(path: string) {
  if (!fixture) return path
  const base = here()
  const url = new URL(path, base.origin)
  const scene = base.searchParams.get('scene')
  url.searchParams.set('fixture', '')
  if (scene) url.searchParams.set('scene', scene)
  return `${url.pathname}${url.search}${url.hash}`
}

export function navigate(path: string, options: { replace?: boolean } = {}) {
  if (options.replace) history.replaceState(null, '', href(path))
  else history.pushState(null, '', href(path))
  dispatchEvent(new PopStateEvent('popstate'))
  scrollTo(0, 0)
}

export function Link(props: { children: ReactNode; className?: string; to: string }) {
  return (
    <a
      className={props.className}
      href={href(props.to)}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        navigate(props.to)
      }}
    >
      {props.children}
    </a>
  )
}
