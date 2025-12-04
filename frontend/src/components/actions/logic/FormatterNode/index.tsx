import { useCallback, useMemo } from 'react'
import NodeInputField from '@/components/ui/InputFields/NodeInputField'
import NodeDropdownField from '@/components/ui/InputFields/NodeDropdownField'
import NodeCheckBoxField from '@/components/ui/InputFields/NodeCheckboxField'
import {
  DATE_COMPONENT_OPTIONS,
  DATE_FORMAT_OPTIONS,
  OPERATION_GROUPS,
  TIMEZONE_OPTIONS,
  createEmptyFormatterConfig,
  normalizeFormatterConfig,
  validateFormatterConfig,
  type FormatterConfig,
  type FormatterOperation,
  type FormatterValidationResult
} from './helpers'

type FieldType = 'text' | 'number' | 'select' | 'toggle'

type FieldDefinition = {
  key: string
  label: string
  type: FieldType
  placeholder?: string
  options?: { label: string; value: string }[]
}

const FIELD_DEFINITIONS: Partial<
  Record<FormatterOperation, FieldDefinition[]>
> = {
  'string.replace': [
    {
      key: 'search_for',
      label: 'Search For',
      type: 'text',
      placeholder: 'Text to find'
    },
    {
      key: 'replace_with',
      label: 'Replace With',
      type: 'text',
      placeholder: 'Replacement text'
    }
  ],
  'string.split': [
    { key: 'delimiter', label: 'Delimiter', type: 'text', placeholder: ',' },
    { key: 'index', label: 'Index', type: 'number', placeholder: '0' }
  ],
  'string.substring': [
    { key: 'start', label: 'Start Index', type: 'number', placeholder: '0' },
    { key: 'length', label: 'Length', type: 'number', placeholder: '4' }
  ],
  'number.add': [
    { key: 'value', label: 'Value', type: 'number', placeholder: '10' }
  ],
  'number.subtract': [
    { key: 'value', label: 'Value', type: 'number', placeholder: '5' }
  ],
  'number.multiply': [
    { key: 'value', label: 'Value', type: 'number', placeholder: '2' }
  ],
  'number.divide': [
    { key: 'value', label: 'Value', type: 'number', placeholder: '3' }
  ],
  'number.round': [
    {
      key: 'decimal_places',
      label: 'Decimal Places',
      type: 'number',
      placeholder: '0'
    }
  ],
  'json.pick': [
    {
      key: 'json_path',
      label: 'JSON Path',
      type: 'text',
      placeholder: 'data.items.0.id'
    }
  ],
  'json.merge': [
    {
      key: 'input_two',
      label: 'JSON Input 2',
      type: 'text',
      placeholder: '{ "other": true }'
    }
  ],
  'json.to_array': [
    { key: 'delimiter', label: 'Delimiter', type: 'text', placeholder: ',' },
    { key: 'trim_items', label: 'Trim Items', type: 'toggle' }
  ],
  'json.to_object': [
    { key: 'key_name', label: 'Key Name', type: 'text', placeholder: 'key' }
  ],
  'date.parse': [
    {
      key: 'format',
      label: 'Input Format',
      type: 'select',
      options: DATE_FORMAT_OPTIONS as unknown as {
        label: string
        value: string
      }[]
    }
  ],
  'date.format': [
    {
      key: 'output_format',
      label: 'Output Format',
      type: 'select',
      options: DATE_FORMAT_OPTIONS as unknown as {
        label: string
        value: string
      }[]
    }
  ],
  'date.adjust': [
    { key: 'days', label: 'Days', type: 'number', placeholder: '0' },
    { key: 'hours', label: 'Hours', type: 'number', placeholder: '0' },
    { key: 'minutes', label: 'Minutes', type: 'number', placeholder: '0' }
  ],
  'date.extract': [
    {
      key: 'component',
      label: 'Component',
      type: 'select',
      options: DATE_COMPONENT_OPTIONS as unknown as {
        label: string
        value: string
      }[]
    },
    {
      key: 'timezone',
      label: 'Timezone',
      type: 'select',
      options: TIMEZONE_OPTIONS as unknown as { label: string; value: string }[]
    }
  ]
}

