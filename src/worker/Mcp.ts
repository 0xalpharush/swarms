import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import * as Memo from '../shared/Memo.ts'
import * as Operations from './Operations.ts'
import * as Problem from './Problem.ts'
import * as Store from './Store.ts'

function instructions(origin: string) {
  return [
    `Swarms (${origin}) are crowdfunded, long-running AI agents on the Tempo gateway. Anyone starts a swarm with a title and a goal. It waits in status funding until someone funds it, and then works in rounds, spending on models and Modal machines: each round is one turn of a lead agent, with up to ${Store.maxParallel - 1} explorer subagents and machines beside it when enough money is left, and ends with a report. The newest completed report is the swarm's answer. A swarm runs until the lead reports the goal met (done) or its money runs out (paused, and new money resumes it).`,
    "Money comes three ways. A pledge is a spending key in MACH (the default) or OUSD, USDC.e or pathUSD that the contributor approves in Tempo Wallet, capped at the pledge: the money stays in their wallet until the swarm spends it, and what it does not spend goes back when the pledge ends. A transfer sends USDC.e, pathUSD or OUSD to the swarm's own wallet, and a daily budget lets the swarm pull up to an amount a day from the contributor's wallet; when the swarm is done, what its wallet did not spend goes back to those contributors pro rata. Transfers and budgets are made on the swarm's page or over the REST API. Contributors steer with money: any of the three may carry a note, money with the same note backs it together, every round reads the notes ranked by the money behind them, and a note that arrives while a round runs steers that round at once.",
    "Contributors can also lend a swarm their own machine as a hand: swarm_hand issues one and returns the nanocode command (nc hand '<url>' --token <token>) and a nanocode-ts snippet (Hand.connect) to run on that machine. The swarm's lead agent and its explorers then run commands there in rounds paid from the swarm's wallet, and are told the machine belongs to a contributor. Issue a hand only when the user asks, and make sure they know the swarm's agents will run commands on the machine.",
    'To answer questions about what the swarms found or did, search first (swarms_search with keywords; set swarm to include that swarm\'s feed of tool calls, commands, machines and messages), then read what matched with swarm_rounds, swarm_answer, swarm_get or swarm_feed, and cite the swarm and round. swarms_list shows the funded swarms. Reading is free and needs no account.',
    `Fund only when the user asks to. swarm_pledge returns a Tempo Wallet link and user code to show the user, who approves on any device; then swarm_pledge_status with wait reports when it is active. swarm_budget returns a link to the swarm's page, where the user approves a daily budget in Tempo Wallet. swarm_contribute counts a transfer the user already sent to the swarm's wallet. A pledge is at least ${Memo.decimal(Store.minPledge)} of its token. swarm_wait waits up to ${Operations.maxWait} s for a running round to end.`,
  ].join('\n\n')
}

export async function handle(request: Request, env: Cloudflare.Env) {
  if (request.method !== 'POST')
    return Problem.json({ code: 'invalid_request', detail: 'Use POST for MCP over streamable HTTP.', status: 405 })

  const server = create(env, new URL(request.url).origin)
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
  await server.connect(transport)
  return transport.handleRequest(request)
}

function text(value: unknown): CallToolResult {
  return { content: [{ text: JSON.stringify(value, null, 2), type: 'text' }] }
}

function reply<value>(result: Problem.Result<value>, shape: (value: value) => unknown = (value) => value): CallToolResult {
  if (!result.ok) return { ...text({ code: result.code, detail: result.detail, status: result.status }), isError: true }
  return text(shape(result.value))
}

const reading = { openWorldHint: false, readOnlyHint: true } as const

