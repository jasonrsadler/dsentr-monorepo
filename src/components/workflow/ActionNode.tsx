import { useState, useMemo, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Handle, Position } from "@xyflow/react"
import { ChevronUp, ChevronDown, Trash2, Plus } from "lucide-react"
import ActionTypeDropdown from "./ActionTypeDropdown"
import { pre } from "framer-motion/client"
import ActionServiceDropdown from "./ActionServiceDropdown"

export default function ActionNode({
  id,
  data,
  selected,
  onLabelChange,
  onRun,
  onRemove,
  onDirtyChange,
  onUpdateNode
}) {
  const isNewNode = !data?.id
  const [label, setLabel] = useState(data?.label ?? "Action")
  const [expanded, setExpanded] = useState(data?.expanded ?? false)
  const [dirty, setDirty] = useState(data?.dirty ?? isNewNode)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [running, setRunning] = useState(false)
  const [editing, setEditing] = useState(false)
  const [actionType, setActionType] = useState(data?.actionType || "Send Email")
  const [params, setParams] = useState(() => ({
    service: "",
    ...(data?.inputs || {})
  }))
  const [timeout, setTimeoutMs] = useState(data?.timeout || 5000)
  const [retries, setRetries] = useState(data?.retries || 0)
  const [stopOnError, setStopOnError] = useState(data?.stopOnError ?? true)
  const [config, setConfig] = useState(() => data || { type: "", params: {} })

  useEffect(() => {
    setConfig(data || { type: "", params: {} })
  }, [data])

  useEffect(() => {
    if (data?.dirty !== undefined && data.dirty !== dirty) {
      console.log("Sync dirty from parent:", data.dirty)
      setDirty(data.dirty)
    }
  }, [data?.dirty])

  const hasValidationErrors = useMemo(() => {
    const checkVars = (vars = []) => {
      const keys = vars.map(v => v.key.trim()).filter(Boolean)
      return vars.some(v => !v.key.trim() || !v.value.trim()) ||
        new Set(keys).size !== keys.length
    }
    return (params.substitutions && checkVars(params.substitutions)) ||
      (params.variables && checkVars(params.variables))
  }, [params.substitutions, params.variables])

  useEffect(() => {
    // Notify parent of updates — always send hasValidationErrors so parent can warn
    onUpdateNode?.(
      id,
      { label, actionType, params, timeout, retries, stopOnError, dirty, expanded, hasValidationErrors },
      true // suppress dirty marking for programmatic updates
    )

    // Mark workflow dirty only if user actually made changes
    if (dirty) {
      onDirtyChange?.(true, { label, actionType, params, timeout, retries, stopOnError, expanded })
    }
  }, [label, actionType, params, timeout, retries, stopOnError, dirty, expanded, hasValidationErrors])

  const hasInvalidInputs = useMemo(() => {

  }, [params])

  const hasDuplicateKeys = useMemo(() => {

  }, [params])

  const updateInput = (index, field, value) => {
    setParams(prev => {
      const updated = [...prev]
      updated[index][field] = value
      setDirty(true)
      return updated
    })
  }

  const addInput = () => {
    setParams(prev => [...prev, { key: "", value: "" }])
    setDirty(true)
  }
  const removeInput = index => {
    setParams(prev => prev.filter((_, i) => i !== index))
    setDirty(true)
  }

  const handleRun = async () => {
    setRunning(true)
    try { await onRun?.(id, params) } finally { setRunning(false) }
  }

  const handleParamChange = useCallback((key, value) => {
    setConfig((prev) => ({
      ...prev,
      params: { ...prev.params, [key]: value }
    }))
    setDirty(true)
  }, [])

  return (
    <motion.div layout className={`relative rounded-2xl shadow-md border bg-white dark:bg-zinc-900 transition-all ${selected ? "ring-2 ring-blue-500" : "border-zinc-300 dark:border-zinc-700"}`} style={{ width: expanded ? "auto" : 256, minWidth: expanded ? 256 : undefined, maxWidth: expanded ? 400 : undefined }}>
      <Handle type="target" position={Position.Left} style={{ width: 14, height: 14, backgroundColor: "blue", border: "2px solid white" }} />
      <Handle type="source" position={Position.Right} style={{ width: 14, height: 14, backgroundColor: "green", border: "2px solid white" }} />
      <div className="p-3">
        <div className="flex justify-between items-center">
          {editing ? (
            <input
              value={label}
              onChange={e => {
                setLabel(e.target.value)
                setDirty(true)
              }}
              onBlur={() => { setEditing(false); onLabelChange?.(id, label) }}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  e.currentTarget.blur()  // triggers onBlur
                }
              }}
              className="text-sm font-semibold bg-transparent border-b border-zinc-400 focus:outline-none w-full"
            />
          ) : (
            <h3 onDoubleClick={() => setEditing(true)} className="text-sm font-semibold cursor-pointer relative">
              {label}{(dirty || hasValidationErrors) && (<span className="absolute -right-3 top-1 w-2 h-2 rounded-full bg-blue-500" />)}
            </h3>
          )}
          <div className="flex gap-1">
            <button onClick={() => setExpanded(prev => !prev)} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
            <button onClick={() => setConfirmingDelete(true)} className="p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded" title="Delete node"><Trash2 size={16} className="text-red-600" /></button>
          </div>
        </div>

        <button onClick={handleRun} disabled={running || hasDuplicateKeys || hasInvalidInputs} className="mt-2 w-full py-1 text-sm rounded-md bg-green-500 text-white hover:bg-green-600 disabled:opacity-50">
          {running ? "Testing..." : "Test Action"}
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div key="expanded-content" layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-3 border-t border-zinc-200 dark:border-zinc-700 pt-2 space-y-2">
              <p className="text-xs text-zinc-500">Action Type</p>
              <ActionTypeDropdown value={actionType} onChange={t => { setActionType(t); setDirty(true) }} />
              {actionType === "email" && (
                <div className="flex flex-col gap-2">
                  <ActionServiceDropdown
                    value={params.service}
                    onChange={val => { setParams({ ...params, service: val }); setDirty(true); }}
                  />
                  {params.service.toLowerCase() === "mailgun" && (
                    <div className="space-y-2">
                      <p className="text-xs text-zinc-500">Mailgun Settings</p>

                      <input
                        className="text-xs p-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-transparent"
                        placeholder="Domain (e.g. mg.example.com)"
                        value={params.domain || ""}
                        onChange={e => {
                          setParams(prev => ({ ...prev, domain: e.target.value }))
                          setDirty(true)
                        }}
                      />

                      <input
                        type="password"
                        className="text-xs p-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-transparent"
                        placeholder="API Key"
                        value={params.apiKey || ""}
                        onChange={e => {
                          setParams(prev => ({ ...prev, apiKey: e.target.value }))
                          setDirty(true)
                        }}
                      />

                      <input
                        className="text-xs p-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-transparent"
                        placeholder="From"
                        value={params.from || ""}
                        onChange={e => {
                          setParams(prev => ({ ...prev, from: e.target.value }))
                          setDirty(true)
                        }}
                      />

                      <input
                        className="text-xs p-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-transparent"
                        placeholder="To (comma separated)"
                        value={params.to || ""}
                        onChange={e => {
                          setParams(prev => ({ ...prev, to: e.target.value }))
                          setDirty(true)
                        }}
                      />

                      <input
                        className="text-xs p-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-transparent"
                        placeholder="Subject"
                        value={params.subject || ""}
                        onChange={e => {
                          setParams(prev => ({ ...prev, subject: e.target.value }))
                          setDirty(true)
                        }}
                      />

                      <textarea
                        className="text-xs p-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-transparent"
                        placeholder="Body (plain text or HTML)"
                        value={params.body || ""}
                        rows={4}
                        onChange={e => {
                          setParams(prev => ({ ...prev, body: e.target.value }))
                          setDirty(true)
                        }}
                      />

                      <input
                        className="text-xs p-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-transparent"
                        placeholder="Template Name (optional)"
                        value={params.template || ""}
                        onChange={e => {
                          setParams(prev => ({ ...prev, template: e.target.value }))
                          setDirty(true)
                        }}
                      />

                      {params.template?.trim() && (
                        <div className="space-y-1">
                          <p className="text-xs text-zinc-500">Template Variables</p>
                          {params.variables?.map((v, i) => (
                            <div key={i} className="flex gap-1">
                              <input
                                value={v.key}
                                placeholder="key"
                                className={`flex-1 text-xs p-1 rounded border ${!v.key.trim() || params.variables.filter(x => x.key.trim() === v.key.trim()).length > 1
                                  ? "border-red-500"
                                  : "border-zinc-300 dark:border-zinc-600"
                                  } bg-transparent`}
                                onChange={e => {
                                  const newVars = [...params.variables]
                                  newVars[i].key = e.target.value
                                  setParams(prev => ({ ...prev, variables: newVars }))
                                  setDirty(true)
                                }}
                              />
                              <input
                                value={v.value}
                                placeholder="value"
                                className={`flex-1 text-xs p-1 rounded border ${!v.value.trim()
                                  ? "border-red-500"
                                  : "border-zinc-300 dark:border-zinc-600"
                                  } bg-transparent`}
                                onChange={e => {
                                  const newVars = [...params.variables]
                                  newVars[i].value = e.target.value
                                  setParams(prev => ({ ...prev, variables: newVars }))
                                  setDirty(true)
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  setParams(prev => ({ ...prev, variables: prev.variables.filter((_, idx) => idx !== i) }))
                                  setDirty(true)
                                }}
                                className="p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded"
                              >
                                <Trash2 size={14} className="text-red-500" />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              setParams(prev => ({ ...prev, variables: [...(prev.variables || []), { key: "", value: "" }] }))
                              setDirty(true)
                            }}
                            className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            <Plus size={14} /> Add variable
                          </button>
                          {params.template && params.variables && (
                            <p className="text-xs text-red-500 mt-1">
                              {(() => {
                                const keys = params.variables.map(v => v.key.trim()).filter(k => k)
                                const hasBlank = params.variables.some(v => !v.key.trim() || !v.value.trim())
                                const hasDuplicate = new Set(keys).size !== keys.length
                                if (hasBlank) return "Keys and values cannot be blank"
                                if (hasDuplicate) return "Duplicate keys are not allowed"
                                return ""
                              })()}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {params.service === 'SendGrid' && (
                    <div className="flex flex-col gap-2">
                      <input
                        type="text"
                        placeholder="SendGrid API Key"
                        className="border p-1 rounded text-xs"
                        value={params.apiKey || ""}
                        onChange={e => { setParams({ ...params, apiKey: e.target.value }); setDirty(true) }}
                      />

                      <input
                        type="email"
                        placeholder="From Email (optional)"
                        className="border p-1 rounded text-xs"
                        value={params.from || ""}
                        onChange={e => { setParams({ ...params, from: e.target.value }); setDirty(true) }}
                      />

                      <input
                        type="text"
                        placeholder="Template ID (optional)"
                        className="border p-1 rounded text-xs"
                        value={params.templateId || ""}
                        onChange={e => { setParams({ ...params, templateId: e.target.value }); setDirty(true) }}
                      />

                      {params.templateId && (
                        <div className="flex flex-col gap-1 mt-2">
                          <p className="text-xs text-zinc-500">Substitution Variables</p>
                          {(params.substitutions || []).map((sub, index) => (
                            <div key={index} className="flex gap-1">
                              <input
                                type="text"
                                placeholder="Key"
                                className="flex-1 text-xs p-1 rounded border border-zinc-300 dark:border-zinc-600 bg-transparent"
                                value={sub.key}
                                onChange={e => {
                                  const updated = [...(params.substitutions || [])]
                                  updated[index].key = e.target.value
                                  setParams({ ...params, substitutions: updated })
                                  setDirty(true)
                                }}
                              />
                              <input
                                type="text"
                                placeholder="Value"
                                className="flex-1 text-xs p-1 rounded border border-zinc-300 dark:border-zinc-600 bg-transparent"
                                value={sub.value}
                                onChange={e => {
                                  const updated = [...(params.substitutions || [])]
                                  updated[index].value = e.target.value
                                  setParams({ ...params, substitutions: updated })
                                  setDirty(true)
                                }}
                              />
                              <button
                                onClick={() => {
                                  const updated = [...(params.substitutions || [])].filter((_, i) => i !== index)
                                  setParams({ ...params, substitutions: updated })
                                  setDirty(true)
                                }}
                                className="p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded"
                              >
                                <Trash2 size={14} className="text-red-500" />
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => {
                              setParams({ ...params, substitutions: [...(params.substitutions || []), { key: "", value: "" }] })
                              setDirty(true)
                            }}
                            className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            <Plus size={14} /> Add variable
                          </button>

                          {/* Validation */}
                          {params.substitutions && (
                            <p className="text-xs text-red-500 mt-1">
                              {(() => {
                                const keys = params.substitutions.map(s => s.key.trim()).filter(k => k)
                                const hasBlank = params.substitutions.some(s => !s.key.trim() || !s.value.trim())
                                const hasDuplicate = new Set(keys).size !== keys.length
                                if (hasBlank) return "Keys and values cannot be blank"
                                if (hasDuplicate) return "Duplicate keys are not allowed"
                                return ""
                              })()}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {params.service === "SMTP" && (
                    <div className="flex flex-col gap-2">
                      <input
                        type="text"
                        placeholder="SMTP Host"
                        className="border p-1 rounded text-xs"
                        value={params.smtpHost || ""}
                        onChange={e => { setParams({ ...params, smtpHost: e.target.value }); setDirty(true) }}
                      />

                      <input
                        type="number"
                        placeholder="SMTP Port"
                        className="border p-1 rounded text-xs"
                        value={params.smtpPort}
                        onChange={e => {
                          const val = Number(e.target.value)
                          setParams(prev => ({ ...prev, smtpPort: val })) // user edits now persist
                          setDirty(true)
                        }}
                      />

                      <input
                        type="text"
                        placeholder="Username"
                        className="border p-1 rounded text-xs"
                        value={params.smtpUser || ""}
                        onChange={e => { setParams({ ...params, smtpUser: e.target.value }); setDirty(true) }}
                      />

                      <input
                        type="password"
                        placeholder="API Key / Password"
                        className="border p-1 rounded text-xs"
                        value={params.apiKey || ""}
                        onChange={e => { setParams({ ...params, apiKey: e.target.value }); setDirty(true) }}
                      />

                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={params.smtpTls ?? true}
                          onChange={e => {
                            const checked = e.target.checked
                            setParams(prev => ({
                              ...prev,
                              smtpTls: checked,
                              // only auto-set port if user hasn't changed it yet
                              smtpPort: prev.smtpPort === undefined || prev.smtpPort === 25 || prev.smtpPort === 587
                                ? (checked ? 587 : 25)
                                : prev.smtpPort
                            }))
                            setDirty(true)
                          }}
                        />
                        Use TLS
                      </label>
                    </div>
                  )}
                  {(params.service === "SMTP" || params.service === 'SendGrid') && (
                    <>
                      <input
                        type="email"
                        placeholder="Sender Email"
                        className="border p-1 rounded text-xs"
                        value={params.from || ""}
                        onChange={e => { setParams({ ...params, from: e.target.value }); setDirty(true) }}
                      />

                      <input
                        type="email"
                        placeholder="Recipient Email"
                        className="border p-1 rounded text-xs"
                        value={params.to || ""}
                        onChange={e => { setParams({ ...params, to: e.target.value }); setDirty(true) }}
                      />

                      <input
                        placeholder="Subject"
                        className="border p-1 rounded text-xs"
                        value={params.subject || ""}
                        onChange={e => { setParams({ ...params, subject: e.target.value }); setDirty(true) }}
                      />

                      <textarea
                        placeholder="Message Body"
                        className="border p-1 rounded text-xs"
                        value={params.body || ""}
                        onChange={e => { setParams({ ...params, body: e.target.value }); setDirty(true) }}
                      />
                    </>
                  )}
                </div>
              )}
              <p className="text-xs text-zinc-500">Execution Options</p>
              <div className="flex gap-2 items-center">
                <input type="number" value={timeout} onChange={e => { setTimeoutMs(Number(e.target.value)); setDirty(true) }} className="w-20 text-xs p-1 rounded border border-zinc-300 dark:border-zinc-600 bg-transparent" />
                <span className="text-xs">ms timeout</span>
                <input type="number" value={retries} onChange={e => { setRetries(Number(e.target.value)); setDirty(true) }} className="w-12 text-xs p-1 rounded border border-zinc-300 dark:border-zinc-600 bg-transparent" />
                <span className="text-xs">retries</span>
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={stopOnError} onChange={e => { setStopOnError(e.target.checked); setDirty(true) }} />
                  Stop on error
                </label>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {confirmingDelete && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-2xl">
            <div className="bg-white dark:bg-zinc-800 p-4 rounded-xl shadow-md w-56">
              <p className="text-sm mb-3">Delete this node?</p>
              <p className="text-sm mb-3">This action can not be undone</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setConfirmingDelete(false)} className="px-2 py-1 text-xs rounded border">Cancel</button>
                <button onClick={() => { setConfirmingDelete(false); onRemove?.(id) }} className="px-2 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600">Delete</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
