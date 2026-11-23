import Pnp.Defs

namespace Pnp

def Statements.Nae3213ebe6 : Prop :=
  ∀ f g : Word → Word, PolyTime f → PolyTime g → PolyTime (g ∘ f)

end Pnp
