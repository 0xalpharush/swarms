import { PatchDiff } from '@pierre/diffs/react'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Config, Detail } from '../shared/Api.ts'
import * as Api from './api.ts'
import { type Change, type Commit, patch, read, unified, Viewer } from './Code.tsx'
import { ago, usd } from './format.ts'
import { message, useNow, usePoll } from './hooks.ts'
import { Link } from './router.tsx'
import { Status } from './Visual.tsx'

type Mark = 'added' | 'deleted' | 'modified' | 'renamed'

const pollMs = 15_000

const flashMs = 12_000

const marks: Record<string, Mark> = { A: 'added', D: 'deleted', R: 'renamed' }

function mark(change: Change): Mark {
  return marks[change.state?.[0]?.toUpperCase() ?? ''] ?? 'modified'
}

function title(commit: Commit) {
  return commit.message.split('\n')[0] ?? ''
}

function query() {
  const params = new URLSearchParams(location.search)
  return { path: params.get('path') ?? undefined, ref: params.get('ref') ?? undefined }
}

function remember(ref: string | undefined, path: string | undefined) {
  const url = new URL(location.href)
  for (const [name, value] of [['ref', ref], ['path', path]] as const) {
    if (value) url.searchParams.set(name, value)
    else url.searchParams.delete(name)
  }
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

function Tree(props: { changes: readonly Change[]; onSelect: (path: string) => void; paths: readonly string[] }) {
  const onSelect = props.onSelect
  const known = useMemo(() => new Set(props.paths), [props.paths])
  const marks = useMemo(() => props.changes.filter((change) => known.has(change.path)).map((change) => ({ path: change.path, status: mark(change) })), [props.changes, known])
  const { model } = useFileTree({
    flattenEmptyDirectories: true,
    gitStatus: marks,
    initialExpandedPaths: [],
    onSelectionChange: (selected) => {
      const path = selected.find((item) => known.has(item))
      if (path) onSelect(path)
    },
    paths: props.paths,
    search: true,
  })

  useEffect(() => {
    model.resetPaths(props.paths)
  }, [model, props.paths])

  useEffect(() => {
    model.setGitStatus(marks)
  }, [model, marks])

  return <FileTree className="repo-tree" model={model} />
}

function Changes(props: { changes: readonly Change[] }) {
  const shown = props.changes
  if (!shown.length) return <p className="empty">No files changed.</p>
  return (
    <div className="code-diff">
      {shown.map((change) =>
        change.patch ? (
          <PatchDiff className="code-view" key={change.path} options={unified} patch={patch(change)} />
        ) : (
          <p className="fine" key={change.path}>
            {change.path}: {mark(change)}, +{change.additions} −{change.deletions}
          </p>
        ),
      )}
    </div>
  )
}

function Timeline(props: {
  commits: readonly Commit[]
  fresh: ReadonlySet<string>
  more: boolean
  onMore: () => void
  onPick: (sha: string) => void
  rounds: ReadonlyMap<string, number>
  selected: string
}) {
  const now = useNow()
  return (
    <ol className="repo-commits">
      {props.commits.map((commit, index) => {
        const round = props.rounds.get(commit.sha)
        const previous = props.commits[index - 1]
        const opens = round !== undefined && (previous === undefined || props.rounds.get(previous.sha) !== round)
        return (
          <li data-fresh={props.fresh.has(commit.sha)} data-on={commit.sha === props.selected} key={commit.sha}>
            {opens && <p className="repo-round">Round {round}</p>}
            <button onClick={() => props.onPick(commit.sha)} type="button">
              <span className="repo-commit-title">{title(commit)}</span>
              <span className="repo-commit-meta">
                <code>{commit.sha.slice(0, 7)}</code>
                {commit.author?.name && <span>{commit.author.name}</span>}
                {commit.date && <span>{ago(Date.parse(commit.date), now)}</span>}
              </span>
            </button>
          </li>
        )
      })}
      {props.more && (
        <li>
          <button className="btn btn-minimal" onClick={props.onMore} type="button">
            Older commits
          </button>
        </li>
      )}
    </ol>
  )
}

function Browser(props: { base: string; detail: Detail; live: boolean }) {
  const initial = useRef(query())
  const [log, setLog] = useState<{ commits: Commit[]; cursor: string | null; error?: string }>()
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set())
  const [pinned, setPinned] = useState<string | undefined>(initial.current.ref)
  const [path, setPath] = useState<string | undefined>(initial.current.path)
  const [tab, setTab] = useState<'changes' | 'file'>(initial.current.path ? 'file' : 'changes')
  const [tree, setTree] = useState<{ error?: string; paths?: string[]; ref?: string }>({})
  const [diff, setDiff] = useState<{ changes?: Change[]; error?: string; ref?: string }>({})
  const known = useRef(new Set<string>())

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      try {
        const page = await read<{ commits: Commit[]; cursor: string | null }>(`${props.base}/log?ref=main&limit=50&at=${Math.floor(Date.now() / pollMs)}`)
        if (!alive) return
        const added = known.current.size ? page.commits.filter((commit) => !known.current.has(commit.sha)).map((commit) => commit.sha) : []
        for (const commit of page.commits) known.current.add(commit.sha)
        setLog((previous) => {
          if (!previous) return page
          const newer = page.commits.filter((commit) => !previous.commits.some((old) => old.sha === commit.sha))
          return { commits: [...newer, ...previous.commits], cursor: previous.cursor }
        })
        if (added.length) {
          setFresh((previous) => new Set([...previous, ...added]))
          setTimeout(() => alive && setFresh((previous) => new Set([...previous].filter((sha) => !added.includes(sha)))), flashMs)
        }
      } catch (error) {
        if (alive) setLog((previous) => previous ?? { commits: [], cursor: null, error: message(error) })
      }
      if (alive && props.live) timer = setTimeout(() => void run(), pollMs)
    }
    void run()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [props.base, props.live])

  const head = log?.commits[0]?.sha
  const ref = pinned ?? head

  useEffect(() => {
    remember(pinned, path)
  }, [pinned, path])

  useEffect(() => {
    if (!ref) return
    let alive = true
    read<{ files: { path: string; type: string }[] }>(`${props.base}/files?ref=${ref}`).then(
      (files) => alive && setTree({ paths: files.files.filter((file) => file.type !== 'tree').map((file) => file.path), ref }),
      (error: unknown) => alive && setTree({ error: message(error), ref }),
    )
    read<{ files: Change[] }>(`${props.base}/diff?ref=${ref}`).then(
      (found) => alive && setDiff({ changes: found.files, ref }),
      (error: unknown) => alive && setDiff({ error: message(error), ref }),
    )
    return () => {
      alive = false
    }
  }, [props.base, ref])

  const rounds = useMemo(() => {
    const map = new Map<string, number>()
    for (const round of props.detail.history) for (const sha of round.commits) map.set(sha, round.n)
    return map
  }, [props.detail.history])

  const older = async () => {
    if (!log?.cursor) return
    const page = await read<{ commits: Commit[]; cursor: string | null }>(`${props.base}/log?ref=main&limit=50&cursor=${encodeURIComponent(log.cursor)}`).catch(() => undefined)
    if (!page) return
    for (const commit of page.commits) known.current.add(commit.sha)
    setLog({ commits: [...log.commits, ...page.commits.filter((commit) => !log.commits.some((old) => old.sha === commit.sha))], cursor: page.cursor })
  }

  if (log?.error && !log.commits.length) return <p className="error">{log.error}</p>
  if (!log) return <p className="empty">Loading the repository…</p>
  if (!ref)
    return (
      <p className="empty">
        No commits yet. {props.live ? 'The swarm is working: each commit appears here as it lands.' : 'Each round pushes what it made, and it shows up here.'}
      </p>
    )

  const commit = log.commits.find((found) => found.sha === ref)
  const changes = diff.ref === ref ? (diff.changes ?? []) : []
  const pick = (sha: string) => {
    setPinned(sha === head ? undefined : sha)
    setTab(path && changes.some((change) => change.path === path) ? 'file' : 'changes')
  }

  return (
    <div className="repo">
      <aside className="repo-side">
        <p className="label">Files at {ref.slice(0, 7)}</p>
        {tree.error && tree.ref === ref ? (
          <p className="error">{tree.error}</p>
        ) : tree.paths ? (
          <Tree
            changes={changes}
            onSelect={(next) => {
              setPath(next)
              setTab('file')
            }}
            paths={tree.paths}
          />
        ) : (
          <p className="empty">Loading files…</p>
        )}
      </aside>
      <section className="repo-main">
        <header className="repo-head">
          <div>
            <h2>{commit ? title(commit) : ref.slice(0, 7)}</h2>
            <p className="fine">
              <code>{ref.slice(0, 7)}</code>
              {commit?.author?.name && <> · {commit.author.name}</>}
              {commit?.date && <> · {new Date(commit.date).toLocaleString()}</>}
              {rounds.has(ref) && <> · round {rounds.get(ref)}</>}
              {pinned ? (
                <>
                  {' '}
                  ·{' '}
                  <button className="btn btn-minimal" onClick={() => setPinned(undefined)} type="button">
                    Follow main
                  </button>
                </>
              ) : (
                <> · main{props.live ? ', live' : ''}</>
              )}
            </p>
          </div>
          <div className="repo-tabs" role="tablist">
            <button aria-selected={tab === 'changes'} onClick={() => setTab('changes')} role="tab" type="button">
              Changes{diff.ref === ref && diff.changes ? ` · ${diff.changes.length}` : ''}
            </button>
            <button aria-selected={tab === 'file'} disabled={!path} onClick={() => setTab('file')} role="tab" type="button">
              {path ?? 'File'}
            </button>
          </div>
        </header>
        <div className="repo-body">
          {tab === 'file' && path ? (
            <Viewer base={props.base} path={path} sha={ref} />
          ) : diff.ref !== ref ? (
            <p className="empty">Loading the diff…</p>
          ) : diff.error ? (
            <p className="error">{diff.error}</p>
          ) : (
            <Changes changes={changes} />
          )}
        </div>
      </section>
      <aside className="repo-log">
        <p className="label">
          {log.commits.length}
          {log.cursor ? '+' : ''} commits on main
        </p>
        <Timeline commits={log.commits} fresh={fresh} more={Boolean(log.cursor)} onMore={() => void older()} onPick={pick} rounds={rounds} selected={ref} />
      </aside>
    </div>
  )
}

