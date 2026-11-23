import Pnp.Defs

namespace Pnp

def Statements.N143e0c5429 : Prop :=
  ∀ (Γ : ∀ n, Set (BoolFn n)) (k c : ℕ), (∀ n ≥ c, (2 : ℝ) ^ 2 ^ n ≤ 2 ^ (c * n) * (Γ n).ncard) → (∀ n ≥ c, ∀ f ∈ Γ n, n ^ k < circuitSize n f) → ∀ n ≥ c, ∀ (m : ℕ) (g : (Fin m → Bool) → BoolFn n), (∀ s, circuitSize n (g s) ≤ n ^ k) → ∃ D : Set (BoolFn n), (∀ s, g s ∉ D) ∧ (2 : ℝ) ^ 2 ^ n ≤ 2 ^ (c * n) * D.ncard

end Pnp
