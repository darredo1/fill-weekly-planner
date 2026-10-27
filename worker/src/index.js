const ALLOWED_ORIGINS = new Set([
  "https://darredo1.github.io",
  "http://localhost:8000",
]);

const GUIDANCE_URL = "https://darredo1.github.io/fill-weekly-planner/data/planner-guidance.json";
const GUIDANCE_CACHE_TTL_SECONDS = 300;
const MAX_CAN_DO_LENGTH = 500;
const MAX_CHECKS_PER_SESSION_AREA = 3;
const SESSION_LIMIT_TTL_SECONDS = 60 * 60 * 2;
const MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_VERSION = "2023-06-01";
const TELEMETRY_PATH = "/telemetry";
const TELEMETRY_EVENTS = new Set([
  "planner_open",
  "step_completed",
  "export_copied",
  "export_downloaded",
  "ai_feedback_requested",
  "ai_feedback_completed",
]);

const FEEDBACK_TOOL = {
  name: "submit_feedback",
  description:
    "Structured feedback on a student's can-do statement, evaluated against this learning area's self-check questions.",
  input_schema: {
    type: "object",
    properties: {
      checks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            verdict: { type: "string", enum: ["pass", "needs_work"] },
            note: { type: "string", description: "One concrete sentence explaining the verdict." },
          },
          required: ["question", "verdict", "note"],
        },
      },
      overall: { type: "string", enum: ["pass", "needs_work", "off_topic"] },
    },
    required: ["checks", "overall"],
  },
};

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") return handlePreflight(origin);
    if (new URL(request.url).pathname === TELEMETRY_PATH) {
      return handleTelemetry(request, env, ctx, origin);
    }
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
    if (!ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed" }, 403, origin);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, origin);
    }

    const { areaId, canDoText, sessionId } = body || {};
    const validationError = validateInput(areaId, canDoText, sessionId);
    if (validationError) return json({ error: validationError }, 400, origin);

    const trimmed = canDoText.trim();
    const rateLimitKey = `ratelimit:${sessionId}:${areaId}`;
    const priorCount = Number((await env.RATE_LIMIT_KV.get(rateLimitKey)) || "0");
    if (priorCount >= MAX_CHECKS_PER_SESSION_AREA) {
      return json(
        {
          error: "You've used all your checks for this area this session.",
          checksRemaining: 0,
          checksMax: MAX_CHECKS_PER_SESSION_AREA,
        },
        429,
        origin
      );
    }

    let guidance;
    try {
      guidance = await getGuidance(ctx);
    } catch {
      return json({ error: "Guidance library is unavailable right now." }, 502, origin);
    }
    const area = (guidance.areas || []).find((a) => a.id === areaId) || null;
    if (!area) return json({ error: "Unknown areaId" }, 400, origin);

    let feedback;
    try {
      feedback = await getFeedback(area, guidance.feedback_guidance, trimmed, env);
    } catch (error) {
      return json({ error: "Feedback service failed. Try again shortly." }, 502, origin);
    }

    await env.RATE_LIMIT_KV.put(rateLimitKey, String(priorCount + 1), {
      expirationTtl: SESSION_LIMIT_TTL_SECONDS,
    });

    return json(
      { feedback, checksRemaining: MAX_CHECKS_PER_SESSION_AREA - priorCount - 1, checksMax: MAX_CHECKS_PER_SESSION_AREA },
      200,
      origin
    );
  },
};

async function handleTelemetry(request, env, ctx, origin) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed" }, 403, origin);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, origin);
  }

  const validationError = validateTelemetry(body);
  if (validationError) return json({ error: validationError }, 400, origin);

  // Analytics Engine receives only the allowlisted event name and, where
  // applicable, the wizard step. Do not add IP-derived, session, plan, or
  // student fields here.
  if (!env.TELEMETRY || typeof env.TELEMETRY.writeDataPoint !== "function") {
    return json({ error: "Telemetry is unavailable" }, 503, origin);
  }
  const point = {
    blobs: [body.event],
    doubles: [body.step ?? 0],
  };
  try {
    const write = env.TELEMETRY.writeDataPoint(point);
    if (write && typeof write.then === "function") ctx.waitUntil(write);
  } catch {
    return json({ error: "Telemetry is unavailable" }, 503, origin);
  }
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function validateTelemetry(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Invalid telemetry body";
  const keys = Object.keys(body);
  if (!keys.every((key) => key === "event" || key === "step")) return "Unexpected telemetry field";
  if (!TELEMETRY_EVENTS.has(body.event)) return "Unknown telemetry event";
  if (body.step !== undefined && (!Number.isInteger(body.step) || body.step < 1 || body.step > 5)) {
    return "Invalid telemetry step";
  }
  if (body.event === "step_completed" && body.step === undefined) return "step is required for step_completed";
  if (body.event !== "step_completed" && body.step !== undefined) return "step is only allowed for step_completed";
  return null;
}

