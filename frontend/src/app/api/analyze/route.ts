import { NextRequest } from "next/server";

export const runtime = "nodejs";

const MODEL = "openrouter/auto";

async function extractText(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) {
    const { extractText } = await import("unpdf");
    const result = await extractText(new Uint8Array(buffer));
    return result.text.join("\n");
  }

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  return buffer.toString("utf-8");
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("cv") as File | null;
  const jobDescription = (formData.get("job_description") as string | null)?.trim();

  if (!file) return Response.json({ error: "No CV file uploaded" }, { status: 400 });
  if (!jobDescription) return Response.json({ error: "Job description is required" }, { status: 400 });

  let cvText: string;
  try {
    cvText = (await extractText(file)).trim();
  } catch (e) {
    return Response.json(
      { error: `Failed to read CV: ${e instanceof Error ? e.message : "Unknown error"}` },
      { status: 400 }
    );
  }

  if (!cvText) {
    return Response.json({ error: "Could not extract text from CV." }, { status: 400 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "API key not configured." }, { status: 500 });
  }

  const prompt = `You are an HR analyst. Compare the CV to the job description and reply with exactly this format, no extra text:

SCORE: [number]/100

WEAKNESSES:
- [weakness]
- [weakness]
- [weakness]

IMPROVEMENTS:
- [specific actionable improvement]
- [specific actionable improvement]
- [specific actionable improvement]

CV:
${cvText.slice(0, 4000)}

JOB:
${jobDescription.slice(0, 2000)}`;

  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "CV Analyzer",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 512,
      stream: true,
    }),
  });

  if (!upstream.ok) {
    const err = await upstream.text();
    return Response.json(
      { error: `API error ${upstream.status}: ${err.slice(0, 300)}` },
      { status: upstream.status }
    );
  }

  // Transform OpenRouter's SSE stream into our simple {"content":"..."} format
  const encoder = new TextEncoder();
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async pull(controller) {
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
              );
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}