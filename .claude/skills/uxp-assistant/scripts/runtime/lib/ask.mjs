/** The first question is always mode. A skill adds the rest through its extension. */

export function modeAsk() {
  return {
    id: "mode",
    title: "How to follow this session",
    prompt: "How do you want to follow this session? The dashboard opens on this computer. Chat keeps the questions in the conversation.",
    options: [
      { id: "dashboard", label: "Live dashboard (Recommended)", detail: "Opens a loopback page. Progress and decisions are there." },
      { id: "chat", label: "Stay in chat", detail: "No page opens." }
    ]
  };
}

export function planAll(extra = []) {
  return [modeAsk(), ...extra.filter((item) => item && item.id !== "mode")];
}
