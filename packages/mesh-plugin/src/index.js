import { evalEvent, hashEvent } from '@tripwire/core';

/**
 * Minimal Mesh-shaped adapter.
 *
 * Tripwire is the framework.
 * Mesh is an application/runtime that wraps capabilities.
 *
 * This package provides:
 * - a normalized TripwireEvent shape
 * - mapping findings -> decision (allow/require_approval/deny)
 * - helper to wrap an arbitrary capability/tool call
 */

/** @typedef {'allow'|'require_approval'|'deny'} TripwireDecision */

/**
 * @typedef {Object} TripwireEvent
 * @property {string} ts - ISO timestamp
 * @property {string} kind - e.g. 'tool_call'
 * @property {string} text - human prompt or tool command
 * @property {string=} tool - tool/capability name
 * @property {Object=} meta - any extra context
 */

/**
 * @typedef {Object} TripwireResult
 * @property {string} event_id
 * @property {TripwireDecision} decision
 * @property {Array<Object>} findings
 */

/**
 * Map findings to an enforcement decision.
 *
 * Default policy (MVP):
 * - any high severity => require_approval
 * - any med severity => require_approval (tunable)
 * - low only => allow
 *
 * You can override by passing `decisionPolicy`.
 */
export function defaultDecisionPolicy(findings) {
  const severities = new Set(findings.map((f) => f.severity));
  if (severities.has('high')) return 'require_approval';
  if (severities.has('med')) return 'require_approval';
  return 'allow';
}

/**
 * Evaluate an event using a Tripwire rulepack and return a decision.
 * @param {TripwireEvent} evt
 * @param {Object} rulepack
 * @param {(findings:Array<Object>)=>TripwireDecision=} decisionPolicy
 * @returns {TripwireResult}
 */
export function evaluateWithDecision(evt, rulepack, decisionPolicy = defaultDecisionPolicy) {
  const findings = evalEvent(evt, rulepack);
  const decision = decisionPolicy(findings);
  return {
    event_id: hashEvent(evt),
    decision,
    findings,
  };
}

/**
 * Wrap a Mesh capability/tool.
 *
 * Usage pattern (pseudo Mesh):
 *
 *   const wrapped = wrapCapability({
 *     rulepack,
 *     capability: 'wallet_sign',
 *     toolFn: mesh.wallet.sign,
 *     buildEvent: ({args, intent}) => ({ ts:new Date().toISOString(), kind:'tool_call', tool:'wallet_sign', text:intent, meta:{args} })
 *   })
 *
 *   const out = await wrapped({args, intent, approve: async()=>true })
 *
 * Contract:
 * - If decision=allow => execute
 * - If require_approval => call `approve({result})`, execute only if approved
 * - If deny => throw
 */
export function wrapCapability({ rulepack, capability, toolFn, buildEvent, decisionPolicy }) {
  if (!rulepack) throw new Error('wrapCapability requires rulepack');
  if (!capability) throw new Error('wrapCapability requires capability');
  if (typeof toolFn !== 'function') throw new Error('wrapCapability requires toolFn');
  if (typeof buildEvent !== 'function') throw new Error('wrapCapability requires buildEvent');

  return async function wrappedCall(input) {
    const evt = buildEvent(input);
    const result = evaluateWithDecision(evt, rulepack, decisionPolicy);

    if (result.decision === 'deny') {
      const top = result.findings[0];
      const msg = top?.title ? `${top.title}: ${top.why}` : 'Tripwire denied action';
      const err = new Error(msg);
      err.tripwire = result;
      throw err;
    }

    if (result.decision === 'require_approval') {
      const approve = input?.approve;
      if (typeof approve !== 'function') {
        const err = new Error('Tripwire requires approval but no approve() handler was provided');
        err.tripwire = result;
        throw err;
      }
      const ok = await approve({ capability, result, event: evt });
      if (!ok) {
        const err = new Error('Action not approved');
        err.tripwire = result;
        throw err;
      }
    }

    return toolFn(input);
  };
}
