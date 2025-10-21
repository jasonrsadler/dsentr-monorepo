import { useEffect, useMemo, useState } from 'react'
import ConfirmDialog from '@/components/ui/dialog/ConfirmDialog'
import {
  SecretStore,
  deleteSecret,
  fetchSecrets,
  upsertSecret
} from '@/lib/optionsApi'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'

interface ServiceDescriptor {
  key: string
  label: string
  valueLabel: string
  helper?: string
}

interface GroupDescriptor {
  key: string
  label: string
  description?: string
  services: ServiceDescriptor[]
}

const SECTION_CONFIG: GroupDescriptor[] = [
  {
    key: 'email',
    label: 'Email',
    description: 'Secrets used by email delivery providers.',
    services: [
      {
        key: 'mailgun',
        label: 'Mailgun',
        valueLabel: 'API Key',
        helper: 'Used when sending email via Mailgun.'
      },
      {
        key: 'sendgrid',
        label: 'SendGrid',
        valueLabel: 'API Key',
        helper: 'Used when sending email via SendGrid.'
      },
      {
        key: 'smtp',
        label: 'SMTP',
        valueLabel: 'Password / API Key',
        helper: 'Stored for SMTP credentials.'
      },
      {
        key: 'amazon_ses',
        label: 'Amazon SES',
        valueLabel: 'Secret Access Key',
        helper: 'Stored for Amazon SES actions.'
      }
    ]
  },
  {
    key: 'messaging',
    label: 'Messaging',
    description: 'Secrets for messaging platforms.',
    services: [
      {
        key: 'slack',
        label: 'Slack',
        valueLabel: 'Token',
        helper: 'Used for Slack message actions.'
      },
      {
        key: 'teams',
        label: 'Microsoft Teams',
        valueLabel: 'Header Secret',
        helper: 'Used for Header Secret Auth workflows.'
      }
    ]
  },
  {
    key: 'webhook',
    label: 'Webhooks',
    description: 'Secrets applied to outgoing webhook calls.',
    services: [
      {
        key: 'basic_auth',
        label: 'Basic Auth',
        valueLabel: 'Password'
      },
      {
        key: 'bearer_token',
        label: 'Bearer Token',
        valueLabel: 'Token'
      }
    ]
  },
  {
    key: 'http',
    label: 'HTTP Requests',
    description: 'Secrets used by the HTTP request action.',
    services: [
      {
        key: 'basic_auth',
        label: 'Basic Auth',
        valueLabel: 'Password'
      },
      {
        key: 'bearer_token',
        label: 'Bearer Token',
        valueLabel: 'Token'
      }
    ]
  }
]

type DraftMap = Record<string, { name: string; value: string }>
type ErrorMap = Record<string, string | null>

