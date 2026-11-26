# TanStack Query (React Query) - Complete Agent Guide

This document contains the full compiled guide for AI coding agents working with TanStack Query. Based on TkDodo's authoritative blog posts.

---

## Core Mental Model

### React Query is NOT a Data Fetching Library

React Query doesn't fetch data - it's agnostic about HOW you fetch. It only needs a Promise that resolves or rejects. Handle baseURLs, headers, GraphQL, etc. in your data layer.

**What React Query IS**: An async state manager that handles:
- Automatic staleness tracking
- Lifecycle management (loading, error states)
- Continuous synchronization without manual intervention

### Server State vs Client State

- **Server state**: A snapshot you don't own - other users can modify it
- **Client state**: Synchronous state you control (dark mode, UI toggles)

**Critical Rule**: Never sync React Query data into Redux or local state via useEffect. Call useQuery wherever you need the data.

### Understanding staleTime and gcTime

- `staleTime: 0` (default) - Data is immediately stale (eligible for background refetch)
- `gcTime` (formerly `cacheTime`) - How long inactive data stays in cache before garbage collection

**Key insight**: "As long as data is fresh, it will always come from the cache only."

---

## Query Keys

### Rules

1. **Always use arrays**: `['todos']` not `'todos'`
2. **Structure generic to specific**: `['todos', 'list', { filters }]`
3. **Include all dependencies**: Every variable that affects the data
4. **Keys must match exactly**: `['item', '1']` !== `['item', 1]`

### Query Key Factory Pattern

```typescript
const todoKeys = {
  all: ['todos'] as const,
  lists: () => [...todoKeys.all, 'list'] as const,
  list: (filters: Filters) => [...todoKeys.lists(), { filters }] as const,
  details: () => [...todoKeys.all, 'detail'] as const,
  detail: (id: number) => [...todoKeys.details(), id] as const,
}

// Usage
queryClient.invalidateQueries({ queryKey: todoKeys.all }) // all todos
queryClient.invalidateQueries({ queryKey: todoKeys.lists() }) // only lists
useQuery({ queryKey: todoKeys.detail(5), queryFn: () => fetchTodo(5) })
```

---

## Status Handling

### Data-First Pattern (Recommended)

```typescript
const query = useTodosQuery()

// Check data first - preserves cached data during background errors
if (query.data) {
  return <TodoList data={query.data} />
}
if (query.error) {
  return <Error message={query.error.message} />
}
return <Loading />
```

### Why Not Status-First

```typescript
// Anti-pattern: hides cached data on background refetch errors
if (query.isPending) return <Loading />
if (query.isError) return <Error />
return <TodoList data={query.data} />
```

With stale-while-revalidate, you often have both stale data AND an error. Don't hide valid cached content.

### fetchStatus vs status

- `status`: Data state (`success`, `pending`, `error`)
- `fetchStatus`: Request state (`fetching`, `paused`, `idle`)

A query can be `success` and `paused` simultaneously (has data, but offline).

---

## Mutations

### Invalidation vs Direct Updates

```typescript
// Invalidation (safer, recommended for most cases)
useMutation({
  mutationFn: updateTodo,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['todos'] })
  },
})

// Direct update (instant, use when mutation returns complete data)
useMutation({
  mutationFn: updateTodo,
  onSuccess: (data) => {
    queryClient.setQueryData(['todos', data.id], data)
  },
})
```

### Return Promises for Loading State

```typescript
// Correct: mutation stays loading during invalidation
onSuccess: () => queryClient.invalidateQueries({ queryKey: ['todos'] })

// Wrong: mutation completes immediately
onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['todos'] }) }
```

### Optimistic Updates Pattern

```typescript
useMutation({
  mutationFn: updateTodo,
  onMutate: async (newTodo) => {
    // Cancel outgoing refetches
    await queryClient.cancelQueries({ queryKey: ['todos', newTodo.id] })

    // Snapshot previous value
    const previousTodo = queryClient.getQueryData(['todos', newTodo.id])

    // Optimistically update
    queryClient.setQueryData(['todos', newTodo.id], newTodo)

    return { previousTodo }
  },
  onError: (err, newTodo, context) => {
    // Rollback on error
    queryClient.setQueryData(['todos', newTodo.id], context.previousTodo)
  },
  onSettled: () => {
    // Always refetch after error or success
    queryClient.invalidateQueries({ queryKey: ['todos'] })
  },
})
```

