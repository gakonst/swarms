import Mathlib

namespace Pnp

open Turing

abbrev Word := List Bool

abbrev Lang := Set Word

def PolyTime (f : Word → Word) : Prop :=
  Nonempty (TM2ComputableInPolyTime (id : Word → List Bool) (id : Word → List Bool) f)

def InP (L : Lang) : Prop :=
  Nonempty (TM2ComputableInPolyTime (id : Word → List Bool) Computability.encodeBool
    (fun x => @decide (x ∈ L) (Classical.propDecidable _)))

def pair (x w : Word) : Word := (x.flatMap fun b => [b, b]) ++ [false, true] ++ w

def InNP (L : Lang) : Prop :=
  ∃ V : Lang, InP V ∧ ∃ p : Polynomial ℕ,
    ∀ x, x ∈ L ↔ ∃ w : Word, w.length ≤ p.eval x.length ∧ pair x w ∈ V

def PolyReduces (A B : Lang) : Prop := ∃ f : Word → Word, PolyTime f ∧ ∀ x, x ∈ A ↔ f x ∈ B

def NPHard (L : Lang) : Prop := ∀ A, InNP A → PolyReduces A L

def NPComplete (L : Lang) : Prop := InNP L ∧ NPHard L

def PEqNP : Prop := ∀ L, InNP L → InP L

def encode {α : Type} [Encodable α] (x : α) : Word := Nat.bits (Encodable.encode x)

abbrev Literal := ℕ × Bool

abbrev Clause := List Literal

abbrev CNF := List Clause

def Literal.eval (a : ℕ → Bool) (l : Literal) : Bool := a l.1 == l.2

def Clause.eval (a : ℕ → Bool) (c : Clause) : Bool := c.any (Literal.eval a)

def CNF.eval (a : ℕ → Bool) (φ : CNF) : Bool := φ.all (Clause.eval a)

def CNF.Satisfiable (φ : CNF) : Prop := ∃ a : ℕ → Bool, φ.eval a = true

def Clause.Horn (c : Clause) : Prop := (c.filter (·.2)).length ≤ 1

def SAT : Lang := {x | ∃ φ : CNF, x = encode φ ∧ φ.Satisfiable}

def ThreeSAT : Lang := {x | ∃ φ : CNF, x = encode φ ∧ (∀ c ∈ φ, c.length ≤ 3) ∧ φ.Satisfiable}

def TwoSAT : Lang := {x | ∃ φ : CNF, x = encode φ ∧ (∀ c ∈ φ, c.length ≤ 2) ∧ φ.Satisfiable}

def HornSAT : Lang := {x | ∃ φ : CNF, x = encode φ ∧ (∀ c ∈ φ, c.Horn) ∧ φ.Satisfiable}

def majorityAssignment (φ : CNF) : ℕ → Bool := fun v =>
  decide ((φ.flatten.filter (· == (v, false))).length ≤ (φ.flatten.filter (· == (v, true))).length)

abbrev BoolFn (n : ℕ) := (Fin n → Bool) → Bool

inductive Gate where
  | input (i : ℕ) (neg : Bool)
  | const (b : Bool)
  | not (j : ℕ)
  | and (js : List ℕ)
  | or (js : List ℕ)

abbrev Circuit := List Gate

def Gate.eval (x : ℕ → Bool) (vals : List Bool) : Gate → Bool
  | .input i neg => x i ^^ neg
  | .const b => b
  | .not j => !(vals.getD j false)
  | .and js => js.all fun j => vals.getD j false
  | .or js => js.any fun j => vals.getD j false

def Circuit.values (c : Circuit) (x : ℕ → Bool) : List Bool :=
  c.foldl (fun vals g => vals ++ [g.eval x vals]) []

def Circuit.eval (c : Circuit) (x : ℕ → Bool) : Bool := (c.values x).getLastD false

def Circuit.size (c : Circuit) : ℕ := c.length

def Gate.depth (ds : List ℕ) : Gate → ℕ
  | .input _ _ => 0
  | .const _ => 0
  | .not j => ds.getD j 0 + 1
  | .and js => (js.map fun j => ds.getD j 0).foldl max 0 + 1
  | .or js => (js.map fun j => ds.getD j 0).foldl max 0 + 1

def Circuit.depths (c : Circuit) : List ℕ := c.foldl (fun ds g => ds ++ [g.depth ds]) []

