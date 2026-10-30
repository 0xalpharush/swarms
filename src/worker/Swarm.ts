import { DurableObject } from 'cloudflare:workers'
import type { Address } from 'viem'
import type { Entry, Hand, Kind, Note, Round } from '../shared/Api.ts'
import * as Memo from '../shared/Memo.ts'
import * as Gateway from './Gateway.ts'
import * as Seal from './Seal.ts'
import * as Store from './Store.ts'

export type Pledged = {
  amount: string
  contributor: Address
  note: string | null
  noteId: string | null
  swarm: string
}

export type View = { feed: Entry[]; hands: Hand[]; left: string | null; rounds: Round[]; steered: string[] }

type Current = { backing: Store.Backing; token: string }

type Money = { left: bigint; row: Store.Row }

type Call = { detail: string | null; kind: Kind; text: string }

const schema = [
  'CREATE TABLE IF NOT EXISTS feed (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, round INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, detail TEXT)',
  "CREATE TABLE IF NOT EXISTS rounds (n INTEGER PRIMARY KEY, turn TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, status TEXT NOT NULL, message TEXT, spent_before TEXT NOT NULL, spent TEXT NOT NULL DEFAULT '0')",
  'CREATE TABLE IF NOT EXISTS steered (note TEXT PRIMARY KEY, at INTEGER NOT NULL)',
]

const followMs = 2_000

const refreshMs = 10_000

const retryMs = 30_000

const turnMs = 30 * 60_000

const maxRounds = 12

const maxFailures = 3

