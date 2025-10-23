import { useCallback, useEffect, useMemo } from 'react'

import NodeDropdownField from '@/components/UI/InputFields/NodeDropdownField'
import NodeInputField from '@/components/UI/InputFields/NodeInputField'
import NodeTextAreaField from '@/components/UI/InputFields/NodeTextAreaField'
import NodeSecretDropdown from '@/components/UI/InputFields/NodeSecretDropdown'
import KeyValuePair from '@/components/UI/ReactFlow/KeyValuePair'
import {
  type WebhookActionParams,
  useActionParams
} from '@/stores/workflowSelectors'
import { useWorkflowStore } from '@/stores/workflowStore'

interface WebhookActionProps {
  nodeId: string
  canEdit?: boolean
}

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH'])

const checkKeyValuePairs = (
  pairs: { key: string; value: string }[]
): boolean => {
  const normalized = pairs.map((pair) => ({
    key: pair?.key?.toString() ?? '',
    value: pair?.value?.toString() ?? ''
  }))
  const keys = normalized.map((entry) => entry.key.trim()).filter(Boolean)
  const anyBlank = normalized.some(
    (entry) => !entry.key.trim() || !entry.value.trim()
  )
  const hasDuplicateKeys = new Set(keys).size !== keys.length
  return anyBlank || hasDuplicateKeys
}

