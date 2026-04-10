"use client";

import { useRef, useState, useMemo, useEffect, DragEvent, ChangeEvent } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Upload, FileText, X, RotateCcw, AlertTriangle, BrainCircuit, Lightbulb } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type Stage = "idle" | "loading" | "done" | "error";

const LOADING_STEPS = [
  { label: "Reading your CV…",      pct: 15 },
  { label: "Sending to AI…",        pct: 35 },
  { label: "Analyzing match…",      pct: 60 },
  { label: "Generating insights…",  pct: 85 },
];
const STEP_DELAYS = [0, 1500, 3500, 6500]; // ms after analyze() starts

// ── Easing ────────────────────────────────────────────────────────────────

type BezierTuple = [number, number, number, number];
const easeOut: BezierTuple  = [0.25, 0.46, 0.45, 0.94];
const easeBack: BezierTuple = [0.34, 1.56, 0.64, 1];

// ── Parsing (regexes hoisted so they compile once) ─────────────────────────

const SCORE_RE       = /score\s*[:\-]\s*\*{0,2}(\d{1,3})\s*\/\s*100\*{0,2}/i;
const WEAKNESS_RE    = /weaknesses\s*[:\-]?\s*\n([\s\S]*?)(?=\nIMPROVEMENTS|\n[A-Z]{4,}|\n##|$)/i;
const IMPROVEMENT_RE = /improvements?\s*[:\-]?\s*\n([\s\S]*?)(?=\n[A-Z]{4,}|\n##|$)/i;
const BULLET_RE      = /^[-*•\d.]\s*/;

function parseScore(text: string): number | null {
  const m = text.match(SCORE_RE);
  return m ? Math.min(100, Math.max(0, parseInt(m[1], 10))) : null;
}

function parseBullets(text: string, re: RegExp): string[] {
  const section = text.match(re);
  if (!section) return [];
  return section[1]
    .split("\n")
    .map((l) => l.replace(BULLET_RE, "").trim())
    .filter((l) => l.length > 3);
}

function parseWeaknesses(text: string)   { return parseBullets(text, WEAKNESS_RE); }
function parseImprovements(text: string) { return parseBullets(text, IMPROVEMENT_RE); }

// ── Score helpers (single call site) ──────────────────────────────────────

function scoreInfo(score: number): { color: string; label: string; description: string } {
  if (score >= 70) return { color: "#10b981", label: "Strong match",   description: "Great fit — candidate meets most requirements." };
  if (score >= 40) return { color: "#f59e0b", label: "Moderate match", description: "Partial fit — some gaps to address." };
  return               { color: "#ef4444", label: "Low match",      description: "Low fit — significant improvements needed." };
}

// ── Animation variants ─────────────────────────────────────────────────────

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  show:   { opacity: 1, y: 0,  transition: { duration: 0.4, ease: easeOut } },
  exit:   { opacity: 0, y: -10, transition: { duration: 0.25, ease: easeOut } },
};

const stagger: Variants = { show: { transition: { staggerChildren: 0.08 } } };

const listItem: Variants = {
  hidden: { opacity: 0, x: -10 },
  show:   { opacity: 1, x: 0,  transition: { duration: 0.3, ease: easeOut } },
};

// ── SVG Score Ring ─────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const r    = 40;
  const circ = 2 * Math.PI * r;
  const { color } = scoreInfo(score);
  return (
    <div className="relative flex items-center justify-center">
      <svg width="104" height="104" viewBox="0 0 104 104" className="-rotate-90">
        <circle cx="52" cy="52" r={r} fill="none" stroke="currentColor"
          strokeWidth="7" className="text-white/10" />
        <motion.circle cx="52" cy="52" r={r} fill="none" stroke={color}
          strokeWidth="7" strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ * (1 - score / 100) }}
          transition={{ duration: 1.2, ease: easeBack, delay: 0.1 }}
          style={{ filter: `drop-shadow(0 0 8px ${color}88)` }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <motion.span className="text-2xl font-bold tabular-nums leading-none" style={{ color }}
          initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.3, ease: easeBack }}>
          {score}
        </motion.span>
        <span className="text-[10px] text-white/40 mt-0.5">/ 100</span>
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function Home() {
  const [file, setFile]       = useState<File | null>(null);
  const [jobDesc, setJobDesc] = useState("");
  const [stage, setStage]     = useState<Stage>("idle");
  const [rawText, setRawText] = useState("");
  const [error, setError]     = useState("");

  const [loadingStep, setLoadingStep] = useState(0);

  const fileInputRef  = useRef<HTMLInputElement>(null);
  const abortRef      = useRef<AbortController | null>(null);
  const stepTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Ref-based drag tracking avoids 50-100 re-renders/s from dragover events
  const dragCountRef  = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const score        = useMemo(() => parseScore(rawText),       [rawText]);
  const weaknesses   = useMemo(() => parseWeaknesses(rawText),  [rawText]);
  const improvements = useMemo(() => parseImprovements(rawText), [rawText]);

  const canAnalyze = file !== null && jobDesc.trim().length > 10;
  const isAnalyzing = stage === "loading" || stage === "done";

  // Advance loading steps on timers; clear when done
  useEffect(() => {
    if (stage !== "loading") {
      stepTimersRef.current.forEach(clearTimeout);
      stepTimersRef.current = [];
      return;
    }
    setLoadingStep(0);
    stepTimersRef.current = STEP_DELAYS.slice(1).map((delay, i) =>
      setTimeout(() => setLoadingStep(i + 1), delay)
    );
    return () => {
      stepTimersRef.current.forEach(clearTimeout);
      stepTimersRef.current = [];
    };
  }, [stage]);

  // ── File handling ──────────────────────────────────────────────────────

  function handleFile(f: File) {
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "docx", "txt"].includes(ext ?? "")) {
      setError("Unsupported format — use PDF, DOCX, or TXT.");
      return;
    }
    setFile(f);
    setError("");
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCountRef.current = 0;
    setIsDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (dragCountRef.current++ === 0) setIsDragOver(true);
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (--dragCountRef.current === 0) setIsDragOver(false);
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  // ── Analyze ───────────────────────────────────────────────────────────

  async function analyze() {
    if (!file || !jobDesc.trim()) return;

    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStage("loading");
    setRawText("");
    setError("");

    const fd = new FormData();
    fd.append("cv", file);
    fd.append("job_description", jobDesc.trim());

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        body: fd,
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Server error" }));
        throw new Error(err.error);
      }

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6);
          if (raw === "[DONE]") { setStage("done"); return; }
          try {
            const parsed = JSON.parse(raw);
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.content) {
              acc += parsed.content;
              setRawText(acc);
            }
          } catch (e) {
            if (e instanceof Error && e.message !== "Unexpected end of JSON input") throw e;
          }
        }
      }
      setStage("done");
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStage("error");
    }
  }

  function reset() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStage("idle");
    setFile(null);
    setJobDesc("");
    setRawText("");
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background selection:bg-primary/20">

      {/* Header glow */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 h-64 opacity-25"
        style={{ background: "radial-gradient(ellipse 80% 50% at 50% -10%, oklch(0.5 0.15 260 / 0.6), transparent)" }}
      />

      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
              <BrainCircuit className="size-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight">CV Analyzer</p>
              <p className="text-[11px] text-muted-foreground leading-none mt-0.5">Powered by AI</p>
            </div>
          </div>
          <AnimatePresence>
            {isAnalyzing && (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.2 }}>
                <Button variant="ghost" size="sm" onClick={reset}>
                  <RotateCcw className="size-3.5" /> New analysis
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <AnimatePresence>

          {/* ── Form ──────────────────────────────────────────────────── */}
          {!isAnalyzing && (
            <motion.div key="form" variants={fadeUp} initial="hidden" animate="show" exit="exit"
              className="space-y-6">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Analyze your resume</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Upload your CV and paste a job description. AI will score the match and surface gaps.
                </p>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                {/* Drop zone */}
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    Resume / CV
                  </label>
                  <div role="button" tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDragEnter={onDragEnter}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                    className={[
                      "group flex h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed transition-all duration-200",
                      isDragOver   ? "border-primary bg-primary/10 scale-[1.01]"
                        : file    ? "border-primary/40 bg-primary/5"
                        : "border-white/10 hover:border-primary/40 hover:bg-white/[0.03]",
                    ].join(" ")}
                  >
                    <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt"
                      className="hidden" onChange={onFileChange} />
                    <AnimatePresence mode="wait">
                      {file ? (
                        <motion.div key="file" initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ duration: 0.2 }} className="flex w-full items-center gap-3 px-5">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                            <FileText className="size-4 text-primary" />
                          </div>
                          <span className="flex-1 truncate text-sm font-medium">{file.name}</span>
                          <button type="button"
                            onClick={(e) => { e.stopPropagation(); setFile(null); }}
                            className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground">
                            <X className="size-3.5" />
                          </button>
                        </motion.div>
                      ) : (
                        <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
                          className="flex flex-col items-center gap-2 text-center">
                          <div className="flex size-10 items-center justify-center rounded-xl bg-white/5 transition-colors group-hover:bg-white/10">
                            <Upload className="size-4 text-muted-foreground" />
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Drop here or <span className="font-medium text-primary">browse</span>
                          </p>
                          <p className="text-[11px] text-muted-foreground/50">PDF · DOCX · TXT</p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Job description */}
                <div className="space-y-2">
                  <label htmlFor="jobDesc"
                    className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    Job Description
                  </label>
                  <Textarea id="jobDesc" value={jobDesc} onChange={(e) => setJobDesc(e.target.value)}
                    placeholder="Paste the job description here…"
                    className="h-44 resize-none rounded-2xl bg-white/[0.03] text-sm leading-relaxed placeholder:text-muted-foreground/50"
                  />
                </div>
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}
                    className="flex items-center gap-2.5 overflow-hidden rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
                    <AlertTriangle className="size-4 shrink-0" />
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              <Button className="w-full rounded-xl py-5 text-sm font-semibold tracking-wide disabled:opacity-30"
                disabled={!canAnalyze} onClick={analyze}>
                Analyze CV
              </Button>
            </motion.div>
          )}

          {/* ── Results ───────────────────────────────────────────────── */}
          {isAnalyzing && (
            <motion.div key="results" variants={fadeUp} initial="hidden" animate="show"
              className="space-y-4">

              {/* Score card */}
              <AnimatePresence>
                {score !== null && (() => {
                  const { color, label, description } = scoreInfo(score);
                  return (
                    <motion.div key="score" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, ease: easeOut }}>
                      <Card className="overflow-hidden rounded-2xl border-white/[0.08] bg-white/[0.03]">
                        <CardContent className="flex items-center gap-6 py-6">
                          <ScoreRing score={score} />
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-base font-semibold">Match Score</span>
                              <span className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                                style={{ color, backgroundColor: `${color}18`, outline: `1px solid ${color}35` }}>
                                {label}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground">{description}</p>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })()}
              </AnimatePresence>

              {/* Weaknesses card */}
              <AnimatePresence>
                {weaknesses.length > 0 && (
                  <motion.div key="weaknesses" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.1, ease: easeOut }}>
                    <Card className="rounded-2xl border-white/[0.08] bg-white/[0.03]">
                      <CardHeader className="pb-0">
                        <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          Weaknesses &amp; Gaps
                        </CardTitle>
                      </CardHeader>
                      <Separator className="mx-4 mt-3 w-auto opacity-50" />
                      <CardContent className="pt-4">
                        <motion.ul className="space-y-2" variants={stagger} initial="hidden" animate="show">
                          {weaknesses.map((w, i) => (
                            <motion.li key={i} variants={listItem}
                              className="flex items-start gap-3 rounded-xl border border-red-500/15 bg-red-500/[0.07] px-3.5 py-3 text-sm leading-relaxed">
                              <X className="mt-0.5 size-3.5 shrink-0 text-red-400 opacity-80" />
                              <span className="text-foreground/75">{w}</span>
                            </motion.li>
                          ))}
                        </motion.ul>
                      </CardContent>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Improvements card */}
              <AnimatePresence>
                {improvements.length > 0 && (
                  <motion.div key="improvements" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.2, ease: easeOut }}>
                    <Card className="rounded-2xl border-white/[0.08] bg-white/[0.03]">
                      <CardHeader className="pb-0">
                        <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          Suggested Improvements
                        </CardTitle>
                      </CardHeader>
                      <Separator className="mx-4 mt-3 w-auto opacity-50" />
                      <CardContent className="pt-4">
                        <motion.ul className="space-y-2" variants={stagger} initial="hidden" animate="show">
                          {improvements.map((imp, i) => (
                            <motion.li key={i} variants={listItem}
                              className="flex items-start gap-3 rounded-xl border border-blue-500/15 bg-blue-500/[0.07] px-3.5 py-3 text-sm leading-relaxed">
                              <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-blue-400 opacity-80" />
                              <span className="text-foreground/75">{imp}</span>
                            </motion.li>
                          ))}
                        </motion.ul>
                      </CardContent>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Raw response — shown while streaming OR if parsing found nothing */}
              {(stage === "loading" || (stage === "done" && score === null && weaknesses.length === 0 && improvements.length === 0))
                && rawText && (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: easeOut }}>
                  <Card className="rounded-2xl border-white/[0.08] bg-white/[0.03]">
                    <CardHeader className="pb-0">
                      <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        {stage === "loading" ? "Generating…" : "Raw Response"}
                      </CardTitle>
                    </CardHeader>
                    <Separator className="mx-4 mt-3 w-auto opacity-50" />
                    <CardContent className="pt-4">
                      <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/70">
                        {rawText}
                        {stage === "loading" && <span className="animate-pulse">▋</span>}
                      </pre>
                    </CardContent>
                  </Card>
                </motion.div>
              )}

              {/* Progress bar — waiting for first token */}
              {stage === "loading" && !rawText && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="py-16 flex flex-col items-center gap-6">
                  <div className="w-full max-w-sm space-y-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <motion.span
                        key={loadingStep}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25 }}>
                        {LOADING_STEPS[loadingStep].label}
                      </motion.span>
                      <motion.span
                        key={`pct-${loadingStep}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.25 }}>
                        {LOADING_STEPS[loadingStep].pct}%
                      </motion.span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                      <motion.div
                        className="h-full rounded-full bg-primary"
                        style={{ filter: "drop-shadow(0 0 6px oklch(0.5 0.15 260 / 0.6))" }}
                        animate={{ width: `${LOADING_STEPS[loadingStep].pct}%` }}
                        transition={{ duration: 0.7, ease: easeOut }}
                      />
                    </div>
                    <div className="flex justify-between">
                      {LOADING_STEPS.map((s, i) => (
                        <div key={i} className={[
                          "h-1 w-1 rounded-full transition-colors duration-300",
                          i <= loadingStep ? "bg-primary" : "bg-white/10",
                        ].join(" ")} />
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

            </motion.div>
          )}

        </AnimatePresence>
      </main>

      <footer className="mt-auto border-t border-white/[0.05] py-5 text-center text-[11px] text-muted-foreground/40">
        Powered by AI &nbsp;·&nbsp; Built by Alae-Eddine Dahane
      </footer>
    </div>
  );
}