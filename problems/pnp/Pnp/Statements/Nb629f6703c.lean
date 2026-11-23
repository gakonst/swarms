import Pnp.Defs

namespace Pnp

def Statements.Nb629f6703c : Prop :=
  ∃ (A : Lang) (E : AlgExt A), ∀ L : Lang, InNPO E.oracle L → InPO A L

end Pnp
