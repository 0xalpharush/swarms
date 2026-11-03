import { File, PatchDiff } from '@pierre/diffs/react'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { useEffect, useMemo, useState } from 'react'
import type { Code as Repo, Pushed } from '../shared/Api.ts'
import { ago, usd } from './format.ts'
import { message, useMedia } from './hooks.ts'
import { Link } from './router.tsx'

export type Commit = { author?: { email: string | null; name: string | null }; date: string | null; message: string; parents?: string[]; sha: string }

export type Change = { additions: number; deletions: number; oldPath: string | null; patch: string; path: string; state: string | null }

const theme = { theme: 'pierre-light' } as const

export const unified = { diffStyle: 'unified', theme: 'pierre-light' } as const

export async function read<value>(url: string): Promise<value> {
  const response = await fetch(url)
  const data = (await response.json().catch(() => undefined)) as (value & { detail?: string }) | undefined
  if (!response.ok || !data) throw new Error(data?.detail ?? `The gateway answered ${response.status}.`)
  return data
}

function Tree(props: { onSelect: (path: string) => void; paths: readonly string[] }) {
  const onSelect = props.onSelect
  const known = useMemo(() => new Set(props.paths), [props.paths])
  const { model } = useFileTree({
    flattenEmptyDirectories: true,
    initialExpandedPaths: [],
    onSelectionChange: (selected) => {
      const path = selected.find((item) => known.has(item))
      if (path) onSelect(path)
    },
    paths: props.paths,
  })

  useEffect(() => {
    model.resetPaths(props.paths)
  }, [model, props.paths])

  return <FileTree className="code-tree" model={model} />
}

export function Viewer(props: { base: string; path: string; sha: string }) {
  const [state, setState] = useState<{ error?: string; source?: { size: number; text?: string } }>({})
  const narrow = useMedia('(max-width: 799px)')

  useEffect(() => {
    let alive = true
    setState({})
    read<{ size: number; text?: string }>(`${props.base}/read?path=${encodeURIComponent(props.path)}&ref=${props.sha}`).then(
      (source) => alive && setState({ source }),
      (error: unknown) => alive && setState({ error: message(error) }),
    )
    return () => {
      alive = false
    }
  }, [props.base, props.path, props.sha])

  const file = useMemo(
    () => (state.source?.text === undefined ? undefined : { cacheKey: `${props.sha}:${props.path}`, contents: state.source.text, name: props.path }),
    [props.path, props.sha, state.source],
  )

  if (state.error) return <p className="error">{state.error}</p>
  if (!state.source) return <p className="empty">Loading {props.path}…</p>
  if (!file) return <p className="empty">{props.path} is binary, {state.source.size.toLocaleString('en-US')} bytes.</p>
  return <File className="code-view" file={file} options={narrow ? { ...theme, overflow: 'wrap' } : theme} />
}

export function patch(change: Change) {
  if (/^(diff --git|---) /m.test(change.patch.split('\n')[0] ?? '')) return change.patch
  const before = change.state === 'A' ? '/dev/null' : `a/${change.oldPath ?? change.path}`
  const after = change.state === 'D' ? '/dev/null' : `b/${change.path}`
  return `--- ${before}\n+++ ${after}\n${change.patch}`
}

function Changes(props: { base: string; from: string | null; to: string }) {
  const [state, setState] = useState<{ error?: string; files?: Change[] }>({})
  const narrow = useMedia('(max-width: 799px)')

  useEffect(() => {
    let alive = true
    read<{ files: Change[] }>(`${props.base}/diff?ref=${props.to}${props.from ? `&base=${props.from}` : ''}`).then(
      (diff) => alive && setState({ files: diff.files }),
      (error: unknown) => alive && setState({ error: message(error) }),
    )
    return () => {
      alive = false
    }
  }, [props.base, props.from, props.to])

  if (state.error) return <p className="error">{state.error}</p>
  if (!state.files) return <p className="empty">Loading the diff…</p>
  if (!state.files.length) return <p className="empty">No files changed.</p>
  return (
    <div className="code-diff">
      {state.files.map((change) =>
        change.patch ? (
          <PatchDiff className="code-view" key={change.path} options={narrow ? { ...unified, overflow: 'wrap' } : unified} patch={patch(change)} />
        ) : (
          <p className="fine" key={change.path}>
            {change.path}: {change.state}, +{change.additions} −{change.deletions}
          </p>
        ),
      )}
    </div>
  )
}

function Diffs(props: { base: string; commits: readonly Commit[]; update: Pushed }) {
  const shas = props.update.commits
  if (props.update.base || shas.length === 1) return <Changes base={props.base} from={props.update.base} to={shas[0] ?? ''} />
  return (
    <>
      {shas.map((sha) => (
        <div className="code-sub" key={sha}>
          <p className="code-sub-head"><code>{sha.slice(0, 7)}</code> {props.commits.find((commit) => commit.sha === sha)?.message.split('\n')[0]}</p>
          <Changes base={props.base} from={null} to={sha} />
        </div>
      ))}
    </>
  )
}

