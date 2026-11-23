import Pnp.Defs

namespace Pnp

def Statements.Nfa40748031 : Prop :=
  ∀ A B C : Lang, PolyReduces A B → PolyReduces B C → PolyReduces A C

end Pnp
