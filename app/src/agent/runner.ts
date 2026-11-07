/**
 * 一次「对话改布局」请求的执行体。
 *
 * 由 `app/src/agent/service.mjs` 以独立子进程启动（本机 tsx 直跑），只做这一件事：
 * 把用户这一句话交给**上游 opencalque 的 Agent Loop**（`apps/web/src/ai/agent.ts`），
 * 让它按需调用 7 个绘图工具读写这一版的工作文档。
 *
 * 本文件**不重写**对话循环 / 会话 / Provider / 工具调用：
 *  - 循环与工具执行来自 `runRequest`；
 *  - Provider 来自 `compatibleProvider`（客户自带接口地址 / 密钥 / 模型名）；
 *  - 图纸解析与操作来自 `@opencalque/core`（`parseDocument` / `applyOps` / `serializeDocument`）。
 * 这里只提供**宿主**：一块能被读写的图纸，和一条能通到模型服务的水管。
 *
 * 输入（stdin，一行 JSON）：
 *   {drawingPath, text, historyPath?, historyOutPath?, config?:{baseUrl,apiKey,model}, stub?:boolean}
 * 输出（stdout，NDJSON 一行一条）：
 *   {"type":"text","delta":"…"}
 *   {"type":"activity","kind":"done|error","text":"…"}
 *   {"type":"done","changed":true|false,"turns":[…],"testDouble"?:true,"error"?:"…"}
 *
 * 红线：有真实密钥时**绝不**走测试替身；本进程不打印任何密钥。
 * @module agent/runner
 */

import fs from 'node:fs'
import path from 'node:path';

import {
  applyOps,
  layersOf,
  pagesOf,
  parseDocument,
  serializeDocument,
  Registry,
} from '../../../vendor/opencalque/packages/core/src/index.ts'
import { runRequest, systemPrompt, toolsFor } from '../../../vendor/opencalque/apps/web/src/ai/agent'
import { compatibleProvider } from '../../../vendor/opencalque/apps/web/src/ai/compatible'
import { setLanguage } from '../../../vendor/opencalque/apps/web/src/i18n'

/** 模型服务单次响应等待上限（毫秒）。 */
const HTTP_TIMEOUT_MS = 120_000
/** 出错时回给上层的响应体片段长度。 */
const BODY_SNIPPET = 300

/** @typedef {{baseUrl?:string, apiKey?:string, model?:string}} ModelConfig */
/** @typedef {{drawingPath:string, text:string, historyPath?:string, historyOutPath?:string, config?:ModelConfig, stub?:boolean}} Payload */

/** 响应超时：与「服务端报错」区分开，界面要给出不同的下一步。 */
class TimeoutError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AgentTimeoutError'
  }
}

/** 连不上服务：地址写错、断了网、代理不通。 */
class UnreachableError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AgentUnreachableError'
  }
}

/** @param {Record<string, unknown>} value */
function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

/** @returns {Promise<string>} */
async function readStdin() {
  /** @type {Buffer[]} */
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(/** @type {Buffer} */ (chunk)))
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * 把模型服务的一次调用做完：超时 120 秒、**不自动重试**、非 2xx 时把状态码与响应体前 300 字交上去。
 * 这是注入给 `compatibleProvider` 的水管，桌面主进程负责决定它通向哪里。
 * @param {string} url
 * @param {{method:string, headers:Record<string,string>, body:string}} init
 * @param {AbortSignal} signal
 * @returns {Promise<{status:number, body:string}>}
 */
async function http(url, init, signal) {
  const controller = new AbortController()
  let timedOut = false
  const relay = () => controller.abort()
  if (signal.aborted) controller.abort()
  else signal.addEventListener('abort', relay, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, HTTP_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: controller.signal,
    })
    const body = await response.text()
    // 非 2xx：只留前 300 字，避免把整页错误页塞进界面。
    return { status: response.status, body: response.ok ? body : body.slice(0, BODY_SNIPPET) }
  } catch (error) {
    if (timedOut) throw new TimeoutError(`模型服务超过 ${Math.round(HTTP_TIMEOUT_MS / 1000)} 秒没有响应，本次请求已停止。`)
    if (signal.aborted) throw error
    throw new UnreachableError(`连不上模型服务（${url}），请检查接口地址、网络与代理设置。`)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', relay)
  }
}

/**
 * 读取上一轮的会话快照（Provider 自己的格式，含会话消息）。
 * 只读，不解析内容；损坏时按「没有历史」处理，不猜。
 * @param {string|undefined} file
 * @returns {unknown}
 */