def Circuit.depth (c : Circuit) : ℕ := c.depths.foldl max 0

def Gate.FanInTwo : Gate → Prop
  | .and js => js.length ≤ 2
  | .or js => js.length ≤ 2
  | _ => True

def Circuit.FanInTwo (c : Circuit) : Prop := ∀ g ∈ c, g.FanInTwo

def Gate.Monotone : Gate → Prop
  | .input _ neg => neg = false
  | .not _ => False
  | _ => True

def Circuit.Monotone (c : Circuit) : Prop := ∀ g ∈ c, g.Monotone

def extend {n : ℕ} (x : Fin n → Bool) : ℕ → Bool := fun i => if h : i < n then x ⟨i, h⟩ else false

def Computes (c : Circuit) (n : ℕ) (f : BoolFn n) : Prop := ∀ x, c.eval (extend x) = f x

noncomputable def circuitSize (n : ℕ) (f : BoolFn n) : ℕ :=
  sInf {s | ∃ c : Circuit, c.FanInTwo ∧ Computes c n f ∧ c.size = s}

def parity (n : ℕ) : BoolFn n := fun x => (List.ofFn x).foldl xor false

def InAC0 (f : ∀ n, BoolFn n) : Prop :=
  ∃ d k : ℕ, ∀ n, ∃ c : Circuit, c.depth ≤ d ∧ c.size ≤ n ^ k + k ∧ Computes c n (f n)

noncomputable def clique (m k : ℕ) : BoolFn (m * m) := fun x =>
  @decide (∃ S : Finset (Fin m), S.card = k ∧ ∀ i ∈ S, ∀ j ∈ S, i < j → extend x (i.val * m + j.val) = true)
    (Classical.propDecidable _)

inductive DTree (n : ℕ) where
  | leaf (b : Bool)
  | query (i : Fin n) (ifFalse ifTrue : DTree n)

def DTree.eval {n : ℕ} : DTree n → (Fin n → Bool) → Bool
  | .leaf b, _ => b
  | .query i l r, x => if x i then r.eval x else l.eval x

def DTree.depth {n : ℕ} : DTree n → ℕ
  | .leaf _ => 0
  | .query _ l r => max l.depth r.depth + 1

noncomputable def dtDepth {n : ℕ} (f : BoolFn n) : ℕ :=
  sInf {d | ∃ T : DTree n, T.depth = d ∧ ∀ x, T.eval x = f x}

abbrev Restriction (n : ℕ) := Fin n → Option Bool

def Restriction.stars {n : ℕ} (ρ : Restriction n) : ℕ := (Finset.univ.filter fun i => ρ i = none).card

def restrict {n : ℕ} (ρ : Restriction n) (f : BoolFn n) : BoolFn n := fun x => f fun i => (ρ i).getD (x i)

abbrev DNF (n : ℕ) := List (List (Fin n × Bool))

def DNF.eval {n : ℕ} (F : DNF n) : BoolFn n := fun x => F.any fun t => t.all fun l => x l.1 == l.2

def DNF.width {n : ℕ} (F : DNF n) : ℕ := (F.map List.length).foldl max 0

def restrictions (n ℓ : ℕ) : Finset (Restriction n) := Finset.univ.filter fun ρ => ρ.stars = ℓ

noncomputable def badRestrictions {n : ℕ} (F : DNF n) (ℓ t : ℕ) : Finset (Restriction n) := by
  classical
  exact (restrictions n ℓ).filter fun ρ => t ≤ dtDepth (restrict ρ F.eval)

structure OTM where
  Q : Type
  [fintype : Fintype Q]
  [decEq : DecidableEq Q]
  start : Q
  accept : Q
  reject : Q
  ask : Q
  yes : Q
  no : Q
  step : Q → Option Bool → Q × Option Bool × Turing.Dir × Option Bool

attribute [instance] OTM.fintype OTM.decEq

structure OTM.Cfg (M : OTM) where
  q : M.Q
  left : List (Option Bool)
  head : Option Bool
  right : List (Option Bool)
  query : List Bool

def OTM.init (M : OTM) (x : Word) : M.Cfg :=
  match x with
  | [] => ⟨M.start, [], none, [], []⟩
  | a :: r => ⟨M.start, [], some a, r.map some, []⟩

