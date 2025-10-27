import { useCallback, useEffect, useMemo } from 'react'

import NodeDropdownField from '@/components/ui/InputFields/NodeDropdownField'
import NodeInputField from '@/components/ui/InputFields/NodeInputField'
import NodeSecretDropdown from '@/components/ui/InputFields/NodeSecretDropdown'
import NodeTextAreaField from '@/components/ui/InputFields/NodeTextAreaField'
import NodeCheckBoxField from '@/components/ui/InputFields/NodeCheckboxField'
import KeyValuePair from '@/components/ui/ReactFlow/KeyValuePair'
import {
  type HttpRequestActionParams,
  useActionParams
} from '@/stores/workflowSelectors'
import { useWorkflowStore } from '@/stores/workflowStore'

interface HttpRequestActionProps {
  nodeId: string
  canEdit?: boolean
}

const HTTP_METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH'])

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

export default function HttpRequestAction({
  nodeId,
  canEdit = true
}: HttpRequestActionProps) {
  const params = useActionParams<HttpRequestActionParams>(nodeId, 'http')
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData)
  const storeCanEdit = useWorkflowStore((state) => state.canEdit)
  const effectiveCanEdit = canEdit && storeCanEdit

  const commitParamsPatch = useCallback(
    (patch: Partial<Omit<HttpRequestActionParams, 'dirty'>>) => {
      if (!effectiveCanEdit) return

      const state = useWorkflowStore.getState()
      const targetNode = state.nodes.find((node) => node.id === nodeId)
      if (!targetNode) return

      let currentParams: HttpRequestActionParams | undefined
      if (targetNode?.data && typeof targetNode.data === 'object') {
        const dataRecord = targetNode.data as Record<string, unknown>
        const rawParams = dataRecord.params
        if (rawParams && typeof rawParams === 'object') {
          currentParams = rawParams as HttpRequestActionParams
        }
      }

      const { dirty: _dirty, ...rest } =
        currentParams ?? ({} as HttpRequestActionParams)

      updateNodeData(nodeId, {
        params: { ...rest, ...patch },
        dirty: true
      })
    },
    [effectiveCanEdit, nodeId, updateNodeData]
  )

  const validation = useMemo(() => {
    const errors: { url?: string; body?: string; auth?: string } = {}
    const trimmedUrl = params.url?.trim() ?? ''

    if (!trimmedUrl) {
      errors.url = 'URL is required'
    } else {
      try {
        new URL(trimmedUrl)
      } catch {
        errors.url = 'Invalid URL'
      }
    }

    const bodyType = params.bodyType ?? 'raw'
    const method = params.method ?? 'GET'
    const methodAllowsBody = HTTP_METHODS_WITH_BODY.has(method)

    if (methodAllowsBody) {
      if (bodyType === 'raw' && !params.body?.trim()) {
        errors.body = 'Request body is required'
      }
      if (bodyType === 'json') {
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
      if (bodyType === 'form') {
        const formEntries = params.formBody ?? []
        if (formEntries.length === 0) {
          errors.body = 'Form body cannot be empty'
        }
      }
    }

    const authType = params.authType ?? 'none'
    if (authType === 'basic') {
      if (!params.username?.trim()) {
        errors.auth = 'Username and password required'
      } else if (!params.password?.trim()) {
        errors.auth = 'Username and password required'
      }
    }
    if (authType === 'bearer' && !params.token?.trim()) {
      errors.auth = 'Bearer token required'
    }

    const headersInvalid = checkKeyValuePairs(params.headers ?? [])
    const queryInvalid = checkKeyValuePairs(params.queryParams ?? [])
    const formInvalid =
      bodyType === 'form' ? checkKeyValuePairs(params.formBody ?? []) : false

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
        method: value as HttpRequestActionParams['method']
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
        bodyType: value as HttpRequestActionParams['bodyType']
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

  const handleTimeoutChange = useCallback(
    (value: string) => {
      const numeric = Number(value)
      commitParamsPatch({ timeout: Number.isNaN(numeric) ? 0 : numeric })
    },
    [commitParamsPatch]
  )

  const handleFollowRedirectsChange = useCallback(
    (value: boolean | string) => {
      commitParamsPatch({ followRedirects: Boolean(value) })
    },
    [commitParamsPatch]
  )

  const handleAuthTypeChange = useCallback(
    (value: string) => {
      commitParamsPatch({
        authType: value as HttpRequestActionParams['authType']
      })
    },
    [commitParamsPatch]
  )

  const handleUsernameChange = useCallback(
    (value: string) => {
      commitParamsPatch({ username: value })
    },
    [commitParamsPatch]
  )

  const handlePasswordChange = useCallback(
    (value: string) => {
      commitParamsPatch({ password: value })
    },
    [commitParamsPatch]
  )

  const handleTokenChange = useCallback(
    (value: string) => {
      commitParamsPatch({ token: value })
    },
    [commitParamsPatch]
  )

  const errorClass = 'text-xs text-red-500'

  return (
    <div className="flex flex-col gap-2">
      <NodeInputField
        placeholder="Request URL"
        value={params.url || ''}
        onChange={handleUrlChange}
      />
      {validation.errors.url && (
        <p className={errorClass}>{validation.errors.url}</p>
      )}

      <NodeDropdownField
        options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']}
        value={params.method}
        onChange={handleMethodChange}
      />

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

      {params.method !== 'GET' && params.method !== 'DELETE' && (
        <>
          <NodeDropdownField
            options={['raw', 'json', 'form']}
            value={params.bodyType}
            onChange={handleBodyTypeChange}
          />
          {params.bodyType === 'raw' || params.bodyType === 'json' ? (
            <NodeTextAreaField
              placeholder={
                params.bodyType === 'json'
                  ? 'JSON Body (e.g. {"key": "value"})'
                  : 'Request Body'
              }
              value={params.body || ''}
              rows={4}
              onChange={handleBodyChange}
            />
          ) : (
            <KeyValuePair
              title="Form Body"
              variables={params.formBody || []}
              onChange={handleFormBodyChange}
            />
          )}
        </>
      )}
      {validation.errors.body && (
        <p className={errorClass}>{validation.errors.body}</p>
      )}

      <NodeInputField
        placeholder="Timeout (ms)"
        type="number"
        value={params.timeout?.toString() || ''}
        onChange={handleTimeoutChange}
      />

      <NodeCheckBoxField
        checked={params.followRedirects ?? true}
        onChange={handleFollowRedirectsChange}
      >
        Follow Redirects
      </NodeCheckBoxField>

      <NodeDropdownField
        options={['none', 'basic', 'bearer']}
        value={params.authType}
        onChange={handleAuthTypeChange}
      />

      {params.authType === 'basic' && (
        <>
          <NodeInputField
            placeholder="Username"
            value={params.username || ''}
            onChange={handleUsernameChange}
          />
          <NodeSecretDropdown
            group="http"
            service="basic_auth"
            value={params.password || ''}
            onChange={handlePasswordChange}
            placeholder="Select HTTP basic password"
          />
        </>
      )}
      {params.authType === 'bearer' && (
        <NodeSecretDropdown
          group="http"
          service="bearer_token"
          value={params.token || ''}
          onChange={handleTokenChange}
          placeholder="Select bearer token"
        />
      )}
      {validation.errors.auth && (
        <p className={errorClass}>{validation.errors.auth}</p>
      )}
    </div>
  )
}