export function Repo(props: { config: Config | undefined; id: string }) {
  const [detail] = usePoll(() => Api.swarm(props.id), pollMs, props.id)
  const swarm = detail.data
  const code = swarm?.code

  useEffect(() => {
    if (swarm) document.title = `Code · ${swarm.title} · Swarms`
  }, [swarm?.title])

  return (
    <section className="page repo-page">
      <p className="repo-back">
        <Link to={`/s/${encodeURIComponent(props.id)}`}>← {swarm?.title ?? 'Back to the swarm'}</Link>
      </p>
      <div className="repo-title">
        <h1 className="display">{code ? code.name : 'Code'}</h1>
        {swarm && <Status status={swarm.status} />}
      </div>
      {detail.error && !swarm ? (
        <p className="error">{detail.error}</p>
      ) : !swarm || !props.config ? (
        <p className="empty">Loading…</p>
      ) : !code ? (
        <p className="empty">This swarm has no repository yet: its lead creates one first thing in its first round that one funder can pay {usd(props.config.repoAt)} at once.</p>
      ) : (
        <Browser base={`${props.config.gateway}/p/${code.owner}/${code.app}/git/${encodeURIComponent(code.name)}`} detail={swarm} live={swarm.status !== 'done'} />
      )}
    </section>
  )
}