function create(env: Cloudflare.Env, origin: string) {
  const server = new McpServer({ name: 'swarms', version: '1.0.0' }, { instructions: instructions(origin) })

  server.registerTool(
    'swarms_list',
    {
      annotations: reading,
      description:
        'List the funded swarms, most recently active first (at most 100), each with its title, goal, status, money raised, spent and remaining, daily budgets, its wallet, rounds, machines, explorers, backers and latest answer. status filters: funding (funded, no round started yet), running, paused (out of money; new money resumes it) or done.',
      inputSchema: Operations.schema.list.shape,
    },
    async (input) => reply(await Operations.list(env, input)),
  )

  server.registerTool(
    'swarm_get',
    {
      annotations: reading,
      description:
        "One swarm: its goal, status and money, its latest answer, every round (status, MACH spent and a short excerpt of its report; read the full reports with swarm_rounds), the running round, the steering notes ranked by the money behind them and their share of everything raised, its pledges, transfers and budget pulls, daily budgets and the machines attached now.",
      inputSchema: Operations.schema.swarm.shape,
    },
    async (input) => reply(await Operations.get(env, input)),
  )

  server.registerTool(
    'swarm_answer',
    {
      annotations: reading,
      description:
        "A swarm's latest answer: the full report of its newest completed round (markdown, without its STATUS line), with done (the lead reports the goal met) and next (what the lead planned for the next round), and the round running now, if any.",
      inputSchema: Operations.schema.swarm.shape,
    },
    async (input) => reply(await Operations.answer(env, input)),
  )

  server.registerTool(
    'swarm_rounds',
    {
      annotations: reading,
      description:
        "A swarm's rounds with their full reports (message, markdown, ending in a STATUS line), status, start and end times in ms and MACH spent. Pass round to read one.",
      inputSchema: Operations.schema.round.shape,
    },
    async (input) => reply(await Operations.rounds(env, input)),
  )

  server.registerTool(
    'swarm_feed',
    {
      annotations: reading,
      description:
        "A swarm's activity log, oldest first: rounds starting and ending (status), the lead's messages and reasoning summaries (message, thinking), tool calls, scripts, shell commands and explorers (tool), Modal machines (machine), money coming in and going back (funds), steering (steer) and failures (error), each with seq, time, round, text and an optional detail. Page with after set to the previous page's next.",
      inputSchema: Operations.schema.feed.shape,
    },
    async (input) => reply(await Operations.feed(env, input)),
  )

  server.registerTool(
    'swarms_search',
    {
      annotations: reading,
      description:
        "Full-text search over what the swarms did: every swarm's title and goal, every round report and the steering notes, ranked best first with the matches marked «like this» in a snippet. With swarm set it searches only that swarm and also its feed (tool calls, shell commands, machines, messages and errors). Send keywords rather than a question; hits match any of them. Read a report hit with swarm_rounds (its round), and a feed hit with swarm_feed (after = its entry.seq - 1).",
      inputSchema: Operations.schema.search.shape,
    },
    async (input) => reply(await Operations.search(env, input)),
  )

  server.registerTool(
    'swarm_create',
    {
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false, readOnlyHint: false },
      description: `Start a swarm with a title and a goal. It costs nothing and waits in status funding until money comes in (swarm_pledge, or a transfer or budget on its page), and only funded swarms appear in swarms_list. Returns the swarm; its page is ${origin}/s/<id>.`,
      inputSchema: Operations.schema.create.shape,
    },
    async (input) => reply(await Operations.create(env, input)),
  )

  server.registerTool(
    'swarm_pledge',
    {
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
      description:
        "Pledge MACH (the default) or another stablecoin (token: ousd, usdce or pathusd) to a swarm, optionally with a steering note. Call it only when the user asks to fund or steer a swarm. It returns a Tempo Wallet link and user code: show both to the user, who approves there, on any device, a spending key capped at the pledge before the link expires. Then call swarm_pledge_status with wait to see the pledge activate. Nothing moves until the user approves, and what the swarm does not spend goes back to their wallet.",
      inputSchema: Operations.schema.pledge.omit({ device: true }).shape,
    },
    async (input) =>
      reply(await Operations.pledge(env, { ...input, device: true }), (requested) => ({
        device: requested.device,
        message: requested.device
          ? `Approve the pledge in Tempo Wallet: open ${requested.device.verificationUriFull} and check the code ${requested.device.userCode}. The link expires at ${new Date(requested.device.expiresAt).toISOString()}.`
          : null,
        pledge: requested.pledge,
        swarm: input.swarm,
      })),
  )

  server.registerTool(
    'swarm_contribute',
    {
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true, readOnlyHint: false },
      description:
        "Count a transfer the user already sent: a transferWithMemo of USDC.e, pathUSD or OUSD from their wallet to the swarm's wallet (swarm_get's wallet). Pass the transaction hash. A note counts only when the transfer's memo is keccak256(\"note:<swarm>:<note>\"); without a note any memo works (the page uses keccak256(\"swarm:<swarm>\")). A hash counts once; one counted without a note can get its note later. What the swarm does not spend goes back to its transfer and budget contributors pro rata when it is done.",
      inputSchema: Operations.schema.contribution.shape,
    },
    async (input) => reply(await Operations.contribute(env, input), (value) => value.contributed),
  )

  server.registerTool(
    'swarm_budget',
    {
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true },
      description:
        "Prepare a daily budget: the swarm may pull up to amount of a stablecoin (usdce, pathusd or ousd) a day from the user's wallet into its own, for 30 days, through a key that can only pay the swarm. Approving it needs Tempo Wallet in a browser, which has no device flow here, so this returns a link to the swarm's page with the budget filled in: show it to the user, who approves there. Call it only when the user asks to fund the swarm daily.",
      inputSchema: Operations.schema.budget.shape,
    },
    async (input) =>
      reply(await Operations.link(env, input, origin), (value) => ({
        ...value,
        message: `Open ${value.link} and approve the daily budget of ${value.amount} ${value.token} in Tempo Wallet.`,
      })),
  )

  server.registerTool(
    'swarm_hand',
    {
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
      description:
        "Issue a hand so the user can lend their own machine to a swarm. Returns a unique hand name, the CLI command to run on that machine (cli: nc hand '<url>' --token <token>; command installs nanocode first) and a nanocode-ts library snippet (library, after npm) that attaches with Hand.connect. Once it runs, the swarm's lead agent and explorers can run commands and read and write files there in rounds paid from the swarm's wallet (transfers and daily budgets), and are told it belongs to a contributor and to ask before anything destructive. The token is shown once: anyone holding it can attach a machine under that name. Stopping the command detaches the machine. Call it only when the user asks, and tell them what the swarm's agents will be able to do on it.",
      inputSchema: Operations.schema.hand.shape,
    },
    async (input) => reply(await Operations.hand(env, input)),
  )

  server.registerTool(
    'swarm_pledge_status',
    {
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true, readOnlyHint: false },
      description: `A pledge's state. While its Tempo Wallet approval is pending it polls Tempo Wallet for up to wait seconds (at most ${Operations.maxWait}). Once the user approves, it checks that the wallet holds the pledge, activates it, starts or steers the swarm, and returns the pledge and the swarm. Errors: access_denied (the user declined), expired (the link expired; pledge again), insufficient_balance (the wallet holds less MACH than the pledge).`,
      inputSchema: Operations.schema.pledged.shape,
    },
    async (input, extra) => reply(await Operations.status(env, input, extra.signal)),
  )

  server.registerTool(
    'swarm_wait',
    {
      annotations: reading,
      description: `Wait up to timeout seconds (at most ${Operations.maxWait}) for a swarm's running round to end, then return that round with its full report and the swarm, whose answer is the new report when the round completed. It returns at once when a round newer than after already ended (changed: true, reason ended), or when nothing runs and the swarm is funding, paused or done (reason idle); otherwise reason timeout. Call it again to keep waiting; the swarm itself has no time limit.`,
      inputSchema: Operations.schema.wait.shape,
    },
    async (input, extra) => reply(await Operations.wait(env, input, extra.signal)),
  )

  return server
}
