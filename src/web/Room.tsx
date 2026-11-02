import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Config, Detail, Me, Member, Said, Way } from '../shared/Api.ts'
import { maxNote, units } from '../shared/Memo.ts'
import * as Mention from '../shared/Mention.ts'
import * as Api from './api.ts'
import { percent, usd } from './format.ts'
import { message as reason, useNow, useWallet } from './hooks.ts'
import { code } from './Pledge.tsx'
import * as Wallet from './wallet.ts'

const ways = { budget: 'daily budget', machine: 'machine', pledge: 'pledge', transfer: 'transfer' } as const satisfies Record<Way, string>

const presets = ['0.25', '0.5', '1', '2'] as const

export function tint(address: string) {
  let value = 0
  for (const char of address.toLowerCase()) value = (value * 31 + char.charCodeAt(0)) >>> 0
  return `hsl(${value % 360} 38% 36%)`
}

function merge(list: readonly Said[], more: readonly Said[]) {
  if (!more.length) return list
  const byId = new Map(list.map((item) => [item.id, item]))
  for (const item of more) byId.set(item.id, item)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

function plain(amount: string) {
  return amount.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

function minute(at: number) {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function Avatar(props: { address: string; handle: string; size?: 'small' }) {
  return (
    <span aria-hidden className="avatar" data-size={props.size} style={{ background: tint(props.address) }}>
      {props.handle.charAt(0).toUpperCase()}
    </span>
  )
}

function Words(props: { handles: ReadonlySet<string>; me: ReadonlySet<string>; text: string }) {
  return (
    <>
      {Mention.pieces(props.text).map((piece, index) => {
        const name = piece.slice(1).toLowerCase()
        if (!piece.startsWith('@') || (name !== 'swarm' && !props.handles.has(name))) return piece
        return (
          <span className="mention" data-me={props.me.has(name)} data-swarm={name === 'swarm'} key={index}>
            {piece}
          </span>
        )
      })}
    </>
  )
}

function Rename(props: { address: string; name: string | null; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const made = Mention.handle(props.address)
  const wanted = value.trim().replace(/^@/, '').toLowerCase()
  const wrong = wanted ? Mention.invalid(wanted) : undefined

  if (!open)
    return (
      <button
        className="btn btn-minimal"
        onClick={() => {
          setValue(props.name ?? '')
          setError(undefined)
          setOpen(true)
        }}
        type="button"
      >
        {props.name ? 'Rename' : 'Pick a username'}
      </button>
    )

  const save = async (name: string | null) => {
    setBusy(true)
    setError(undefined)
    try {
      await Wallet.rename(name)
      setOpen(false)
      props.onDone()
    } catch (failure) {
      setError(reason(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="rename"
      onSubmit={(event) => {
        event.preventDefault()
        if (wanted && !wrong) void save(wanted)
      }}
    >
      <label className="rename-field">
        <span>@</span>
        <input aria-label="Username" autoFocus maxLength={Mention.maxName + 1} onChange={(event) => setValue(event.target.value)} placeholder={made} spellCheck={false} value={value} />
      </label>
      <div className="rename-actions">
        <button className="btn btn-high" disabled={busy || !wanted || !!wrong || wanted === props.name} type="submit">
          {busy ? 'Saving…' : 'Save'}
        </button>
        {props.name && (
          <button className="btn btn-minimal" disabled={busy} onClick={() => void save(null)} type="button">
            Go back to @{made}
          </button>
        )}
        <button className="btn btn-minimal" onClick={() => setOpen(false)} type="button">
          Cancel
        </button>
      </div>
      <p className={error || wrong ? 'error' : 'fine'}>{error ?? wrong ?? 'Every room shows it, and others mention you with it. Letters, digits, - and _.'}</p>
    </form>
  )
}

export function Room(props: {
  config: Config | undefined
  onArtifact: (slug: string) => void
  onBack: (note: string) => void
  onSteered: () => void
  onUnread: (count: number) => void
  swarm: Detail
  visible: boolean
}) {
  const id = props.swarm.id
  const done = props.swarm.status === 'done'
  const wallet = useWallet()
  const token = wallet.session?.token
  const now = useNow(1000)
  const [messages, setMessages] = useState<readonly Said[]>([])
  const [members, setMembers] = useState<readonly Member[]>([])
  const [me, setMe] = useState<Me | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState<string>()
  const [earlier, setEarlier] = useState(false)
  const [online, setOnline] = useState<readonly string[]>([])
  const [watching, setWatching] = useState(0)
  const [typing, setTyping] = useState<Readonly<Record<string, number>>>({})
  const [roster, setRoster] = useState(false)
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [pick, setPick] = useState(0)
  const [closed, setClosed] = useState(false)
  const [steer, setSteer] = useState<string>()
  const [sending, setSending] = useState(false)
  const [signing, setSigning] = useState(false)
  const [problem, setProblem] = useState<{ short?: boolean; text: string }>()
  const [fresh, setFresh] = useState(0)
  const list = useRef<HTMLOListElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const line = useRef<Api.Line | undefined>(undefined)
  const stick = useRef(true)
  const last = useRef(0)
  const typed = useRef(0)

  const load = useCallback(
    async (after: number) => {
      try {
        const room = await Api.room(id, after ? { after } : {})
        setMessages((previous) => merge(after ? previous : [], room.messages))
        if (!after) setEarlier(room.messages.length >= 100)
        setMembers(room.members)
        setMe(room.me)
        setLoaded(true)
        setFailed(undefined)
        if (token && !room.me) Wallet.signOut()
      } catch (error) {
        setFailed(reason(error))
      }
    },
    [id, token],
  )

  useEffect(() => {
    last.current = messages.at(-1)?.id ?? 0
  }, [messages])

  useEffect(() => {
    void load(0)
  }, [load])

  useEffect(() => {
    const timer = setInterval(() => void load(last.current), 15_000)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (loaded) void load(last.current)
  }, [props.swarm.contributors, loaded, load])

  useEffect(() => {
    const connection = Api.chatter(id, (event) => {
      if (event.type === 'open') void load(last.current)
      if (event.type === 'said') setMessages((previous) => merge(previous, [event.message]))
      if (event.type === 'presence') {
        setOnline(event.online)
        setWatching(event.watching)
      }
      if (event.type === 'typing') setTyping((previous) => ({ ...previous, [event.address]: Date.now() + 4000 }))
    })
    line.current = connection
    return () => {
      connection.close()
      line.current = undefined
    }
  }, [id, load])

  useEffect(() => {
    if (token) line.current?.hello()
  }, [token])

  const newest = messages.at(-1)?.id
  const seen = useRef<number | undefined>(undefined)
  const onUnread = props.onUnread
  const myself = me?.address
  useEffect(() => {
    if (newest === undefined) return
    if (seen.current === undefined || props.visible) seen.current = newest
    const after = seen.current
    onUnread(props.visible ? 0 : messages.filter((item) => item.id > after && item.author !== null && item.author !== myself).length)
  }, [messages, newest, props.visible, onUnread, myself])

  useLayoutEffect(() => {
    const element = list.current
    if (!element || newest === undefined) return
    if (stick.current) element.scrollTop = element.scrollHeight
    else setFresh((count) => count + 1)
  }, [newest])

  useEffect(() => {
    const element = list.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      if (stick.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const called = new Map(members.map((member) => [member.address, member.handle]))
  const handleOf = (address: string) => called.get(address as `0x${string}`) ?? Mention.handle(address)
  const handles = new Set(members.flatMap((member) => [member.handle, Mention.handle(member.address)]))
  const myNames = new Set(me ? [me.handle, Mention.handle(me.address)] : [])
  const refresh = () => void load(last.current)
  const mine = me?.member ? me : undefined
  const query = mine && !closed ? /(^|\s)@([a-z0-9_-]*)$/i.exec(text.slice(0, caret)) : null
  const options = query
    ? [
        { handle: 'swarm', hint: done ? 'done, it takes no more steering' : 'steer it with your backing' },
        ...members.map((member) => ({ handle: member.handle, hint: member.address === me?.address ? 'you' : `${usd(member.backed)} in` })),
      ]
        .filter((option) => option.handle.startsWith((query[2] ?? '').toLowerCase()))
        .slice(0, 6)
    : []
  const steering = Mention.steers(text)
  const idea = Mention.idea(text)
  const available = mine ? units(mine.available) : 0n
  const amount = steer !== undefined && /^\d*\.?\d{0,6}$/.test(steer) && steer !== '' && steer !== '.' ? units(steer) : 0n
  const typers = Object.entries(typing).filter(([address, until]) => until > now && address !== me?.address).map(([address]) => handleOf(address))

  const complete = (handle: string) => {
    if (!query) return
    const start = caret - (query[2]?.length ?? 0) - 1
    const next = `${text.slice(0, start)}@${handle} ${text.slice(caret)}`
    const at = start + handle.length + 2
    setText(next)
    setCaret(at)
    setPick(0)
    requestAnimationFrame(() => {
      area.current?.focus()
      area.current?.setSelectionRange(at, at)
    })
  }

  const mention = (handle: string) => {
    if (!mine) return
    const next = `${text}${text && !text.endsWith(' ') ? ' ' : ''}@${handle} `
    setText(next)
    setCaret(next.length)
    requestAnimationFrame(() => {
      area.current?.focus()
      area.current?.setSelectionRange(next.length, next.length)
    })
  }

  const post = async (body: string, amount?: string) => {
    setSending(true)
    setProblem(undefined)
    try {
      const posted = await Api.say(id, { text: body, ...(amount ? { steer: amount } : {}) })
      setMe(posted.me)
      setMessages((previous) => merge(previous, [posted.message]))
      stick.current = true
      setFresh(0)
      requestAnimationFrame(() => list.current?.scrollTo({ top: list.current.scrollHeight }))
      setText('')
      setCaret(0)
      setSteer(undefined)
      if (amount) props.onSteered()
    } catch (error) {
      setProblem({ short: code(error) === 'insufficient_balance', text: reason(error) })
    } finally {
      setSending(false)
    }
  }

  const submit = () => {
    const body = text.trim()
    if (!body || sending || !mine) return
    if (Mention.steers(body)) {
      if (done) return setProblem({ text: 'This swarm is done, so @swarm no longer steers it.' })
      if (idea.length < 3) return setProblem({ text: 'Say what the swarm should do after @swarm.' })
      if (idea.length > maxNote) return setProblem({ text: `Keep the idea to ${maxNote} characters; it becomes a note the agent keeps reading.` })
      setProblem(undefined)
      setSteer(available >= 500_000n ? '0.5' : available > 0n ? plain(mine.available) : '')
      return
    }
    void post(body)
  }

  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (options.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setPick((index) => (index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        complete(options[Math.min(pick, options.length - 1)]?.handle ?? 'swarm')
        return
      }
      if (event.key === 'Escape') {
        setClosed(true)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  const signIn = async () => {
    if (!props.config) return
    setSigning(true)
    setProblem(undefined)
    try {
      await Wallet.signIn(props.config)
    } catch (error) {
      setProblem({ text: reason(error) })
    } finally {
      setSigning(false)
    }
  }

  const older = async () => {
    const first = messages[0]
    const element = list.current
    if (!first || !element) return
    const height = element.scrollHeight
    const room = await Api.room(id, { before: first.id }).catch(() => undefined)
    if (!room) return
    setEarlier(room.messages.length >= 100)
    setMessages((previous) => merge(previous, room.messages))
    requestAnimationFrame(() => {
      element.scrollTop += element.scrollHeight - height
    })
  }

  const ranked = [...members].sort((a, b) => Number(units(b.backed) - units(a.backed)))
  const here = online.filter((address) => members.some((member) => member.address === address))

  let gate: ReactNode = null
  if (!token)
    gate = (
      <div className="room-gate">
        <ol className="room-steps">
          <li>Back it</li>
          <li>Sign in</li>
          <li>Talk and steer</li>
        </ol>
        <p>Backers talk here and steer the swarm with <span className="mention" data-swarm="true">@swarm</span>. Anyone can read along.</p>
        <div className="room-gate-actions">
          <button className="btn btn-high" disabled={!props.config || signing} onClick={() => void signIn()} type="button">
            {signing ? 'Approve in Tempo Wallet…' : 'Sign in with Tempo Wallet'}
          </button>
          {!done && <button className="btn btn-low" onClick={() => props.onBack('')} type="button">Back this swarm</button>}
        </div>
      </div>
    )
  else if (me && !me.member)
    gate = (
      <div className="room-gate">
        <ol className="room-steps">
          <li>Back it</li>
          <li data-done="true">Sign in</li>
          <li>Talk and steer</li>
        </ol>
        <p>
          You are <b>@{me.handle}</b>. {done ? 'This swarm is done and takes no new backers, so its room is read-only for you.' : 'Back this swarm with any amount, a daily budget or a lent machine to post here.'}
        </p>
        <div className="room-gate-actions">
          {!done && <button className="btn btn-high" onClick={() => props.onBack('')} type="button">Back this swarm</button>}
          <Rename address={me.address} name={wallet.account?.name ?? null} onDone={refresh} />
          <button className="btn btn-minimal" onClick={() => Wallet.signOut()} type="button">Sign out</button>
        </div>
      </div>
    )

  return (
    <section aria-label="The swarm's room" className="room">
      <header className="room-head">
        <div>
          <h2>Room</h2>
          <p className="room-count">
            {members.length} backer{members.length === 1 ? '' : 's'} · {watching || 1} watching
          </p>
        </div>
        <button aria-expanded={roster} className="room-online" onClick={() => setRoster(!roster)} title="Who backs this swarm" type="button">
          {(here.length ? here : ranked.map((member) => member.address)).slice(0, 5).map((address) => (
            <span className="room-face" data-online={online.includes(address)} key={address}>
              <Avatar address={address} handle={handleOf(address)} size="small" />
            </span>
          ))}
          <span className="room-online-label">{roster ? 'Close' : here.length ? `${here.length} here` : 'Backers'}</span>
        </button>
      </header>
      {roster && (
        <ol className="roster">
          {ranked.map((member) => (
            <li key={member.address}>
              <button disabled={!mine} onClick={() => mention(member.handle)} title={mine ? `Mention @${member.handle}` : member.address} type="button">
                <Avatar address={member.address} handle={member.handle} />
                <span className="roster-name">
                  @{member.handle}
                  {member.address === me?.address && <span className="tag">you</span>}
                  {online.includes(member.address) && <i className="roster-dot" title="Here now" />}
                </span>
                <span className="roster-meta">
                  {usd(member.backed)} in · {member.ways.map((way) => ways[way]).join(', ')}
                </span>
              </button>
            </li>
          ))}
          {!ranked.length && <li className="roster-empty">No backers yet. The first one opens the room.</li>}
        </ol>
      )}
      <ol
        aria-live="polite"
        className="room-list"
        onScroll={(event) => {
          const element = event.currentTarget
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60
          if (stick.current) setFresh(0)
        }}
        ref={list}
      >
        {earlier && (
          <li className="room-earlier">
            <button className="btn btn-minimal" onClick={() => void older()} type="button">Earlier messages</button>
          </li>
        )}
        {!loaded && <li className="room-empty">{failed ? `Could not load the room. ${failed}` : 'Opening the room…'}</li>}
        {loaded && !messages.length && <li className="room-empty">Quiet so far. Backers who sign in can say hello, mention each other with @ and steer the swarm with @swarm.</li>}
        {messages.map((item, index) => {
          const author = item.author
          if (!author)
            return (
              <li className="said said-system" data-artifact={!!item.artifact} key={item.id}>
                <p>
                  <Words handles={handles} me={myNames} text={item.text} />
                  <time dateTime={new Date(item.at).toISOString()}>{minute(item.at)}</time>
                </p>
                {item.artifact && (
                  <button className="said-open" onClick={() => item.artifact && props.onArtifact(item.artifact.slug)} type="button">
                    Open {item.artifact.title} →
                  </button>
                )}
              </li>
            )
          const previous = messages[index - 1]
          const follow = previous?.author === author && item.at - previous.at < 5 * 60_000 && !item.steer && !previous.steer
          const handle = handleOf(author)
          return (
            <li className="said" data-follow={follow} data-me={author === me?.address} data-mentioned={!!me && item.mentions.includes(me.address)} key={item.id}>
              {follow ? <span className="said-gap" /> : <Avatar address={author} handle={handle} />}
              <div className="said-body">
                {!follow && (
                  <p className="said-head">
                    <button className="said-who" disabled={!mine} onClick={() => mention(handle)} style={{ color: tint(author) }} type="button">
                      @{handle}
                    </button>
                    {author === me?.address && <span className="tag">you</span>}
                    <time dateTime={new Date(item.at).toISOString()}>{minute(item.at)}</time>
                  </p>
                )}
                <p className="said-text">
                  <Words handles={handles} me={myNames} text={item.text} />
                </p>
                {item.steer && (
                  <p className="said-steer">
                    <b>Steer</b> {usd(item.steer.amount)} behind it · {usd(item.steer.weight)} in all, {percent(item.steer.share)} of the money ·{' '}
                    {item.steer.live ? 'reached the agent at once' : 'read when it resumes'}
                  </p>
                )}
              </div>
            </li>
          )
        })}
        {fresh > 0 && (
          <li className="room-jump">
            <button
              className="btn btn-medium"
              onClick={() => {
                list.current?.scrollTo({ behavior: 'smooth', top: list.current.scrollHeight })
                stick.current = true
                setFresh(0)
              }}
              type="button"
            >
              New messages ↓
            </button>
          </li>
        )}
      </ol>
      <footer className="room-foot">
        <p className="room-typing">{typers.length ? `@${typers.slice(0, 2).join(', @')} ${typers.length === 1 ? 'is' : 'are'} typing…` : ''}</p>
        {gate}
        {mine && steer !== undefined && (
          <div className="steer">
            <p className="label">Steer the swarm</p>
            <p className="steer-idea">“{idea}”</p>
            {available > 0n ? (
              <>
                <p className="steer-ask">How much of your backing goes behind it?</p>
                <div className="chips">
                  {[...presets.filter((value) => units(value) < available), plain(mine.available)].map((value, index, all) => (
                    <button className={steer === value ? 'chip chip-on' : 'chip'} key={value} onClick={() => setSteer(value)} type="button">
                      {index === all.length - 1 ? `All ${usd(value)}` : usd(value)}
                    </button>
                  ))}
                  <input aria-label="Amount to steer with" className="steer-input" inputMode="decimal" onChange={(event) => setSteer(event.target.value.replace(',', '.'))} value={steer} />
                </div>
                <p className="fine">
                  {usd(mine.available)} of the {usd(mine.backed)} you put in is not behind a note yet. This moves weight, not money: the agent weighs every note by the money behind it{props.swarm.status === 'running' ? ', and hears this one now' : ' when it resumes'}.
                </p>
              </>
            ) : (
              <p className="fine">Everything you put in ({usd(mine.backed)}) is behind notes already. Put new money behind this idea to steer with it.</p>
            )}
            <div className="steer-actions">
              {available > 0n && (
                <button className="btn btn-high" disabled={sending || amount < Mention.smallestSteer || amount > available} onClick={() => void post(text.trim(), steer)} type="button">
                  {sending ? 'Steering…' : `Steer with ${amount > 0n ? usd(steer) : '…'}`}
                </button>
              )}
              <button
                className="btn btn-low"
                onClick={() => {
                  setSteer(undefined)
                  props.onBack(idea)
                }}
                type="button"
              >
                Put new money behind it
              </button>
              <button className="btn btn-minimal" onClick={() => setSteer(undefined)} type="button">Cancel</button>
            </div>
          </div>
        )}
        {mine && (
          <div className="composer">
            {options.length > 0 && (
              <ol className="mentions" role="listbox">
                {options.map((option, index) => (
                  <li key={option.handle}>
                    <button
                      aria-selected={index === pick}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        complete(option.handle)
                      }}
                      role="option"
                      type="button"
                    >
                      <b data-swarm={option.handle === 'swarm'}>@{option.handle}</b>
                      <span>{option.hint}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <textarea
              aria-label="Message the room"
              maxLength={Mention.maxText}
              onChange={(event) => {
                setText(event.target.value)
                setCaret(event.target.selectionStart)
                setPick(0)
                setClosed(false)
                if (steer !== undefined && !Mention.steers(event.target.value)) setSteer(undefined)
                if (Date.now() - typed.current > 3000) {
                  typed.current = Date.now()
                  line.current?.typing()
                }
              }}
              onKeyDown={keys}
              onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
              placeholder={done ? 'Talk about what it found…' : 'Message the room. @ to mention, @swarm to steer'}
              ref={area}
              rows={2}
              value={text}
            />
            <button className="btn btn-high room-send" disabled={!text.trim() || sending} onClick={submit} type="button">
              {steering && !done ? 'Steer…' : 'Send'}
            </button>
          </div>
        )}
        {problem && (
          <p className="error room-error" role="alert">
            {problem.text}
            {problem.short && (
              <>
                {' '}
                <button className="btn btn-minimal" onClick={() => props.onBack(idea)} type="button">
                  Put new money behind it
                </button>
              </>
            )}
          </p>
        )}
        {mine && (
          <div className="room-me">
            <span>
              You are <b>@{mine.handle}</b> · {usd(mine.available)} to steer with
            </span>
            <div className="room-me-actions">
              <Rename address={mine.address} name={wallet.account?.name ?? null} onDone={refresh} />
              <button className="btn btn-minimal" onClick={() => Wallet.signOut()} type="button">Sign out</button>
            </div>
          </div>
        )}
      </footer>
    </section>
  )
}