const toFieldString = (value: unknown): string => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return typeof value === 'string' ? value : ''
}

interface FormatterNodeConfigProps {
  config?: FormatterConfig
  onChange: (config: FormatterConfig) => void
  validation?: FormatterValidationResult
  canEdit?: boolean
}

export default function FormatterNodeConfig({
  config,
  onChange,
  validation,
  canEdit = true
}: FormatterNodeConfigProps) {
  const normalizedConfig = useMemo(
    () => normalizeFormatterConfig(config ?? createEmptyFormatterConfig()),
    [config]
  )
  const currentValidation = useMemo(
    () => validation ?? validateFormatterConfig(normalizedConfig),
    [normalizedConfig, validation]
  )

  const setConfig = useCallback(
    (next: Partial<FormatterConfig>) => {
      if (!canEdit) return
      const merged = normalizeFormatterConfig({
        ...normalizedConfig,
        ...next
      })
      onChange(merged)
    },
    [canEdit, normalizedConfig, onChange]
  )

  const handleOperationChange = useCallback(
    (nextValue: string) => {
      setConfig({
        operation: nextValue as FormatterOperation,
        fields: {}
      })
    },
    [setConfig]
  )

  const handleFieldChange = useCallback(
    (key: string, value: any) => {
      setConfig({
        fields: {
          ...normalizedConfig.fields,
          [key]: value
        }
      })
    },
    [normalizedConfig.fields, setConfig]
  )

  const handleInputChange = useCallback(
    (value: string) => setConfig({ input: value }),
    [setConfig]
  )

  const handleOutputKeyChange = useCallback(
    (value: string) => setConfig({ output_key: value }),
    [setConfig]
  )

  const operation = normalizedConfig.operation as FormatterOperation
  const fieldDefs = FIELD_DEFINITIONS[operation] ?? []

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Operation
        </label>
        <NodeDropdownField
          value={operation}
          onChange={handleOperationChange}
          options={OPERATION_GROUPS.map((group) => ({
            label: group.label,
            options: group.options
          }))}
          placeholder="Select an operation"
          collapsibleGroups
        />
      </div>

      <div className="space-y-2">
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Input Value
        </label>
        <NodeInputField
          value={normalizedConfig.input}
          onChange={handleInputChange}
          placeholder="e.g. {{trigger.body}}"
        />
      </div>

      {operation && fieldDefs.length > 0 ? (
        <div className="space-y-2">
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Operation Settings
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {fieldDefs.map((field) => {
              const value = normalizedConfig.fields?.[field.key]
              if (field.type === 'toggle') {
                return (
                  <div key={field.key} className="flex items-center">
                    <NodeCheckBoxField
                      checked={Boolean(value)}
                      onChange={(checked) =>
                        handleFieldChange(field.key, checked)
                      }
                    >
                      <span className="text-xs text-zinc-700 dark:text-zinc-200">
                        {field.label}
                      </span>
                    </NodeCheckBoxField>
                  </div>
                )
              }
              if (field.type === 'select') {
                return (
                  <div key={field.key} className="space-y-1">
                    <span className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                      {field.label}
                    </span>
                    <NodeDropdownField
                      value={typeof value === 'string' ? value : ''}
                      onChange={(val) => handleFieldChange(field.key, val)}
                      options={field.options ?? []}
                      placeholder="Select..."
                    />
                  </div>
                )
              }
              return (
                <div key={field.key} className="space-y-1">
                  <span className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                    {field.label}
                  </span>
                  <NodeInputField
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={
                      field.type === 'number'
                        ? toFieldString(value)
                        : (value as string)
                    }
                    onChange={(val) => handleFieldChange(field.key, val)}
                    placeholder={field.placeholder}
                  />
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Output Key
        </label>
        <NodeInputField
          value={normalizedConfig.output_key}
          onChange={handleOutputKeyChange}
          placeholder="resultKey"
        />
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          Saves the result under this key inside the Formatter node output.
        </p>
      </div>

      {currentValidation.hasErrors ? (
        <p className="text-xs text-red-500">
          {currentValidation.messages[0] ?? 'Complete the required fields.'}
        </p>
      ) : null}
    </div>
  )
}
