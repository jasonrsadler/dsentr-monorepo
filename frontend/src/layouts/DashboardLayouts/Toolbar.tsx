import { useEffect, useState } from 'react'
import {
  selectIsDirty,
  selectIsSaving,
  useWorkflowStore
} from '@/stores/workflowStore'

type WorkspaceRole = 'owner' | 'admin' | 'user' | 'viewer'

type WorkflowOption = { id: string; name: string }

type WorkflowSummary = {
  id: string
  name: string
  list: WorkflowOption[]
}

interface WorkflowToolbarProps {
  workflow: WorkflowSummary
  role?: WorkspaceRole
  canEdit?: boolean
  canLock?: boolean
  canUnlock?: boolean
  isLocked?: boolean
  lockBusy?: boolean
  onLock?: () => void
  onUnlock?: () => void
  onSave?: () => void
  onNew?: () => void
  onSelect?: (id: string) => void
  onRename?: (id: string, name: string) => void
  runStatus?: 'idle' | 'queued' | 'running'
  onToggleOverlay?: () => void
}

export default function WorkflowToolbar({
  workflow,
  role = 'viewer',
  canEdit = false,
  canLock = false,
  canUnlock = false,
  isLocked = false,
  lockBusy = false,
  onLock,
  onUnlock,
  onSave,
  onNew,
  onSelect,
  onRename,
  runStatus = 'idle',
  onToggleOverlay
}: WorkflowToolbarProps) {
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(workflow?.name || '')
  const [nameError, setNameError] = useState<string | null>(null)
  const isViewer = role === 'viewer'
  const isDirty = useWorkflowStore(selectIsDirty)
  const isSaving = useWorkflowStore(selectIsSaving)

  useEffect(() => {
    setName(workflow?.name || '')
    setNameError(null)
    setEditingName(false)
  }, [workflow?.id, workflow?.name])

  const handleRename = () => {
    if (!canEdit) {
      setEditingName(false)
      setName(workflow?.name || '')
      return
    }
    const trimmed = name.trim()
    if (!trimmed) {
      setName(workflow?.name || '')
      setEditingName(false)
      setNameError(null)
      return
    }
    if (trimmed !== workflow?.name) {
      const exists = (workflow?.list || []).some(
        (w: WorkflowOption) => w.name?.toLowerCase?.() === trimmed.toLowerCase()
      )
      if (exists) {
        setNameError('A workflow with this name already exists')
        return
      }
      onRename?.(workflow.id, trimmed)
    }
    setNameError(null)
    setEditingName(false)
  }

  const triggerRename = () => {
    if (!canEdit) return
    setEditingName(true)
  }

  const handleNewClick = () => {
    if (!canEdit) return
    onNew?.()
  }

  const handleSaveClick = () => {
    if (!canEdit) return
    onSave?.()
  }

  const isSavingDisabled = !isDirty || isSaving || !canEdit
  const isRunActive = runStatus === 'queued' || runStatus === 'running'
  const runBtnClasses = isRunActive
    ? runStatus === 'running'
      ? 'bg-green-500 text-white hover:bg-green-600 animate-pulse'
      : 'bg-blue-500 text-white hover:bg-blue-600'
    : 'bg-zinc-300 text-zinc-600 cursor-not-allowed'

  const renderLockButton = () => {
    if (isLocked) {
      if (canUnlock) {
        return (
          <button
            type="button"
            onClick={() => !lockBusy && onUnlock?.()}
            disabled={lockBusy}
            className={`px-2 py-1 rounded border ${
              lockBusy
                ? 'border-zinc-300 text-zinc-400 cursor-not-allowed'
                : 'border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30'
            }`}
          >
            {lockBusy ? 'Unlocking…' : 'Unlock'}
          </button>
        )
      }
      return <span className="text-xs text-zinc-500 ml-2">Locked</span>
    }

    if (!canLock) {
      return null
    }

    return (
      <button
        type="button"
        onClick={() => !lockBusy && onLock?.()}
        disabled={lockBusy}
        className={`px-2 py-1 rounded border ${
          lockBusy
            ? 'border-zinc-300 text-zinc-400 cursor-not-allowed'
            : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'
        }`}
      >
        {lockBusy ? 'Locking…' : 'Lock'}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 p-2 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
      <select
        value={workflow?.id}
        onChange={(e) => onSelect?.(e.target.value)}
        className="px-2 py-1 border rounded bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-600"
      >
        {workflow?.list?.map((wf) => (
          <option
            key={wf.id}
            value={wf.id}
            className="bg-white dark:bg-zinc-800"
          >
            {wf.name}
          </option>
        ))}
      </select>

      {editingName ? (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          className="px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-600"
          autoFocus
          disabled={!canEdit}
        />
      ) : (
        <button
          type="button"
          onClick={triggerRename}
          disabled={!canEdit}
          className={`px-2 py-1 border rounded ${
            canEdit
              ? 'bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              : 'bg-zinc-200 text-zinc-500 cursor-not-allowed'
          }`}
        >
          Rename
        </button>
      )}

      {nameError && (
        <span className="text-xs text-red-600 ml-2">{nameError}</span>
      )}

      <button
        type="button"
        onClick={handleNewClick}
        disabled={!canEdit}
        className={`px-2 py-1 rounded ${
          canEdit
            ? 'bg-blue-500 text-white hover:bg-blue-600'
            : 'bg-blue-200 text-white/70 cursor-not-allowed'
        }`}
      >
        New Workflow
      </button>

      <button
        type="button"
        onClick={handleSaveClick}
        disabled={isSavingDisabled}
        className={`px-2 py-1 rounded ${
          isSavingDisabled
            ? 'bg-zinc-300 text-zinc-600 cursor-not-allowed'
            : 'bg-green-500 text-white hover:bg-green-600'
        }`}
      >
        {isSaving ? 'Saving...' : 'Save'}
      </button>

      {isDirty && !isSaving && canEdit && (
        <span className="w-2 h-2 rounded-full bg-blue-500" />
      )}

      {!canEdit && isViewer && (
        <span className="text-xs text-zinc-500">Viewer access</span>
      )}

      {renderLockButton()}

      <button
        type="button"
        onClick={() => onToggleOverlay?.()}
        disabled={!isRunActive}
        className={`ml-2 px-2 py-1 rounded ${runBtnClasses}`}
        title={isRunActive ? `Run is ${runStatus}` : 'No active run'}
      >
        Run Status
      </button>
    </div>
  )
}
