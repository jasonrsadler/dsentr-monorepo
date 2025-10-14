import NodeDropdownField from '@/components/UI/InputFields/NodeDropdownField'
import NodeInputField from '@/components/UI/InputFields/NodeInputField'
import KeyValuePair from '@/components/UI/ReactFlow/KeyValuePair'
import { useEffect, useMemo, useState } from 'react'

import { fetchConnections } from '@/lib/oauthApi'

const MAX_SHEETS_COLUMNS = 18278
const COLUMN_KEY_REGEX = /^[A-Za-z]+$/

const columnKeyToIndex = (key: string) => {
  let index = 0
  for (const char of key.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64)
  }
  return index
}

const validateColumnMappings = (
  columns: { key: string; value: string }[]
): string | undefined => {
  if (!columns || columns.length === 0)
    return 'At least one column mapping is required'

  const seen = new Set<number>()

  for (let i = 0; i < columns.length; i += 1) {
    const rawKey = columns[i]?.key?.trim()
    if (!rawKey) return `Column name is required for mapping ${i + 1}`
    if (rawKey.includes('{') || rawKey.includes('}'))
      return 'Column names cannot contain template expressions'
    if (!COLUMN_KEY_REGEX.test(rawKey))
      return 'Column names must only include letters (e.g. A, B, AA)'

    const columnIndex = columnKeyToIndex(rawKey)
    if (columnIndex === 0 || columnIndex > MAX_SHEETS_COLUMNS)
      return `Column ${rawKey.toUpperCase()} exceeds the Google Sheets column limit`

    if (seen.has(columnIndex))
      return `Duplicate column ${rawKey.toUpperCase()} detected`

    seen.add(columnIndex)
  }

  return undefined
}

interface SheetsActionProps {
  spreadsheetId: string
  worksheet: string
  columns: { key: string; value: string }[]
  accountEmail?: string
  dirty: boolean
  setParams: (params: Partial<SheetsActionProps>) => void
  setDirty: (dirty: boolean) => void
}

interface SheetsActionErrorProps extends Partial<SheetsActionProps> {
  spreadsheetIdError?: string
  worksheetError?: string
  columnsError?: string
  accountEmailError?: string
}

export default function SheetsAction({
  args,
  onChange
}: {
  args: SheetsActionProps
  onChange?: (
    args: Partial<SheetsActionProps>,
    hasErrors: boolean,
    dirty: boolean
  ) => void
}) {
  const [_, setDirty] = useState(false)
  const [params, setParams] = useState<Partial<SheetsActionProps>>({
    ...args,
    spreadsheetId: args.spreadsheetId || '',
    worksheet: args.worksheet || '',
    columns: args.columns || [],
    accountEmail: args.accountEmail || ''
  })
  const [accountOptions, setAccountOptions] = useState<string[]>([])
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [accountsError, setAccountsError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setAccountsLoading(true)
    fetchConnections()
      .then((connections) => {
        if (!active) return
        const google = connections.google
        const available =
          google?.connected && google.accountEmail?.trim()
            ? [google.accountEmail.trim()]
            : []
        setAccountOptions(available)
        setParams((prev) => {
          if (!prev) return prev
          const current = prev.accountEmail?.trim()
          if (!current) return prev
          if (
            available.length === 0 ||
            !available.some(
              (option) => option.toLowerCase() === current.toLowerCase()
            )
          ) {
            return { ...prev, accountEmail: '' }
          }
          return prev
        })
        setAccountsError(null)
      })
      .catch((error) => {
        if (!active) return
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to load Google connections'
        setAccountsError(message)
      })
      .finally(() => {
        if (!active) return
        setAccountsLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const hasErrors = (updatedParams: Partial<SheetsActionProps>) => {
    const errors: Partial<SheetsActionErrorProps> = {}
    if (!updatedParams.spreadsheetId?.trim())
      errors.spreadsheetIdError = 'Spreadsheet ID is required'
    if (!updatedParams.worksheet?.trim())
      errors.worksheetError = 'Worksheet name is required'
    if (!updatedParams.columns || updatedParams.columns.length === 0) {
      errors.columnsError = 'At least one column mapping is required'
    } else {
      const columnError = validateColumnMappings(updatedParams.columns)
      if (columnError) errors.columnsError = columnError
    }
    const accountSelected = updatedParams.accountEmail?.trim()
    if (!accountSelected) {
      errors.accountEmailError = accountOptions.length
        ? 'Select a connected Google account'
        : 'Connect a Google account in Settings → Integrations'
    } else if (
      accountOptions.length > 0 &&
      !accountOptions.some(
        (option) => option.toLowerCase() === accountSelected.toLowerCase()
      )
    ) {
      errors.accountEmailError =
        'Selected Google account is no longer connected. Refresh your integrations.'
    }
    return errors
  }

  const validationErrors = useMemo(
    () => hasErrors(params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, accountOptions]
  )

  useEffect(() => {
    onChange?.(params, Object.keys(validationErrors).length > 0, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, validationErrors])

  const updateField = (key: keyof SheetsActionProps, value: any) => {
    setDirty(true)
    setParams((prev) => ({ ...prev, [key]: value }))
  }

  const errorClass = 'text-xs text-red-500'

  return (
    <div className="flex flex-col gap-2">
      <NodeDropdownField
        options={accountOptions}
        value={params.accountEmail || ''}
        onChange={(val) => updateField('accountEmail', val)}
        placeholder={
          accountsLoading
            ? 'Loading Google accounts…'
            : accountOptions.length > 0
              ? 'Select Google account'
              : 'No connected Google accounts'
        }
        disabled={accountsLoading || accountOptions.length === 0}
      />
      {accountsError && <p className="text-xs text-red-500">{accountsError}</p>}
      {validationErrors.accountEmailError && (
        <p className={errorClass}>{validationErrors.accountEmailError}</p>
      )}

      <NodeInputField
        placeholder="Spreadsheet ID"
        value={params.spreadsheetId || ''}
        onChange={(val) => updateField('spreadsheetId', val)}
      />
      {validationErrors.spreadsheetIdError && (
        <p className={errorClass}>{validationErrors.spreadsheetIdError}</p>
      )}

      <NodeInputField
        placeholder="Worksheet Name"
        value={params.worksheet || ''}
        onChange={(val) => updateField('worksheet', val)}
      />
      {validationErrors.worksheetError && (
        <p className={errorClass}>{validationErrors.worksheetError}</p>
      )}

      <KeyValuePair
        title="Column Mappings"
        variables={params.columns || []}
        placeholderKey="Column"
        placeholderValue="Value"
        onChange={(updatedVars, nodeHasErrors, childDirty) => {
          setParams((prev) => ({ ...prev, columns: updatedVars }))
          setDirty((prev) => prev || childDirty)
          onChange?.(
            { ...params, columns: updatedVars },
            nodeHasErrors,
            childDirty
          )
        }}
      />
      {validationErrors.columnsError && (
        <p className={errorClass}>{validationErrors.columnsError}</p>
      )}
    </div>
  )
}
