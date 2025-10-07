import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Handle, Position } from "@xyflow/react"
import ActionTypeDropdown from "./ActionTypeDropdown"
import ActionServiceDropdown from "./ActionServiceDropdown"
import SendGridAction from "./Actions/Email/Services/SendGridAction"
import NodeInputField from "../UI/InputFields/NodeInputField"
import NodeCheckBoxField from "../UI/InputFields/NodeCheckboxField"
import NodeHeader from "../UI/ReactFlow/NodeHeader"
import MailGunAction from "./Actions/Email/Services/MailGunAction"
import SMTPAction from "./Actions/Email/Services/SMTPAction"
import AmazonSESAction from "./Actions/Email/Services/AmazonSESAction"
import WebhookAction from "./Actions/Webhook/Webhook"
import MessagingAction from "./Actions/Messaging/MessagingAction"
import SheetsAction from "./Actions/Google/SheetsAction"
import HttpRequestAction from "./Actions/HttpRequestAction"
import RunCustomCodeAction from "./Actions/RunCustomCodeAction"

interface ActionNodeProps {
  id: string
  data: any
  selected: boolean
  onRun?: (id: string, params: any) => Promise<void>
  onRemove?: (id: string) => void
  onDirtyChange?: (dirty: boolean, data: any) => void
  onUpdateNode?: (id: string, data: any, suppressDirty?: boolean) => void
}

