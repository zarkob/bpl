# BPL Connectivity Rules (Normative)

This document defines the deterministic connection model for BPMN-lite parsing/rendering.

## Goals

- Produce stable graph edges from the same DSL input.
- Avoid hidden side effects (for example lane changes from reference tokens).
- Make edge generation testable through ordered passes.

## Core Concepts

- `sequenceFlow`: control-flow edge between tasks/events/gateways/branches.
- `messageFlow`: dashed message edge between `send` and matching `receive`.
- `dataAssociation`: dashed edge from data object to referenced task.
- `explicit arrow`: inline `->` / `<-` expression in a DSL line.
- `implicit flow`: default sequential connection by document order when no rule blocks it.

## Precedence Order

Edge generation runs in this exact order:

1. Build global task order
2. Implicit sequential edges
3. Explicit arrow edges
4. Message-flow edges
5. Special edges:
   - gateway branch edges
   - branch merge edges
   - process start/end completion
6. Deferred data-association resolution
7. Connection de-duplication (enforced in `addConnection`)

Higher steps do not delete lower-step edges; they only add missing valid edges.

## Deterministic Rules

### R1. Task Order

- Global order is document order of parsed tasks.
- Exclude comments and branch pseudo-nodes from order.
- Keep real task/event/gateway nodes.

### R2. Implicit Sequential

- Connect each ordered task to the next unless:
  - a connection break `---` exists between their source lines, or
  - source is a gateway (gateway fan-out is handled separately).

### R3. Explicit Arrows

- Parse each arrow line into ordered tokens and operators.
- Resolve references using the lane active at that source line.
- `A -> B` adds `A -> B`.
- `A <- B` adds `B -> A`.
- Chained arrows are pairwise (`A -> B -> C` => `A->B`, `B->C`).
- Reference tokens must not be interpreted as structural directives:
  - `@Lane.Task` is a task reference, not a lane declaration.

### R4. Fully Qualified References

- Format: `@Lane.Task` (or `Lane.Task`).
- Resolve in specified lane first.
- If unresolved and qualified, parser may create an implicit task in that lane.

### R5. Gateway Branching

- Gateway connects to each branch node.
- Branch-to-merge connection is auto-created when branch has no explicit outgoing flow.
- Branch type (`+`, `-`, `=`, `~`) affects semantics/styling, not merge eligibility.

### R6. Message Flows

- Match by message name between `send` and `receive`.
- Do not create across connection-break boundaries.

### R7. Start / End Events

- `process_start` connects to first non-start task.
- Any terminal task (no outgoing sequence flow) connects to `process_end` if end exists.
- Never create self-loop start/end edges.

### R8. De-duplication

- Duplicate connection keys are ignored:
  - same `type`, `sourceRef`, `targetRef`, `name`.

## Safety Invariants

- No implicit lane switch from reference parsing.
- No duplicate identical edges.
- No event self-loop for process start/end.
- No orphan subgraph style IDs in Mermaid output.

## Test Contract

The connectivity suite (`test-connectivity.js`) is the executable contract for:

- mid-lane and cross-lane references
- backward and mixed arrows
- FQN references
- gateway + explicit-arrow interaction
- complex event-driven flows
