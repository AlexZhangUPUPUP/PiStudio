/**
 * Extension UI dialogs.
 *
 * Renders the first pending dialog from the store (`state.dialogs`). Supports
 * the four methods pi extensions can request:
 *
 *   - `select`  → options list, ArrowUp/Down/Enter/number keys, respond {value}
 *   - `confirm` → message + No/Yes, respond {confirmed}, Yes is focused
 *   - `input`   → single-line field, Enter/OK respond {value}
 *   - `editor`  → textarea, Cmd/Ctrl+Enter/Save respond {value}
 *
 * Esc and backdrop clicks respond {cancelled:true}. An optional `timeout`
 * renders a live countdown and auto-resolves (responds with an empty payload,
 * which pi treats the same as a timeout) when it reaches 0.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePi, type ExtDialog } from '@/store/pi'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export default function ExtensionDialogs() {
  const { dialogs, respondDialog, t } = usePi()
  const dialog = dialogs[0]
  if (!dialog) return null
  return (
    <DialogView
      key={dialog.id}
      dialog={dialog}
      t={t}
      respond={(payload) => respondDialog(dialog.id, payload)}
    />
  )
}

function DialogView({
  dialog,
  t,
  respond,
}: {
  dialog: ExtDialog
  t: (key: string, vars?: Record<string, unknown>) => string
  respond: (payload: Record<string, unknown>) => void
}) {
  const options = Array.isArray(dialog.options) ? dialog.options : []
  const [value, setValue] = useState(dialog.prefill ?? '')
  const [selected, setSelected] = useState(0)
  const [left, setLeft] = useState(() => (dialog.timeout ? dialog.timeout : 0))
  const settledRef = useRef(false)
  const firstOptionRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)

  const finish = useCallback(
    (payload: Record<string, unknown>) => {
      if (settledRef.current) return
      settledRef.current = true
      respond(payload)
    },
    [respond],
  )

  const cancel = useCallback(() => finish({ cancelled: true }), [finish])

  // Live countdown for the optional timeout.
  useEffect(() => {
    if (!dialog.timeout) return
    const deadline = Date.now() + dialog.timeout
    const tick = () => {
      const remaining = Math.max(0, deadline - Date.now())
      setLeft(remaining)
      if (remaining <= 0) finish({})
    }
    tick()
    const iv = setInterval(tick, 100)
    return () => clearInterval(iv)
  }, [dialog.timeout, finish])

  // Global Esc → cancel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancel()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [cancel])

  // select: ArrowUp/Down/Enter/number keys.
  useEffect(() => {
    if (dialog.method !== 'select') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelected((s) => (options.length ? (s + 1) % options.length : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected((s) => (options.length ? (s - 1 + options.length) % options.length : 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (options[selected] != null) finish({ value: options[selected] })
      } else if (/^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1
        if (i < options.length) finish({ value: options[i] })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dialog.method, options, selected, finish])

  // Initial focus.
  useEffect(() => {
    if (dialog.method === 'select') firstOptionRef.current?.focus()
    else if (dialog.method === 'confirm') confirmRef.current?.focus()
    else if (dialog.method === 'input') inputRef.current?.focus()
    else editorRef.current?.focus()
  }, [dialog.method])

  const title =
    dialog.title ||
    t(
      dialog.method === 'confirm'
        ? 'dialog.confirm'
        : dialog.method === 'select'
          ? 'dialog.select'
          : dialog.method === 'editor'
            ? 'dialog.editor'
            : 'dialog.input',
    )

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`ext-dialog-title-${dialog.id}`}
        className="flex max-h-[85vh] w-full max-w-md animate-fade-in flex-col overflow-hidden rounded-lg border border-border bg-popover text-foreground shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t(`dialog.${dialog.method}`)}
          </span>
          <h2 id={`ext-dialog-title-${dialog.id}`} className="truncate text-sm font-semibold">
            {title}
          </h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {dialog.method === 'confirm' && dialog.message ? (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{dialog.message}</p>
          ) : null}

          {dialog.method === 'select' ? (
            <div className="flex flex-col gap-1">
              {options.map((opt, i) => (
                <button
                  key={opt}
                  ref={i === 0 ? firstOptionRef : undefined}
                  onClick={() => finish({ value: opt })}
                  onMouseMove={() => setSelected(i)}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    i === selected ? 'bg-teal/15 text-teal' : 'hover:bg-muted',
                  )}
                >
                  <span className="w-4 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
                  <span className="truncate">{opt}</span>
                </button>
              ))}
            </div>
          ) : null}

          {dialog.method === 'input' ? (
            <Input
              ref={inputRef}
              type="text"
              value={value}
              placeholder={dialog.placeholder || ''}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  finish({ value })
                }
              }}
            />
          ) : null}

          {dialog.method === 'editor' ? (
            <Textarea
              ref={editorRef}
              rows={12}
              value={value}
              placeholder={dialog.placeholder || ''}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  finish({ value })
                }
              }}
            />
          ) : null}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          {dialog.timeout ? (
            <span className="mr-auto font-mono text-xs text-muted-foreground">
              {t('dialog.timeout', { s: (left / 1000).toFixed(1) })}
            </span>
          ) : (
            <span className="mr-auto" />
          )}

          {dialog.method === 'select' ? (
            <Button variant="ghost" size="sm" onClick={cancel}>
              {t('common.cancel')}
            </Button>
          ) : null}

          {dialog.method === 'confirm' ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => finish({ confirmed: false })}>
                {t('common.no')}
              </Button>
              <Button ref={confirmRef} size="sm" onClick={() => finish({ confirmed: true })}>
                {t('common.yes')}
              </Button>
            </>
          ) : null}

          {dialog.method === 'input' ? (
            <>
              <Button variant="ghost" size="sm" onClick={cancel}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={() => finish({ value })}>
                {t('common.ok')}
              </Button>
            </>
          ) : null}

          {dialog.method === 'editor' ? (
            <>
              <Button variant="ghost" size="sm" onClick={cancel}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={() => finish({ value })}>
                {t('common.save')}
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
