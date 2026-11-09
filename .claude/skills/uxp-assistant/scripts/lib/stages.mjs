import { contextEvidenceAsk, designAsk, feasibilityAsk, runtimeAsk, validationAsk } from "./ask.mjs";
import { discoverDesignSkills } from "./design-skill.mjs";
import { contextEvidence, runtimeOffer } from "./runtime.mjs";

/**
 * Questions that have to be answered before a file is written.
 * continue is only valid when the fresh pages already name the goal.
 */
export function stageDecision({ choice, capability, pages, behaviors, goal, context, skillRoots, skipDesign = [], cepHybrid = false }) {
  if (!choice("feasibility")) return { action: "ask", ask: feasibilityAsk(capability) };
  if (capability.state !== "awaiting-agent-implementation") {
    if (choice("feasibility") === "continue") {
      return {
        action: "reject-continue",
        say: "continue is not offered. The fresh pages do not establish this goal. No files were written."
      };
    }
    return { action: "hold-state" };
  }
  if (choice("feasibility") !== "continue") return { action: "stop", say: "Stopped before any edit." };

  const contextCheck = contextEvidence(pages, context);
  if (!contextCheck.confirmed) {
    const picked = choice("context-evidence");
    if (!picked) return { action: "ask", ask: contextEvidenceAsk(contextCheck) };
    if (picked === "stop") return { action: "stop", say: "Stopped. The context was not confirmed by a fresh page." };
    if (picked !== "keep-unverified") {
      return { action: "stop", say: "The context answer was not keep-unverified. No files were written." };
    }
  }

  const offer = runtimeOffer({ pages, behaviors, goal, cepHybrid });
  const runtime = choice("runtime");
  if (!runtime) return { action: "ask", ask: runtimeAsk(offer) };
  if (runtime === "refresh") return { action: "refresh-docs", say: "The docs are not fresh enough to choose a runtime. Refresh them before any edit." };
  if (runtime === "stop") return { action: "stop", say: "Stopped before any edit." };
  if (!offer.choices.some((item) => item.id === runtime)) {
    return { action: "reject-runtime", say: `${runtime} was not offered. ${offer.gaps.join(" ")} No files were written.`, offer };
  }

  const discovery = discoverDesignSkills(skillRoots, { skip: skipDesign });
  const design = choice("design");
  if (!design) return { action: "ask", ask: designAsk(discovery) };
  const allowed = new Set(["uxp-constraints", ...discovery.skills.map((item) => item.id)]);
  if (!allowed.has(design)) {
    return {
      action: "reject-design",
      say: `${design} is not an available design source. ${discovery.example.note} No files were written.`,
      discovery
    };
  }
  if (!choice("validation")) return { action: "ask", ask: validationAsk() };
  if (choice("validation") !== "commands") return { action: "stop", say: "Stopped before any edit. Validation was not set to recorded commands." };

  const selected = discovery.skills.find((item) => item.id === design) || null;
  return {
    action: "proceed",
    runtime,
    design: {
      id: design,
      skill: selected,
      example: discovery.example,
      latest: false
    },
    discovery,
    offer,
    contextCheck
  };
}
