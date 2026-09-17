import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FileUp,
  FileText,
  ScanLine,
  Search,
  Download,
  Trash2,
  RotateCcw,
  RefreshCw,
  Eye,
  Send,
  Loader2,
  Check,
  AlertTriangle,
  FolderOpen,
  X,
  Save,
} from "lucide-react";
import {
  DOC_TYPES,
  detectDocType,
  extractFieldValues,
  COLLECTION_LABELS,
  isWorkflowDoc,
} from "./lib/import.js";
import { downloadFormPdf } from "./lib/pdf.js";

// Try NVIDIA LLM field extraction first; fall back to the regex extractor
// if the API is unavailable or fails. When `image` (base64 data URL) is given,
// the request hits the vision-capable nano-omni model which reads the doc
// straight off the image — the source of truth for tilted photo scans.
async function extractFieldsSmart(text, docLabel, fields, image) {
  const fallback = () => {
    const r = extractFieldValues(text || "", fields || []);
    return { ...r, usingFallback: true };
  };
  if ((!text && !image) || !fields || !fields.length) return fallback();
  try {
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text || "",
        docLabel: docLabel || "",
        fields,
        image: image || undefined,
      }),
    });
    if (!res.ok) return fallback();
    const data = await res.json();
    return { values: data.values || {}, confidence: data.confidence || {}, usingFallback: false };
  } catch {
    return fallback();
  }
}

const fileToDataUrl = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });

const TONE_COLORS = { inward: "#2F6FED", outward: "#7C3AED", simple: "#334155" };
const C = {
  border: "#E3E7EC",
  surface: "#F1F3F6",
  card: "#FFFFFF",
  text: "#171A21",
  muted: "#6B7280",
  faint: "#9AA1AC",
  primary: "#2F6FED",
  success: "#188A5A",
  danger: "#D23C3C",
};

const CONF_LABELS = { 3: "High", 2: "Medium", 1: "Low", 0: "Missing" };
const CONF_TONES = { 3: "#188A5A", 2: "#C2790A", 1: "#6B7280", 0: "#9AA1AC" };

let uid = 0;
const nextId = () => `imp-${++uid}`;

// Browser-side cache of a finished review so re-opening a pending item in the
// same browser restores the last extraction without calling the OCR bot again.
const reviewCacheKey = (id) => `rwms:review:${id}`;
const loadCachedReview = (id) => {
  try {
    const raw = localStorage.getItem(reviewCacheKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
const cacheReview = (id, data) => {
  try {
    localStorage.setItem(reviewCacheKey(id), JSON.stringify(data));
  } catch {}
};
const dropReviewCache = (id) => {
  try {
    localStorage.removeItem(reviewCacheKey(id));
  } catch {}
};

function timeAgo(iso) {
  if (!iso) return "";
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function Pill({ tone, children }) {
  const color = tone === "success" ? C.success : tone === "warn" ? "#C2790A" : C.faint;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase"
      style={{ background: `${color}1A`, color }}
    >
      {children}
    </span>
  );
}

function DocTypeSelect({ item, onChange }) {
  const selected = item.docKey;
  return (
    <select
      value={selected || ""}
      onChange={(e) => onChange(e.target.value)}
      style={{ borderColor: C.border, color: C.text }}
      className="w-full px-3 py-2 rounded-md border text-sm outline-none focus:ring-2 bg-white"
    >
      <option value="" disabled>
        Select document type…
      </option>
      {DOC_TYPES.map((doc) => (
        <option key={doc.key} value={doc.key}>
          {doc.label}
          {doc.flow ? ` · ${doc.flow === "inward" ? "Inward" : "Outward"} step ${(doc.stageIndex || 0) + 1}` : ""}
        </option>
      ))}
    </select>
  );
}

function SearchableLinkSelect({ options, value, onChange, accent }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const selected = options.find((o) => o.rootId === value) || null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      `${o.rootId} ${o.party} ${o.commonNumber}`.toLowerCase().includes(q),
    );
  }, [query, options]);

  const pick = (rootId) => {
    onChange(rootId);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="relative" ref={boxRef}>
      <input
        type="text"
        value={open ? query : ""}
        placeholder={
          selected
            ? `${selected.rootId} · ${selected.party}`
            : `Search by ID, party or common no. — ${options.length} available`
        }
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && filtered.length) pick(filtered[0].rootId);
          if (e.key === "Escape") setOpen(false);
        }}
        style={{ borderColor: selected ? `${accent}66` : C.border, color: C.text }}
        className="w-full px-3 py-2 pr-9 rounded-md border text-sm outline-none focus:ring-2 bg-white"
      />
      <Search
        size={14}
        className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
        style={{ color: C.faint }}
      />
      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-20 max-h-64 overflow-y-auto rounded-md border bg-white shadow-lg"
          style={{ borderColor: C.border }}
        >
          {filtered.length ? (
            filtered.map((opt) => {
              const isActive = opt.rootId === value;
              return (
                <button
                  key={opt.rootId}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(opt.rootId)}
                  className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-gray-50"
                  style={{ background: isActive ? `${accent}0D` : "transparent" }}
                >
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className="text-xs font-semibold truncate" style={{ color: C.text }}>
                      {opt.rootId} · {opt.party}
                    </span>
                    <span className="text-[11px] truncate" style={{ color: C.muted }}>
                      {opt.commonNumber} · step {opt.progressStep}/6 {opt.deepestLabel}
                    </span>
                  </span>
                  {isActive && <Check size={14} style={{ color: accent }} className="flex-shrink-0" />}
                </button>
              );
            })
          ) : (
            <p className="px-3 py-2 text-xs" style={{ color: C.faint }}>
              No matching consignment for “{query}”.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// LLM extraction is a single HTTP call, so true progress isn't available.
// Drive an animated 0-100 bar while a task key is truthy; it climbs toward
// ~92% and resets to 0 once the key becomes falsy (work finished).
function useFakeProgress(activeKey) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!activeKey) {
      setValue(0);
      return undefined;
    }
    setValue(5);
    const id = setInterval(() => {
      setValue((cur) => (cur >= 92 ? 92 : cur + Math.max(0.4, (94 - cur) * 0.055)));
    }, 250);
    return () => clearInterval(id);
  }, [activeKey]);
  return value;
}

