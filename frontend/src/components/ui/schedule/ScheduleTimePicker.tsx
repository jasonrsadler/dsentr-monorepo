import { hoursList, minutesList, TimeParts, toTimeString } from './utils'

type ScheduleTimePickerProps = {
  selectedTime?: TimeParts
  onSelect: (time: string) => void
  onClose?: () => void
}

export function ScheduleTimePicker({
  selectedTime,
  onSelect,
  onClose
}: ScheduleTimePickerProps) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
      <div className="grid gap-3 text-sm text-zinc-700 dark:text-zinc-100 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Hour
          </p>
          <div className="mt-2 max-h-56 space-y-1 overflow-y-auto themed-scroll pr-1">
            {hoursList.map((hour) => {
              const isSelected = selectedTime?.hours === hour
              return (
                <button
                  key={hour}
                  type="button"
                  onClick={() => {
                    const minutes = selectedTime?.minutes ?? 0
                    onSelect(toTimeString(hour, minutes))
                  }}
                  className={`flex h-9 w-full items-center justify-center rounded-md border text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                    isSelected
                      ? 'border-blue-500 bg-blue-500 text-white shadow'
                      : 'border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {hour.toString().padStart(2, '0')}
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Minute
          </p>
          <div className="mt-2 max-h-56 space-y-1 overflow-y-auto themed-scroll pr-1">
            {minutesList.map((minute) => {
              const isSelected = selectedTime?.minutes === minute
              return (
                <button
                  key={minute}
                  type="button"
                  onClick={() => {
                    const hour = selectedTime?.hours ?? 0
                    onSelect(toTimeString(hour, minute))
                    onClose?.()
                  }}
                  className={`flex h-9 w-full items-center justify-center rounded-md border text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                    isSelected
                      ? 'border-blue-500 bg-blue-500 text-white shadow'
                      : 'border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {minute.toString().padStart(2, '0')}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
