import { useState, useRef, useEffect, useCallback } from 'react'
import { useTopologyStore } from '../../store/topology-store'
import { useEnvStore } from '../../store/env-store'
import { useDecisionStore } from '../../store/decision-store'
import { hasApiKey, setApiKey, clearApiKey, streamChat, type ChatMessage } from '../../ai/claude-client'
import { SYSTEM_PROMPT, QUICK_QUESTIONS } from '../../ai/prompts'
import { buildContext } from '../../ai/context-builder'

export function AIExplainer() {
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [hasKey, setHasKey] = useState(hasApiKey())
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const config = useTopologyStore((s) => s.hardwareConfig)
  const system = useTopologyStore((s) => s.system)
  const ringGraph = useTopologyStore((s) => s.ringGraph)
  const treeGraph = useTopologyStore((s) => s.treeGraph)
  const envConfig = useEnvStore((s) => s.config)
  const decisions = useDecisionStore((s) => s.entries)

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
  }, [messages])

  const handleSaveKey = () => {
    if (apiKeyInput.trim()) {
      setApiKey(apiKeyInput.trim())
      setHasKey(true)
      setApiKeyInput('')
    }
  }

  const handleRemoveKey = () => {
    clearApiKey()
    setHasKey(false)
  }

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return

    const context = buildContext(config, system, ringGraph, treeGraph, envConfig, decisions)
    const fullSystem = `${SYSTEM_PROMPT}\n\n---\n\nCurrent State:\n${context}`

    const userMsg: ChatMessage = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setIsStreaming(true)

    try {
      let assistantText = ''
      setMessages([...newMessages, { role: 'assistant', content: '' }])

      for await (const chunk of streamChat(fullSystem, newMessages)) {
        assistantText += chunk
        setMessages([...newMessages, { role: 'assistant', content: assistantText }])
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to get response'
      setMessages([
        ...newMessages,
        { role: 'assistant', content: `Error: ${errorMsg}` },
      ])
    } finally {
      setIsStreaming(false)
    }
  }, [messages, isStreaming, config, system, ringGraph, treeGraph, envConfig, decisions])

  // API key setup
  if (!hasKey) {
    return (
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          AI Explainer
        </h3>
        <p className="text-[10px] text-gray-500">
          Provide your Anthropic API key to enable AI-powered topology explanations.
          Your key is stored in localStorage and never transmitted elsewhere.
        </p>
        <div className="flex gap-1">
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
            placeholder="sk-ant-..."
            className="input flex-1 text-[10px]"
          />
          <button onClick={handleSaveKey} className="btn-primary text-[10px]">
            Save
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          AI Explainer
        </h3>
        <button
          onClick={handleRemoveKey}
          className="text-[9px] text-gray-600 hover:text-neon-red"
        >
          Remove Key
        </button>
      </div>

      {/* Quick questions */}
      {messages.length === 0 && (
        <div className="space-y-1 mb-3">
          <span className="text-[9px] text-gray-500 uppercase">Quick Questions</span>
          <div className="flex flex-wrap gap-1">
            {QUICK_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => sendMessage(q)}
                className="px-2 py-1 text-[9px] text-gray-400 border border-surface-600 rounded hover:text-neon-cyan hover:border-neon-cyan/30 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-2 mb-2 min-h-0">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`text-[10px] p-2 rounded ${
              msg.role === 'user'
                ? 'bg-neon-cyan/5 text-gray-200 ml-4'
                : 'bg-surface-700 text-gray-300 mr-4'
            }`}
          >
            <span className="text-[9px] text-gray-500 uppercase block mb-0.5">
              {msg.role === 'user' ? 'You' : 'Claude'}
            </span>
            <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
          </div>
        ))}
        {isStreaming && messages[messages.length - 1]?.content === '' && (
          <div className="text-[10px] text-gray-500 p-2">Thinking...</div>
        )}
      </div>

      {/* Input */}
      <div className="flex gap-1 mt-auto">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage(input)}
          placeholder="Ask about the topology..."
          className="input flex-1 text-[10px]"
          disabled={isStreaming}
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={isStreaming || !input.trim()}
          className="btn-primary text-[10px]"
        >
          Ask
        </button>
      </div>
    </div>
  )
}