function ProgressBar({ value }) {
  return (
    <div
      className="w-full h-2 rounded-full overflow-hidden"
      style={{ background: C.surface, border: `1px solid ${C.border}` }}
    >
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{
          width: `${Math.max(0, Math.min(100, value))}%`,
          background: "linear-gradient(90deg, #2F6FED, #7C3AED)",
        }}
      />
    </div>
  );
}

// Shared review panel used both for queued uploads and for For Approval items
// (Telegram). Everything is driven by props so both call sites look identical.
function ReviewPanel({
  fileName,
  pendingId,
  fullText,
  pages = [],
  detected,
  alternatives = [],
  docKey,
  selectedDoc,
  selectedFields = [],
  values = {},
  confidence = {},
  parentLink = "",
  showLink = false,
  linkCandidates = [],
  tone,
  extracting = false,
  aiUnavailable = false,
  reExtracting = false,
  onReExtract,
  onChangeDocType,
  onSetValue,
  onClear,
  onRemove,
  onSetParentLink,
  onDownloadPdf,
  onSave,
  onOpenForm,
  onClose,
  hideRemove = false,
}) {
  // Each mounted ReviewPanel drives its OWN animated progress while the LLM
  // extraction for THIS document is in flight, so multiple open reviews never
  // interfere with each other's progress bar.
  const progress = useFakeProgress(extracting ? (pendingId || fileName || "review") : "");
  return (
    <div className="rounded-md border overflow-hidden" style={{ borderColor: C.border, background: C.card }}>
      {extracting && (
        <div className="px-4 py-3 border-b flex flex-col gap-2" style={{ borderColor: C.border }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium flex items-center gap-2" style={{ color: C.muted }}>
              <Loader2 size={13} className="animate-spin" style={{ color: C.primary }} />
              Extracting fields…
            </span>
            <span className="text-xs font-semibold" style={{ color: C.primary }}>
              {Math.round(progress || 0)}%
            </span>
          </div>
          <ProgressBar value={progress || 0} />
        </div>
      )}

      {aiUnavailable && !extracting && !reExtracting && (
        <div
          className="px-4 py-2 flex items-center gap-2"
          style={{ background: "#FFF7ED", borderBottom: `1px solid ${C.border}` }}
        >
          <AlertTriangle size={12} style={{ color: "#C2790A" }} />
          <span className="text-[11px]" style={{ color: "#9A6700" }}>
            AI extraction unavailable — showing local rule-based values.
          </span>
        </div>
      )}

      <div className="px-4 py-3 flex items-center justify-between" style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
        <div>
          <div style={{ color: C.muted }} className="text-[10px] font-semibold uppercase tracking-wider">
            Document review · {fileName}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span style={{ background: `${tone}18`, color: tone }} className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase">
              {selectedDoc ? selectedDoc.label : "Unknown type"}
            </span>
            {detected && (
              <span style={{ color: C.muted }} className="text-[11px]">
                detected ~{detected.score} pts
              </span>
            )}
            <span style={{ color: C.faint }} className="text-[11px]">
              saves to: {selectedDoc ? (COLLECTION_LABELS[selectedDoc.collection] || selectedDoc.collection) : "—"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onReExtract && (
            <button
              onClick={onReExtract}
              disabled={reExtracting || extracting}
              style={{ color: C.primary, borderColor: C.border }}
              className="px-2.5 py-1.5 rounded-md border text-[11px] font-medium flex items-center gap-1 hover:bg-blue-50 disabled:opacity-50"
              title="Re-run NVIDIA extraction for this document"
            >
              {reExtracting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Re-extract with AI
            </button>
          )}
          <button
            onClick={onClear}
            style={{ color: C.muted, borderColor: C.border }}
            className="px-2.5 py-1.5 rounded-md border text-[11px] font-medium flex items-center gap-1 hover:bg-gray-50"
          >
            <RotateCcw size={12} /> Reset values
          </button>
          {!hideRemove && (
            <button
              onClick={onRemove}
              style={{ color: C.danger, borderColor: C.border }}
              className="px-2.5 py-1.5 rounded-md border text-[11px] font-medium flex items-center gap-1 hover:bg-red-50"
            >
              <Trash2 size={12} /> Remove
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              title="Close review"
              style={{ color: C.danger, borderColor: C.border }}
              className="px-2.5 py-1.5 rounded-md border text-[11px] font-medium flex items-center gap-1 hover:bg-red-50"
            >
              <Trash2 size={12} /> Cancel
            </button>
          )}
        </div>
      </div>

      <div className="p-4 border-b flex flex-col gap-3" style={{ borderColor: C.border }}>
        {alternatives.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {alternatives.map((alt) => {
              const isActive = docKey === alt.key;
              return (
                <button
                  key={alt.key}
                  onClick={() => onChangeDocType(alt.key)}
                  className="text-[11px] font-medium px-2 py-1 rounded-full border"
                  style={{
                    borderColor: isActive ? TONE_COLORS[alt.tone] : C.border,
                    background: isActive ? `${TONE_COLORS[alt.tone]}14` : "transparent",
                    color: isActive ? TONE_COLORS[alt.tone] : C.muted,
                  }}
                >
                  {alt.label}
                  {alt.score > 4 ? " · likely" : ""}
                </button>
              );
            })}
          </div>
        )}
        <div className="max-w-md">
          <DocTypeSelect item={{ docKey }} onChange={onChangeDocType} />
        </div>
      </div>

      {showLink && (
        <div className="p-4 border-b flex flex-col gap-2.5" style={{ borderColor: C.border }}>
          <div style={{ color: C.muted }} className="text-[10px] font-semibold uppercase tracking-wider">
            Link to transaction (step {(selectedDoc.stageIndex || 0) + 1} of the {selectedDoc.flow === "inward" ? "Inward" : "Outward"} flow)
          </div>
          {linkCandidates.length ? (
            <>
              <SearchableLinkSelect
                options={linkCandidates}
                value={parentLink}
                onChange={onSetParentLink}
                accent={tone}
              />
              <label
                onClick={() => onSetParentLink("")}
                className="inline-flex items-center gap-2 cursor-pointer select-none self-start"
              >
                <input
                  type="checkbox"
                  checked={parentLink === ""}
                  onChange={() => onSetParentLink("")}
                  className="accent-[#2F6FED]"
                />
                <span style={{ color: C.muted }} className="text-xs font-medium">
                  Standalone — no consignment link
                </span>
              </label>
            </>
          ) : (
            <p style={{ color: C.faint }} className="text-xs">
              No existing {selectedDoc.flow} consignments to link to.
            </p>
          )}
        </div>
      )}

      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h5 style={{ color: C.text }} className="text-sm font-semibold">
            {selectedDoc ? selectedDoc.label : "Select a document type"} fields
          </h5>
          <span style={{ color: C.muted }} className="text-xs">
            {selectedFields.length} field{selectedFields.length === 1 ? "" : "s"} · OCR confidence in brackets
          </span>
        </div>
        {selectedFields.length ? (
          <div className="flex flex-col gap-2">
            {selectedFields.map((field) => {
              const conf = confidence[field.key] || 0;
              const hasValue = (values[field.key] || "").trim() !== "";
              return (
                <div key={field.key} className="flex items-center gap-3">
                  <label style={{ color: C.muted }} className="w-40 sm:w-52 flex-shrink-0 text-xs font-medium truncate" title={field.label}>
                    {field.label}
                    <span className="ml-1 text-[10px] font-semibold" style={{ color: CONF_TONES[conf] || CONF_TONES[0] }}>
                      {CONF_LABELS[conf]}
                    </span>
                  </label>
                  <input
                    type={field.type === "date" ? "date" : "text"}
                    value={values[field.key] || ""}
                    placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                    onChange={(e) => onSetValue(field.key, e.target.value)}
                    style={{
                      borderColor: hasValue ? `${tone}66` : C.border,
                      color: C.text,
                    }}
                    className="flex-1 px-3 py-2 rounded-md border text-sm outline-none focus:ring-2"
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <p style={{ color: C.faint }} className="text-sm">
            No field definitions for this type yet.
          </p>
        )}

        <details className="mt-1">
          <summary style={{ color: C.primary }} className="text-xs font-medium cursor-pointer select-none">
            View raw OCR text ({pages.length} page{pages.length === 1 ? "" : "s"})
          </summary>
          <pre
            className="mt-2 rounded-md border p-3 text-[11px] leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto"
            style={{ borderColor: C.border, background: C.surface, color: C.muted, fontFamily: "ui-monospace, monospace" }}
          >
            {fullText || "No text extracted."}
          </pre>
        </details>
      </div>

      <div className="px-4 py-3 flex items-center justify-end gap-2 flex-wrap" style={{ borderTop: `1px solid ${C.border}`, background: C.surface }}>
        <button
          onClick={onDownloadPdf}
          style={{ color: C.muted, borderColor: C.border }}
          className="px-3 py-2 rounded-md border text-xs font-medium flex items-center gap-1.5 hover:bg-gray-50"
        >
          <Download size={13} /> Download PDF
        </button>
        <button
          onClick={onSave}
          style={{ color: C.primary, borderColor: C.primary }}
          className="px-3 py-2 rounded-md border text-xs font-semibold flex items-center gap-1.5 hover:opacity-80"
        >
          <Save size={13} /> Save record
        </button>
        <button
          onClick={onOpenForm}
          style={{ background: tone }}
          className="px-3.5 py-2 rounded-md text-xs font-semibold text-white flex items-center gap-1.5 hover:opacity-90"
        >
          <FolderOpen size={13} /> Open {selectedDoc ? selectedDoc.label : "form"}
        </button>
      </div>
    </div>
  );
}

export default function ImportPage({ fieldsByLabel = {}, linkOptions = {}, onOpenForm, onSaveDirect, onCachePdf }) {
  const [items, setItems] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [pendingItems, setPendingItems] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [reviews, setReviews] = useState([]);
  const inputRef = useRef(null);

  const fetchPending = async () => {
    try {
      const res = await fetch("/api/imports?status=unapproved");
      if (!res.ok) return;
      setPendingItems(await res.json());
    } catch {}
  };

  useEffect(() => { fetchPending(); }, []);
  useEffect(() => {
    const id = setInterval(fetchPending, 5000);
    return () => clearInterval(id);
  }, []);

  const openPendingReview = (p) => {
    if (reviews.some((r) => r.pendingId === p.id)) return; // already open
    const ranks = detectDocType(p.fullText || "");
    // Re-open fast from the per-document browser draft; the FIRST open always
    // runs the NVIDIA bot (visible progress) even when Java already back-filled
    // values. Drafts are keyed by document id so reviews never mix.
    const draft = loadCachedReview(p.id);
    const backfilled =
      p.docKey &&
      DOC_TYPES.some((d) => d.key === p.docKey) &&
      p.values &&
      Object.keys(p.values).length
        ? { docKey: p.docKey, values: p.values, confidence: p.confidence || {} }
        : null;
    const primed = draft || backfilled;
    const detectedDoc =
      (primed && DOC_TYPES.find((d) => d.key === primed.docKey)) ||
      (primed && DOC_TYPES.find((d) => d.label === primed.docLabel)) ||
      ranks[0] ||
      null;
    const docKey = detectedDoc ? detectedDoc.key : "";
    const fields = fieldsByLabel[detectedDoc?.label] || [];
    const extracting = !draft; // draft = user already reviewed → no bot call
    const editStamp = 0;
    setReviews((prev) => [
      ...prev,
      {
        pendingId: p.id,
        fileName: p.fileName,
        fullText: (draft && draft.fullText) || p.fullText || "",
        pages: p.pages || [],
        detected: detectedDoc,
        alternatives: ranks.slice(0, 4),
        docKey,
        docLabel: detectedDoc?.label || "",
        fields,
        values: { ...(primed ? primed.values : {}) },
        confidence: primed?.confidence || {},
        parentLink: (draft && draft.parentLink) || defaultLinkFor(detectedDoc),
        extracting,
        image: null,
        mime: p.mime || "",
        aiUnavailable: false,
        reExtracting: false,
        editStamp,
      },
    ]);
    if (!extracting) return;
    // Run the LLM without blocking the UI — the progress bar in the
    // ReviewPanel shows once it is done. For photos, first pull the stored
    // document image and let the vision model read it directly (OCR text on a
    // tilted photo often grabs keyboard/desktop noise instead).
    (async () => {
      const stamp = editStamp;
      const opening = {
        docKey,
        docLabel: detectedDoc?.label || "",
        fullText: (draft && draft.fullText) || p.fullText || "",
        parentLink: (draft && draft.parentLink) || defaultLinkFor(detectedDoc),
      };
      let image = null;
      if (p.mime && p.mime.startsWith("image/")) {
        try {
          const res = await fetch(`/api/imports/${p.id}/image`);
          if (res.ok) {
            const data = await res.json();
            image = data.image || null;
          }
        } catch {}
      }
      const ex = await extractFieldsSmart(opening.fullText, opening.docLabel, fields, image);
      // Persist the result even if the review was cancelled mid-extraction, so a
      // re-open restores these values instead of re-running the bot. Only skip
      // the write when the user edited values while the bot was still running.
      setReviews((prev) => {
        const open = prev.some((r) => r.pendingId === p.id);
        let match = false;
        const next = prev.map((r) => {
          if (r.pendingId !== p.id) return r;
          match = r.editStamp === stamp;
          if (!match) return r.extracting ? { ...r, extracting: false } : r;
          return {
            ...r,
            values: { ...(ex.values || {}) },
            confidence: ex.confidence || {},
            extracting: false,
            aiUnavailable: !!ex.usingFallback,
            image,
          };
        });
        if (match || !open) {
          cacheReview(p.id, {
            docKey: opening.docKey,
            docLabel: opening.docLabel,
            values: { ...(ex.values || {}) },
            confidence: ex.confidence || {},
            fullText: opening.fullText,
            parentLink: opening.parentLink,
          });
        }
        return next;
      });
    })();
  };

  const rerunExtract = async (id) => {
    const target = reviews.find((r) => r.pendingId === id);
    if (!target || target.reExtracting) return;
    const stamp = target.editStamp;
    patchReview(id, { reExtracting: true });
    let image = target.image;
    if (!image && target.mime && target.mime.startsWith("image/")) {
      try {
        const res = await fetch(`/api/imports/${id}/image`);
        if (res.ok) {
          const data = await res.json();
          image = data.image || null;
        }
      } catch {}
    }
    const ex = await extractFieldsSmart(
      target.fullText || "",
      target.detected?.label,
      target.fields || [],
      image,
    );
    setReviews((prev) => {
      let updated = null;
      const next = prev.map((r) => {
        if (r.pendingId !== id) return r;
        if (r.editStamp === stamp) {
          updated = {
            ...r,
            values: { ...(ex.values || {}) },
            confidence: ex.confidence || {},
            aiUnavailable: !!ex.usingFallback,
            reExtracting: false,
            image: image || r.image,
          };
          return updated;
        }
        return r.reExtracting ? { ...r, reExtracting: false } : r;
      });
      if (updated) {
        cacheReview(id, {
          docKey: updated.docKey,
          docLabel: updated.docLabel,
          values: updated.values,
          confidence: updated.confidence || {},
          fullText: updated.fullText,
          parentLink: updated.parentLink,
        });
      }
      return next;
    });
  };

  const patchReview = (id, updater) =>
    setReviews((prev) => {
      let updated = null;
      const next = prev.map((r) => {
        if (r.pendingId !== id) return r;
        const merged = typeof updater === "function" ? updater(r) : { ...r, ...updater };
        if (merged.values) {
          updated = merged;
        }
        return merged;
      });
      if (updated)
        cacheReview(id, {
          docKey: updated.docKey,
          docLabel: updated.docLabel,
          values: updated.values,
          confidence: updated.confidence || {},
          fullText: updated.fullText,
          parentLink: updated.parentLink,
        });
      return next;
    });

  const cancelReview = (id) => setReviews((prev) => prev.filter((r) => r.pendingId !== id));

  const saveReview = (id) => {
    const target = reviews.find((r) => r.pendingId === id);
    if (!target) return;
    const tDoc = DOC_TYPES.find((d) => d.key === target.docKey);
    if (!tDoc) return;
    const tShowLink = isWorkflowDoc(tDoc) && (tDoc.stageIndex || 0) > 0;
    const tLinkCandidates = tShowLink ? (linkOptions[tDoc.flow] || []) : [];
    const link = tLinkCandidates.some((o) => o.rootId === target.parentLink)
      ? target.parentLink
      : "";
    onSaveDirect(tDoc, target.values, link);
    if (target.pendingId) {
      dropReviewCache(target.pendingId);
      fetch(`/api/imports/${target.pendingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      }).catch(() => {});
    }
    setPendingItems((prev) => prev.filter((p) => p.id !== target.pendingId));
    cancelReview(id);
  };

  const changeReviewDocType = (key, id) => {
    const doc = DOC_TYPES.find((d) => d.key === key);
    const target = reviews.find((r) => r.pendingId === id);
    if (!doc || !target) return;
    const newFields = fieldsByLabel[doc.label] || [];
    const extraction = extractFieldValues(target.fullText || "", newFields);
    const values = { ...extraction.values };
    // Preserve any manual edits for fields that still exist in the new type.
    newFields.forEach((f) => {
      if (
        target.values[f.key] !== undefined &&
        target.values[f.key] !== null &&
        target.values[f.key] !== ""
      ) {
        values[f.key] = target.values[f.key];
      }
    });
    patchReview(id, {
      docKey: key,
      docLabel: doc.label,
      fields: newFields,
      values,
      confidence: extraction.confidence,
      parentLink: defaultLinkFor(doc),
      extracting: !!target.image,
      editStamp: target.editStamp + 1,
    });
    // A photo's OCR text is unreliable; when a document image is stored,
    // re-run extraction against the vision model so changing the doc type
    // triggers a proper re-scan instead of re-reading garble.
    if (target.image) {
      const stamp = target.editStamp + 1;
      extractFieldsSmart(target.fullText || "", doc.label, newFields, target.image).then((ex) => {
        setReviews((prev) => {
          let updated = null;
          const next = prev.map((r) => {
            if (r.pendingId !== id || r.docKey !== key) return r;
            if (r.editStamp === stamp) {
              updated = {
                ...r,
                values: { ...(ex.values || {}) },
                confidence: ex.confidence || {},
                extracting: false,
              };
              return updated;
            }
            return r.extracting ? { ...r, extracting: false } : r;
          });
          if (updated) {
            cacheReview(id, {
              docKey: updated.docKey,
              docLabel: updated.docLabel,
              values: updated.values,
              confidence: updated.confidence || {},
              fullText: updated.fullText,
              parentLink: updated.parentLink,
            });
          }
          return next;
        });
      });
    }
  };

  const clearReview = (id) => {
    const target = reviews.find((r) => r.pendingId === id);
    if (!target) return;
    const extraction = extractFieldValues(target.fullText || "", target.fields || []);
    patchReview(id, (r) => ({
      ...r,
      editStamp: r.editStamp + 1,
      values: { ...extraction.values },
      confidence: extraction.confidence,
    }));
  };

  const setReviewValue = (key, value, id) =>
    patchReview(id, (r) => ({ ...r, editStamp: r.editStamp + 1, values: { ...r.values, [key]: value } }));

  const setReviewParentLink = (value, id) => patchReview(id, { parentLink: value });

  const rejectPending = async (id) => {
    dropReviewCache(id);
    fetch(`/api/imports/${id}`, { method: "DELETE" }).catch(() => {});
    setPendingItems((prev) => prev.filter((p) => p.id !== id));
    setReviews((prev) => prev.filter((r) => r.pendingId !== id));
  };

  const patch = (id, partial) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...partial } : it)));

  // First-step documents never link; mid-flow documents default to the first
  // available consignment so they attach to its transaction tree on save
  // instead of silently becoming a standalone record with a fresh CN number.
  const defaultLinkFor = (doc) => {
    if (!doc || !isWorkflowDoc(doc) || (doc.stageIndex || 0) <= 0) return "";
    const opts = linkOptions[doc.flow] || [];
    return opts.length ? opts[0].rootId : "";
  };

  const ocrFile = async (file, itemId) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/import/ocr", { method: "POST", body: form });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Server responded ${res.status}`);
    }
    const payload = await res.json();
    const ranks = detectDocType(payload.fullText || "");
    const fields = fieldsByLabel[ranks[0]?.label] || [];
    const extraction = extractFieldValues(payload.fullText || "", fields);
    patch(itemId, {
      status: "done",
      pages: payload.pages || [],
      fullText: payload.fullText || "",
      detected: ranks[0],
      alternatives: ranks.slice(0, 4),
      docKey: ranks[0]?.key,
      fields,
      values: { ...(extraction.values || {}) },
      confidence: extraction.confidence || {},
      parentLink: defaultLinkFor(ranks[0] || null),
      visionPending: file.type.startsWith("image/"),
    });
    if (file.type.startsWith("image/")) {
      try {
        const image = await fileToDataUrl(file);
        const visionEx = await extractFieldsSmart(
          payload.fullText || "", ranks[0]?.label, fields, image,
        );
        patch(itemId, {
          values: { ...(visionEx.values || {}) },
          confidence: visionEx.confidence || {},
          visionPending: false,
        });
      } catch {
        patch(itemId, { visionPending: false });
      }
    }
  };

  const enqueueFiles = (fileList) => {
    const incoming = Array.from(fileList || []).filter((f) =>
      ["application/pdf", "image/png", "image/jpeg"].includes(f.type),
    );
    if (!incoming.length) return;
    const newItems = incoming.map((file) => ({
      id: nextId(),
      fileName: file.name,
      file,
      status: "queued",
      message: "",
      pages: [],
      fullText: "",
      detected: undefined,
      alternatives: [],
      docKey: "",
      fields: [],
      values: {},
      confidence: {},
      parentLink: "",
    }));
    setItems((prev) => [...newItems, ...prev]);
    setExpandedId(newItems[0].id);
    incoming.forEach((file, i) => {
      const itemId = newItems[i].id;
      (async () => {
        patch(itemId, { status: "ocr", message: "Sending to OCR service…" });
        try {
          await ocrFile(file, itemId);
        } catch (err) {
          patch(itemId, { status: "error", message: err.message || "OCR failed" });
        }
      })();
    });
  };

  const changeDocType = async (itemId, key) => {
    const item = items.find((it) => it.id === itemId);
    const doc = DOC_TYPES.find((d) => d.key === key);
    if (!item || !doc) return;
    const fields = fieldsByLabel[doc.label] || [];
    const extraction = extractFieldValues(item.fullText || "", fields);
    const values = { ...extraction.values };
    // Preserve any manual edits for fields that still exist in the new type.
    fields.forEach((f) => {
      if (item.values[f.key] !== undefined && item.values[f.key] !== null && item.values[f.key] !== "") {
        values[f.key] = item.values[f.key];
      }
    });
    patch(itemId, { docKey: key, fields, values, confidence: extraction.confidence, parentLink: defaultLinkFor(doc) });
    // Photo uploads: OCR text can be desktop/keyboard noise, so a doc-type
    // change re-scans the original image through the vision model.
    if (item.file && item.file.type.startsWith("image/")) {
      patch(itemId, { status: "ocr", message: "Re-scanning with vision model…" });
      const image = await fileToDataUrl(item.file);
      const ex = await extractFieldsSmart(item.fullText || "", doc.label, fields, image);
      patch(itemId, {
        status: "done",
        message: "",
        values: { ...(ex.values || {}) },
        confidence: ex.confidence || {},
      });
    }
  };

  const setValue = (itemId, key, value) => {
    const item = items.find((it) => it.id === itemId);
    if (!item) return;
    patch(itemId, { values: { ...item.values, [key]: value } });
  };

  const remove = (id) => setItems((prev) => prev.filter((it) => it.id !== id));

  // After a document is saved, drop it from the queue and fall back to the
  // upload screen instead of re-displaying the stale review.
  const consume = (id) => {
    const remaining = items.filter((it) => it.id !== id);
    setItems(remaining);
    setExpandedId(remaining.length ? remaining[0].id : null);
  };

  const clear = (id) => {
    const item = items.find((it) => it.id === id);
    if (!item) return;
    const extraction = extractFieldValues(item.fullText || "", item.fields || []);
    patch(id, { values: { ...extraction.values }, confidence: extraction.confidence });
  };

  const active = items.find((it) => it.id === expandedId) || items[0] || null;

  const summary = useMemo(() => {
    const counts = DOC_TYPES.reduce((acc, d) => {
      acc[d.key] = { label: d.label, count: 0 };
      return acc;
    }, {});
    items.filter((it) => it.docKey).forEach((it) => {
      if (counts[it.docKey]) counts[it.docKey].count += 1;
    });
    return counts;
  }, [items]);

  const selectedDoc = active ? DOC_TYPES.find((d) => d.key === active.docKey) : null;
  const selectedFields = selectedDoc ? fieldsByLabel[selectedDoc.label] || [] : [];
  const tone = selectedDoc ? TONE_COLORS[selectedDoc.tone] : "#334155";
  // Mid-flow workflow documents (step 2+) can be attached to an existing
  // consignment so the saved record lands inside its transaction tree.
  const showLink =
    selectedDoc && isWorkflowDoc(selectedDoc) && (selectedDoc.stageIndex || 0) > 0;
  const linkCandidates = showLink ? (linkOptions[selectedDoc.flow] || []) : [];
  const setParentLink = (value) => patch(active.id, { parentLink: value });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 style={{ color: C.text }} className="text-lg sm:text-xl font-semibold">
            <ScanLine size={20} className="inline mr-1.5 mb-0.5" style={{ color: C.primary }} />
            Import from PDF / Scan
          </h2>
          <p style={{ color: C.muted }} className="text-xs sm:text-sm mt-1 max-w-2xl">
            Upload a scanned document or PDF. The OCR service reads the text,
            detects the document type, and pre-fills the matching form — review,
            then open the form or save straight to records.
          </p>
        </div>
      </div>

      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          enqueueFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current && inputRef.current.click()}
        className="rounded-lg border-2 border-dashed px-5 py-10 flex flex-col items-center justify-center text-center cursor-pointer transition-colors"
        style={{ borderColor: dragging ? C.primary : C.border, background: dragging ? "#EEF4FF" : C.card }}
      >
        <FileUp size={34} style={{ color: C.primary }} />
        <p style={{ color: C.text }} className="text-sm font-semibold mt-3">
          Drop scanned PDFs here, or click to browse
        </p>
        <p style={{ color: C.faint }} className="text-xs mt-1">
          PDF, PNG or JPEG · multiple files supported
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          multiple
          className="hidden"
          onChange={(e) => {
            enqueueFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* For Approval — Telegram / WhatsApp / external queue */}
      {(pendingItems.length > 0 || reviews.length > 0) && (
        <div className="rounded-md border overflow-hidden" style={{ borderColor: C.border, background: C.card }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ background: "#FFF8ED", borderBottom: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ background: "#C2790A" }}
              />
              <span style={{ color: "#8B5E1A" }} className="text-sm font-semibold">
                For Approval ({pendingItems.some((p) => p.source === "telegram") ? "Telegram" : "WhatsApp"})
              </span>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: "#C2790A1A", color: "#C2790A" }}
              >
                {pendingItems.filter((p) => !reviews.some((r) => r.pendingId === p.id)).length}
              </span>
            </div>
            <button
              onClick={fetchPending}
              style={{ color: "#8B5E1A", borderColor: "#E5D5B0" }}
              className="px-2 py-1 rounded border text-[11px] font-medium flex items-center gap-1 hover:bg-orange-50"
            >
              <RefreshCw size={11} /> Refresh
            </button>
          </div>
          <div className="flex flex-col gap-0">
            {pendingItems
              .filter((pi) => !reviews.some((r) => r.pendingId === pi.id))
              .map((pi) => {
                const detected = detectDocType(pi.fullText || "");
                const doc = detected.length ? DOC_TYPES.find((d) => d.key === detected[0].key) : null;
                return (
                  <div
                    key={pi.id}
                    className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0"
                    style={{ borderColor: C.border }}
                  >
                    <FileText size={15} style={{ color: doc ? TONE_COLORS[doc.tone] : C.faint }} />
                    <span className="text-xs font-medium truncate flex-1 min-w-0" style={{ color: C.text }}>
                      {pi.fileName}
                    </span>
                    {pi.sender && (
                      <span style={{ color: C.muted }} className="text-[11px] truncate max-w-[120px]">
                        {pi.sender}
                      </span>
                    )}
                    {pi.group && (
                      <span style={{ color: C.faint }} className="text-[11px] truncate max-w-[120px] hidden sm:inline">
                        {pi.group}
                      </span>
                    )}
                    {doc && (
                      <span
                        className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0"
                        style={{ background: `${TONE_COLORS[doc.tone]}1A`, color: TONE_COLORS[doc.tone] }}
                      >
                        {doc.label}
                      </span>
                    )}
                    <Pill tone="warn">Unapproved</Pill>
                    <span style={{ color: C.faint }} className="text-[10px] flex-shrink-0 whitespace-nowrap">
                      {timeAgo(pi.receivedAt)}
                    </span>
                    <button
                      onClick={() => openPendingReview(pi)}
                      style={{ color: C.primary, borderColor: C.border }}
                      className="px-2 py-1 rounded border text-[11px] font-medium flex items-center gap-1 hover:bg-gray-50 flex-shrink-0"
                    >
                      <Eye size={12} /> Review
                    </button>
                    <button
                      onClick={() => rejectPending(pi.id)}
                      style={{ color: C.danger, borderColor: C.border }}
                      className="px-2 py-1 rounded border flex items-center gap-1 hover:bg-red-50 flex-shrink-0"
                      title="Reject"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}

            {reviews.map((r) => {
              const rDoc = DOC_TYPES.find((d) => d.key === r.docKey) || null;
              const rFields = rDoc ? fieldsByLabel[rDoc.label] || [] : [];
              const rTone = rDoc ? TONE_COLORS[rDoc.tone] : "#334155";
              const rShowLink =
                rDoc && isWorkflowDoc(rDoc) && (rDoc.stageIndex || 0) > 0;
              const rLinkCandidates = rShowLink ? (linkOptions[rDoc.flow] || []) : [];
              return (
                <ReviewPanel
                  key={r.pendingId}
                  pendingId={r.pendingId}
                  fileName={r.fileName}
                  fullText={r.fullText}
                  pages={r.pages || []}
                  detected={r.detected}
                  alternatives={r.alternatives || []}
                  docKey={r.docKey}
                  selectedDoc={rDoc}
                  selectedFields={rFields}
                  values={r.values}
                  confidence={r.confidence}
                  parentLink={r.parentLink}
                  showLink={rShowLink}
                  linkCandidates={rLinkCandidates}
                  tone={rTone}
                  extracting={r.extracting}
                  aiUnavailable={r.aiUnavailable}
                  reExtracting={r.reExtracting}
                  onReExtract={() => rerunExtract(r.pendingId)}
                  onChangeDocType={(key) => changeReviewDocType(key, r.pendingId)}
                  onSetValue={(key, value) => setReviewValue(key, value, r.pendingId)}
                  onClear={() => clearReview(r.pendingId)}
                  onRemove={() => cancelReview(r.pendingId)}
                  hideRemove
                  onClose={() => cancelReview(r.pendingId)}
                  onSetParentLink={(value) => setReviewParentLink(value, r.pendingId)}
                  onDownloadPdf={() =>
                    rDoc &&
                    downloadFormPdf({
                      title: rDoc.label,
                      tone: rTone,
                      docId: r.values[rFields[0]?.key] || "IMPORT",
                      fields: rFields,
                      values: r.values,
                      meta: { Source: r.fileName, Status: "Imported" },
                      onGenerated: (blob, args) => onCachePdf && onCachePdf(blob, args),
                    })
                  }
                  onSave={() => saveReview(r.pendingId)}
                  onOpenForm={() => {
                    if (!rDoc) return;
                    onOpenForm(rDoc, r.values, r.parentLink || "");
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="flex flex-col gap-4">
          {/* Import queue */}
          <div className="flex flex-col gap-2">
            {items.map((item) => {
              const doc = DOC_TYPES.find((d) => d.key === item.docKey);
              return (
                <div
                  key={item.id}
                  className="rounded-md border flex items-center gap-3 px-3 py-2.5"
                  style={{
                    borderColor: expandedId === item.id ? tone : C.border,
                    background: C.card,
                  }}
                >
                  {item.status === "queued" && <Pill tone="">Queued</Pill>}
                  {item.status === "ocr" && (
                    <Loader2 size={15} className="animate-spin" style={{ color: C.primary }} />
                  )}
                  {item.status === "done" && <Check size={15} style={{ color: C.success }} />}
                  {item.status === "error" && (
                    <AlertTriangle size={15} style={{ color: C.danger }} />
                  )}
                  <FileText size={15} style={{ color: item.status === "error" ? C.danger : doc ? TONE_COLORS[doc.tone] : C.faint }} />
                  <span className="text-xs font-medium truncate flex-1" style={{ color: C.text }}>
                    {item.fileName}
                  </span>
                  {item.status === "ocr" && (
                    <span style={{ color: C.muted }} className="text-[11px]">
                      {item.message || "Reading document…"}
                    </span>
                  )}
                  {item.status === "done" && item.visionPending && (
                    <Loader2 size={12} className="animate-spin" style={{ color: C.primary }} />
                  )}
                  {item.status === "done" && doc && (
                    <>
                      <span
                        className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                        style={{
                          background: `${TONE_COLORS[doc.tone]}1A`,
                          color: TONE_COLORS[doc.tone],
                        }}
                      >
                        {doc.label}
                      </span>
                      <button
                        onClick={() => setExpandedId(item.id)}
                        style={{ color: C.primary, borderColor: C.border }}
                        className="px-2 py-1 rounded border text-[11px] font-medium flex items-center gap-1 hover:bg-gray-50"
                      >
                        <Eye size={12} /> Review
                      </button>
                    </>
                  )}
                  {item.status === "error" && (
                    <span style={{ color: C.danger }} className="text-[11px]">
                      {item.message}
                    </span>
                  )}
                  <button
                    onClick={() => remove(item.id)}
                    style={{ color: C.faint }}
                    className="p-1 rounded hover:bg-gray-100"
                    title="Remove"
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Review panel for the active import */}
          {active && active.status === "done" && (
            <ReviewPanel
              fileName={active.fileName}
              fullText={active.fullText}
              pages={active.pages || []}
              detected={active.detected}
              alternatives={active.alternatives || []}
              docKey={active.docKey}
              selectedDoc={selectedDoc}
              selectedFields={selectedFields}
              values={active.values}
              confidence={active.confidence}
              parentLink={active.parentLink}
              showLink={showLink}
              linkCandidates={linkCandidates}
              tone={tone}
              onChangeDocType={(key) => changeDocType(active.id, key)}
              onSetValue={(key, value) => setValue(active.id, key, value)}
              onClear={() => clear(active.id)}
              onRemove={() => remove(active.id)}
              onSetParentLink={setParentLink}
              onDownloadPdf={() =>
                selectedDoc &&
                downloadFormPdf({
                  title: selectedDoc.label,
                  tone,
                  docId: active.values[selectedFields[0]?.key] || "IMPORT",
                  fields: selectedFields,
                  values: active.values,
                  meta: { Source: active.fileName, Status: "Imported" },
                  onGenerated: (blob, args) => onCachePdf && onCachePdf(blob, args),
                })
              }
              onSave={() => {
                if (!selectedDoc) return;
                const link = linkCandidates.some(
                  (o) => o.rootId === active.parentLink,
                )
                  ? active.parentLink
                  : "";
                onSaveDirect(selectedDoc, active.values, link);
                if (active.sourcePendingId) {
                  fetch(`/api/imports/${active.sourcePendingId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: "approved" }),
                  }).catch(() => {});
                }
                consume(active.id);
              }}
              onOpenForm={() => {
                if (!selectedDoc) return;
                onOpenForm(selectedDoc, active.values, active.parentLink || "");
              }}
            />
          )}

          {/* Imported doc-type summary */}
          <div className="flex flex-wrap gap-1.5">
            {Object.values(summary)
              .filter((s) => s.count > 0)
              .map((s) => (
                <span key={s.label} className="text-[11px] px-2 py-1 rounded-full" style={{ background: `${C.primary}14`, color: C.primary }}>
                  {s.label} × {s.count}
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}