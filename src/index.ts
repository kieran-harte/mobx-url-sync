/* eslint-disable @typescript-eslint/no-explicit-any */
import { intercept } from 'mobx'

// Default throttle delay (in milliseconds) for URL updates.
const DEFAULT_THROTTLE_DELAY = 500

/**
 * Generic serializer interface.
 * This defines a type's class constructor along with functions to convert an instance
 * to a string (serialize) and a string back to an instance (deserialize).
 */
interface Serializer<T> {
  classConstructor: new (...args: any[]) => T
  serialize: (value: T) => string
  deserialize: (value: string) => T
}

/**
 * Collection of serializers for various types.
 */
export interface Serializers {
  [key: string]: Serializer<any>
}

/**
 * Internal type representing a field registered for URL synchronization.
 * Contains:
 * - store: the MobX store instance.
 * - property: the property name on the store.
 * - queryParam: the URL query parameter key.
 * - defaultValue: the property's default value.
 * - serialize/deserialize: functions to convert the property's value.
 * - updateTimer/lastUpdateTime: used to throttle URL updates.
 */
interface FieldEntry<QP extends string> {
  store: any
  property: string
  queryParam: QP
  defaultValue: any
  serialize: (value: any) => string
  deserialize: (value: string) => any
  updateTimer?: number
  lastUpdateTime?: number
}

/**
 * Options for MobxUrlSync.
 */
interface MobxUrlSyncOptions {
  throttleDelay?: number
}

/**
 * MobxUrlSync synchronizes MobX store properties with URL query parameters.
 * It supports default serialization for primitives and custom types via provided serializers.
 * URL updates are throttled to avoid excessive history updates.
 *
 * @template QueryParameter - A union type of allowed query parameter strings.
 */
export class MobXURLSync<QueryParameter extends string> {
  /**
   * Constructs a MobxUrlSync.
   * @param defaultSerializers - Optional custom serializers for non-primitive types.
   * @param options - Options for configuration (e.g., throttleDelay).
   */
  constructor(
    defaultSerializers: Serializers = {},
    options: MobxUrlSyncOptions = {
      throttleDelay: DEFAULT_THROTTLE_DELAY
    }
  ) {
    this.defaultSerializers = defaultSerializers
    if (options.throttleDelay) {
      this.throttleDelay = options.throttleDelay
    }
  }

  private defaultSerializers: Serializers
  private throttleDelay: number = DEFAULT_THROTTLE_DELAY

  // Fields registered for URL synchronization, stored in a Map keyed by the query parameter.
  private fields: Map<QueryParameter, FieldEntry<QueryParameter>> = new Map()

