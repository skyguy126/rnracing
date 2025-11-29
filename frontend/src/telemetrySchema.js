import { z } from 'zod'

/**
 * Schema for car telemetry data from OBD port
 * All fields are optional to allow partial data without failing validation
 */
export const telemetryDataSchema = z.object({
  speed: z.number().optional(),
  rpm: z.number().optional(),
  coolant_temp: z.number().optional(),
  throttle: z.number().optional(),
  engine_load: z.number().optional(),
  fuel_level: z.number().optional(),
}).passthrough() // Allow additional fields that aren't in the schema

/**
 * Validates telemetry data against the schema
 * Returns the validated data and logs warnings for any validation errors
 * Never throws - always returns data even if validation fails
 * @param {any} data - The data to validate
 * @returns {object} - The validated data (or original data if validation fails)
 */
export function validateTelemetryData(data) {
  // Handle null/undefined
  if (data == null) {
    console.warn('[Telemetry Schema] Received null or undefined data')
    return {}
  }
  
  // Handle non-object types
  if (typeof data !== 'object' || Array.isArray(data)) {
    console.warn('[Telemetry Schema] Expected object but received:', typeof data)
    return data
  }
  
  const result = telemetryDataSchema.safeParse(data)
  
  if (result.success) {
    // Check for any unexpected fields (excluding timestamp which we add)
    const expectedFields = ['speed', 'rpm', 'coolant_temp', 'throttle', 'engine_load', 'fuel_level', 'timestamp']
    const dataFields = Object.keys(data)
    const unexpectedFields = dataFields.filter(field => !expectedFields.includes(field))
    
    if (unexpectedFields.length > 0) {
      console.warn(`[Telemetry Schema] Unexpected fields found:`, unexpectedFields)
    }
    
    // Check for type mismatches in individual fields
    const expectedNumericFields = ['speed', 'rpm', 'coolant_temp', 'throttle', 'engine_load', 'fuel_level']
    expectedNumericFields.forEach(field => {
      if (field in data && typeof data[field] !== 'number' && data[field] != null) {
        console.warn(`[Telemetry Schema] Field "${field}" expected number but got ${typeof data[field]}:`, data[field])
      }
    })
    
    return result.data
  } else {
    console.warn('[Telemetry Schema] Validation errors:', result.error.errors)
    // Return the original data anyway, but warn about issues
    return data
  }
}

