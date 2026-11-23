import Pnp.Defs

namespace Pnp

def Statements.N2f7a140626 : Prop :=
  ∃ φ : CNF, φ.Satisfiable ∧ φ.eval (majorityAssignment φ) = false

end Pnp
