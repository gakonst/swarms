import Pnp.Defs

namespace Pnp

def Statements.Nf71cc669e4 : Prop :=
  ∀ Γ : ConstraintLang, ¬ Schaefer Γ → NPComplete (CSP Γ)

end Pnp
