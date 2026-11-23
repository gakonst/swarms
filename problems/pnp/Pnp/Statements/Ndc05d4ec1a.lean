import Pnp.Defs

namespace Pnp

def Statements.Ndc05d4ec1a : Prop :=
  ∃ (A : Lang) (E : AlgExt A) (L : Lang), InNPO A L ∧ ¬ InPO E.oracle L

end Pnp
