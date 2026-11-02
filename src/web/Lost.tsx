import type { ReactNode } from 'react'

export function Lost(props: { children: ReactNode; title: string }) {
  return (
    <section className="page lost">
      <span className="lost-orbit" aria-hidden="true"><i /><i /><i /></span>
      <h1>{props.title}</h1>
      <nav className="lost-actions">{props.children}</nav>
    </section>
  )
}
