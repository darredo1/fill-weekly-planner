(() => {
  "use strict";
  const STORAGE_KEY = "fill-weekly-planner-v2";
  const REQUIRED_AREA = "interpersonal-speaking-listening";
  const form = document.querySelector("#planner-form");
  const steps = [...document.querySelectorAll(".wizard-step")];
  const progress = [...document.querySelectorAll(".progress li")];
  const status = document.querySelector("#status");
  const nextButton = document.querySelector("#next-button");
  const backButton = document.querySelector("#back-button");
  const resetButton = document.querySelector("#reset-button");
  const exportText = document.querySelector("#export-text");
  let content;
  let currentStep = 1;
  let restored = {};

  init();

  async function init() {
    try {
      const response = await fetch("data/planner-guidance.json");
      if (!response.ok) throw new Error("Guidance could not load.");
      content = await response.json();
      buildChoices();
      populateStaticGuidance();
      restore();
      bindEvents();
      render();
    } catch (error) {
      status.textContent = "The planning guidance could not load. Refresh the page or contact your instructor.";
      nextButton.disabled = true;
    }
  }

  function bindEvents() {
    form.addEventListener("input", save);
    form.addEventListener("change", () => { save(); renderDependentContent(); });
    nextButton.addEventListener("click", next);
    backButton.addEventListener("click", () => goTo(currentStep - 1));
    resetButton.addEventListener("click", reset);
    document.querySelector("#copy-export").addEventListener("click", copyExport);
    document.querySelector("#download-export").addEventListener("click", downloadExport);
  }

  function buildChoices() {
    const select = document.querySelector("#guidance-range");
    content.modes.forEach((mode) => select.add(new Option(mode.label, mode.id)));
    const choiceRoot = document.querySelector("#area-choices");
    content.areas.filter((area) => area.id !== REQUIRED_AREA).forEach((area) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox"; input.name = "areas"; input.value = area.id;
      label.append(input, document.createTextNode(` ${area.label}`));
      choiceRoot.append(label);
    });
  }

  function populateStaticGuidance() {
    document.querySelector("#evidence-hint").textContent = `Evidence ideas: ${content.evidence_types.join(" · ")}. Choose and describe your own.`;
    document.querySelector("#reflection-hint").textContent = `Reflection prompts: ${content.reflection_prompts.join(" ")}`;
  }

  function selectedAreas() {
    return [REQUIRED_AREA, ...[...form.querySelectorAll('input[name="areas"]:checked')].map((input) => input.value)];
  }

  function renderDependentContent() {
    const mode = content.modes.find((item) => item.id === form.elements.guidanceRange.value);
    const modeNote = document.querySelector("#mode-note");
    modeNote.hidden = !mode;
    modeNote.replaceChildren();
    if (mode) { const title = document.createElement("strong"); title.textContent = mode.label; const text = document.createElement("p"); text.textContent = mode.description; modeNote.append(title, text); }
    const extra = selectedAreas().length - 1;
    document.querySelector("#area-counter").textContent = extra === 2 ? "Two additional areas selected." : `Choose ${2 - extra} additional area${2 - extra === 1 ? "" : "s"}.`;
    renderAreaGuidance();
  }

  function renderAreaGuidance() {
    const root = document.querySelector("#area-guidance");
    const prior = new Map([...root.querySelectorAll("textarea")].map((node) => [node.name, node.value]));
    root.replaceChildren();
    selectedAreas().map(areaById).filter(Boolean).forEach((area) => {
      const card = element("article", "area-card");
      card.append(element("h3", "", area.label), element("p", "", area.description));
      const contrast = element("div", "contrast");
      contrast.append(example("Strong contrast", area.strong_example, "strong"), example("Weak contrast", area.weak_example, "weak"));
      card.append(contrast, element("strong", "", "Self-check before writing"));
      const checks = document.createElement("ul");
      area.self_checks.forEach((check) => checks.append(element("li", "", check)));
      card.append(checks);
      const label = document.createElement("label"); label.className = "can-do"; label.append(document.createTextNode(`Your can-do for ${area.label}`));
      const textarea = document.createElement("textarea"); textarea.name = `canDo__${area.id}`; textarea.required = true; textarea.rows = 3; textarea.value = prior.get(textarea.name) || restored[textarea.name] || "";
      label.append(textarea); card.append(label); root.append(card);
    });
    const cards = content.activity_cards.filter((card) => card.areas.some((area) => selectedAreas().includes(area))).slice(0, 5);
    const section = element("section", "planning-cards"); section.append(element("h3", "", "Planning approaches to adapt"), element("p", "intro", "Use these to think through your activities. They will not fill in any part of your plan."));
    const list = element("div", "card-list"); cards.forEach((card) => { const item = element("article", "planning-card"); item.append(element("h4", "", card.title), element("p", "", card.guidance)); list.append(item); });
    section.append(list); root.append(section);
  }

  function example(title, text, className) { const box = element("div", `example ${className}`); box.append(element("strong", "", title), document.createElement("br"), document.createTextNode(text)); return box; }
  function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; }
  function areaById(id) { return content.areas.find((area) => area.id === id); }

  function next() { if (!validateStep(currentStep)) return; if (currentStep < 4) goTo(currentStep + 1); else status.textContent = "Your Canvas-ready export is below."; }
  function goTo(step) { currentStep = Math.max(1, Math.min(4, step)); status.textContent = ""; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function render() {
    steps.forEach((step) => step.classList.toggle("is-active", Number(step.dataset.step) === currentStep));
    progress.forEach((item, index) => item.classList.toggle("is-current", index + 1 === currentStep));
    backButton.hidden = currentStep === 1; nextButton.hidden = currentStep === 4; nextButton.textContent = currentStep === 3 ? "Review plan" : "Continue";
    renderDependentContent(); if (currentStep === 4) exportText.value = buildExport();
  }

  function validateStep(step) {
    status.textContent = "";
    if (step === 2 && selectedAreas().length !== 3) { status.textContent = "Select exactly two additional learning areas to continue."; return false; }
    const active = steps.find((item) => Number(item.dataset.step) === step);
    const missing = [...active.querySelectorAll("[required]")].find((field) => !field.value.trim());
    if (missing) { status.textContent = "Please complete the required fields before continuing."; missing.focus(); return false; }
    if (step === 4 && !["checkFocused", "checkEvidence", "checkSteps", "checkAuthored"].every((name) => form.elements[name].checked)) { status.textContent = "Complete each final self-check before exporting."; return false; }
    return true;
  }

  function formState() { const state = Object.fromEntries(new FormData(form).entries()); state.selectedAreas = [...form.querySelectorAll('input[name="areas"]:checked')].map((input) => input.value); return state; }
  function save() { try { restored = { ...formState(), currentStep }; sessionStorage.setItem(STORAGE_KEY, JSON.stringify(restored)); } catch { /* Browser storage is optional. */ } }
  function restore() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}"); restored = saved; currentStep = Number(saved.currentStep) || 1;
      Object.entries(saved).forEach(([name, value]) => { if (name === "selectedAreas" || name === "currentStep") return; const fields = form.querySelectorAll(`[name="${CSS.escape(name)}"]`); fields.forEach((field) => { if (field.type === "checkbox") field.checked = value === field.value || value === "on"; else field.value = value; }); });
      (saved.selectedAreas || []).forEach((id) => { const field = form.querySelector(`input[name="areas"][value="${CSS.escape(id)}"]`); if (field) field.checked = true; });
    } catch { sessionStorage.removeItem(STORAGE_KEY); }
  }
  function reset() { if (!window.confirm("Reset this session’s plan? This clears the plan from this browser session.")) return; sessionStorage.removeItem(STORAGE_KEY); restored = {}; form.reset(); currentStep = 1; status.textContent = "Plan reset. Nothing was sent or saved by this site."; render(); }

  function buildExport() {
    const value = (name) => (form.elements[name]?.value || "").trim();
    const canDos = selectedAreas().map((id) => `${areaById(id).label}:\n${value(`canDo__${id}`)}`).join("\n\n");
    return [
      `Student: ${value("studentName")}`, `Course: ${value("course")}`, `Week: ${value("week")}`, `Language: ${value("language")}`,
      `Weekly growth need\n${value("growthNeed")}`, `Topic and real-life context\nTopic: ${value("topic")}\nContext: ${value("context")}`,
      `Selected learning areas\n${selectedAreas().map((id) => areaById(id).label).join(", ")}`, `Student-authored can-do statements\n${canDos}`,
      `Student-authored learning activities\n${value("activities")}`, `Planned artifact/evidence\n${value("evidence")}`, `Strategies and resources\n${value("strategies")}`,
      `First-next-then action plan\n${value("actionPlan")}`, `Carry-forward reflection\n${value("reflection")}`
    ].join("\n\n");
  }
  async function copyExport() { if (!validateStep(4)) return; exportText.value = buildExport(); try { await navigator.clipboard.writeText(exportText.value); status.textContent = "Copied. Paste this into Canvas."; } catch { exportText.select(); document.execCommand("copy"); status.textContent = "Selected for copying. Use your browser’s copy command if needed."; } }
  function downloadExport() { if (!validateStep(4)) return; const text = buildExport(); const blob = new Blob([text], { type: "text/plain" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "fill-weekly-plan.txt"; link.click(); URL.revokeObjectURL(link.href); status.textContent = "Downloaded the same text shown for Canvas."; }
})();

