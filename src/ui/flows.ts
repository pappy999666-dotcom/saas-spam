/**
 * Interactive flow framework (spec §10, §51).
 *
 * Multi-step flows (create group, configure settings) are state machines with
 * bounded steps, timeouts, explicit Skip, and cancel — a user can never be
 * trapped in a stale interactive session. Steps declare their input type; the
 * framework validates, re-prompts once on invalid input, and expires cleanly.
 */

import type { CardButton, ResponseCard } from "./renderer.js";
import { renderCard } from "./renderer.js";

export type FlowInputType = "text" | "number" | "media" | "choice";

export interface FlowStep {
  id: string;
  prompt: string;
  input: FlowInputType;
  /** Optional choices for `choice` steps (rendered as native buttons where possible). */
  choices?: Array<{ id: string; label: string; value?: string }>;
  optional?: boolean;
  /** Validate/normalize raw input; throw to trigger one bounded re-prompt. */
  validate?: (raw: string) => string;
  /** Max characters accepted for text inputs. */
  maxLength?: number;
}

export interface FlowDefinition {
  id: string;
  title: string;
  steps: FlowStep[];
  /** Default 90s per step. */
  stepTimeoutMs?: number;
}

export interface FlowState {
  definitionId: string;
  sessionId: string;
  chatJid: string;
  currentStepIndex: number;
  answers: Record<string, string>;
  invalidCountForStep: number;
  expiresAt: number;
}

const MAX_INVALID_ATTEMPTS = 2;
export const FLOW_DEFAULT_STEP_TIMEOUT_MS = 90_000;

export function startFlow(definition: FlowDefinition, sessionId: string, chatJid: string, now = Date.now()): FlowState {
  return {
    definitionId: definition.id,
    sessionId,
    chatJid,
    currentStepIndex: 0,
    answers: {},
    invalidCountForStep: 0,
    expiresAt: now + (definition.stepTimeoutMs ?? FLOW_DEFAULT_STEP_TIMEOUT_MS),
  };
}

export function currentStep(definition: FlowDefinition, state: FlowState): FlowStep | undefined {
  return definition.steps[state.currentStepIndex];
}

export function isExpired(state: FlowState, now = Date.now()): boolean {
  return state.expiresAt <= now;
}

export type FlowAdvanceResult =
  | { kind: "step"; card: ResponseCard; state: FlowState }
  | { kind: "complete"; state: FlowState }
  | { kind: "invalid"; card: ResponseCard; state: FlowState }
  | { kind: "expired"; card: ResponseCard }
  | { kind: "cancelled" };

export function flowPromptCard(definition: FlowDefinition, state: FlowState): ResponseCard {
  const step = definition.steps[state.currentStepIndex]!;
  const buttons: CardButton[] = [];
  if (step.optional) buttons.push({ id: `flow:skip:${definition.id}:${state.currentStepIndex}`, text: "Skip", style: "neutral" });
  buttons.push({ id: `flow:cancel:${definition.id}`, text: "Cancel", style: "cancel" });
  return {
    kind: "status",
    title: definition.title,
    headline: step.prompt,
    rows: Object.entries(state.answers).map(([label, value]) => ({ label, value })),
    ...(step.optional ? { footer: "This input is optional." } : {}),
    buttons,
  };
}

export function advanceFlow(
  definition: FlowDefinition,
  state: FlowState,
  input: string | { choiceId: string },
  now = Date.now(),
): FlowAdvanceResult {
  if (isExpired(state, now))
    return { kind: "expired", card: renderCard.error(definition.title, "This flow expired. Start again when ready.", { next: [definition.id] }) };

  const step = definition.steps[state.currentStepIndex];
  if (!step) return { kind: "complete", state };

  // Skip on optional steps.
  if (typeof input === "object" && "choiceId" in input && input.choiceId === "__skip__") {
    if (!step.optional) return invalid(definition, state, step, "This step is required.");
    return next(definition, state, "", now);
  }

  const raw = typeof input === "string" ? input.trim() : input.choiceId;

  if (step.maxLength !== undefined && raw.length > step.maxLength)
    return invalid(definition, state, step, `Too long — maximum ${step.maxLength} characters.`);

  if (step.input === "number" && !/^\d+$/u.test(raw))
    return invalid(definition, state, step, "Enter a number.");

  if (step.input === "choice") {
    const match = step.choices?.find((choice) => choice.id === raw);
    if (!match) return invalid(definition, state, step, "Choose one of the options.");
    return next(definition, state, match.value ?? match.id, now);
  }

  if (step.validate) {
    try {
      return next(definition, state, step.validate(raw), now);
    } catch (error) {
      return invalid(definition, state, step, error instanceof Error ? error.message : "Invalid input.");
    }
  }

  return next(definition, state, raw, now);
}

function invalid(definition: FlowDefinition, state: FlowState, step: FlowStep, message: string): FlowAdvanceResult {
  const invalidCount = state.invalidCountForStep + 1;
  if (invalidCount > MAX_INVALID_ATTEMPTS)
    return {
      kind: "expired",
      card: renderCard.error(definition.title, "Too many invalid inputs — flow ended.", { next: [definition.id] }),
    };
  return {
    kind: "invalid",
    card: {
      ...flowPromptCard(definition, state),
      kind: "error",
      headline: `${message}\n\n${step.prompt}`,
    },
    state: { ...state, invalidCountForStep: invalidCount },
  };
}

function next(definition: FlowDefinition, state: FlowState, answer: string, now: number): FlowAdvanceResult {
  const step = definition.steps[state.currentStepIndex]!;
  const nextState: FlowState = {
    ...state,
    currentStepIndex: state.currentStepIndex + 1,
    answers: { ...state.answers, [step.id]: answer },
    invalidCountForStep: 0,
    expiresAt: now + (definition.stepTimeoutMs ?? FLOW_DEFAULT_STEP_TIMEOUT_MS),
  };
  if (nextState.currentStepIndex >= definition.steps.length) return { kind: "complete", state: nextState };
  return { kind: "step", card: flowPromptCard(definition, nextState), state: nextState };
}

export function cancelFlow(): FlowAdvanceResult {
  return { kind: "cancelled" };
}
