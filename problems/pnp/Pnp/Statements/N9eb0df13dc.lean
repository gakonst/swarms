import Pnp.Defs

namespace Pnp

def Statements.N9eb0df13dc : Prop :=
  ∀ A B : Lang, PolyReduces A B → InNP B → InNP A

end Pnp