function first(paths: readonly string[]) {
  return paths.find((path) => /^readme(\.md)?$/i.test(path)) ?? paths.find((path) => /readme/i.test(path)) ?? paths[0]
}

function Copy(props: { label?: string; text: string }) {
  const [done, setDone] = useState(false)
  return <button className="code-copy" onClick={() => void navigator.clipboard?.writeText(props.text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500) })} type="button">{done ? 'Copied' : (props.label ?? 'Copy path')}</button>
}

export function Clone(props: { repo: Repo }) {
  const command = `git clone ${props.repo.clone} ${props.repo.name}`
  return (
    <div className="code-clone">
      <code title={command}>{command}</code>
      <Copy label="Copy" text={command} />
    </div>
  )
}

export function Code(props: { gateway: string; repo: Repo; swarm: string; updates: readonly Pushed[] }) {
  const base = `${props.gateway}/p/${props.repo.owner}/${props.repo.app}/git/${encodeURIComponent(props.repo.name)}`
  const version = String(props.updates.at(-1)?.at ?? 0)
  const [state, setState] = useState<{ commits?: Commit[]; error?: string; files?: string[] }>({})
  const [path, setPath] = useState<string>()
  const [open, setOpen] = useState<number>()

  useEffect(() => {
    let alive = true
    Promise.all([
      read<{ commits: Commit[] }>(`${base}/log?ref=main&limit=50&v=${encodeURIComponent(version)}`),
      read<{ files: { path: string; type: string }[] }>(`${base}/files?ref=main&v=${encodeURIComponent(version)}`),
    ]).then(
      ([log, files]) => alive && setState({ commits: log.commits, files: files.files.filter((file) => file.type !== 'tree').map((file) => file.path) }),
      (error: unknown) => alive && setState({ error: message(error) }),
    )
    return () => {
      alive = false
    }
  }, [base, version])

  const pushed = [...props.updates].filter((update) => update.commits.length).reverse()
  const commits = state.commits
  const head = commits?.[0]
  const shown = path ?? (state.files ? first(state.files) : undefined)
  const browser = `/s/${encodeURIComponent(props.swarm)}/code`

  if (state.error) return <p className="machine-none">{state.error}</p>
  if (!commits || !state.files)
    return (
      <div className="repo-card" aria-busy="true">
        <header className="repo-card-head"><span className="code-glyph" aria-hidden="true">{'</>'}</span><b>{props.repo.name}</b></header>
        <div className="code-browse"><div className="code-tree code-ghost" /><div className="code-file code-ghost" /></div>
      </div>
    )
  if (!head)
    return (
      <div className="repo-card">
        <header className="repo-card-head"><span className="code-glyph" aria-hidden="true">{'</>'}</span><b>{props.repo.name}</b><span className="repo-card-meta">empty</span></header>
        <p className="machine-none">No commits yet. Each one shows up here as it lands.</p>
      </div>
    )

  return (
    <div className="code-page">
      <div className="repo-card">
        <header className="repo-card-head">
          <span className="code-glyph" aria-hidden="true">{'</>'}</span>
          <b>{props.repo.name}</b>
          <span className="repo-card-meta">{commits.length === 1 ? '1 commit' : `${commits.length} commits`} · {state.files.length} files · {head.date ? ago(Date.parse(head.date)) : head.sha.slice(0, 7)}</span>
          <Link className="repo-card-open" to={browser}>Full browser →</Link>
        </header>
        <Clone repo={props.repo} />
        <div className="code-browse">
          <Tree onSelect={setPath} paths={state.files} />
          <div className="code-file">
            {shown ? (
              <>
                <div className="code-file-bar"><span>{shown}</span><code>{head.sha.slice(0, 7)}</code><Copy text={shown} /></div>
                <Viewer base={base} path={shown} sha={head.sha} />
              </>
            ) : (
              <p className="machine-none">No files.</p>
            )}
          </div>
        </div>
      </div>
      {pushed.length > 0 && (
        <ol className="tiles-swarm code-log">
          {pushed.map((update) => {
            const single = update.commits.length === 1 ? commits.find((commit) => commit.sha === update.commits[0]) : undefined
            return (
              <li data-open={open === update.at} key={update.at}>
                <button aria-expanded={open === update.at} className="tile-swarm machine-row" onClick={() => setOpen(open === update.at ? undefined : update.at)} type="button">
                  <i aria-hidden="true" className="machine-glyph" data-state={open === update.at ? 'on' : 'idle'}>±</i>
                  <span className="tile-title">{single?.message.split('\n')[0] ?? `${update.commits.length} commits`}</span>
                  <span className="tile-raised">{usd(update.spent)}</span>
                  <span className="machine-sub">{update.commits.map((sha) => sha.slice(0, 7)).join(' ')} · {ago(update.at)}</span>
                </button>
                {open === update.at && <div className="machine-open code-open"><Diffs base={base} commits={commits} update={update} /></div>}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
