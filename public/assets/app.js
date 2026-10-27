(() => {
  "use strict";

  const STORAGE_KEY = "fill-weekly-planner-v3";
  const REQUIRED_AREA = "interpersonal-speaking-listening";
  const TOTAL_STEPS = 5;

  // Keep this in sync with the connect-src entry in index.html's CSP meta tag,
  // and with worker/README.md. Feedback is hidden entirely until this is set
  // to a real deployed worker URL.
  const FEEDBACK_ENDPOINT = "https://fill-weekly-planner-feedback.darredo1.workers.dev";
  const FEEDBACK_ENABLED = !FEEDBACK_ENDPOINT.includes("REPLACE-WITH");
  // Keep telemetry off until the Cloudflare handling/retention review and
  // preview release gate are complete. This is independent of feedback.
  const TELEMETRY_ENDPOINT = `${FEEDBACK_ENDPOINT}/telemetry`;
  const TELEMETRY_ENABLED = false;
  const FEEDBACK_SESSION_KEY = "fill-weekly-planner-feedback-session-v1";
  const MAX_CAN_DO_LENGTH = 500;
  const MAX_CHECKS_PER_SESSION_AREA = 3;
  const feedbackCache = new Map();
  let checksRemainingByArea = new Map();
  let lastAreaSignature = null;
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
  const completedSteps = new Set();

  init();

  async function init() {
    try {
      const response = await fetch("data/planner-guidance.json");
      if (!response.ok) throw new Error("Guidance could not load.");
      content = await response.json();
      buildChoices();
      renderLearningPlanStages();
      restore();
      bindEvents();
      render();
      track("planner_open");
    } catch (error) {
      status.textContent = "The planning guidance could not load. Refresh the page or contact your instructor.";
      nextButton.disabled = true;
    }
  }

  function bindEvents() {
    form.addEventListener("input", (event) => {
      restored.exportText = event.target === exportText ? exportText.value : "";
      save();
    });
    form.addEventListener("change", (event) => {
      restored.exportText = event.target === exportText ? exportText.value : "";
      save();
      renderDependentContent();
    });
    nextButton.addEventListener("click", next);
    backButton.addEventListener("click", () => goTo(currentStep - 1));
    resetButton.addEventListener("click", reset);
    document.querySelector("#copy-export").addEventListener("click", copyExport);
    document.querySelector("#download-export").addEventListener("click", downloadExport);
  }

  function buildChoices() {
    const root = document.querySelector("#area-choice-cards");
    const counter = document.querySelector("#area-counter");
    content.areas.forEach((area) => {
      const isRequired = area.id === REQUIRED_AREA;
      const card = element("article", `area-choice-card${isRequired ? " locked" : ""}`);
      const header = document.createElement("label");
      header.className = "area-choice-header";
      const input = document.createElement("input");
      input.type = "checkbox";
      if (isRequired) {
        input.checked = true;
        input.disabled = true;
      } else {
        input.name = "areas";
        input.value = area.id;
      }
      header.append(input, element("span", "area-choice-name", area.label));
      if (isRequired) header.append(element("span", "required-tag", "required"));
      card.append(header);
      card.append(element("p", "area-choice-definition", area.learner_friendly_definition || area.description));
      const list = document.createElement("ul");
      list.className = "area-choice-examples";
      (area.novice_examples || []).forEach((example) => list.append(element("li", "", example)));
      card.append(list);
      root.append(card);
      if (isRequired) root.append(counter);
    });
  }

  function renderLearningPlanStages() {
    document.querySelector("#plan-approaches-intro").textContent = content.learning_plan_intro || "";
    const root = document.querySelector("#learning-plan-stages");
    content.learning_plan_stages.forEach((stage) => {
      const section = element("article", "plan-stage");
      section.append(element("p", "stage-day-range", stage.day_range));
      section.append(element("h3", "", stage.title));
      section.append(element("p", "", stage.description));
      const list = document.createElement("ul");
      stage.activities.forEach((activity) => list.append(element("li", "", activity)));
      section.append(list);
      section.append(element("p", "brainstorm-prompt", stage.brainstorm_prompt));
      const label = document.createElement("label");
      label.className = "plan-stage-field";
      label.append(document.createTextNode(stage.field_prompt));
      const textarea = document.createElement("textarea");
      textarea.name = stage.field_name;
      textarea.required = true;
      textarea.rows = 3;
      label.append(textarea);
      section.append(label);
      root.append(section);
    });
  }

  function selectedAreas() {
    return [REQUIRED_AREA, ...[...form.querySelectorAll('input[name="areas"]:checked')].map((input) => input.value)];
  }

  function renderDependentContent() {
    const extra = selectedAreas().length - 1;
    const areaInputs = [...form.querySelectorAll('input[name="areas"]')];
    areaInputs.forEach((input) => { input.disabled = extra >= 2 && !input.checked; });
    document.querySelector("#area-counter").textContent = extra === 2
      ? "Two additional areas selected."
      : extra > 2
        ? "Choose only two additional areas."
        : `Choose ${2 - extra === 2 ? "two" : 2 - extra} additional area${2 - extra === 1 ? "" : "s"}.`;
    renderPlanRecap();
    // Only rebuild the area cards (and the "Check my can-do" buttons inside
    // them) when the selected areas actually change. This handler fires on
    // every form change, including edits inside the cards themselves; a
    // full rebuild on every keystroke-commit would replace a card's own
    // button out from under an in-progress click on it.
    const signature = selectedAreas().join(",");
    if (signature !== lastAreaSignature) {
      lastAreaSignature = signature;
      renderAreaGuidance();
    }
  }

  function renderPlanRecap() {
    const root = document.querySelector("#plan-recap");
    root.replaceChildren();
    root.append(element("strong", "", "My three goals for this week"));
    const list = document.createElement("ul");
    selectedAreas().map(areaById).filter(Boolean).forEach((area) => {
      const text = (form.elements[`canDo__${area.id}`]?.value || restored[`canDo__${area.id}`] || "").trim();
      list.append(element("li", "", `${area.label}: ${text || "Not written yet."}`));
    });
    root.append(list);
  }

  function renderAreaGuidance() {
    const root = document.querySelector("#area-guidance");
    const prior = new Map([...root.querySelectorAll("textarea")].map((node) => [node.name, node.value]));
    root.replaceChildren();
    selectedAreas().map(areaById).filter(Boolean).forEach((area) => {
      const card = element("article", "area-card");
      card.append(element("h3", "", area.label), element("p", "", area.description));
      card.append(exampleGroup("Strong can-do statements", area.strong_examples, "strong"));
      card.append(exampleGroup("Weak can-do statements", area.weak_examples, "weak"));
      card.append(element("strong", "", "Self-check before writing"));
      const checks = document.createElement("ul");
      area.self_checks.forEach((check) => checks.append(element("li", "", check)));
      card.append(checks);
      const label = document.createElement("label");
      label.className = "can-do";
      label.append(document.createTextNode(`Your can-do goal for ${area.label}`));
      const textarea = document.createElement("textarea");
      textarea.name = `canDo__${area.id}`;
      textarea.required = true;
      textarea.rows = 3;
      textarea.value = prior.get(textarea.name) || restored[textarea.name] || "";
      label.append(textarea);
      card.append(label);
      if (FEEDBACK_ENABLED) card.append(buildFeedbackBlock(area, textarea));
      root.append(card);
    });
  }

  function buildFeedbackBlock(area, textarea) {
    const block = element("div", "feedback");
    const header = element("div", "feedback-header");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button secondary feedback-check-button";
    button.textContent = "Check my can-do";
    const badge = element("span", "feedback-badge");
    header.append(button, badge);
    const feedbackStatus = element("p", "feedback-status");
    feedbackStatus.setAttribute("aria-live", "polite");
    const result = element("div", "feedback-result");
    result.hidden = true;
    const flagWrap = element("div", "instructor-flag");
    flagWrap.hidden = true;

    updateChecksUI(area.id, badge, flagWrap);

    const cached = feedbackCache.get(area.id);
    if (cached && cached.text === textarea.value) {
      renderFeedbackResult(result, cached.result);
    }

    button.addEventListener("click", () => checkCanDo(area, textarea, feedbackStatus, result, button, badge, flagWrap));
    block.append(header, feedbackStatus, result, flagWrap);
    return block;
  }

  function updateChecksUI(areaId, badge, flagWrap) {
    const state = checksRemainingByArea.get(areaId) || { remaining: MAX_CHECKS_PER_SESSION_AREA, max: MAX_CHECKS_PER_SESSION_AREA };
    const remaining = state.remaining;
    badge.textContent = `${Math.max(remaining, 0)}/${state.max} checks remaining`;
    if (remaining > 0) {
      flagWrap.hidden = true;
      return;
    }
    flagWrap.hidden = false;
    if (flagWrap.querySelector("input")) return;
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = `instructorFlag__${areaId}`;
    checkbox.checked = restored[`instructorFlag__${areaId}`] === "on";
    label.append(checkbox, document.createTextNode(" I’d like some extra instructor feedback on this can-do statement."));
    flagWrap.append(label);
  }

  async function checkCanDo(area, textarea, statusEl, resultEl, button, badge, flagWrap) {
    const text = textarea.value.trim();
    if (!text) {
      statusEl.textContent = "Write your can-do statement first.";
      return;
    }
    if (text.length > MAX_CAN_DO_LENGTH) {
      statusEl.textContent = `Shorten your statement to ${MAX_CAN_DO_LENGTH} characters or fewer to check it.`;
      return;
    }
    button.disabled = true;
    statusEl.textContent = "Checking…";
    resultEl.hidden = true;
    track("ai_feedback_requested");
    try {
      const response = await fetch(FEEDBACK_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ areaId: area.id, canDoText: text, sessionId: feedbackSessionId() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 429) {
          const priorMax = checksRemainingByArea.get(area.id)?.max || MAX_CHECKS_PER_SESSION_AREA;
          checksRemainingByArea.set(area.id, { remaining: 0, max: data.checksMax || priorMax });
          updateChecksUI(area.id, badge, flagWrap);
          save();
        }
        statusEl.textContent = data.error || "Feedback isn't available right now.";
        return;
      }
      feedbackCache.set(area.id, { text, result: data.feedback });
      track("ai_feedback_completed");
      renderFeedbackResult(resultEl, data.feedback);
      checksRemainingByArea.set(area.id, { remaining: data.checksRemaining, max: data.checksMax || MAX_CHECKS_PER_SESSION_AREA });
      updateChecksUI(area.id, badge, flagWrap);
      statusEl.textContent = "";
      save();
    } catch {
      statusEl.textContent = "Could not reach the feedback service. Your plan is unaffected.";
    } finally {
      button.disabled = false;
    }
  }

  function renderFeedbackResult(root, feedback) {
    root.replaceChildren();
    if (!feedback || feedback.overall === "off_topic") {
      root.append(element("p", "feedback-note", "This doesn't read as a can-do statement yet. Describe what you can actually do."));
      root.hidden = false;
      return;
    }
    const list = document.createElement("ul");
    list.className = "feedback-checks";
    (feedback.checks || []).forEach((check) => {
      const item = element("li", `feedback-check ${check.verdict === "pass" ? "pass" : "needs-work"}`);
      item.append(element("strong", "", check.question));
      item.append(element("p", "", check.note));
      list.append(item);
    });
    root.append(list);
    root.hidden = false;
  }

  function feedbackSessionId() {
    try {
      let id = sessionStorage.getItem(FEEDBACK_SESSION_KEY);
      if (!id) {
        id = crypto.randomUUID();
        sessionStorage.setItem(FEEDBACK_SESSION_KEY, id);
      }
      return id;
    } catch {
      return "no-storage";
    }
  }

  function exampleGroup(title, examples, className) {
    const group = element("section", `example-group ${className}`);
    group.append(element("h4", "", title));
    const list = document.createElement("ul");
    (examples || []).forEach((text) => list.append(element("li", "", text)));
    group.append(list);
    return group;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function areaById(id) { return content.areas.find((area) => area.id === id); }

  function next() {
    if (!validateStep(currentStep)) return;
    recordStepCompletion(currentStep);
    if (currentStep < TOTAL_STEPS) goTo(currentStep + 1);
  }

  function recordStepCompletion(step) {
    if (completedSteps.has(step)) return;
    completedSteps.add(step);
    track("step_completed", step);
  }

  function goTo(step) {
    currentStep = Math.max(1, Math.min(TOTAL_STEPS, step));
    status.textContent = "";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function render() {
    steps.forEach((step) => step.classList.toggle("is-active", Number(step.dataset.step) === currentStep));
    progress.forEach((item, index) => item.classList.toggle("is-current", index + 1 === currentStep));
    backButton.hidden = currentStep === 1;
    nextButton.hidden = currentStep === TOTAL_STEPS;
    nextButton.textContent = currentStep === 4 ? "Review plan" : "Continue";
    renderDependentContent();
    if (currentStep === TOTAL_STEPS) exportText.value = restored.exportText || buildExport();
  }

  function validateStep(step) {
    status.textContent = "";
    if (step === 2 && selectedAreas().length !== 3) {
      status.textContent = "Select exactly two additional learning areas to continue.";
      return false;
    }
    const active = steps.find((item) => Number(item.dataset.step) === step);
    const missing = [...active.querySelectorAll("[required]")].find((field) => !field.value.trim());
    if (missing) {
      status.textContent = "Please complete the required fields before continuing.";
      missing.focus();
      return false;
    }
    if (step === TOTAL_STEPS && !["checkFocused", "checkEvidence", "checkSteps", "checkAuthored"].every((name) => form.elements[name].checked)) {
      status.textContent = "Complete each final self-check before exporting.";
      return false;
    }
    return true;
  }

  function formState() {
    const state = Object.fromEntries(new FormData(form).entries());
    state.selectedAreas = [...form.querySelectorAll('input[name="areas"]:checked')].map((input) => input.value);
    state.exportText = restored.exportText || "";
    state.checksRemainingByArea = Object.fromEntries(checksRemainingByArea);
    return state;
  }

  function save() {
    try {
      restored = { ...formState(), currentStep };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(restored));
    } catch { /* Browser storage is optional. */ }
  }

  function restore() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}");
      restored = saved;
      currentStep = Math.max(1, Math.min(TOTAL_STEPS, Number(saved.currentStep) || 1));
      checksRemainingByArea = new Map(Object.entries(saved.checksRemainingByArea || {}));
      Object.entries(saved).forEach(([name, value]) => {
        if (name === "selectedAreas" || name === "currentStep" || name === "exportText" || name === "checksRemainingByArea") return;
        const fields = form.querySelectorAll(`[name="${CSS.escape(name)}"]`);
        fields.forEach((field) => {
          if (field.type === "checkbox") field.checked = value === field.value || value === "on";
          else field.value = value;
        });
      });
      (saved.selectedAreas || []).forEach((id) => {
        const field = form.querySelector(`input[name="areas"][value="${CSS.escape(id)}"]`);
        if (field) field.checked = true;
      });
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }

  function reset() {
    if (!window.confirm("Reset this session’s plan? This clears the plan from this browser session.")) return;
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(FEEDBACK_SESSION_KEY);
    feedbackCache.clear();
    checksRemainingByArea.clear();
    completedSteps.clear();
    lastAreaSignature = null;
    restored = {};
    form.reset();
    currentStep = 1;
    status.textContent = "Plan reset. Nothing was sent or saved by this site.";
    render();
  }

  function buildExport() {
    const value = (name) => (form.elements[name]?.value || "").trim();
    const flagged = (id) => !!form.elements[`instructorFlag__${id}`]?.checked;
    const canDos = selectedAreas()
      .map((id) => `${flagged(id) ? "*** INSTRUCTOR: PLEASE REVIEW *** " : ""}${areaById(id).label}:\n${value(`canDo__${id}`)}`)
      .join("\n\n");
    return [
      `Student: ${value("studentName")}`, `Course: ${value("course")}`, `Week: ${value("week")}`, `Language: ${value("language")}`,
      `Topic and real-life context\nTopic: ${value("topic")}\nContext: ${value("context")}`,
      `Selected learning areas\n${selectedAreas().map((id) => areaById(id).label).join(", ")}`,
      `Student-authored can-do statements\n${canDos}`,
      `Input plan\n${value("planInput")}`,
      `Interaction and practice plan\n${value("planInteraction")}`,
      `Production plan\n${value("planProduction")}`
    ].join("\n\n");
  }

  async function copyExport() {
    if (!validateStep(TOTAL_STEPS)) return;
    recordStepCompletion(TOTAL_STEPS);
    try {
      await navigator.clipboard.writeText(exportText.value);
      status.textContent = "Copied. Paste this into Canvas.";
      track("export_copied");
    } catch {
      exportText.select();
      document.execCommand("copy");
      status.textContent = "Selected for copying. Use your browser’s copy command if needed.";
    }
  }

  function downloadExport() {
    if (!validateStep(TOTAL_STEPS)) return;
    recordStepCompletion(TOTAL_STEPS);
    const text = exportText.value || buildExport();
    const blob = new Blob([text], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "fill-weekly-plan.txt";
    link.click();
    URL.revokeObjectURL(link.href);
    status.textContent = "Downloaded the same text shown for Canvas.";
    track("export_downloaded");
  }

  function track(event, step) {
    if (!TELEMETRY_ENABLED) return;
    const payload = step === undefined ? { event } : { event, step };
    // Telemetry is deliberately best-effort: an outage must never block
    // navigation, export, storage, or Claude feedback.
    try {
      fetch(TELEMETRY_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    } catch { /* Analytics is optional. */ }
  }
})();
