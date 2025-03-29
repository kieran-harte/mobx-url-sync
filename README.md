# mobx-url-sync

Synchronizes MobX observables with URL query parameters.

## Features

- **Type-safe API:** Register store properties with strict query parameter names.
- **Serialization:** Supports primitives (string, number, boolean) by default and allows extension for custom types
- **Two-way binding:** Observable values are initialized from the URL and uses MobX’s `intercept` to monitor and sync property changes.
- **Clean URLs:** Removes query parameters when the value matches the default value.

## Installation

Install via npm:

```bash
npm install mobx-url-sync
```

## Example

This examples shows a MobX store holding a counter property which is automatically synchronized with the URL query parameter `counter`.

### 1. Create a Counter Store

```typescript
// counterStore.ts
import { makeAutoObservable } from 'mobx'
import { MobxUrlSync } from 'mobx-url-sync'

// Define allowed query parameter(s) (here, only "counter" is allowed)
type QueryParams = 'counter'

// Initialize MobxUrlSync (no custom serializers needed for numbers)
const mobxUrlSync = new MobxUrlSync<QueryParams>()

export class CounterStore {
  counter: number = 0

  constructor() {
    makeAutoObservable(this)
    // Register the counter property to sync with the "counter" query parameter.
    mobxUrlSync.registerField(this, 'counter', 'counter')
  }

  increment() {
    this.counter++
  }

  decrement() {
    this.counter--
  }
}

export const counterStore = new CounterStore()
```

After calling `counterStore.increment()` the URL will change to `?counter=1`.

## API Reference

### Class: `MobxUrlSync<QueryParameter extends string>`

#### Constructor

```typescript
new MobxUrlSync(defaultSerializers?: Serializers, options?: { throttleDelay?: number })
```

- **defaultSerializers:** Custom serializers for complex types.
- **options.throttleDelay:** Delay (in ms) before updating the URL (default is 500ms).

#### Method: `registerField`

```typescript
registerField<TStore, K extends keyof TStore>(
  store: TStore,
  property: K,
  queryParam: QueryParameter,
  config?: {
    defaultValue?: TStore[K];
    serialize?: (value: TStore[K]) => string;
    deserialize?: (value: string) => TStore[K];
  }
): void
```

- **store:** The MobX store instance.
- **property:** The property on the store to sync.
- **queryParam:** A string key from a predefined union of allowed query parameters.
- **config (optional):** Override the default value or serialization behavior.

#### Behavior

- **On Registration:**  
  The field is added, and its current value is loaded from the URL if available.

- **On Changes:**  
  When the property changes, the URL is updated (debounced). If the new value matches the default or is null/undefined, the query parameter is removed.

## License

[MIT](LICENSE)