function validateInput(areaId, canDoText, sessionId) {
  if (typeof areaId !== "string" || !areaId) return "areaId is required";
  if (typeof canDoText !== "string" || !canDoText.trim()) return "canDoText is required";
  if (canDoText.trim().length > MAX_CAN_DO_LENGTH) return `canDoText exceeds ${MAX_CAN_DO_LENGTH} characters`;
  if (typeof sessionId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) return "Invalid sessionId";
  return null;
}

async function getGuidance(ctx) {
  const cache = caches.default;
  const cacheKey = new Request(GUIDANCE_URL);
  let response = await cache.match(cacheKey);

  if (!response) {
    const upstream = await fetch(GUIDANCE_URL);
    if (!upstream.ok) throw new Error(`Guidance fetch failed: ${upstream.status}`);
    response = new Response(upstream.body, upstream);
    response.headers.set("Cache-Control", `max-age=${GUIDANCE_CACHE_TTL_SECONDS}`);
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return response.json();
}

async function getFeedback(area, feedbackGuidance, canDoText, env) {
  const systemPrompt = buildSystemPrompt(area, feedbackGuidance);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: "user", content: canDoText }],
      tools: [FEEDBACK_TOOL],
      tool_choice: { type: "tool", name: "submit_feedback" },
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  const toolUse = (data.content || []).find((block) => block.type === "tool_use" && block.name === "submit_feedback");
  if (!toolUse) throw new Error("Model did not return structured feedback");
  return toolUse.input;
}

function buildSystemPrompt(area, feedbackGuidance) {
  const extraRules = Array.isArray(area.feedback_rules) && area.feedback_rules.length
    ? `\n\nAdditional guidance for this area:\n${area.feedback_rules.map((rule) => `- ${rule}`).join("\n")}`
    : "";

  const fg = feedbackGuidance || {};
  const writingCriteria = Array.isArray(fg.writing_criteria) && fg.writing_criteria.length
    ? `\n\nWhat makes a can-do statement good, in general (use this to judge tone and flag issues the self-check questions below don't already cover):\n${fg.writing_criteria.map((c) => `- ${c}`).join("\n")}`
    : "";
  const commonPitfall = fg.common_pitfall ? `\n\nCommon weak pattern to watch for: ${fg.common_pitfall}` : "";
  const levelDescriptions = fg.proficiency_notes?.target_level_descriptions
    ? Object.entries(fg.proficiency_notes.target_level_descriptions)
        .map(([level, desc]) => `- ${level}: ${desc}`)
        .join("\n")
    : "";
  const proficiencySection = levelDescriptions
    ? `\n\nThis course targets ${fg.target_level || "novice"}-level proficiency. What that looks like:\n${levelDescriptions}${fg.proficiency_notes?.above_target_note ? `\n${fg.proficiency_notes.above_target_note}` : ""}`
    : "";

  return [
    "You are a writing coach for a single language-learning area in a student weekly planner.",
    "You give brief, specific feedback on ONE student-authored can-do statement. You never write, rewrite, or suggest replacement wording for the statement — the student must author every word of their own plan.",
    "",
    `Area: ${area.label}`,
    `Description: ${area.description}`,
    `Strong examples: ${(area.strong_examples || []).join(" | ")}`,
    `Weak examples: ${(area.weak_examples || []).join(" | ")}`,
    `Self-check questions: ${(area.self_checks || []).join(" | ")}`,
    extraRules,
    writingCriteria,
    commonPitfall,
    proficiencySection,
    "",
    "Rules:",
    "- Evaluate the statement against each self-check question. For each, give a verdict of pass or needs_work plus one concrete sentence why.",
    "- Use the general writing-criteria and proficiency-level guidance above to inform the wording of your notes (e.g. flag a statement that describes Intermediate-level ability as more ambitious than this course expects), but still report exactly one verdict per self-check question — do not add extra checks.",
    "- If the statement is off-topic, empty of meaning, or not related to language learning, set overall to off_topic and explain briefly in the notes instead of scoring the checks.",
    "- Never output a replacement or improved version of the statement, even as an example.",
    "- Be concrete, not encouraging filler. No praise padding.",
    "- Always respond using the submit_feedback tool.",
  ].join("\n");
}

function handlePreflight(origin) {
  if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
    },
  });
}

export { validateTelemetry };

function corsHeaders(origin) {
  return origin && ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {};
}

function json(payload, status, origin) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      ...corsHeaders(origin),
    },
  });
}
