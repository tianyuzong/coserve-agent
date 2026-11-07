import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { caStudioApiUrl, caStudioOrigin, caStudioProjectId, consumeCAStudioEvents, requestCAStudio } from '../src/castudio-transport.ts'
import type { CAStudioEvent } from '../src/castudio-protocol.ts'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  })))
})

describe('CAStudio local transport', () => {
  it('keeps renderer API paths on the configured loopback service', () => {
    const origin = caStudioOrigin('http://127.0.0.1:4317')
    expect(caStudioApiUrl(origin, '/api/projects/p/file?path=model.py').href).toBe(`${origin}/api/projects/p/file?path=model.py`)
    for (const value of ['https://example.com', 'http://127.0.0.1:4317/api', 'http://user@127.0.0.1:4317', 'file:///C:/']) {
      expect(() => caStudioOrigin(value)).toThrow()
    }
    for (const value of ['https://example.com/api/status', '//example.com/api/status', '/api/../outside', '/api/../../', '/api/\\outside']) {
      expect(() => caStudioApiUrl(origin, value)).toThrow()
    }
    expect(caStudioProjectId('design-123')).toBe('design-123')
    expect(() => caStudioProjectId('../design')).toThrow()
  })

  it('preserves request bodies and reports real server failures without retrying mutations', async () => {
    const requests: string[] = []
    const server = createServer(async (request, response) => {
      const parts: Buffer[] = []
      for await (const part of request) parts.push(Buffer.from(part))
      requests.push(`${request.method} ${request.url} ${Buffer.concat(parts).toString()}`)
      response.setHeader('content-type', 'application/json')
      if (request.url === '/api/projects/p/prompt') {
        response.statusCode = 409
        response.end(JSON.stringify({ error: '项目正在执行' }))
      } else response.end(JSON.stringify({ ok: true }))
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Missing test port')
    const origin = `http://127.0.0.1:${address.port}`
    await expect(requestCAStudio(origin, '/api/settings', 'PUT', { model: 'test' })).resolves.toEqual({ ok: true })
    await expect(requestCAStudio(origin, '/api/projects/p/prompt', 'POST', { text: '设计支架' })).rejects.toThrow('409: 项目正在执行')
    expect(requests).toEqual(['PUT /api/settings {"model":"test"}', 'POST /api/projects/p/prompt {"text":"设计支架"}'])
  })

  it('decodes partial UTF-8 SSE frames in order and ignores heartbeats', async () => {
    const encoder = new TextEncoder()
    const bytes = encoder.encode(': connected\r\n\r\nid: 42\r\ndata: {"id":42,"type":"delta","data":{"text":"你好"}}\r\n\r\nid: 43\ndata: {"id":43,"type":"run_end","data":{}}\n\n')
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
      controller.close()
    } })
    const events: CAStudioEvent[] = []
    await consumeCAStudioEvents(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }), event => events.push(event))
    expect(events).toEqual([
      { id: 42, type: 'delta', data: { text: '你好' } },
      { id: 43, type: 'run_end', data: {} },
    ])
  })

  it('does not accept an error page or malformed envelope as a connected project', async () => {
    await expect(consumeCAStudioEvents(new Response('not found', { status: 404 }), () => {})).rejects.toThrow('404')
    const response = new Response('data: {"id":"wrong","type":"delta","data":{}}\n\n', { headers: { 'content-type': 'text/event-stream' } })
    await expect(consumeCAStudioEvents(response, () => {})).rejects.toThrow('Invalid CAStudio event')
  })
})