def OTM.shift (w : Option Bool) (d : Turing.Dir) (left right : List (Option Bool)) :
    List (Option Bool) × Option Bool × List (Option Bool) :=
  match d, left, right with
  | .left, [], r => ([], none, w :: r)
  | .left, a :: l, r => (l, a, w :: r)
  | .right, l, [] => (w :: l, none, [])
  | .right, l, a :: r => (w :: l, a, r)

noncomputable def OTM.next (M : OTM) (A : Lang) (c : M.Cfg) : M.Cfg :=
  if c.q = M.accept ∨ c.q = M.reject then c
  else if c.q = M.ask then
    { c with q := @ite _ (c.query ∈ A) (Classical.propDecidable _) M.yes M.no, query := [] }
  else
    let s := M.step c.q c.head
    let t := OTM.shift s.2.1 s.2.2.1 c.left c.right
    ⟨s.1, t.1, t.2.1, t.2.2, c.query ++ s.2.2.2.toList⟩

noncomputable def OTM.run (M : OTM) (A : Lang) (x : Word) (t : ℕ) : M.Cfg := (M.next A)^[t] (M.init x)

def OTM.DecidesIn (M : OTM) (A L : Lang) (T : ℕ → ℕ) : Prop :=
  ∀ x, ∃ t ≤ T x.length,
    ((M.run A x t).q = M.accept ∧ x ∈ L) ∨ ((M.run A x t).q = M.reject ∧ x ∉ L)

def InPO (A L : Lang) : Prop := ∃ (M : OTM) (k : ℕ), M.DecidesIn A L (fun n => n ^ k + k)

def InNPO (A L : Lang) : Prop :=
  ∃ V : Lang, InPO A V ∧ ∃ k : ℕ,
    ∀ x, x ∈ L ↔ ∃ w : Word, w.length ≤ x.length ^ k + k ∧ pair x w ∈ V

open Classical in
structure AlgExt (A : Lang) where
  poly : (n p : ℕ) → MvPolynomial (Fin n) (ZMod p)
  multilinear : ∀ (n p : ℕ) (i : Fin n), (poly n p).degreeOf i ≤ 1
  agrees : ∀ n p : ℕ, p.Prime → ∀ x : Fin n → Bool,
    MvPolynomial.eval (fun i => if x i then (1 : ZMod p) else 0) (poly n p) =
      if List.ofFn x ∈ A then 1 else 0

def AlgExt.oracle {A : Lang} (E : AlgExt A) : Lang :=
  {q | ∃ (n p : ℕ) (v : Fin n → ZMod p) (j : ℕ),
    q = encode (n, p, (List.ofFn v).map ZMod.val, j) ∧
      Nat.testBit (MvPolynomial.eval v (E.poly n p)).val j = true}

structure Rel where
  arity : ℕ
  tuples : Set (Fin arity → Bool)

abbrev ConstraintLang := List Rel

abbrev CSPInstance := List (ℕ × List ℕ)

def CSPInstance.Sat (Γ : ConstraintLang) (I : CSPInstance) : Prop :=
  ∃ a : ℕ → Bool, ∀ c ∈ I, ∃ R : Rel, Γ[c.1]? = some R ∧
    ∃ h : c.2.length = R.arity, (fun j : Fin R.arity => a (c.2.get (Fin.cast h.symm j))) ∈ R.tuples

def CSP (Γ : ConstraintLang) : Lang := {x | ∃ I : CSPInstance, x = encode I ∧ I.Sat Γ}

def Rel.ClosedUnder (R : Rel) (k : ℕ) (f : (Fin k → Bool) → Bool) : Prop :=
  ∀ ts : Fin k → Fin R.arity → Bool, (∀ i, ts i ∈ R.tuples) → (fun j => f fun i => ts i j) ∈ R.tuples

def Schaefer (Γ : ConstraintLang) : Prop :=
  (∀ R ∈ Γ, (fun _ => false) ∈ R.tuples) ∨
  (∀ R ∈ Γ, (fun _ => true) ∈ R.tuples) ∨
  (∀ R ∈ Γ, R.ClosedUnder 2 fun b => b 0 && b 1) ∨
  (∀ R ∈ Γ, R.ClosedUnder 2 fun b => b 0 || b 1) ∨
  (∀ R ∈ Γ, R.ClosedUnder 3 fun b => (b 0 && b 1) || (b 1 && b 2) || (b 0 && b 2)) ∨
  (∀ R ∈ Γ, R.ClosedUnder 3 fun b => b 0 ^^ b 1 ^^ b 2)

end Pnp

