import { useEffect, useState } from 'react'
import type { Artifact, Form } from '../shared/Api.ts'
import { ago } from './format.ts'
import { message, useNow } from './hooks.ts'
import { Markdown } from './Markdown.tsx'

const glyphs = { image: '◩', json: '{ }', markdown: '¶', page: '▦', table: '▤', text: '≡' } as const satisfies Record<Form, string>

const named = { image: 'Image', json: 'Data', markdown: 'Write-up', page: 'Live page', table: 'Table', text: 'Text' } as const satisfies Record<Form, string>

function source(artifact: Artifact, nonce: number) {
  return /^https?:/.test(artifact.url) ? `${artifact.url}?v=${artifact.version}${nonce ? `.${nonce}` : ''}` : artifact.url
}

function rows(text: string, separator: string) {
  const table: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length && table.length < 500; index++) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"'
        index++
      } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === separator) {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++
      row.push(cell)
      if (row.some((value) => value !== '')) table.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  if (cell || row.length) table.push([...row, cell])
  return table
}

function Grid(props: { rows: string[][] }) {
  const [head = [], ...body] = props.rows
  return (
    <div className="artifact-table">
      <table>
        <thead>
          <tr>{head.map((cell, index) => <th key={index}>{cell}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, index) => (
            <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Text(props: { artifact: Artifact; nonce: number }) {
  const artifact = props.artifact
  const [state, setState] = useState<{ error?: string; text?: string }>({})
  const url = source(artifact, props.nonce)

  useEffect(() => {
    let alive = true
    setState({})
    fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`The artifact answered ${response.status}.`)
        return response.text()
      })
      .then(
        (text) => alive && setState({ text }),
        (error: unknown) => alive && setState({ error: message(error) }),
      )
    return () => {
      alive = false
    }
  }, [url])

  if (state.error) return <p className="error artifact-note">{state.error}</p>
  if (state.text === undefined) return <p className="empty artifact-note">Loading…</p>
  if (artifact.form === 'markdown') return <div className="artifact-prose"><Markdown base={artifact.url} text={state.text} /></div>
  if (artifact.form === 'table') return <Grid rows={rows(state.text, artifact.entry.endsWith('.tsv') ? '\t' : ',')} />
  if (artifact.form === 'json') {
    try {
      const value: unknown = JSON.parse(state.text)
      if (Array.isArray(value) && value.length && value.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item))) {
        const keys = [...new Set(value.flatMap((item) => Object.keys(item as object)))]
        return <Grid rows={[keys, ...value.slice(0, 500).map((item) => keys.map((key) => { const cell = (item as Record<string, unknown>)[key]; return typeof cell === 'string' ? cell : JSON.stringify(cell) ?? '' }))]} />
      }
      return <pre className="artifact-pre">{JSON.stringify(value, null, 2)}</pre>
    } catch {
      return <pre className="artifact-pre">{state.text}</pre>
    }
  }
  return <pre className="artifact-pre">{state.text}</pre>
}

function View(props: { artifact: Artifact }) {
  const artifact = props.artifact
  const now = useNow(30_000)
  const [nonce, setNonce] = useState(0)
  const [full, setFull] = useState(false)
  const link = /^https?:/.test(artifact.url)

  useEffect(() => {
    if (!full) return
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setFull(false)
    addEventListener('keydown', close)
    return () => removeEventListener('keydown', close)
  }, [full])

  return (
    <section aria-label={artifact.title} className="artifact-view" data-form={artifact.form} data-full={full}>
      <header className="artifact-bar">
        <div className="artifact-name">
          <h2>{artifact.title}</h2>
          <p>
            {artifact.kind} · version {artifact.version}
            {artifact.updatedAt ? ` · updated ${ago(artifact.updatedAt, now)}` : ''}
          </p>
        </div>
        <div className="artifact-actions">
          <button className="btn btn-low" onClick={() => setNonce(Date.now())} title="Load it again" type="button">Reload</button>
          <button className="btn btn-low" onClick={() => setFull(!full)} type="button">{full ? 'Close' : 'Expand'}</button>
          {link && <a className="btn btn-low" href={source(artifact, nonce)} rel="noreferrer" target="_blank">Open ↗</a>}
        </div>
      </header>
      {artifact.summary && <p className="artifact-summary">{artifact.summary}</p>}
      <div className="artifact-body">
        {artifact.form === 'page' ? (
          <iframe
            allow="fullscreen"
            className="artifact-frame"
            key={`${artifact.slug}:${artifact.version}:${nonce}`}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
            src={source(artifact, nonce)}
            title={artifact.title}
          />
        ) : artifact.form === 'image' ? (
          <div className="artifact-image">
            <img alt={artifact.title} src={source(artifact, nonce)} />
          </div>
        ) : (
          <Text artifact={artifact} nonce={nonce} />
        )}
      </div>
    </section>
  )
}

export function Artifacts(props: { artifacts: readonly Artifact[] | undefined; error: string | undefined; onSelect: (slug: string) => void; selected: string | undefined; working: boolean }) {
  const now = useNow(30_000)
  const list = props.artifacts
  if (!list)
    return <p className="empty artifact-note">{props.error ? `Could not list the artifacts. ${props.error}` : 'Looking for artifacts…'}</p>
  if (!list.length)
    return (
      <div className="artifact-empty">
        <p className="label">Artifacts</p>
        <h2>Dashboards, charts and write-ups land here</h2>
        <p>
          The lead publishes them as the work goes, so you can follow the numbers without reading every step of the transcript.
          {props.working ? ' None yet this run.' : ''} Want one? Ask in the room, for example <span className="mention" data-swarm="true">@swarm</span> publish a live leaderboard of the results.
        </p>
      </div>
    )
  const current = list.find((artifact) => artifact.slug === props.selected) ?? list[0]
  return (
    <div className="artifacts">
      <ol className="artifact-list">
        {list.map((artifact) => (
          <li key={artifact.slug}>
            <button aria-pressed={artifact.slug === current?.slug} className="artifact-item" onClick={() => props.onSelect(artifact.slug)} type="button">
              <span aria-hidden className="artifact-glyph" data-form={artifact.form}>{glyphs[artifact.form]}</span>
              <span className="artifact-item-text">
                <b>{artifact.title}</b>
                <span>
                  {named[artifact.form]}
                  {artifact.updatedAt ? ` · ${ago(artifact.updatedAt, now)}` : ` · v${artifact.version}`}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {current && <View artifact={current} key={current.slug} />}
    </div>
  )
}
