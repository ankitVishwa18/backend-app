const OpenAI = require("openai");

const STATUS_VALUES = [
  "pending",
  "recurring",
  "paid",
  "renewal",
  "cancelled",
  "trial",
  "unknown",
];

function normalizeStatus(status) {
  const value = String(status || "unknown").toLowerCase();
  return STATUS_VALUES.includes(value) ? value : "unknown";
}

function buildSummary(subscriptions) {
  return {
    total: subscriptions.length,
    pending: subscriptions.filter((item) => item.status === "pending").length,
    recurring: subscriptions.filter((item) => item.status === "recurring")
      .length,
    paid: subscriptions.filter((item) => item.status === "paid").length,
    renewal: subscriptions.filter((item) => item.status === "renewal").length,
    cancelled: subscriptions.filter((item) => item.status === "cancelled")
      .length,
    trial: subscriptions.filter((item) => item.status === "trial").length,
  };
}

function extractMerchant(from) {
  if (!from) return "";
  return String(from).split("<")[0].replace(/\"/g, "").trim();
}

function heuristicStatus(text) {
  const normalized = text.toLowerCase();

  if (
    normalized.includes("past due") ||
    normalized.includes("due") ||
    normalized.includes("failed payment")
  ) {
    return "pending";
  }

  if (normalized.includes("renew") || normalized.includes("auto-renew")) {
    return "renewal";
  }

  if (
    normalized.includes("recurring") ||
    normalized.includes("monthly") ||
    normalized.includes("annual")
  ) {
    return "recurring";
  }

  if (
    normalized.includes("paid") ||
    normalized.includes("payment received") ||
    normalized.includes("receipt")
  ) {
    return "paid";
  }

  if (normalized.includes("cancelled") || normalized.includes("canceled")) {
    return "cancelled";
  }

  if (normalized.includes("trial")) {
    return "trial";
  }

  return "unknown";
}

function heuristicFilter(emails) {
  const subscriptionKeywords = [
    "subscription",
    "renew",
    "renewal",
    "recurring",
    "invoice",
    "bill",
    "receipt",
    "payment",
    "plan",
    "membership",
    "due",
    "trial",
  ];

  const subscriptions = emails
    .filter((mail) => {
      const haystack =
        `${mail.subject} ${mail.snippet} ${mail.from}`.toLowerCase();
      return subscriptionKeywords.some((keyword) => haystack.includes(keyword));
    })
    .map((mail) => {
      const text = `${mail.subject} ${mail.snippet}`;
      return {
        id: mail.id || "",
        subject: mail.subject || "",
        from: mail.from || "",
        date: mail.date || "",
        snippet: mail.snippet || "",
        merchant: extractMerchant(mail.from),
        status: heuristicStatus(text),
        amount: "",
        currency: "",
        next_billing_date: "",
        confidence: 0.55,
        reason: "Heuristic fallback classification",
      };
    });

  return {
    subscriptions,
    summary: buildSummary(subscriptions),
    ai_used: false,
    model_used: null,
  };
}

function buildPrompt(emails) {
  return `You are an email finance classifier.
Return only JSON in this exact shape:
{
  "subscriptions": [
    {
      "id": "string",
      "subject": "string",
      "from": "string",
      "date": "string",
      "snippet": "string",
      "merchant": "string",
      "status": "pending|recurring|paid|renewal|cancelled|trial|unknown",
      "amount": "string",
      "currency": "string",
      "next_billing_date": "string",
      "confidence": 0,
      "reason": "string"
    }
  ]
}
Rules:
- Include only subscription or billing related emails.
- Focus on statuses: pending, recurring, paid, renewal.
- If uncertain, use unknown.
- Keep confidence between 0 and 1.
- Keep fields short and precise.
Input emails JSON:
${JSON.stringify(emails)}`;
}

async function classifyWithModel(client, model, emails) {
  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You extract structured subscription billing info from emails.",
      },
      {
        role: "user",
        content: buildPrompt(emails),
      },
    ],
  });

  const raw = response.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(raw);

  const subscriptions = Array.isArray(parsed.subscriptions)
    ? parsed.subscriptions.map((item) => ({
        id: item.id || "",
        subject: item.subject || "",
        from: item.from || "",
        date: item.date || "",
        snippet: item.snippet || "",
        merchant: item.merchant || "",
        status: normalizeStatus(item.status),
        amount: item.amount || "",
        currency: item.currency || "",
        next_billing_date: item.next_billing_date || "",
        confidence: Number(item.confidence || 0),
        reason: item.reason || "",
      }))
    : [];

  return {
    subscriptions,
    summary: buildSummary(subscriptions),
    ai_used: true,
    model_used: model,
  };
}

async function classifySubscriptionEmailsWithAI(emails) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      ...heuristicFilter(emails),
      warning: "OPENAI_API_KEY is missing. Used heuristic fallback.",
    };
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const models = [
    process.env.OPENAI_MODEL,
    "gpt-4o-mini",
    "gpt-4.1-mini",
    "gpt-4o",
  ].filter(Boolean);

  let lastError = null;

  for (const model of models) {
    try {
      return await classifyWithModel(client, model, emails);
    } catch (error) {
      lastError = error;
      const isModelAccessError =
        error?.code === "model_not_found" ||
        (error?.message || "").includes("does not have access to model");

      if (!isModelAccessError) {
        break;
      }
    }
  }

  return {
    ...heuristicFilter(emails),
    warning: `AI classification unavailable (${lastError?.message || "unknown error"}). Used heuristic fallback.`,
  };
}

module.exports = {
  classifySubscriptionEmailsWithAI,
};