export class Swarm extends DurableObject<Cloudflare.Env> {
  stepping: Promise<number | null> | undefined
  opened = new Map<string, string>()

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env)
    for (const statement of schema) ctx.storage.sql.exec(statement)
  }

  get kv() {
    return this.ctx.storage.kv
  }

  async pledged(input: Pledged) {
    this.kv.put('id', input.swarm)
    this.log(
      'funds',
      `${short(input.contributor)} pledged ${trim(input.amount)} MACH${input.note ? ' with a note' : ''}`,
      input.note,
    )
    if (input.noteId) await this.steer(input.swarm, input.noteId, input.amount)
    await this.ctx.storage.setAlarm(Date.now())
  }

  view(): View {
    const sql = this.ctx.storage.sql
    const feed = sql
      .exec<Record<string, SqlStorageValue>>(
        'SELECT seq, at, round, kind, text, detail FROM feed ORDER BY seq DESC LIMIT 200',
      )
      .toArray()
      .reverse()
      .map(entry)
    const rounds = sql
      .exec<Record<string, SqlStorageValue>>(
        'SELECT n, started_at, ended_at, status, message, spent FROM rounds ORDER BY n',
      )
      .toArray()
      .map((row) => ({
        endedAt: row['ended_at'] === null ? null : Number(row['ended_at']),
        message: row['message'] === null ? null : String(row['message']),
        n: Number(row['n']),
        spent: Memo.decimal(BigInt(String(row['spent']))),
        startedAt: Number(row['started_at']),
        status: String(row['status']) as Round['status'],
      }))
    return {
      feed,
      hands: this.kv.get<Hand[]>('hands') ?? [],
      left: this.kv.get<string>('left') ?? null,
      rounds,
      steered: this.steered(),
    }
  }

  feed(after: number): Entry[] {
    return this.ctx.storage.sql
      .exec<Record<string, SqlStorageValue>>(
        'SELECT seq, at, round, kind, text, detail FROM feed WHERE seq > ? ORDER BY seq LIMIT 200',
        after,
      )
      .toArray()
      .map(entry)
  }

  override async alarm() {
    this.stepping ??= this.step()
      .catch((error: unknown) => {
        this.log('error', 'The swarm hit an error and will retry.', String(error))
        return Date.now() + retryMs
      })
      .finally(() => {
        this.stepping = undefined
      })
    const next = await this.stepping
    if (next !== null) await this.ctx.storage.setAlarm(next)
  }

  async step() {
    const id = this.kv.get<string>('id')
    const row = id ? await Store.find(this.env, id) : null
    if (!row) return null

    if (this.kv.get<string>('turn')) return this.follow(row)
    if (row.status === 'done') return null
    return this.advance(row)
  }

  async advance(row: Store.Row) {
    const rounds = this.kv.get<number>('round') ?? 0
    if (rounds >= maxRounds) {
      await this.done(row, `The swarm reached its limit of ${maxRounds} rounds.`)
      return null
    }

    const current = await this.current(row)
    if (!current) {
      await this.pause(row, rounds ? 'paused' : 'funding')
      return null
    }
    const money = await this.refresh(row, current)
    if (this.kv.get<string>('pledge') !== current.backing.id || money.left < Store.reserve) return Date.now()

    let agent = this.kv.get<string>('agent')
    if (!agent) {
      const created = await Gateway.agent(this.env, current.token, { name: row.title.slice(0, 60) })
      if (!created.ok) {
        this.log('error', 'The gateway did not create the lead agent.', created.detail)
        return Date.now() + retryMs
      }
      agent = created.value.id
      this.kv.put('agent', agent)
      this.kv.put('cursor', 0)
      this.kv.put('fresh', true)
      this.log('status', `Created a lead agent on the gateway, paid from ${short(current.backing.contributor)}'s pledge.`, agent)
    }

    const n = rounds + 1
    const notes = await this.notes(money.row)
    const parallel = Store.parallel(money.left)
    const text = this.kv.get<boolean>('fresh')
      ? brief(money, current.backing, n, parallel, notes, this.reports())
      : next(money, current.backing, n, parallel, notes)
    const sent = await Gateway.prompt(this.env, current.token, agent, { prompt: text, steer: false })
    if (!sent.ok) {
      this.log('error', `The gateway refused round ${n}.`, sent.detail)
      if (sent.status === 401) await this.release(current.backing, current.token, 'ended')
      return Date.now() + retryMs
    }

    const now = Date.now()
    this.kv.put('fresh', false)
    this.kv.put('turn', sent.value.request_id)
    this.kv.put('round', n)
    this.kv.put('started', now)
    this.kv.put('workers', 0)
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO rounds (n, turn, started_at, status, spent_before) VALUES (?, ?, ?, 'running', ?)",
      n,
      sent.value.request_id,
      now,
      String(money.row.spent),
    )
    for (const note of notes)
      this.ctx.storage.sql.exec('INSERT OR IGNORE INTO steered (note, at) VALUES (?, ?)', note.id, now)
    await Store.update(this.env, row.id, { rounds: n, status: 'running', workers: 0 })
    this.log(
      'status',
      `Round ${n} started on ${short(current.backing.contributor)}'s pledge, with ${trim(Memo.decimal(money.left))} MACH left on it and room for ${parallel} parallel explorer${parallel === 1 ? '' : 's'}.`,
      text,
    )
    return now + followMs
  }

  async follow(row: Store.Row) {
    const current = await this.held(row)
    const agent = this.kv.get<string>('agent')
    const turn = this.kv.get<string>('turn')
    if (!current || !agent || !turn) {
      if (turn) return this.finish(row, { error: 'The pledge paying for this round ended.', request_id: turn, status: 'failed' })
      return Date.now()
    }

    let cursor = this.kv.get<number>('cursor') ?? 0
    let ended = false
    for (let page = 0; page < 5; page++) {
      const read = await Gateway.events(this.env, current.token, agent, cursor)
      if (!read.ok) break
      for (const event of read.value.events) ended = this.digest(event, turn) || ended
      cursor = read.value.next_cursor
      this.kv.put('cursor', cursor)
      if (!read.value.has_more) break
    }

    const now = Date.now()
    if (!ended && now - (this.kv.get<number>('checked') ?? 0) < refreshMs) return now + followMs

    this.kv.put('checked', now)
    const [report] = await Promise.all([
      Gateway.turn(this.env, current.token, agent, turn),
      this.refresh(row, current),
    ])
    if (report.ok && !['queued', 'running'].includes(report.value.status))
      return this.finish(row, report.value)
    if (!report.ok && report.status !== 401 && report.status < 500)
      return this.finish(row, { error: report.detail, request_id: turn, status: 'failed' })
    if (now - (this.kv.get<number>('started') ?? now) > turnMs) {
      await Gateway.cancel(this.env, current.token, agent, turn)
      this.log('status', 'The round ran past 30 minutes and was cancelled.')
    }
    return now + followMs
  }

  async finish(row: Store.Row, report: Gateway.Report) {
    const n = this.kv.get<number>('round') ?? 0
    const error = typeof report.error === 'string' ? report.error : report.error?.message
    const message = report.ok?.message ?? error ?? null
    const status: Round['status'] =
      report.status === 'completed' ? 'completed' : report.status === 'cancelled' ? 'cancelled' : 'failed'
    this.flush()
    const current = await this.held(row)
    const money = current ? await this.refresh(row, current) : { left: 0n, row: (await Store.find(this.env, row.id)) ?? row }
    const before = BigInt(
      this.ctx.storage.sql
        .exec<{ spent_before: string }>('SELECT spent_before FROM rounds WHERE n = ?', n)
        .toArray()[0]?.spent_before ?? '0',
    )
    const spent = BigInt(money.row.spent) - before
    this.ctx.storage.sql.exec(
      'UPDATE rounds SET ended_at = ?, status = ?, message = ?, spent = ? WHERE n = ?',
      Date.now(),
      status,
      message,
      String(spent),
      n,
    )
    this.kv.delete('turn')
    this.kv.delete('started')
    this.log(
      status === 'completed' ? 'status' : 'error',
      `Round ${n} ${status}, spending ${trim(Memo.decimal(spent))} MACH.`,
      status === 'completed' ? null : message,
    )

    const failures = status === 'completed' ? 0 : (this.kv.get<number>('failures') ?? 0) + 1
    this.kv.put('failures', failures)
    if (status === 'completed' && /STATUS:\s*done/i.test(message ?? '')) {
      await this.done(row, 'The lead agent reports the goal is met.')
      return null
    }
    if (failures >= maxFailures) {
      this.kv.put('failures', 0)
      await this.pause(row, 'paused', `${failures} rounds in a row failed, so the swarm paused. A new pledge restarts it.`)
      return null
    }
    return Date.now()
  }

  async current(row: Store.Row): Promise<Current | undefined> {
    const id = this.kv.get<string>('pledge')
    const active = await Store.active(this.env, row.id)
    const kept = active.find((backing) => backing.id === id)
    if (kept && left(kept) >= Store.reserve) return { backing: kept, token: await this.open(kept) }
    if (kept) await this.release(kept, await this.open(kept), 'spent')

    const chosen = active.find((backing) => backing.id !== id && left(backing) >= Store.reserve)
    if (!chosen) return undefined
    this.kv.put('pledge', chosen.id)
    this.kv.delete('agent')
    this.kv.put('fresh', true)
    return { backing: chosen, token: await this.open(chosen) }
  }

  async held(row: Store.Row): Promise<Current | undefined> {
    const id = this.kv.get<string>('pledge')
    const backing = id ? await Store.backing(this.env, row.id, id) : null
    return backing?.status === 'active' ? { backing, token: await this.open(backing) } : undefined
  }

  async open(backing: Store.Backing) {
    const known = this.opened.get(backing.id)
    if (known) return known
    const token = await Seal.open(this.env.SWARMS_SECRET, backing.sealed_key ?? '')
    this.opened.set(backing.id, token)
    return token
  }

  async refresh(row: Store.Row, current: Current): Promise<Money> {
    const [me, hands] = await Promise.all([
      Gateway.me(this.env, current.token),
      Gateway.hands(this.env, current.token),
    ])
    const channel = me.ok ? me.value.usage.channel : null
    const spent = channel ? Memo.units(channel.spent) : BigInt(current.backing.spent)
    if (!me.ok && me.status === 401) await this.release(current.backing, current.token, 'ended', spent)
    else if (spent !== BigInt(current.backing.spent)) await Store.spend(this.env, current.backing.id, spent)

    const connected = hands.ok ? hands.value.hands.filter((hand) => hand.connected) : []
    const previous = new Set((this.kv.get<Hand[]>('hands') ?? []).map((hand) => hand.name))
    for (const hand of connected)
      if (!previous.has(hand.name)) this.log('machine', `Machine ${hand.name} joined the swarm.`)
    for (const name of previous)
      if (!connected.some((hand) => hand.name === name)) this.log('machine', `Machine ${name} left.`)
    this.kv.put('hands', connected.map((hand) => ({ connected: true, name: hand.name })))

    const remaining = BigInt(current.backing.amount) - spent
    const available = channel ? Memo.units(channel.available) : remaining
    const leftover = remaining < available ? remaining : available
    this.kv.put('left', Memo.decimal(leftover))
    await Store.update(this.env, row.id, {
      machines: connected.length,
      workers: this.kv.get<number>('workers') ?? 0,
    })
    return { left: leftover, row: (await Store.find(this.env, row.id)) ?? row }
  }

  async release(backing: Store.Backing, token: string, status: 'ended' | 'spent', spent?: bigint) {
    if (status === 'spent') await Gateway.revoke(this.env, token)
    await Store.spend(this.env, backing.id, spent ?? BigInt(backing.spent), status)
    this.opened.delete(backing.id)
    if (this.kv.get<string>('pledge') === backing.id) {
      this.kv.delete('pledge')
      this.kv.delete('agent')
    }
    this.log(
      'funds',
      status === 'spent'
        ? `${short(backing.contributor)}'s pledge is used up: ${trim(Memo.decimal(spent ?? BigInt(backing.spent)))} of ${trim(Memo.decimal(BigInt(backing.amount)))} MACH spent, and the rest goes back to their wallet.`
        : `${short(backing.contributor)}'s key ended at the gateway (revoked or expired), so the swarm stopped spending from it.`,
    )
  }

  async pause(row: Store.Row, status: 'funding' | 'paused', reason?: string) {
    if (row.status === status && !reason) return
    await Store.update(this.env, row.id, { status })
    this.log(
      'status',
      reason ??
        (status === 'funding'
          ? 'Waiting for its first pledge.'
          : 'Paused: every pledge is used up. A new pledge starts the next round.'),
    )
  }

  async done(row: Store.Row, reason: string) {
    for (const backing of await Store.active(this.env, row.id)) {
      const token = await this.open(backing)
      await Gateway.revoke(this.env, token)
      await Store.spend(this.env, backing.id, BigInt(backing.spent), 'ended')
    }
    this.opened.clear()
    this.kv.delete('pledge')
    this.kv.delete('agent')
    await Store.update(this.env, row.id, { machines: 0, status: 'done', workers: 0 })
    this.log('status', `Done. ${reason} Every pledge's unspent money goes back to its wallet.`)
  }

  async steer(swarm: string, noteId: string, amount: string) {
    const row = await Store.find(this.env, swarm)
    const current = row ? await this.held(row) : undefined
    const agent = this.kv.get<string>('agent')
    const turn = this.kv.get<string>('turn')
    if (!row || !current || !agent || !turn) return

    const note = (await this.notes(row)).find((found) => found.id === noteId)
    if (!note) return
    const sent = await Gateway.prompt(this.env, current.token, agent, {
      prompt: `A contributor just pledged ${trim(amount)} MACH behind this note, which now has ${trim(note.weight)} MACH behind it (${percent(note.share)} of everything pledged, ${note.backers} backer${note.backers === 1 ? '' : 's'}): "${note.note}". Steer the swarm toward it in proportion to that weight.`,
      steer: true,
    })
    if (!sent.ok) return

    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO steered (note, at) VALUES (?, ?)', note.id, Date.now())
    this.log(
      'steer',
      `Steered the running round toward "${clip(note.note, 120)}"`,
      `${trim(note.weight)} MACH behind it, ${percent(note.share)} of everything pledged`,
    )
  }

  async notes(row: Store.Row) {
    return Store.notes(this.env, row.id, BigInt(row.raised), new Set(this.steered()))
  }

  steered() {
    return this.ctx.storage.sql
      .exec<{ note: string }>('SELECT note FROM steered')
      .toArray()
      .map((row) => row.note)
  }

  reports() {
    return this.ctx.storage.sql
      .exec<{ message: string | null; n: number }>(
        "SELECT n, message FROM rounds WHERE status = 'completed' ORDER BY n DESC LIMIT 3",
      )
      .toArray()
      .reverse()
  }

  digest(event: Gateway.Event, turn: string) {
    const outer = event.event
    if (!outer) return false
    if (outer.source === undefined) return outer.type === 'result' && event.request_id === turn

    const inner = outer.event
    const payload = inner?.payload ?? {}
    if (inner?.type === 'tool.call') {
      const described = call(payload)
      if (described) this.log(described.kind, described.text, described.detail)
      if (payload['tool'] === 'spawn_agent') this.kv.put('workers', (this.kv.get<number>('workers') ?? 0) + 1)
    } else if (inner?.type === 'tool.result' && payload['status'] !== 'completed') {
      this.log('error', `${tool(payload)} failed`, clip(JSON.stringify(payload['result'] ?? ''), 2000))
    } else if (inner?.type === 'assistant.message') {
      this.flush()
      this.log('message', clip(String(payload['text'] ?? ''), 4000))
    } else if (inner?.type === 'reasoning.summary.delta') {
      this.kv.put('thinking', (this.kv.get<string>('thinking') ?? '') + String(payload['text'] ?? ''))
    } else if (inner?.type === 'model.call.completed') {
      this.flush()
    } else if (inner?.type === 'run.failed' || inner?.type === 'model.call.failed') {
      this.log('error', inner.type === 'run.failed' ? 'The round failed.' : 'A model call failed.', clip(JSON.stringify(payload), 2000))
    }
    return false
  }

  flush() {
    const thinking = this.kv.get<string>('thinking')?.trim()
    this.kv.delete('thinking')
    if (thinking) this.log('thinking', clip(thinking, 600))
  }

  log(kind: Kind, text: string, detail?: string | null) {
    this.ctx.storage.sql.exec(
      'INSERT INTO feed (at, round, kind, text, detail) VALUES (?, ?, ?, ?, ?)',
      Date.now(),
      this.kv.get<number>('round') ?? 0,
      kind,
      text,
      detail ?? null,
    )
  }
}