export default function WebhookAction({
  nodeId,
  canEdit = true
}: WebhookActionProps) {
  const params = useActionParams<WebhookActionParams>(nodeId, 'webhook')
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData)
  const storeCanEdit = useWorkflowStore((state) => state.canEdit)
  const effectiveCanEdit = canEdit && storeCanEdit

  const commitParamsPatch = useCallback(
    (patch: Partial<Omit<WebhookActionParams, 'dirty'>>) => {
      if (!effectiveCanEdit) return

      const state = useWorkflowStore.getState()
      const targetNode = state.nodes.find((node) => node.id === nodeId)
      if (!targetNode) return

      let currentParams: WebhookActionParams | undefined
      if (targetNode?.data && typeof targetNode.data === 'object') {
        const dataRecord = targetNode.data as Record<string, unknown>
        const rawParams = dataRecord.params
        if (rawParams && typeof rawParams === 'object') {
          currentParams = rawParams as WebhookActionParams
        }
      }

      const { dirty: _dirty, ...rest } =
        currentParams ?? ({} as WebhookActionParams)

      updateNodeData(nodeId, {
        params: { ...rest, ...patch },
        dirty: true
      })
    },
    [effectiveCanEdit, nodeId, updateNodeData]
  )

  const validation = useMemo(() => {
    const errors: {
      url?: string
      method?: string
      body?: string
      authUsername?: string
      authPassword?: string
      authToken?: string
    } = {}

    const trimmedUrl = params.url?.trim() ?? ''
    if (!trimmedUrl) {
      errors.url = 'Webhook URL is required'
    } else {
      try {
        new URL(trimmedUrl)
      } catch {
        errors.url = 'Invalid URL'
      }
    }

    const method = params.method ?? ''
    if (!method) {
      errors.method = 'HTTP method is required'
    }

    if (METHODS_WITH_BODY.has(method)) {
      if (params.bodyType === 'raw' && !params.body?.trim()) {
        errors.body = 'Request body is required'
      }
      if (params.bodyType === 'json') {
        const rawBody = params.body ?? ''
        if (!rawBody.trim()) {
          errors.body = 'Request body is required'
        } else {
          try {
            JSON.parse(rawBody)
          } catch {
            errors.body = 'Invalid JSON'
          }
        }
      }
      if (
        params.bodyType === 'form' &&
        (!params.formBody || params.formBody.length === 0)
      ) {
        errors.body = 'Form body cannot be empty'
      }
    }

    if (params.authType === 'basic') {
      if (!params.authUsername?.trim()) {
        errors.authUsername = 'Username required for Basic Auth'
      }
      if (!params.authPassword?.trim()) {
        errors.authPassword = 'Password required for Basic Auth'
      }
    }

    if (params.authType === 'bearer' && !params.authToken?.trim()) {
      errors.authToken = 'Token required for Bearer Auth'
    }

    const headersInvalid = checkKeyValuePairs(params.headers ?? [])
    const queryInvalid = checkKeyValuePairs(params.queryParams ?? [])
    const formInvalid =
      params.bodyType === 'form'
        ? checkKeyValuePairs(params.formBody ?? [])
        : false

    return {
      errors,
      headersInvalid,
      queryInvalid,
      formInvalid
    }
  }, [params])

  const hasValidationErrors = useMemo(() => {
    if (Object.keys(validation.errors).length > 0) return true
    if (validation.headersInvalid) return true
    if (validation.queryInvalid) return true
    if (validation.formInvalid) return true
    return false
  }, [validation])

  useEffect(() => {
    updateNodeData(nodeId, { hasValidationErrors })
  }, [hasValidationErrors, nodeId, updateNodeData])

  const handleUrlChange = useCallback(
    (value: string) => {
      commitParamsPatch({ url: value })
    },
    [commitParamsPatch]
  )

  const handleMethodChange = useCallback(
    (value: string) => {
      commitParamsPatch({
        method: value as WebhookActionParams['method']
      })
    },
    [commitParamsPatch]
  )

  const handleHeadersChange = useCallback(
    (next: { key: string; value: string }[]) => {
      commitParamsPatch({ headers: next })
    },
    [commitParamsPatch]
  )

  const handleQueryChange = useCallback(
    (next: { key: string; value: string }[]) => {
      commitParamsPatch({ queryParams: next })
    },
    [commitParamsPatch]
  )

  const handleBodyTypeChange = useCallback(
    (value: string) => {
      commitParamsPatch({
        bodyType: value as WebhookActionParams['bodyType']
      })
    },
    [commitParamsPatch]
  )

  const handleBodyChange = useCallback(
    (value: string) => {
      commitParamsPatch({ body: value })
    },
    [commitParamsPatch]
  )

  const handleFormBodyChange = useCallback(
    (next: { key: string; value: string }[]) => {
      commitParamsPatch({ formBody: next })
    },
    [commitParamsPatch]
  )

  const handleAuthTypeChange = useCallback(
    (value: string) => {
      commitParamsPatch({
        authType: value as WebhookActionParams['authType']
      })
    },
    [commitParamsPatch]
  )

  const handleAuthUsernameChange = useCallback(
    (value: string) => {
      commitParamsPatch({ authUsername: value })
    },
    [commitParamsPatch]
  )

  const handleAuthPasswordChange = useCallback(
    (value: string) => {
      commitParamsPatch({ authPassword: value })
    },
    [commitParamsPatch]
  )

  const handleAuthTokenChange = useCallback(
    (value: string) => {
      commitParamsPatch({ authToken: value })
    },
    [commitParamsPatch]
  )

  const errorClass = 'text-xs text-red-500'

  return (
    <div className="flex flex-col gap-2">
      <NodeInputField
        placeholder="Webhook URL"
        value={params.url || ''}
        onChange={handleUrlChange}
      />
      {validation.errors.url && (
        <p className={errorClass}>{validation.errors.url}</p>
      )}

      <NodeDropdownField
        options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE']}
        value={params.method}
        onChange={handleMethodChange}
      />
      {validation.errors.method && (
        <p className={errorClass}>{validation.errors.method}</p>
      )}

      <KeyValuePair
        title="Headers"
        variables={params.headers || []}
        onChange={handleHeadersChange}
      />

      <KeyValuePair
        title="Query Parameters"
        variables={params.queryParams || []}
        onChange={handleQueryChange}
      />

      <NodeDropdownField
        options={['raw', 'json', 'form']}
        value={params.bodyType}
        onChange={handleBodyTypeChange}
      />

      {['raw', 'json'].includes(params.bodyType || '') && (
        <NodeTextAreaField
          placeholder={
            params.bodyType === 'raw'
              ? 'Request Body'
              : 'JSON Body (e.g. {"key":"value"})'
          }
          value={params.body || ''}
          rows={6}
          onChange={handleBodyChange}
        />
      )}

      {params.bodyType === 'form' && (
        <KeyValuePair
          title="Form Body"
          variables={params.formBody || []}
          onChange={handleFormBodyChange}
        />
      )}
      {validation.errors.body && (
        <p className={errorClass}>{validation.errors.body}</p>
      )}

      <p className="text-xs text-zinc-500">Authentication</p>
      <NodeDropdownField
        options={['none', 'basic', 'bearer']}
        value={params.authType}
        onChange={handleAuthTypeChange}
      />

      {params.authType === 'basic' && (
        <>
          <NodeInputField
            placeholder="Username"
            value={params.authUsername || ''}
            onChange={handleAuthUsernameChange}
          />
          <NodeSecretDropdown
            group="webhook"
            service="basic_auth"
            value={params.authPassword || ''}
            onChange={handleAuthPasswordChange}
            placeholder="Select basic auth password"
          />
          {validation.errors.authUsername && (
            <p className={errorClass}>{validation.errors.authUsername}</p>
          )}
          {validation.errors.authPassword && (
            <p className={errorClass}>{validation.errors.authPassword}</p>
          )}
        </>
      )}

      {params.authType === 'bearer' && (
        <>
          <NodeSecretDropdown
            group="webhook"
            service="bearer_token"
            value={params.authToken || ''}
            onChange={handleAuthTokenChange}
            placeholder="Select bearer token"
          />
          {validation.errors.authToken && (
            <p className={errorClass}>{validation.errors.authToken}</p>
          )}
        </>
      )}
    </div>
  )
}
