import Pnp.Defs

namespace Pnp

def Statements.Nc7bea4e90e : Prop :=
  ∃ n₀ : ℕ, ∀ n ≥ n₀, ∃ f : BoolFn n, 2 ^ n ≤ 10 * n * circuitSize n f

end Pnp