function left(backing: Store.Backing) {
  return BigInt(backing.amount) - BigInt(backing.spent)
}

function pool(money: Money) {
  const row = money.row
  return `${trim(Memo.decimal(BigInt(row.raised)))} MACH pledged by ${row.contributors} contributor${row.contributors === 1 ? '' : 's'}, ${trim(Memo.decimal(BigInt(row.remaining)))} MACH still unspent`
}

function brief(
  money: Money,
  backing: Store.Backing,
  n: number,
  parallel: number,
  notes: Note[],
  reports: { message: string | null; n: number }[],
) {
  return [
    "You are the lead agent of a crowdfunded swarm. People pledged real money for this work: every model call, machine-second and tool call you make is paid from their pledges, so spend deliberately and make each round count.",
    '',
    `Goal: ${money.row.title}`,
    money.row.goal,
    '',
    `Budget: ${pool(money)}. This is round ${n}; rounds continue while pledges last. This round is paid from ${short(backing.contributor)}'s pledge, which has ${trim(Memo.decimal(money.left))} MACH left; everything you and your explorers do spends from it.`,
    '',
    `This round you may run up to ${parallel} explorer${parallel === 1 ? '' : 's'} in parallel: spawn_agent subagents, each taking its own angle on the goal. More money unlocks more parallel explorers (one per ${trim(Memo.decimal(Store.perWorker))} MACH left, up to ${Store.maxParallel}).`,
    '',
    'For anything that needs a real machine (running code, benchmarks, installs, downloads), create a Modal sandbox with tools.mcp__gateway__compute_create({ image: "python:3.12-slim", cpu: 1, memory: 1024, lease: 300, timeout: 900, attach: "<short name>" }). It joins as a hand with that name, so pass hand: "<short name>" to exec_command and the file tools to work there. Terminate every sandbox you create with tools.mcp__gateway__compute_terminate before you reply.',
    '',
    'Contributors steer the swarm with their money. Their notes, with the MACH behind each and its share of everything pledged (weigh them by that share; new notes may arrive while you work):',
    listed(notes),
    ...(reports.length
      ? ['', 'Reports from earlier rounds, by a previous lead agent:', ...reports.map((report) => `Round ${report.n}: ${clip(report.message ?? '', 1500)}`)]
      : []),
    '',
    'Aim to finish this round within about 5 minutes. Reply with a short report of what this round tried and found, with concrete numbers or artifacts, and end with one last line that is exactly "STATUS: done" if the goal is met, or "STATUS: continue: <what the next round should do>".',
  ].join('\n')
}

