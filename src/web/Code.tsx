import { File, PatchDiff } from '@pierre/diffs/react'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { useEffect, useMemo, useState } from 'react'
import type { Code as Repo, Round } from '../shared/Api.ts'
import { ago, usd } from './format.ts'
import { message } from './hooks.ts'

type Commit = { date: string | null; message: string; sha: string }

type Change = { additions: number; deletions: number; oldPath: string | null; patch: string; path: string; state: string | null }

const theme = { theme: 'pierre-light' } as const

const unified = { diffStyle: 'unified', theme: 'pierre-light' } as const

async function read<value>(url: string): Promise<value> {
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

function Viewer(props: { base: string; path: string; sha: string }) {
  const [state, setState] = useState<{ error?: string; source?: { size: number; text?: string } }>({})

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
  return <File className="code-view" file={file} options={theme} />
}

function patch(change: Change) {
  if (/^(diff --git|---) /m.test(change.patch.split('\n')[0] ?? '')) return change.patch
  const before = change.state === 'A' ? '/dev/null' : `a/${change.oldPath ?? change.path}`
  const after = change.state === 'D' ? '/dev/null' : `b/${change.path}`
  return `--- ${before}\n+++ ${after}\n${change.patch}`
}

function Changes(props: { base: string; from: string | null; to: string }) {
  const [state, setState] = useState<{ error?: string; files?: Change[] }>({})

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
          <PatchDiff className="code-view" key={change.path} options={unified} patch={patch(change)} />
        ) : (
          <p className="fine" key={change.path}>
            {change.path}: {change.state}, +{change.additions} −{change.deletions}
          </p>
        ),
      )}
    </div>
  )
}

function Diffs(props: { base: string; commits: readonly Commit[]; round: Round }) {
  const shas = props.round.commits
  if (props.round.base || shas.length === 1) return <Changes base={props.base} from={props.round.base} to={shas[0] ?? ''} />
  return (
    <>
      {shas.map((sha) => (
        <div key={sha}>
          <p className="fine">
            {sha.slice(0, 7)} {props.commits.find((commit) => commit.sha === sha)?.message.split('\n')[0]}
          </p>
          <Changes base={props.base} from={null} to={sha} />
        </div>
      ))}
    </>
  )
}

export function Code(props: { gateway: string; repo: Repo; rounds: readonly Round[] }) {
  const base = `${props.gateway}/p/${props.repo.owner}/${props.repo.app}/git/${encodeURIComponent(props.repo.name)}`
  const version = props.rounds.map((round) => `${round.n}${round.status}`).join(',')
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

  const pushed = [...props.rounds].filter((round) => round.commits.length).sort((a, b) => b.n - a.n)
  const commits = state.commits
  const head = commits?.[0]

  if (state.error) return <p className="error">{state.error}</p>
  if (!commits || !state.files) return <p className="empty">Loading the code…</p>
  if (!head) return <p className="empty">The repository {props.repo.name} has no commits yet. Each round pushes what it made, and it shows up here.</p>

  return (
    <div className="code">
      <p className="fine">
        Public repository <strong>{props.repo.name}</strong>, {commits.length === 1 ? '1 commit' : `${commits.length} commits`}, last {head.date ? ago(Date.parse(head.date)) : head.sha.slice(0, 7)}.
      </p>
      <div className="code-browse">
        <Tree onSelect={setPath} paths={state.files} />
        <div className="code-file">{path ? <Viewer base={base} path={path} sha={head.sha} /> : <p className="empty">Pick a file to read it at {head.sha.slice(0, 7)}.</p>}</div>
      </div>
      <ol className="commits">
        {pushed.map((round) => (
          <li className="commit" data-open={open === round.n} key={round.n}>
            <button className="commit-head" onClick={() => setOpen(open === round.n ? undefined : round.n)} type="button">
              <span className="commit-sha">Round {round.n}</span>
              <span className="commit-message">
                {round.commits.length === 1 ? commits.find((commit) => commit.sha === round.commits[0])?.message.split('\n')[0] ?? '1 commit' : `${round.commits.length} commits`}
              </span>
              <span className="commit-ago">{usd(round.spent)}</span>
            </button>
            {open === round.n && <Diffs base={base} commits={commits} round={round} />}
          </li>
        ))}
      </ol>
    </div>
  )
}
