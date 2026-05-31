import { useMemo } from 'react'
import type { FieldDefinition } from '../types'

/**
 * Evaluates all calculated fields given current input values.
 * Formulas reference other fields by id (e.g. "01 + 02 - 03").
 * Returns a merged object: inputs + evaluated calculated fields.
 */
export function useFormCalculation(
  fields: FieldDefinition[],
  values: Record<string, number | null>
): Record<string, number | null> {
  return useMemo(() => {
    const result: Record<string, number | null> = { ...values }

    // Two passes to handle calculated fields that reference other calculated fields
    for (let pass = 0; pass < 2; pass++) {
      for (const field of fields) {
        if (field.type !== 'calculated' || !field.formula) continue
        try {
          const normalised = field.formula.replace(/×/g, '*').replace(/÷/g, '/')
          const expr = normalised.replace(/\b(\d+)\b/g, (_, id) => {
            const v = result[id]
            return v == null ? '0' : String(v)
          })
          // eslint-disable-next-line no-new-func
          const computed = Function(`"use strict"; return (${expr})`)() as number
          result[field.id] = isFinite(computed) ? computed : null
        } catch {
          result[field.id] = null
        }
      }
    }

    return result
  }, [fields, values])
}