export default function ActionNode({
  id,
  data,
  selected,
  onRun,
  onRemove,
  onDirtyChange,
  onUpdateNode
}: ActionNodeProps) {
  const isNewNode = !data?.id

  const [expanded, setExpanded] = useState(data?.expanded ?? false)
  const [dirty, setDirty] = useState(data?.dirty ?? isNewNode)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [running, setRunning] = useState(false)
  const [actionType, setActionType] = useState(data?.actionType || "Send Email")
  const [params, setParams] = useState(() => ({
    service: "",
    ...(data?.params || data?.inputs || {})
  }))
  const [timeout, setTimeoutMs] = useState(data?.timeout || 5000)
  const [retries, setRetries] = useState(data?.retries || 0)
  const [stopOnError, setStopOnError] = useState(data?.stopOnError ?? true)
  const [_, setConfig] = useState(() => data || { type: "", params: {} })
  const [label, setLabel] = useState(data?.label || "Action")

  useEffect(() => {
    setConfig(data || { type: "", params: {} })
  }, [data])

  useEffect(() => {
    if (data?.dirty !== undefined && data.dirty !== dirty) {
      console.log("Sync dirty from parent:", data.dirty)
      setDirty(data.dirty)
    }
  }, [data?.dirty])

  const [prevService, setPrevService] = useState(params.service || "")

  const [hasValidationErrors, setHasValidationErrors] = useState(false)

  useEffect(() => {
    if (params.service !== prevService) {
      let defaultRegion = ""
      switch (params.service.toLowerCase()) {
        case "mailgun":
          defaultRegion = "US (api.mailgun.net)"
          break
        case "amazon ses":
          defaultRegion = "us-east-1"
          break
        default:
          defaultRegion = ""
      }

      setParams(prev => ({ ...prev, region: defaultRegion }))
      setPrevService(params.service)
    }
  }, [params.service, prevService])

  useEffect(() => {
    onUpdateNode?.(
      id, { label, actionType, params, timeout, retries, stopOnError, dirty, expanded, hasValidationErrors }, true
    )

    if (dirty) {
      onDirtyChange?.(true, { label, actionType, params, timeout, retries, stopOnError, expanded })
    }
  }, [label, actionType, params, timeout, retries, stopOnError, dirty, expanded, hasValidationErrors])

  const handleRun = async () => {
    setRunning(true)
    try { await onRun?.(id, params) } finally { setRunning(false) }
  }

  return (
    <motion.div layout className={`relative rounded-2xl shadow-md border bg-white dark:bg-zinc-900 transition-all ${selected ? "ring-2 ring-blue-500" : "border-zinc-300 dark:border-zinc-700"}`} style={{ width: expanded ? "auto" : 256, minWidth: expanded ? 256 : undefined, maxWidth: expanded ? 400 : undefined }}>
      <Handle type="target" position={Position.Left} style={{ width: 14, height: 14, backgroundColor: "blue", border: "2px solid white" }} />
      <Handle type="source" position={Position.Right} style={{ width: 14, height: 14, backgroundColor: "green", border: "2px solid white" }} />
      <div className="p-3">
        <NodeHeader
          label={label}
          dirty={dirty}
          hasValidationErrors={hasValidationErrors}
          expanded={expanded}
          onLabelChange={
            val => {
              setLabel(val)
              setDirty(true)
            }
          }
          onExpanded={
            () => setExpanded(prev => !prev)
          }
          onConfirmingDelete={
            () => setConfirmingDelete(true)
          }
        />
        <button onClick={handleRun} disabled={running || hasValidationErrors} className="mt-2 w-full py-1 text-sm rounded-md bg-green-500 text-white hover:bg-green-600 disabled:opacity-50">
          {running ? "Testing..." : "Test Action"}
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div key="expanded-content" layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-3 border-t border-zinc-200 dark:border-zinc-700 pt-2 space-y-2">
              <p className="text-xs text-zinc-500">Action Type</p>
              <ActionTypeDropdown value={actionType} onChange={t => { setActionType(t); setDirty(true) }} />
              {actionType === 'webhook' && (
                <div className="flex flex-col gap-2">
                  <WebhookAction
                    args={params}
                    onChange={
                      (updatedParams, nodeHasErrors, childDirty) => {
                        setParams(prev => ({ ...prev, ...updatedParams }))
                        setHasValidationErrors(nodeHasErrors)
                        setDirty(prev => childDirty || prev)
                      }
                    }
                  />
                </div>
              )}
              {actionType === "email" && (
                <div className="flex flex-col gap-2">
                  <ActionServiceDropdown
                    value={params.service}
                    onChange={
                      val => {
                        setParams(prev => ({ ...prev, service: val }));
                        setDirty(true);
                      }
                    }
                  />
                  {params.service === "Mailgun" && (
                    <MailGunAction
                      args={params}
                      onChange={(updatedParams, nodeHasErrors, childDirty) => {
                        setParams((prev) => ({ ...prev, ...updatedParams }))
                        setHasValidationErrors(nodeHasErrors)
                        setDirty(prev => childDirty || prev)
                      }}
                    />
                  )}
                  {params.service === 'SendGrid' && (
                    <SendGridAction
                      args={params}
                      onChange={(updatedParams, nodeHasErrors, childDirty) => {
                        setParams(prev => ({ ...prev, ...updatedParams }))
                        setHasValidationErrors(nodeHasErrors)
                        setDirty(prev => childDirty || prev)
                      }}
                    />

                  )}
                  {params.service === "SMTP" && (
                    <SMTPAction
                      args={params}
                      onChange={(updatedParams, nodeHasErrors, childDirty) => {
                        setParams(prev => ({ ...prev, ...updatedParams }))
                        setHasValidationErrors(nodeHasErrors)
                        setDirty(prev => childDirty || prev)
                      }}
                    />
                  )}
                  {params.service === "Amazon SES" && (
                    <AmazonSESAction
                      args={params}
                      onChange={(updatedParams, nodeHasErrors, childDirty) => {
                        setParams(prev => ({ ...prev, ...updatedParams }))
                        setHasValidationErrors(nodeHasErrors)
                        setDirty(prev => childDirty || prev)
                      }}
                    />
                  )}
                </div>
              )}
              {actionType === "messaging" && (
                <MessagingAction
                  args={params}
                  onChange={(updatedParams, nodeHasErrors, childDirty) => {
                    setParams(prev => ({ ...prev, ...updatedParams }))
                    setHasValidationErrors(nodeHasErrors)
                    setDirty(prev => childDirty || prev)
                  }}
                />
              )}
              {actionType === "sheets" && (
                <SheetsAction
                  args={params}
                  onChange={
                    (updatedParams, nodeHasErrors, childDirty) => {
                      setParams(prev => ({ ...prev, ...updatedParams }))
                      setHasValidationErrors(nodeHasErrors)
                      setDirty(prev => childDirty || prev)
                    }
                  }
                />
              )}
              {actionType === "http" && (
                <HttpRequestAction
                  args={params}
                  onChange={
                    (updatedParams, nodeHasErrors, childDirty) => {
                      setParams(prev => ({ ...prev, ...updatedParams }))
                      setHasValidationErrors(nodeHasErrors)
                      setDirty(prev => childDirty || prev)
                    }
                  }
                />
              )}
              {actionType === "code" && (
                <RunCustomCodeAction
                  args={{ code: params.code || "", language: params.language || "js", inputs: params.inputs || [], outputs: params.outputs || [], dirty }}
                  onChange={(updatedParams, nodeHasErrors, childDirty) => {
                    setParams(prev => ({ ...prev, ...updatedParams }))
                    setHasValidationErrors(nodeHasErrors)
                    setDirty(prev => childDirty || prev)
                  }}
                />
              )}
              <p className="text-xs text-zinc-500">Execution Options</p>
              <div className="flex gap-2 items-center">
                <NodeInputField
                  type="number"
                  value={timeout}
                  onChange={
                    val => {
                      setTimeoutMs(Number(val));
                      setDirty(true)
                    }
                  }
                  className="w-20 text-xs p-1 rounded border border-zinc-300 dark:border-zinc-600 bg-transparent"
                />
                <span className="text-xs">ms timeout</span>
                <NodeInputField
                  type="number"
                  value={retries}
                  onChange={
                    val => {
                      setRetries(Number(val));
                      setDirty(true)
                    }
                  }
                  className="w-12 text-xs p-1 rounded border border-zinc-300 dark:border-zinc-600 bg-transparent"
                />
                <span className="text-xs">retries</span>
                <NodeCheckBoxField
                  checked={stopOnError}
                  onChange={
                    val => {
                      setStopOnError(val);
                      setDirty(true)
                    }
                  }
                >
                  Stop on error
                </NodeCheckBoxField>
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
