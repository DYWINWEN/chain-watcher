import { evaluateRule, type EvalDeps } from './ast.js';
import type { RuleDsl } from './schema.js';
import type { NormalizedTx } from '../../types.js';

export type CompiledRule = {
  id: string;
  name: string;
  severity: 'P1' | 'P2' | 'P3';
  enabled: boolean;
  builtIn: boolean;
  raw: RuleDsl;
  evaluate: (tx: NormalizedTx, deps: EvalDeps) => Promise<boolean>;
};

export function compileRule(raw: RuleDsl, opts: { builtIn?: boolean } = {}): CompiledRule {
  // For M14, we don't precompile to bytecode — we just bind the rule shape into a closure.
  // The AST evaluator is fast enough that on-the-fly traversal is fine.
  return {
    id: raw.id,
    name: raw.name,
    severity: raw.severity,
    enabled: raw.enabled,
    builtIn: !!opts.builtIn,
    raw,
    evaluate: (tx, deps) => evaluateRule(raw, tx, deps),
  };
}
