export function launcher<Input, Made>(create: (input: Input) => Promise<Made>) {
  const made = new Map<string, Made>()
  return async (input: Input, step: (step: 'create') => void) => {
    const drafted = JSON.stringify(input)
    const known = made.get(drafted)
    if (known) return known
    step('create')
    const created = await create(input)
    made.set(drafted, created)
    return created
  }
}
