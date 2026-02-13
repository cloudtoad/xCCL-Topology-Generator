import Anthropic from '@anthropic-ai/sdk'

let client: Anthropic | null = null

export function getApiKey(): string | null {
  return localStorage.getItem('xccl-claude-api-key')
}

export function setApiKey(key: string): void {
  localStorage.setItem('xccl-claude-api-key', key)
  client = null
}

export function clearApiKey(): void {
  localStorage.removeItem('xccl-claude-api-key')
  client = null
}

export function hasApiKey(): boolean {
  return !!getApiKey()
}

function getClient(): Anthropic {
  if (!client) {
    const key = getApiKey()
    if (!key) throw new Error('No API key configured')
    client = new Anthropic({
      apiKey: key,
      dangerouslyAllowBrowser: true,
    })
  }
  return client
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function* streamChat(
  systemPrompt: string,
  messages: ChatMessage[],
): AsyncGenerator<string> {
  const anthropic = getClient()

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 2048,
    system: systemPrompt,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  })

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text
    }
  }
}
