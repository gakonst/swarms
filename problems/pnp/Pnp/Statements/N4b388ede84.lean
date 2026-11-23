import Pnp.Defs

namespace Pnp

def Statements.N4b388ede84 : Prop :=
  ∀ A B : Lang, PolyReduces A B → InP B → InP A

end Pnp