### When to Use Optimistic Updates

- High-confidence operations (toggles, likes)
- NOT for navigational mutations where rollbacks create poor UX

### Mutation Rules

1. **Prefer mutate() over mutateAsync()** - Avoids manual error handling
2. **Single argument** - Use objects for multiple values
3. **Callback placement** - Query logic in useMutation; UI actions in mutate()

---

## TypeScript Integration

### Prefer Type Inference

```typescript
// Add explicit return types to API functions
function fetchTodos(): Promise<Todo[]> {
  return axios.get('/todos').then(res => res.data)
}

// Types are inferred automatically
function useTodos() {
  return useQuery({
    queryKey: ['todos'],
    queryFn: fetchTodos,
  })
}
```

### Don't Destructure for Type Narrowing

```typescript
// Correct: type narrowing works
const query = useTodos()
if (query.isSuccess) {
  query.data // Type: Todo[] (not undefined)
}

// Wrong: breaks type narrowing
const { data, isSuccess } = useTodos()
if (isSuccess) {
  data // Type: Todo[] | undefined (still includes undefined)
}
```

### queryOptions Helper (v5+)

```typescript
const todosQuery = queryOptions({
  queryKey: ['todos'],
  queryFn: fetchTodos,
})

// Reusable and fully type-safe
useQuery(todosQuery)
queryClient.prefetchQuery(todosQuery)
const data = queryClient.getQueryData(todosQuery.queryKey) // Type: Todo[] | undefined
```

### Type-Safe Factories

```typescript
const todoQueries = {
  all: () => ['todos'] as const,
  lists: () => [...todoQueries.all(), 'list'] as const,
  list: (filters: Filters) => queryOptions({
    queryKey: [...todoQueries.lists(), filters],
    queryFn: () => fetchTodos(filters),
  }),
  detail: (id: number) => queryOptions({
    queryKey: ['todos', 'detail', id],
    queryFn: () => fetchTodo(id),
  }),
}
```

---

## Cache Management

### placeholderData vs initialData

| Aspect | placeholderData | initialData |
|--------|-----------------|-------------|
| Level | Observer | Cache |
| Persistence | Never cached | Persisted |
| Refetch | Always triggers | Respects staleTime |
| On error | Becomes undefined | Persists |
| Use case | "Fake" estimated data | "Real" data from cache |

### Seeding from Existing Cache

```typescript
// Pull approach: at detail render time
useQuery({
  queryKey: ['todo', id],
  queryFn: () => fetchTodo(id),
  initialData: () => {
    return queryClient.getQueryData(['todos'])?.find(t => t.id === id)
  },
  initialDataUpdatedAt: () => {
    return queryClient.getQueryState(['todos'])?.dataUpdatedAt
  },
})

// Push approach: after fetching list
const fetchTodos = async () => {
  const todos = await api.getTodos()
  todos.forEach(todo => {
    queryClient.setQueryData(['todo', todo.id], todo)
  })
  return todos
}
```

---

## Error Handling

### Global Error Callbacks (Background Refetch Toasts)

```typescript
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Only toast for background failures (has existing data)
      if (query.state.data !== undefined) {
        toast.error(`Update failed: ${error.message}`)
      }
    },
  }),
})
```

### Error Boundaries

```typescript
useQuery({
  queryKey: ['todos'],
  queryFn: fetchTodos,
  throwOnError: true, // All errors go to boundary
})

// Granular: only 5xx errors to boundary
useQuery({
  queryKey: ['todos'],
  queryFn: fetchTodos,
  throwOnError: (error) => error.response?.status >= 500,
})
```

### Fetch API Gotcha

