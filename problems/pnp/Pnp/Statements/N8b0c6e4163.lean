import Pnp.Defs

namespace Pnp

def Statements.N8b0c6e4163 : Prop :=
  ∀ (n w t ℓ : ℕ) (F : DNF n), F.width ≤ w → ((badRestrictions F ℓ t).card : ℝ) ≤ ((10 * ℓ * w : ℝ) / n) ^ t * (restrictions n ℓ).card

end Pnp
