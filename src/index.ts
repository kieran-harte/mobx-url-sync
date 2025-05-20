/* eslint-disable @typescript-eslint/no-explicit-any */
import { action, intercept, makeObservable, observable, reaction } from 'mobx'

// Default debounce delay (ms) for URL updates
const DEFAULT_DEBOUNCE_DELAY = 500

/** Serializer interface for custom types */
export interface Serializer<T> {
  classConstructor: new (...args: any[]) => T
  serialize(value: T): string
  deserialize(raw: string): T
}

/** Map of custom serializers keyed by type name */
export type Serializers = Record<string, Serializer<any>>

/** Internal record for one synced field */
interface SyncedField<QP extends string> {
  store: any
  property: string
  queryParam: QP
  defaultValue: any
  serialize: (v: any) => string
  deserialize: (s: string) => any
}

/** Configuration options */
export interface UrlSyncOptions {
  debounceDelay?: number
}

/**
 * MobxUrlSync synchronizes MobX store properties with URL query parameters with a single debounced update.
 * It supports default serialization for primitives and custom types via provided serializers.
 * URL updates are throttled to avoid excessive history updates.
 *
 * @template QueryParameter - A union type of allowed query parameter strings.
 */
export class MobXURLSync<QP extends string> {
  private serializers: Serializers
  private debounceDelay: number
  private fields = new Map<QP, SyncedField<QP>>()
  private updateTimer?: number
  private lastUpdateTime: number = 0

  constructor(serializers: Serializers = {}, options: UrlSyncOptions = {}) {
    this.serializers = serializers
    this.debounceDelay = options.debounceDelay ?? DEFAULT_DEBOUNCE_DELAY

    makeObservable<this, 'fields'>(this, {
      fields: observable.shallow,
      register: action
    })

    // When any field’s serialized value changes, schedule a URL update
    reaction(
      () => this.buildQueryString(),
      () => this.scheduleUrlUpdate()
    )
  }

  /**
   * Register a MobX store property to sync with a URL parameter.
   * Primitives get default (de)serializers; complex types require a Serializer.
   */
  register<TStore, K extends keyof TStore>(
    store: TStore,
    property: K,
    queryParam: QP,
    config: {
      defaultValue?: TStore[K]
      serialize?: (v: TStore[K]) => string
      deserialize?: (s: string) => TStore[K]
    } = {}
  ): void {
    if (this.fields.has(queryParam)) {
      throw new Error(`Query param "${queryParam}" already registered.`)
    }

    // Determine defaultValue
    const defaultVal = config.defaultValue ?? store[property]

    // Determine (de)serializer
    let { serialize, deserialize } = config
    if (!serialize || !deserialize) {
      const auto = this.getAutoSerializer(defaultVal)
      if (auto) {
        serialize = serialize ?? auto.serialize
        deserialize = deserialize ?? auto.deserialize
      }
    }
    if (!serialize || !deserialize) {
      throw new Error(
        `Property "${String(
          property
        )}" requires serialize/deserialize functions.`
      )
    }

    // Load initial value from URL if present
    const params = new URLSearchParams(window.location.search)
    if (params.has(queryParam)) {
      try {
        store[property] = deserialize(params.get(queryParam)!)
      } catch {
        // ignore parse errors
      }
    }

    this.fields.set(queryParam, {
      store,
      property: String(property),
      queryParam,
      defaultValue: defaultVal,
      serialize,
      deserialize
    })

    // Intercept changes to trigger our reaction
    intercept(store as any, property as string, change => change)
  }

  /** Build the combined query string based on current store values */
  private buildQueryString(): string {
    const params = new URLSearchParams()
    this.fields.forEach(f => {
      const raw = f.store[f.property]
      const str = f.serialize(raw)
      if (str !== f.serialize(f.defaultValue)) {
        params.set(f.queryParam, str)
      }
    })
    return params.toString()
  }

  /**
   * Schedule or immediately perform the URL update.
   * - If more than `debounceDelay` ms have passed since `lastUpdateTime`, update now.
   * - Otherwise, debounce for the remaining time.
   */
  private scheduleUrlUpdate() {
    const now = Date.now()
    const elapsed = now - this.lastUpdateTime

    // Clear any pending timer
    if (this.updateTimer != null) {
      clearTimeout(this.updateTimer)
      this.updateTimer = undefined
    }

    if (this.lastUpdateTime === 0 || elapsed >= this.debounceDelay) {
      // Enough time has passed — update immediately
      this.applyUrlUpdate()
    } else {
      // Debounce for the remaining delay
      const wait = this.debounceDelay - elapsed
      this.updateTimer = window.setTimeout(() => {
        this.applyUrlUpdate()
        this.updateTimer = undefined
      }, wait)
    }
  }

  /** Actually write the new URL based on the latest query string */
  private applyUrlUpdate() {
    this.lastUpdateTime = Date.now()
    const qs = this.buildQueryString()
    const base = window.location.pathname
    const newUrl = qs ? `${base}?${qs}` : base

    // Only replace state if it’s truly changed
    if (
      newUrl !==
      window.location.href.split('?')[0] + window.location.search
    ) {
      window.history.replaceState(null, '', newUrl)
    }
  }

  /** Infer a default serializer for primitives or any registered custom type */
  private getAutoSerializer<T>(val: T) {
    if (['string', 'number', 'boolean'].includes(typeof val)) {
      return {
        serialize: (v: T) => String(v),
        deserialize: (s: string) => s as unknown as T
      }
    }
    for (const key in this.serializers) {
      const s = this.serializers[key]
      if (val instanceof s.classConstructor) return s
    }
    return undefined
  }
}