function next(money: Money, backing: Store.Backing, n: number, parallel: number, notes: Note[]) {
  return [
    `Round ${n}. ${pool(money)}. This round is paid from ${short(backing.contributor)}'s pledge, with ${trim(Memo.decimal(money.left))} MACH left on it; up to ${parallel} parallel explorer${parallel === 1 ? '' : 's'}.`,
    '',
    'Contributor notes (MACH behind each, share of everything pledged):',
    listed(notes),
    '',
    'Continue toward the goal from where the last round ended. Same rules: terminate the sandboxes you create, aim for about 5 minutes, and end with "STATUS: done" or "STATUS: continue: <next step>".',
  ].join('\n')
}

function listed(notes: Note[]) {
  if (!notes.length) return '(none yet)'
  return notes
    .slice(0, 8)
    .map(
      (note, index) =>
        `${index + 1}. "${note.note}" (${trim(note.weight)} MACH, ${percent(note.share)}, ${note.backers} backer${note.backers === 1 ? '' : 's'})`,
    )
    .join('\n')
}

function call(payload: Record<string, unknown>): Call | undefined {
  const name = tool(payload)
  const raw = typeof payload['arguments'] === 'string' ? payload['arguments'] : JSON.stringify(payload['arguments'] ?? {})
  const input =
    typeof payload['arguments'] === 'object' && payload['arguments'] !== null
      ? (payload['arguments'] as Record<string, unknown>)
      : {}
  const on = typeof input['hand'] === 'string' ? ` on ${input['hand']}` : ''

  if (name === 'exec') return { detail: clip(raw, 4000), kind: 'tool', text: `Ran a script: ${clip(raw.split('\n')[0] ?? '', 120)}` }
  if (name === 'spawn_agent')
    return { detail: clip(String(input['task'] ?? ''), 2000), kind: 'tool', text: `Spawned an explorer: ${clip(String(input['role'] ?? 'worker'), 80)}` }
  if (name === 'wait_agent') return { detail: null, kind: 'tool', text: 'Waiting on explorers' }
  if (name === 'compute_create')
    return {
      detail: raw,
      kind: 'machine',
      text: `Starting machine ${String(input['attach'] ?? '')} (${String(input['image'] ?? 'default image')}${input['gpu'] ? ', ' + String(input['gpu']) : ''})`,
    }
  if (name === 'compute_terminate') return { detail: raw, kind: 'machine', text: 'Shutting down a machine' }
  if (name === 'exec_command') return { detail: raw, kind: 'tool', text: `$ ${clip(String(input['cmd'] ?? ''), 140)}${on}` }
  if (name === 'write_stdin' || name === 'wait') return undefined
  return { detail: clip(raw, 2000), kind: 'tool', text: `Called ${name}${on}` }
}

function tool(payload: Record<string, unknown>) {
  return String(payload['tool'] ?? 'a tool').replace(/^mcp__gateway__/, '')
}

function entry(row: Record<string, SqlStorageValue>): Entry {
  return {
    at: Number(row['at']),
    detail: row['detail'] === null ? null : String(row['detail']),
    kind: String(row['kind']) as Kind,
    round: Number(row['round']),
    seq: Number(row['seq']),
    text: String(row['text']),
  }
}

function clip(text: string, length: number) {
  return text.length > length ? text.slice(0, length - 1) + '…' : text
}

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function trim(amount: string) {
  return amount.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

function percent(share: number) {
  return `${Math.round(share * 1000) / 10}%`
}