function formatLabel(raw: string): string {
  return raw
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function serviceKey(group: string, service: string) {
  return `${group}:${service}`
}

function mergeConfig(secrets: SecretStore): GroupDescriptor[] {
  const groups: GroupDescriptor[] = SECTION_CONFIG.map((group) => ({
    ...group,
    services: [...group.services]
  }))

  const ensureService = (group: GroupDescriptor, key: string) => {
    if (!group.services.some((svc) => svc.key === key)) {
      group.services.push({
        key,
        label: formatLabel(key),
        valueLabel: 'Secret'
      })
    }
  }

  Object.entries(secrets).forEach(([groupKey, services]) => {
    let group = groups.find((g) => g.key === groupKey)
    if (!group) {
      group = {
        key: groupKey,
        label: formatLabel(groupKey),
        services: []
      }
      groups.push(group)
    }

    Object.keys(services || {}).forEach((serviceKey) =>
      ensureService(group!, serviceKey)
    )
  })

  return groups
}

export default function OptionsTab() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [secrets, setSecrets] = useState<SecretStore>({})
  const [drafts, setDrafts] = useState<DraftMap>({})
  const [serviceErrors, setServiceErrors] = useState<ErrorMap>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [deleteBusyKey, setDeleteBusyKey] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{
    groupKey: string
    serviceKey: string
    name: string
  } | null>(null)
  const currentUserId = useAuth((state) => state.user?.id ?? null)
  const currentWorkspace = useAuth(selectCurrentWorkspace)
  const workspaceId = currentWorkspace?.workspace.id ?? null

  const workspaceRole = currentWorkspace?.role ?? 'viewer'
  const canCreateSecret = useMemo(
    () => ['owner', 'admin', 'user'].includes(workspaceRole),
    [workspaceRole]
  )
  const canDeleteAnySecret = useMemo(
    () => ['owner', 'admin'].includes(workspaceRole),
    [workspaceRole]
  )

  const canDeleteSecretEntry = (ownerId: string | null) => {
    if (canDeleteAnySecret) {
      return true
    }
    if (!canCreateSecret) {
      return false
    }
    if (!ownerId || !currentUserId) {
      return false
    }
    return ownerId === currentUserId
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    if (!workspaceId) {
      setSecrets({})
      setError(null)
      setLoading(false)
      return
    }

    fetchSecrets(workspaceId)
      .then((result) => {
        if (!active) return
        setSecrets(result)
        setError(null)
      })
      .catch((err) => {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to load secrets')
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [workspaceId])

  const sections = useMemo(() => mergeConfig(secrets), [secrets])

  useEffect(() => {
    setDrafts({})
    setServiceErrors({})
  }, [workspaceId])

  const handleAdd = async (
    groupKey: string,
    service: ServiceDescriptor,
    draft: { name: string; value: string }
  ) => {
    const key = serviceKey(groupKey, service.key)
    if (!canCreateSecret) {
      setServiceErrors((prev) => ({
        ...prev,
        [key]: 'You do not have permission to create secrets in this workspace.'
      }))
      return
    }
    const name = draft.name.trim()
    const value = draft.value.trim()

    if (!name) {
      setServiceErrors((prev) => ({
        ...prev,
        [key]: 'Please provide a name for this secret.'
      }))
      return
    }
    if (!value) {
      setServiceErrors((prev) => ({
        ...prev,
        [key]: 'Please provide a value.'
      }))
      return
    }

    try {
      setBusyKey(key)
      setServiceErrors((prev) => ({ ...prev, [key]: null }))
      if (!workspaceId) {
        setServiceErrors((prev) => ({
          ...prev,
          [key]: 'Select a workspace before creating secrets.'
        }))
        return
      }

      const response = await upsertSecret(
        groupKey,
        service.key,
        name,
        value,
        workspaceId
      )
      setSecrets(response.secrets ?? {})
      setDrafts((prev) => ({ ...prev, [key]: { name: '', value: '' } }))
    } catch (err) {
      setServiceErrors((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : 'Failed to save secret.'
      }))
    } finally {
      setBusyKey((current) => (current === key ? null : current))
    }
  }

  const handleDelete = async (
    groupKey: string,
    serviceKeyStr: string,
    name: string
  ) => {
    const key = serviceKey(groupKey, serviceKeyStr)
    const entryOwnerId =
      secrets[groupKey]?.[serviceKeyStr]?.[name]?.ownerId ?? null

    if (!canDeleteSecretEntry(entryOwnerId)) {
      setServiceErrors((prev) => ({
        ...prev,
        [key]: canCreateSecret
          ? 'Only the creator can remove this secret.'
          : 'You do not have permission to remove secrets in this workspace.'
      }))
      return
    }
    try {
      setDeleteBusyKey(`${key}:${name}`)
      setServiceErrors((prev) => ({ ...prev, [key]: null }))
      if (!workspaceId) {
        setServiceErrors((prev) => ({
          ...prev,
          [key]: 'Select a workspace before removing secrets.'
        }))
        return
      }

      const response = await deleteSecret(
        groupKey,
        serviceKeyStr,
        name,
        workspaceId
      )
      setSecrets(response.secrets ?? {})
    } catch (err) {
      setServiceErrors((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : 'Failed to delete secret.'
      }))
    } finally {
      setDeleteBusyKey(null)
    }
  }

  const confirmDelete = () => {
    if (!pendingDelete) return
    const { groupKey, serviceKey, name } = pendingDelete
    setPendingDelete(null)
    void handleDelete(groupKey, serviceKey, name)
  }

  const renderService = (groupKey: string, descriptor: ServiceDescriptor) => {
    const entries = Object.entries(secrets[groupKey]?.[descriptor.key] ?? {})
      .map<[string, string, string | null]>(([name, entry]) => [
        name,
        entry?.value ?? '',
        entry?.ownerId ?? null
      ])
      .sort((a, b) => a[0].localeCompare(b[0]))
    const draft = drafts[serviceKey(groupKey, descriptor.key)] ?? {
      name: '',
      value: ''
    }
    const key = serviceKey(groupKey, descriptor.key)
    const busy = busyKey === key

    return (
      <div
        key={descriptor.key}
        className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h4 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
              {descriptor.label}
            </h4>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {descriptor.valueLabel}
            </p>
            {descriptor.helper && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                {descriptor.helper}
              </p>
            )}
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {entries.length === 0 && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              No secrets saved yet.
            </p>
          )}
          {entries.map(([name, value, ownerId]) => {
            const masked = value
              ? '•'
                  .repeat(Math.min(value.length, 8))
                  .concat(value.length > 8 ? '…' : '')
              : '•'
            const deleteKey = `${key}:${name}`

            const canDelete = canDeleteSecretEntry(ownerId)
            return (
              <div
                key={name}
                className="flex items-center justify-between rounded bg-zinc-100 dark:bg-zinc-800 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {name}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 tracking-widest">
                    {masked}
                  </p>
                  {ownerId && ownerId !== currentUserId && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                      Created by another workspace member
                    </p>
                  )}
                  {!canDelete && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                      Only the creator can remove this secret.
                    </p>
                  )}
                </div>
                <button
                  onClick={() =>
                    setPendingDelete({
                      groupKey,
                      serviceKey: descriptor.key,
                      name
                    })
                  }
                  disabled={deleteBusyKey === deleteKey || !canDelete}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50"
                >
                  {deleteBusyKey === deleteKey ? 'Removing…' : 'Remove'}
                </button>
              </div>
            )
          })}
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <input
            className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm"
            placeholder="Secret name"
            value={draft.name}
            onChange={(e) =>
              setDrafts((prev) => ({
                ...prev,
                [key]: { ...draft, name: e.target.value }
              }))
            }
          />
          <input
            className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm"
            placeholder={descriptor.valueLabel}
            type="password"
            value={draft.value}
            onChange={(e) =>
              setDrafts((prev) => ({
                ...prev,
                [key]: { ...draft, value: e.target.value }
              }))
            }
          />
          {serviceErrors[key] && (
            <p className="text-xs text-red-500">{serviceErrors[key]}</p>
          )}
          <button
            className="self-start rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            onClick={() => handleAdd(groupKey, descriptor, draft)}
            disabled={busy || !canCreateSecret}
          >
            {busy ? 'Saving…' : 'Save Secret'}
          </button>
          {!canCreateSecret && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              You do not have permission to create secrets in this workspace.
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Secrets &amp; API Keys
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Store API keys and other sensitive credentials centrally. Secrets
          saved here will sync with your workflow nodes automatically.
        </p>
      </header>

      {loading && <p className="text-sm text-zinc-500">Loading…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {!loading && (
        <div className="space-y-8">
          {sections.map((group) => (
            <section key={group.key} className="space-y-4">
              <div>
                <h3 className="text-md font-semibold text-zinc-900 dark:text-zinc-100">
                  {group.label}
                </h3>
                {group.description && (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {group.description}
                  </p>
                )}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {group.services.map((descriptor) =>
                  renderService(group.key, descriptor)
                )}
              </div>
            </section>
          ))}
        </div>
      )}
      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        title="Delete secret?"
        message={`Deleting "${
          pendingDelete?.name ?? 'this secret'
        }" cannot be undone and may break workflows that rely on this API key or secret.`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        confirmText="Delete"
        cancelText="Cancel"
      />
    </div>
  )
}