function readHistory(file) {
  if (!file) return undefined
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * 写回图纸：先写临时文件再改名，避免写到一半断电留下半份图纸。
 * 传入的已经是序列化后的文本，避免同一份内容序列化两次。
 * @param {string} file
 * @param {string} text
 */
function writeDrawing(file, text) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.writing`)
  fs.writeFileSync(temp, text, 'utf8')
  fs.renameSync(temp, file)
}

/** @param {unknown} value */
function asObject(value) {
  return typeof value === 'object' && value !== null ? /** @type {Record<string, any>} */ (value) : null
}

/**
 * 测试替身：不发出任何网络请求，按固定剧本走完「读图纸 → 改一处 → 回一句」。
 * 只在**没有配置真实密钥**且调用方显式要求时才允许使用。
 * @returns {any}
 */
function createStubProvider() {
  return {
    pictures: false,
    /** @param {{system:string, tools:unknown[], history?:unknown}} setup */
    createSession(setup) {
      const earlier = asObject(setup.history)
      const messages = Array.isArray(earlier?.messages) ? [...earlier.messages] : []
      let step = 0
      /**
       * 和真实 provider 一样把本轮交换记进会话：上一轮的 user / 助手回复（含工具调用）/
       * 工具结果都留下，`snapshot()` 才有上文，多轮接续才测得出来。
       * 顺序是「助手发起工具调用 → 下一条是工具结果」，与真实协议一致。
       * @param {any} input
       * @param {any} output
       * @param {string} spoken
       */
      const remember = (input, output, spoken) => {
        if (Array.isArray(input?.results)) {
          for (const result of input.results) {
            messages.push({ role: 'tool', tool_call_id: result.id, content: String(result.content ?? '') })
          }
        } else {
          messages.push({ role: 'user', content: String(input?.text ?? '') })
        }
        const calls = Array.isArray(output?.calls) ? output.calls : []
        messages.push({
          role: 'assistant',
          content: spoken || null,
          ...(calls.length > 0
            ? {
              tool_calls: calls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
              })),
            }
            : {}),
        })
      }
      return {
        /**
         * @param {any} input
         * @param {(delta:string)=>void} onText
         * @param {AbortSignal} signal
         */
        async send(input, onText, signal) {
          if (signal.aborted) throw new DOMException('Stopped', 'AbortError')
          step += 1
          let spoken = ''
          /** @type {any} */
          let output
          if (step === 1) {
            // 第一轮：先读图纸（不改变任何内容）。
            output = { calls: [{ id: `stub_read_${step}`, name: 'read_document', input: {} }], stop: 'tools' }
          } else if (step === 2) {
            // 第二轮：拿读回来的图纸，真的加一条参考线，验证「改图纸并写回同一份工作文档」。
            const first = Array.isArray(input?.results) ? input.results[0] : null
            let parsed = null
            try {
              parsed = JSON.parse(String(first?.content || ''))
            } catch {
              parsed = null
            }
            const nodes = asObject(parsed?.nodes) || {}
            const page = Object.values(nodes).find((node) => asObject(node)?.type === 'page')
            const layers = asObject(parsed?.layers) || {}
            const layerId = Object.keys(layers)[0]
            if (!page || !layerId) {
              spoken = '测试替身回复：没能在这份图纸里找到可用页面，本次没有改动。'
              onText(spoken)
              output = { calls: [], stop: 'done' }
            } else {
              output = {
                calls: [{
                  id: `stub_apply_${step}`,
                  name: 'apply_operations',
                  input: {
                    operations: [{
                      op: 'add_node',
                      node: {
                        type: 'line',
                        name: '对话测试参考线',
                        parent: page.id,
                        layer: layerId,
                        a: { x: 0, y: 0 },
                        b: { x: 1500, y: 0 },
                      },
                    }],
                  },
                }],
                stop: 'tools',
              }
            }
          } else {
            spoken = '测试替身回复：已读过这一版图纸，并放下一条测试用的参考线。本次没有连接真实模型，图纸改动仅供流程验证。'
            onText(spoken)
            output = { calls: [], stop: 'done' }
          }
          remember(input, output, spoken)
          return output
        },
        snapshot() {
          return { messages, unanswered: [] }
        },
      }
    },
    /** @param {unknown} error */
    describeError(error) {
      return error instanceof Error ? error.message : String(error)
    },
  }
}

async function main() {
  // 工具的提示语走上游中文文案，员工看到的是中文。
  setLanguage('zh')

  const raw = await readStdin()
  /** @type {Payload} */
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    emit({ type: 'done', changed: false, turns: [], error: '请求内容不完整，本次没有改动图纸。' })
    return
  }

  const drawingPath = String(payload.drawingPath || '')
  const text = String(payload.text || '').trim()
  if (!drawingPath || !text) {
    emit({ type: 'done', changed: false, turns: [], error: '缺少图纸或要求，本次没有改动图纸。' })
    return
  }
  if (!fs.existsSync(drawingPath)) {
    emit({ type: 'done', changed: false, turns: [], error: '这一版的工作文档不存在，无法对话修改。' })
    return
  }

  const config = payload.config || {}
  const apiKey = String(config.apiKey || '')
  const baseUrl = String(config.baseUrl || '')
  const model = String(config.model || '')
  const wantsStub = payload.stub === true
  // 红线：配了真实密钥就不许走测试替身，避免「演示很好看、其实没连上」。
  if (wantsStub && apiKey) {
    emit({ type: 'done', changed: false, turns: [], error: '已配置真实模型密钥，不允许使用测试替身。' })
    return
  }
  const useStub = wantsStub
  if (!useStub && (!baseUrl || !model || !apiKey)) {
    emit({ type: 'done', changed: false, turns: [], error: '还没有配置文本模型，请到模型设置填写接口地址 / 密钥 / 模型名。' })
    return
  }

  /** @type {any} */
  let doc
  try {
    doc = parseDocument(JSON.parse(fs.readFileSync(drawingPath, 'utf8')))
  } catch (error) {
    emit({
      type: 'done', changed: false, turns: [],
      error: `这一版的图纸读不出来：${error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)}`,
    })
    return
  }

  const registry = new Registry()
  /**
   * 载入时的图纸内容（序列化后的字节）。判断「这次到底有没有改到图纸」以它为准：
   * 工具调用成功 ≠ 图纸有变化 —— 把名字改成同名、把属性设成原值都是合法但无实质变化的操作，
   * 拿 ops.length 当判据会造出「内容一字未变的假新版本」。
   */
  const baseline = serializeDocument(doc)
  /** 当前内容是否与载入时不同。 */
  const contentChanged = () => serializeDocument(doc) !== baseline
  const host = {
    state() {
      return {
        doc,
        // 正在编辑的就是这份图纸的首页；没有页面时退回上游约定的 root。
        scope: pagesOf(doc)[0]?.id || 'root',
        selection: [],
        activeLayer: layersOf(doc)[0]?.id,
      }
    },
    /** @param {any[]} ops */
    apply(ops) {
      const before = serializeDocument(doc)
      const next = applyOps(doc, ops)
      const after = serializeDocument(next)
      doc = next
      // 内容真的不一样才写回文件；空操作连文件都不碰。
      if (after !== before) writeDrawing(drawingPath, after)
    },
    registry,
  }

  /** @type {any[]} */
  const turns = []
  let reply = ''

  const provider = useStub
    ? createStubProvider()
    : compatibleProvider({ apiKey, baseUrl, model }, http)
  const session = provider.createSession({
    system: systemPrompt(registry, false),
    tools: toolsFor(false),
    history: readHistory(payload.historyPath),
  })

  // 记下每一步模型干了什么，回给主进程做「做过什么」的说明。
  let current = { step: 1, tools: /** @type {string[]} */ ([]), text: '' }
  const wrappedSession = {
    /**
     * @param {any} input
     * @param {(delta:string)=>void} onText
     * @param {AbortSignal} signal
     */
    async send(input, onText, signal) {
      current.text = ''
      const output = await session.send(input, (delta) => {
        current.text += delta
        reply += delta
        onText(delta)
      }, signal)
      current.tools = (output.calls || []).map((call) => String(call.name))
      turns.push({ step: current.step, tools: current.tools, text: current.text.slice(0, 300) })
      current = { step: current.step + 1, tools: [], text: '' }
      return output
    },
    snapshot() {
      return session.snapshot()
    },
  }

  const controller = new AbortController()
  const onSignal = () => controller.abort()
  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)

  try {
    await runRequest(wrappedSession, host, text, {
      onText(delta) {
        emit({ type: 'text', delta })
      },
      onActivity(kind, message) {
        emit({ type: 'activity', kind, text: message })
      },
    }, controller.signal, [], { selection: true })
  } catch (error) {
    const message = failureText(error, provider, useStub)
    emit({ type: 'activity', kind: 'error', text: message })
    emit({ type: 'done', changed: contentChanged(), turns, error: message, ...(useStub ? { testDouble: true } : {}) })
    return
  } finally {
    process.removeListener('SIGTERM', onSignal)
    process.removeListener('SIGINT', onSignal)
  }

  // 会话快照留给下一轮；不含密钥，也不含完整系统提示（上游已剔掉第一条）。
  if (payload.historyOutPath) {
    try {
      const snapshot = session.snapshot()
      fs.writeFileSync(String(payload.historyOutPath), JSON.stringify(snapshot), 'utf8')
    } catch {
      // 存不下会话就只影响「下一轮记不住上文」，不能让这一轮的修改白做。
    }
  }

  emit({ type: 'done', changed: contentChanged(), turns, ...(useStub ? { testDouble: true } : {}) })
}

/**
 * 把异常翻译成员工能看懂的一句话。
 * @param {unknown} error
 * @param {any} provider
 * @param {boolean} useStub
 * @returns {string}
 */
function failureText(error, provider, useStub) {
  if (error instanceof TimeoutError) return error.message
  if (error instanceof UnreachableError) return error.message
  if (error instanceof Error && error.name === 'AbortError') return '本次请求已停止。'
  if (useStub) return error instanceof Error ? error.message : String(error)
  let described = ''
  try {
    described = String(provider.describeError(error) || '')
  } catch {
    described = ''
  }
  if (described.trim()) return described.trim()
  return `模型服务调用失败：${error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)}`
}

await main()
