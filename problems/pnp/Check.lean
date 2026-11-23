import Lean

open Lean

def allowed : List Name := ["propext".toName, "Classical.choice".toName, "Quot.sound".toName]

abbrev Walk := StateM (NameSet × NameSet)

partial def collect (env : Kernel.Environment) (c : Name) : Walk Unit := do
  if (← get).1.contains c then return
  modify fun (seen, found) => (seen.insert c, found)
  let visit (e : Expr) : Walk Unit := e.getUsedConstants.forM (collect env)
  match env.find? c with
  | some (.axiomInfo v) => modify (fun (seen, found) => (seen, found.insert c)) *> visit v.type
  | some (.defnInfo v) => visit v.type *> visit v.value
  | some (.thmInfo v) => visit v.type *> visit v.value
  | some (.opaqueInfo v) => visit v.type *> visit v.value
  | some (.ctorInfo v) => visit v.type
  | some (.recInfo v) => visit v.type
  | some (.inductInfo v) => visit v.type *> v.ctors.forM (collect env)
  | some (.quotInfo _) => pure ()
  | none => modify fun (seen, found) => (seen, found.insert (.str c "missing"))

def answer (ok : Bool) (fields : List (String × Json)) : IO UInt32 := do
  IO.println (Json.mkObj (("ok", toJson ok) :: fields)).compress
  return if ok then 0 else 1

def main (args : List String) : IO UInt32 := do
  let (nid, refute) ← match args with
    | [nid] => pure (nid, false)
    | [nid, "refutation"] => pure (nid, true)
    | _ => return ← answer false [("error", "usage: lake exe check <nid> [refutation]")]
  unless nid == "root" || (nid.length == 10 && nid.all (fun c => c.isDigit || ('a' ≤ c && c ≤ 'f'))) do
    return ← answer false [("error", s!"bad node id {nid}")]
  initSearchPath (← findSysroot)
  let challenge := s!"Pnp.Challenge.N{nid}".toName
  let statement := s!"Pnp.Statements.N{nid}".toName
  let claimed := s!"Pnp.N{nid}".toName
  let verified := s!"Pnp.Verified.N{nid}".toName
  let env ← importModules #[{ module := challenge }] {} (trustLevel := 0)
  let named := toJson claimed.toString
  let some (.defnInfo _) := env.find? statement
    | answer false [("theorem", named), ("error", s!"{statement} is missing")]
  let home := (env.getModuleIdxFor? statement).bind fun i => env.header.moduleNames[i.toNat]?
  unless home == some statement do
    return ← answer false [("theorem", named), ("error", s!"{statement} is not from its statement file")]
  let some (.thmInfo info) := env.find? claimed
    | answer false [("theorem", named), ("error", s!"{claimed} is not a theorem")]
  let decl := Declaration.thmDecl {
    name := verified, levelParams := []
    type := if refute then mkApp (mkConst "Not".toName) (mkConst statement) else mkConst statement
    value := mkConst claimed (info.levelParams.map fun _ => Level.zero) }
  match env.toKernelEnv.addDecl {} decl with
  | .error e =>
    answer false [("theorem", named), ("error", s!"{claimed} does not have the frozen statement's type: {← (e.toMessageData {}).toString}")]
  | .ok kenv =>
    let ((), (_, found)) := (collect kenv verified).run ({}, {})
    let axioms := (found.toList.map (·.toString)).toArray.qsort (· < ·)
    let bad := found.toList.filter (!allowed.contains ·)
    if bad.isEmpty then answer true [("theorem", named), ("axioms", toJson axioms)]
    else answer false [("theorem", named), ("axioms", toJson axioms), ("error", s!"axioms outside the allowlist: {bad}")]