```typescript
// Fetch doesn't reject on 4xx/5xx - check manually
const fetchTodos = async () => {
  const response = await fetch('/todos')
  if (!response.ok) {
    throw new Error('Network response was not ok')
  }
  return response.json()
}
```

---

## Render Optimization

### Select for Computed Data

```typescript
// Only re-renders when todoCount changes
const { data: todoCount } = useQuery({
  queryKey: ['todos'],
  queryFn: fetchTodos,
  select: (data) => data.length,
})

// Only re-renders when specific todo changes
const { data: todo } = useQuery({
  queryKey: ['todos'],
  queryFn: fetchTodos,
  select: (data) => data.find(t => t.id === 5),
})
```

### Tracked Queries (Default v4+)

Components only re-render when properties they use change. Caveat: spreading `{ ...query }` tracks all fields.

### Structural Sharing

React Query preserves object references for unchanged data. Disable for large datasets:

```typescript
useQuery({
  queryKey: ['largeData'],
  queryFn: fetchLargeData,
  structuralSharing: false,
})
```

---

## Testing

### Setup Pattern

```typescript
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false, // Critical!
      },
    },
  })
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

// Each test gets fresh client
it('fetches todos', async () => {
  const { result } = renderHook(() => useTodos(), {
    wrapper: createWrapper(),
  })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
})
```

### Use Mock Service Worker (MSW)

MSW is recommended for network mocking - single source of truth for all environments.

---

## Advanced Patterns

### WebSocket Integration

```typescript
useEffect(() => {
  const ws = new WebSocket(url)
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data)
    queryClient.invalidateQueries({
      queryKey: [...data.entity, data.id].filter(Boolean)
    })
  }
  return () => ws.close()
}, [])

// With WebSockets handling updates, set high staleTime
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity } }
})
```

### React Router Integration

```typescript
// Loader
export const loader = (queryClient: QueryClient) =>
  async ({ params }: LoaderFunctionArgs) => {
    const query = todoQuery(params.id!)
    return queryClient.getQueryData(query.queryKey) ??
           await queryClient.fetchQuery(query)
  }

// Component
function TodoPage() {
  const initialData = useLoaderData() as Todo
  const params = useParams()
  const { data } = useQuery({
    ...todoQuery(params.id!),
    initialData,
  })
}
```

### Suspense Queries (v5+)

```typescript
// Guaranteed data - no undefined
function TodoList() {
  const { data } = useSuspenseQuery({
    queryKey: ['todos'],
    queryFn: fetchTodos,
  })
  // data is Todo[], not Todo[] | undefined
  return <List items={data} />
}
```

---

## Anti-Patterns to Avoid

### Don't sync to local state

```typescript
// WRONG
const { data } = useQuery({...})
const [localData, setLocalData] = useState(data)
useEffect(() => setLocalData(data), [data])

// CORRECT
const { data } = useQuery({...})
// Use data directly
```

### Don't use QueryCache as state manager

`setQueryData` is for optimistic updates and mutation responses only.

### Don't create unstable QueryClient

```typescript
// WRONG
function App() {
  const queryClient = new QueryClient() // Recreates every render!
  return <QueryClientProvider client={queryClient}>...</QueryClientProvider>
}

// CORRECT
const queryClient = new QueryClient()
function App() {
  return <QueryClientProvider client={queryClient}>...</QueryClientProvider>
}
```

### Don't swallow errors

```typescript
// WRONG
const fetchData = async () => {
  try {
    return await api.get()
  } catch (error) {
    console.log(error) // Query thinks this succeeded!
  }
}

// CORRECT
const fetchData = async () => {
  try {
    return await api.get()
  } catch (error) {
    console.log(error)
    throw error // Re-throw!
  }
}
```

---

## When NOT to Use React Query

1. **React Server Components** - Use framework-native data fetching
2. **Next.js/Remix simple needs** - Built-in solutions may suffice
3. **GraphQL with normalized cache** - Consider Apollo Client or urql
4. **No background updates needed** - Static SSR may be enough

---

## Resources

- Official docs: https://tanstack.com/query
- TkDodo's blog: https://tkdodo.eu/blog
