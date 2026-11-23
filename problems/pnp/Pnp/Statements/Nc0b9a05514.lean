import Pnp.Defs

namespace Pnp

def Statements.Nc0b9a05514 : Prop :=
  ∃ ε : ℝ, 0 < ε ∧ ∃ m₀ : ℕ, ∀ m ≥ m₀, ∀ c : Circuit, c.Monotone → c.FanInTwo → Computes c (m * m) (clique m (Nat.sqrt (Nat.sqrt m))) → (2 : ℝ) ^ (ε * (m : ℝ) ^ ((1 : ℝ) / 8)) ≤ c.size

end Pnp
