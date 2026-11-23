import Pnp.Defs

namespace Pnp

def Statements.Ndbb7e7488f : Prop :=
  ∃ n₀ : ℕ, ∀ n ≥ n₀, 2 ^ 2 ^ n ≤ 2 * {f : BoolFn n | 2 ^ n ≤ 10 * n * circuitSize n f}.ncard

end Pnp
