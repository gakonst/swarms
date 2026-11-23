import Pnp.Defs

namespace Pnp

def Statements.Nd658fca714 : Prop :=
  ∀ (c : Circuit) (n : ℕ), c.Monotone → Monotone fun x : Fin n → Bool => c.eval (extend x)

end Pnp
