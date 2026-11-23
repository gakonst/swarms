import Pnp.Defs

namespace Pnp

def Statements.N4c4401c81d : Prop :=
  ∀ d : ℕ, 2 ≤ d → ∃ n₀ : ℕ, ∀ n ≥ n₀, ∀ c : Circuit, c.depth ≤ d → Computes c n (parity n) → (2 : ℝ) ^ ((n : ℝ) ^ ((1 : ℝ) / ((d : ℝ) - 1)) / 10) ≤ c.size

end Pnp