  /**
   * Returns a default serializer for the given value if available.
   * For primitives (string, number, boolean), returns an inline default implementation.
   * For other types, iterates through provided defaultSerializers.
   *
   * @param value - The value for which to obtain a serializer.
   * @returns A Serializer for the type, or undefined if none is found.
   */
  getDefaultSerializer<T>(value: T): Serializer<T> | undefined {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return {
        classConstructor: value.constructor as new (...args: any[]) => T,
        serialize: (v: T) => String(v),
        deserialize: (s: string) => s as unknown as T
      }
    }
    for (const key in this.defaultSerializers) {
      if (value instanceof this.defaultSerializers[key].classConstructor) {
        return this.defaultSerializers[key] as Serializer<T>
      }
    }
    return undefined
  }

  /**
   * Registers a store property for URL synchronization.
   *
   * There are two overloads:
   * 1. For supported default types, the serializer/deserializer functions are optional.
   * 2. For non-supported types, the serializer/deserializer functions must be provided.
   *
   * @param store - The MobX store instance.
   * @param property - The property on the store to sync.
   * @param queryParam - The URL query parameter key.
   * @param config - Optional configuration including defaultValue, serialize, and deserialize.
   */
  // Overload for supported default types.
  registerField<TStore, K extends keyof TStore>(
    store: TStore,
    property: K,
    queryParam: QueryParameter,
    config?: {
      defaultValue?: TStore[K]
      serialize?: (value: TStore[K]) => string
      deserialize?: (value: string) => TStore[K]
    }
  ): void
  // Overload for non-supported types.
  registerField<TStore, K extends keyof TStore>(
    store: TStore,
    property: K,
    queryParam: QueryParameter,
    config: {
      defaultValue?: TStore[K]
      serialize: (value: TStore[K]) => string
      deserialize: (value: string) => TStore[K]
    }
  ): void
  // Implementation of registerField.
  registerField(
    store: any,
    property: any,
    queryParam: QueryParameter,
    config: any = {}
  ): void {
    // Ensure that the query parameter is unique.
    if (this.fields.has(queryParam)) {
      throw new Error(`Query param "${queryParam}" is already registered.`)
    }

    // Use the store's current property value as the default if not provided.
    if (config.defaultValue === undefined) {
      config.defaultValue = store[property]
    }

    // If serializer/deserializer are missing, try to obtain defaults.
    if (!config.serialize || !config.deserialize) {
      const serializer = this.getDefaultSerializer(store[property])
      if (serializer) {
        config.serialize = config.serialize || serializer.serialize
        config.deserialize = config.deserialize || serializer.deserialize
      }
    }

    // If still missing, throw an error.
    if (!config.serialize || !config.deserialize) {
      throw new Error(
        `For property "${String(
          property
        )}", custom serialize/deserialize functions must be provided.`
      )
    }

    // Create a field entry.
    const fieldEntry: FieldEntry<QueryParameter> = {
      store,
      property: String(property),
      queryParam,
      defaultValue: config.defaultValue,
      serialize: config.serialize,
      deserialize: config.deserialize
    }

    // Save the field entry and initialize synchronization.
    this.fields.set(queryParam, fieldEntry)
    this.loadFromURLForField(fieldEntry)
    this.startInterceptorForField(fieldEntry)
  }

  /**
   * Loads the field value from the URL query parameter and updates the store.
   * This is called upon registration.
   *
   * @param field - The field entry to load.
   */
  private loadFromURLForField(field: FieldEntry<QueryParameter>): void {
    const params = new URLSearchParams(window.location.search)
    if (params.has(field.queryParam)) {
      const valueStr = params.get(field.queryParam)!
      field.store[field.property] = field.deserialize(valueStr)
    }
  }

  /**
   * Sets up a MobX interceptor on the registered property.
   * When the property changes, it computes the new URL parameters (by serializing the new value)
   * and updates the URL using a throttled approach.
   *
   * If the serialized new value equals the default value, the parameter is removed.
   *
   * @param field - The field entry to monitor.
   */
  private startInterceptorForField(field: FieldEntry<QueryParameter>): void {
    intercept(field.store, field.property, (change: any) => {
      // Compute current URL parameters.
      const currentParams = new URLSearchParams(window.location.search)
      // Clone the current parameters to compute the new set.
      const newParams = new URLSearchParams(currentParams.toString())
      const serializedValue = field.serialize(change.newValue)

      // Remove the query parameter if the new value matches the default; otherwise, set it.
      if (serializedValue === field.serialize(field.defaultValue)) {
        newParams.delete(field.queryParam)
      } else {
        newParams.set(field.queryParam, serializedValue)
      }

      // If the new parameters match the current ones, skip the update.
      if (newParams.toString() === currentParams.toString()) {
        return change
      }

      // Get the current time for throttling.
      const now = Date.now()

      // Function to update the URL.
      const updateUrl = () => {
        // Clear the update timer.
        field.updateTimer = undefined
        // Record the time of update.
        field.lastUpdateTime = Date.now()
        // Update the URL with the new parameters.
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${
            newParams.toString().length ? `?${newParams.toString()}` : ''
          }`
        )
      }

      // If this is the first update or enough time has passed, update immediately.
      if (
        !field.lastUpdateTime ||
        now - field.lastUpdateTime >= this.throttleDelay
      ) {
        updateUrl()
      } else {
        // Otherwise, schedule an update after the remaining delay.
        if (field.updateTimer) {
          clearTimeout(field.updateTimer)
        }
        const timeRemaining = this.throttleDelay - (now - field.lastUpdateTime)
        field.updateTimer = window.setTimeout(updateUrl, timeRemaining)
      }
      return change
    })
  }
}
