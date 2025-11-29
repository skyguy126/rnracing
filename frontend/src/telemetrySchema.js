import { z } from 'zod'

/**
 * Schema for car telemetry data from OBD port
 * All fields are optional to allow partial data without failing validation
 */
export const telemetryDataSchema = z.object({
  type: z.enum(['obd', 'gps', 'connected']).optional(),
  speed: z.number().optional(),
  rpm: z.number().optional(),
  coolant_temp: z.number().optional(),
  throttle: z.number().optional(),
  engine_load: z.number().optional(),
  fuel_level: z.number().optional(),
}).passthrough() // Allow additional fields that aren't in the schema

/**
 * Schema for GPS location data
 * Requires latitude, longitude, and timestamp
 * Additional fields are optional
 */
export const gpsDataSchema = z.object({
  type: z.literal('gps').optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timestamp: z.string().or(z.date()),
  altitude: z.number().optional(),
  speed: z.number().optional(),
  heading: z.number().min(0).max(360).optional(),
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
    const expectedFields = ['type', 'speed', 'rpm', 'coolant_temp', 'throttle', 'engine_load', 'fuel_level', 'timestamp']
    const dataFields = Object.keys(data)
    const unexpectedFields = dataFields.filter(field => !expectedFields.includes(field))
    
    if (unexpectedFields.length > 0) {
      console.warn(`[Telemetry Schema] Unexpected fields found:`, unexpectedFields)
    }
    
    // Validate type field if present
    if ('type' in data && data.type !== 'obd' && data.type !== 'gps' && data.type !== 'connected') {
      console.warn(`[Telemetry Schema] Invalid type value: "${data.type}". Expected 'obd', 'gps', or 'connected'`)
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

/**
 * Validates GPS data against the GPS schema
 * Returns the validated data and logs warnings for any validation errors
 * Never throws - always returns data even if validation fails
 * @param {any} data - The GPS data to validate
 * @returns {object} - The validated data (or original data if validation fails)
 */
export function validateGpsData(data) {
  // Handle null/undefined
  if (data == null) {
    console.warn('[GPS Schema] Received null or undefined data')
    return null
  }
  
  // Handle non-object types
  if (typeof data !== 'object' || Array.isArray(data)) {
    console.warn('[GPS Schema] Expected object but received:', typeof data)
    return data
  }
  
  const result = gpsDataSchema.safeParse(data)
  
  if (result.success) {
    // Validate required fields are present
    if (data.latitude === undefined || data.latitude === null) {
      console.warn('[GPS Schema] Missing required field: latitude')
      return data
    }
    if (data.longitude === undefined || data.longitude === null) {
      console.warn('[GPS Schema] Missing required field: longitude')
      return data
    }
    if (data.timestamp === undefined || data.timestamp === null) {
      console.warn('[GPS Schema] Missing required field: timestamp')
      return data
    }
    
    // Validate latitude/longitude ranges
    if (typeof data.latitude === 'number' && (data.latitude < -90 || data.latitude > 90)) {
      console.warn(`[GPS Schema] Latitude out of range: ${data.latitude}. Expected -90 to 90`)
    }
    if (typeof data.longitude === 'number' && (data.longitude < -180 || data.longitude > 180)) {
      console.warn(`[GPS Schema] Longitude out of range: ${data.longitude}. Expected -180 to 180`)
    }
    
    // Validate heading if present
    if (data.heading !== undefined && data.heading !== null) {
      if (typeof data.heading !== 'number' || data.heading < 0 || data.heading > 360) {
        console.warn(`[GPS Schema] Heading out of range: ${data.heading}. Expected 0 to 360`)
      }
    }
    
    return result.data
  } else {
    console.warn('[GPS Schema] Validation errors:', result.error.errors)
    // Return the original data anyway, but warn about issues
    return data
  }
}

