import NodeInputField from '@/components/UI/InputFields/NodeInputField'
import KeyValuePair from '@/components/UI/ReactFlow/KeyValuePair'
import { useEffect, useMemo, useState } from 'react'

interface SheetsActionProps {
  spreadsheetId: string
  worksheet: string
  columns: { key: string; value: string }[]
  dirty: boolean
  setParams: (params: Partial<SheetsActionProps>) => void
  setDirty: (dirty: boolean) => void
}

interface SheetsActionErrorProps extends Partial<SheetsActionProps> {
  spreadsheetIdError?: string
  worksheetError?: string
  columnsError?: string
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
  const [, setDirty] = useState(false)
  const [params, setParams] = useState<Partial<SheetsActionProps>>({
    ...args,
    spreadsheetId: args.spreadsheetId || '',
    worksheet: args.worksheet || '',
    columns: args.columns || []
  })

  const hasErrors = (updatedParams: Partial<SheetsActionProps>) => {
    const errors: Partial<SheetsActionErrorProps> = {}
    if (!updatedParams.spreadsheetId?.trim())
      errors.spreadsheetIdError = 'Spreadsheet ID is required'
    if (!updatedParams.worksheet?.trim())
      errors.worksheetError = 'Worksheet name is required'
    if (!updatedParams.columns || updatedParams.columns.length === 0)
      errors.columnsError = 'At least one column mapping is required'
    return errors
  }

  const validationErrors = useMemo(() => hasErrors(params), [params])

  useEffect(() => {
    onChange?.(params, Object.keys(validationErrors).length > 0, true)
  }, [params, validationErrors, onChange])

  const updateField = (key: keyof SheetsActionProps, value: any) => {
    setDirty(true)
    setParams((prev) => ({ ...prev, [key]: value }))
  }

  const errorClass = 'text-xs text-red-500'

  return (
    <div className="flex flex-col gap-2">
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
