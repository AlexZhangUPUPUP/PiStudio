import { useEffect, useRef, useState } from 'react'
import type {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { ArrowUp, Paperclip, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { apiUrl, sendCommand, uid } from '@/lib/pi'
import { usePi } from '@/store/pi'

/* ------------------------------------------------------------- constants */

const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const DRAFT_KEY = 'pi-gui-draft'
const HIST_KEY = 'pi-gui-history'
const HIST_MAX = 50

/* ---------------------------------------------------------------- types */

interface Attachment {
  id: string
  /** base64 payload, without the `data:` prefix (matches send's image shape) */
  data: string
  mimeType: string
  bytes: number
  name: string
  /** data URL used only for the thumbnail preview */
  url: string
}

interface AcItem {
  value: string
  label: string
  desc?: string
  kind?: string | null
}

interface AcState {
  open: boolean
  mode: 'command' | 'file'
  items: AcItem[]
  index: number
  from: number
  to: number
}

const EMPTY_AC: AcState = { open: false, mode: 'file', items: [], index: 0, from: 0, to: 0 }

export interface ComposerProps {
  streaming: boolean
  disabled?: boolean
}

/* ---------------------------------------------------------- persistence */

function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) || ''
  } catch {
    return ''
  }
}

function loadHistory(): string[] {
  try {
    const a = JSON.parse(localStorage.getItem(HIST_KEY) || '[]')
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/* ---------------------------------------------------------- autocomplete */

function acContext(
  value: string,
  caret: number,
): { mode: 'command' | 'file'; query: string; from: number; to: number } | null {
  const before = value.slice(0, caret)
  const cmd = /^\/([^\s/]*)$/.exec(before)
  if (cmd) return { mode: 'command', query: cmd[1], from: 0, to: caret }
  const at = before.lastIndexOf('@')
  if (at !== -1) {
    const seg = before.slice(at + 1)
    const prev = at === 0 ? '' : before[at - 1]
    if (!/\s/.test(seg) && (at === 0 || /\s|[([{]/.test(prev))) {
      return { mode: 'file', query: seg, from: at, to: caret }
    }
  }
  return null
}

/* -------------------------------------------------------------- component */

export function Composer({ streaming, disabled }: ComposerProps) {
  const { draft, setDraft, commands, send, abort, toast, t } = usePi()

  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const acRef = useRef<HTMLDivElement>(null)
  const acTimer = useRef<number | null>(null)
  const acSeq = useRef(0)
  const aliveRef = useRef(true)

  // an in-flight file lookup must not touch state after unmount
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])
  const pendingCaret = useRef<number | null>(null)
  const histIndex = useRef(-1)
  const initialized = useRef(false)

  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [history, setHistory] = useState<string[]>(() => loadHistory())
  const [historyHint, setHistoryHint] = useState('')
  const [ac, setAc] = useState<AcState>(EMPTY_AC)

  /* load a persisted draft once; the store stays the single source of truth */
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    const loaded = loadDraft()
    if (loaded) setDraft(loaded)
  }, [setDraft])

  /* persist the draft (debounced), clearing is handled in submit() */
  useEffect(() => {
    if (!initialized.current) return
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, draft)
      } catch {}
    }, 250)
    return () => window.clearTimeout(timer)
  }, [draft])

  /* restore a pending caret after a programmatic draft change (runs after
     every render so a history step equal to the current draft still lands) */
  useEffect(() => {
    const el = taRef.current
    if (el && pendingCaret.current != null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current)
      pendingCaret.current = null
    }
  })

  /* auto-grow the textarea */
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 220) + 'px'
  }, [draft])

  /* clear the file-fetch debounce on unmount */
  useEffect(() => () => {
    if (acTimer.current) window.clearTimeout(acTimer.current)
  }, [])

  /* ------------------------------------------------------- autocomplete */

  const closeAc = () => setAc(EMPTY_AC)

  const moveAc = (delta: number) => {
    setAc((prev) => {
      if (!prev.open || !prev.items.length) return prev
      return { ...prev, index: (prev.index + delta + prev.items.length) % prev.items.length }
    })
  }

  const acceptAc = (idx?: number) => {
    if (!ac.open || !ac.items.length) return
    const item = ac.items[idx ?? ac.index] ?? ac.items[0]
    const insert = ac.mode === 'command' ? `/${item.value} ` : `@${item.value} `
    const next = draft.slice(0, ac.from) + insert + draft.slice(ac.to)
    const caret = (draft.slice(0, ac.from) + insert).length
    pendingCaret.current = caret
    setDraft(next)
    closeAc()
    taRef.current?.focus()
  }

  const updateAc = (value: string, caret: number) => {
    const ctx = acContext(value, caret)
    if (!ctx) {
      closeAc()
      return
    }
    if (ctx.mode === 'command') {
      if (acTimer.current) window.clearTimeout(acTimer.current)
      const q = ctx.query.toLowerCase()
      const items: AcItem[] = (commands || [])
        .filter((c) => !q || String(c.name).toLowerCase().includes(q))
        .slice(0, 40)
        .map((c) => ({ value: c.name, label: `/${c.name}`, desc: c.description || '', kind: c.source }))
      setAc({ open: true, mode: 'command', items, index: 0, from: ctx.from, to: ctx.to })
      return
    }

    if (acTimer.current) window.clearTimeout(acTimer.current)
    const seq = ++acSeq.current
    setAc((prev) => ({ ...prev, open: false, mode: 'file', items: [], from: ctx.from, to: ctx.to }))
    acTimer.current = window.setTimeout(async () => {
      try {
        const res = await fetch(apiUrl(`/api/files?q=${encodeURIComponent(ctx.query)}&limit=40`))
        const json = await res.json()
        if (!aliveRef.current || seq !== acSeq.current) return
        const files: string[] = Array.isArray(json.files) ? json.files : []
        setAc({
          open: true,
          mode: 'file',
          items: files.map((f) => ({ value: f, label: f, desc: '', kind: null })),
          index: 0,
          from: ctx.from,
          to: ctx.to,
        })
      } catch {
        if (aliveRef.current && seq === acSeq.current) closeAc()
      }
    }, 90)
  }

  /* close when clicking anywhere outside the popup / textarea */
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      if (acRef.current && !acRef.current.contains(target) && target !== taRef.current) closeAc()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  /* ------------------------------------------------------------ history */

  const pushHistory = (text: string) => {
    if (!text) return
    const next = history.filter((x) => x !== text)
    next.push(text)
    const kept = next.length > HIST_MAX ? next.slice(-HIST_MAX) : next
    setHistory(kept)
    try {
      localStorage.setItem(HIST_KEY, JSON.stringify(kept))
    } catch {}
    histIndex.current = -1
    setHistoryHint('')
  }

  const browseHistory = (delta: number): boolean => {
    if (!history.length) return false
    let idx = histIndex.current
    if (idx === -1) idx = history.length
    idx = Math.min(history.length, Math.max(0, idx + delta))
    histIndex.current = idx
    const next = idx >= history.length ? '' : history[idx]
    pendingCaret.current = next.length
    setDraft(next)
    setHistoryHint(idx >= history.length ? '' : `${history.length - idx}/${history.length}`)
    return true
  }

  /* --------------------------------------------------------- attachments */

  const fileToAttachment = (file: File): Promise<Attachment | null> =>
    new Promise((resolve) => {
      if (!file || !file.type || !file.type.startsWith('image/')) return resolve(null)
      if (file.size > MAX_IMAGE_BYTES) {
        toast(t('attach.tooLarge', { mb: (file.size / 1024 / 1024).toFixed(1) }), 'warning')
        return resolve(null)
      }
      const fr = new FileReader()
      fr.onload = () => {
        const raw = String(fr.result || '')
        const m = /^data:([^;]+);base64,(.*)$/.exec(raw)
        if (!m) return resolve(null)
        resolve({
          id: uid('att'),
          data: m[2],
          mimeType: m[1],
          bytes: file.size,
          name: file.name || 'pasted-image',
          url: raw,
        })
      }
      fr.onerror = () => resolve(null)
      fr.readAsDataURL(file)
    })

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files)
    let added = 0
    const newAtts: Attachment[] = []
    for (const f of list) {
      const att = await fileToAttachment(f)
      if (att) {
        newAtts.push(att)
        added += 1
      }
    }
    if (newAtts.length) setAttachments((prev) => [...prev, ...newAtts])
    if (added) toast(t(added === 1 ? 'attach.one' : 'attach.other', { n: added }), 'info', 1600)
  }

  /* -------------------------------------------------------------- submit */

  const submit = () => {
    const text = draft
    const trimmed = text.trim()
    const images = attachments.map((a) => ({ data: a.data, mimeType: a.mimeType }))
    if (!trimmed && !images.length) return
    closeAc()
    if (trimmed) pushHistory(trimmed)
    pendingCaret.current = null
    setDraft('')
    setAttachments([])
    try {
      localStorage.removeItem(DRAFT_KEY)
    } catch {}
    if (trimmed) {
      send(text, images.length ? images : undefined)
    } else {
      // image-only prompt: the store's send() requires non-empty text
      void sendCommand({ type: 'prompt', message: '', images })
    }
  }

  /* ------------------------------------------------------------- handlers */

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (ac.open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        moveAc(1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        moveAc(-1)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing)) {
        e.preventDefault()
        acceptAc()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeAc()
        return
      }
    }

    const el = e.currentTarget
    const start = el.selectionStart ?? draft.length
    const end = el.selectionEnd ?? start
    const before = draft.slice(0, start)
    const after = draft.slice(end)

    // shell-style history, only when the caret is on the first / last line
    if (e.key === 'ArrowUp' && !before.includes('\n')) {
      if (browseHistory(-1)) e.preventDefault()
      return
    }
    if (e.key === 'ArrowDown' && !after.includes('\n')) {
      if (browseHistory(1)) e.preventDefault()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setDraft(value)
    setHistoryHint('')
    updateAc(value, e.target.selectionStart ?? value.length)
  }

  const onSelect = (e: ChangeEvent<HTMLTextAreaElement>) => {
    updateAc(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length)
  }

  const onBlur = () => {
    window.setTimeout(closeAc, 120)
  }

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    e.target.value = ''
    if (files.length) void addFiles(files)
  }

  const onPaste = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const dtItems = e.clipboardData?.items
    if (!dtItems) return
    const files: File[] = []
    let hasText = false
    for (let i = 0; i < dtItems.length; i++) {
      const it = dtItems[i]
      if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) files.push(f)
      } else if (it.kind === 'string' && it.type === 'text/plain') {
        hasText = true
      }
    }
    if (!files.length) return
    if (!hasText) e.preventDefault()
    void addFiles(files)
  }

  const onDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (e.dataTransfer && e.dataTransfer.types.includes('Files')) e.preventDefault()
  }

  const onDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer) return
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type && f.type.startsWith('image/'))
    if (files.length) {
      e.preventDefault()
      void addFiles(files)
    }
  }

  const canSend = !disabled && (!!draft.trim() || attachments.length > 0)

  /* -------------------------------------------------------------- render */

  return (
    <div
      className="border-t border-border bg-background/80 px-4 py-3 backdrop-blur"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="mx-auto max-w-3xl">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="group relative size-16 overflow-hidden rounded-lg border border-border"
              >
                <img src={att.url} alt={att.name} className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                  title={t('attach.remove')}
                  className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded bg-background/80 text-foreground opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => fileRef.current?.click()}
            title={t('composer.attach')}
            disabled={disabled}
            className="shrink-0"
          >
            <Paperclip className="size-4" />
          </Button>

          <div className="relative min-w-0 flex-1">
            <Textarea
              ref={taRef}
              value={draft}
              onChange={onChange}
              onKeyDown={onKeyDown}
              onSelect={onSelect}
              onBlur={onBlur}
              onPaste={onPaste}
              rows={1}
              placeholder={disabled ? 'pi is not running…' : t('composer.placeholder')}
              disabled={disabled}
              className="min-h-[44px] resize-none py-3"
            />
            {historyHint && (
              <span className="pointer-events-none absolute bottom-3 right-3 text-[11px] text-muted-foreground">
                {historyHint}
              </span>
            )}
            {ac.open && (
              <div
                ref={acRef}
                role="listbox"
                className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
              >
                <div className="px-2.5 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {ac.mode === 'command'
                    ? t('ac.commands', { n: ac.items.length })
                    : t('ac.files', { n: ac.items.length })}
                </div>
                {ac.items.length === 0 ? (
                  <div className="px-2.5 py-1.5 text-sm text-muted-foreground">
                    {ac.mode === 'command' ? t('ac.noCommands') : t('ac.noFiles')}
                  </div>
                ) : (
                  ac.items.map((item, i) => (
                    <button
                      key={`${item.value}-${i}`}
                      type="button"
                      role="option"
                      aria-selected={i === ac.index}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        acceptAc(i)
                      }}
                      className={cn(
                        'flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left text-sm',
                        i === ac.index && 'bg-muted',
                      )}
                    >
                      <span className="font-mono text-[13px]">{item.label}</span>
                      {item.kind && <span className="text-[11px] text-muted-foreground">{item.kind}</span>}
                      {item.desc && <span className="text-[11px] text-muted-foreground">{item.desc}</span>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {streaming ? (
            <Button
              variant="secondary"
              size="icon"
              onClick={abort}
              title={t('common.stop')}
              className="shrink-0"
            >
              <Square className="size-4" />
            </Button>
          ) : (
            <Button size="icon" onClick={submit} disabled={!canSend} title={t('common.send')} className="shrink-0">
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFileChange} />
    </div>
  )
}

export default Composer
