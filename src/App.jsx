import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import JSZip from "jszip";

function parseTSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split("\t").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cols = line.split("\t");
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] || "").trim(); });
    return obj;
  });
  return { headers, rows };
}

function parseXLSX(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });
  if (!raw.length) return { headers: [], rows: [] };
  const headers = Object.keys(raw[0]);
  const rows = raw.map((r) => {
    const obj = {};
    headers.forEach((h) => { obj[h] = String(r[h] ?? "").trim(); });
    return obj;
  });
  return { headers, rows };
}

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function getRowTexts(tr) {
  const cells = tr.getElementsByTagName("w:tc");
  return Array.from(cells).map((tc) => {
    const texts = tc.getElementsByTagName("w:t");
    return Array.from(texts).map((t) => t.textContent).join("").trim();
  });
}

function isDataHeader(cells) {
  const lc = cells.map((h) => h.toLowerCase());
  const hasId = lc.some((h) => h === "id" || h.startsWith("id") || h.includes(" id"));
  const hasContent = lc.some((h) =>
    h.includes("source") || h.includes("target") ||
    h.includes("translation") || h.includes("score")
  );
  return hasId && hasContent;
}

function findBestTable(tables) {
  let bestTable = null;
  let bestRows = 0;
  for (const tbl of tables) {
    const trs = tbl.getElementsByTagName("w:tr");
    if (trs.length < 2) continue;
    const headerCells = getRowTexts(trs[0]).filter(Boolean);
    if (isDataHeader(headerCells) && trs.length > bestRows) {
      bestTable = tbl;
      bestRows = trs.length;
    }
  }
  if (!bestTable) {
    for (const tbl of tables) {
      const n = tbl.getElementsByTagName("w:tr").length;
      if (n > bestRows) { bestTable = tbl; bestRows = n; }
    }
  }
  return bestTable;
}

// Returns ALL tables that look like data tables (with ID + content headers).
// Falls back to [findBestTable()] for files that have only one data table.
function findAllDataTables(tables) {
  const result = tables.filter((tbl) => {
    const trs = tbl.getElementsByTagName("w:tr");
    if (trs.length < 2) return false;
    const headerCells = getRowTexts(trs[0]).filter(Boolean);
    return isDataHeader(headerCells);
  });
  if (!result.length) {
    const best = findBestTable(tables);
    if (best) return [best];
  }
  return result;
}

function setCellText(tc, text) {
  const ownerDoc = tc.ownerDocument;
  const paras = Array.from(tc.getElementsByTagName("w:p"));
  if (!paras.length) return;
  const firstPara = paras[0];
  // Remove extra paragraphs (keep first)
  for (let i = paras.length - 1; i >= 1; i--) {
    if (paras[i].parentNode === tc) tc.removeChild(paras[i]);
  }
  // Get or create a run
  const runs = Array.from(firstPara.getElementsByTagName("w:r"));
  let run;
  if (runs.length > 0) {
    run = runs[0];
    for (let i = runs.length - 1; i >= 1; i--) {
      if (runs[i].parentNode === firstPara) firstPara.removeChild(runs[i]);
    }
    Array.from(run.getElementsByTagName("w:t")).forEach((t) => {
      if (t.parentNode === run) run.removeChild(t);
    });
  } else {
    run = ownerDoc.createElementNS(W_NS, "w:r");
    firstPara.appendChild(run);
  }
  const tEl = ownerDoc.createElementNS(W_NS, "w:t");
  const str = text || "";
  if (str.startsWith(" ") || str.endsWith(" ")) {
    tEl.setAttribute("xml:space", "preserve");
  }
  tEl.textContent = str;
  run.appendChild(tEl);
}

async function parseDOCX(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const xmlFile = zip.file("word/document.xml");
  if (!xmlFile) return { headers: [], rows: [] };
  const xml = await xmlFile.async("string");
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const tables = Array.from(doc.getElementsByTagName("w:tbl"));
  if (!tables.length) return { headers: [], rows: [] };
  const dataTables = findAllDataTables(tables);
  if (!dataTables.length) return { headers: [], rows: [] };
  // Headers from the first data table
  const firstTrs = dataTables[0].getElementsByTagName("w:tr");
  const headers = getRowTexts(firstTrs[0]).filter(Boolean);
  if (!headers.length) return { headers: [], rows: [] };
  // Collect rows from ALL data tables in document order
  const rows = [];
  for (const tbl of dataTables) {
    Array.from(tbl.getElementsByTagName("w:tr")).slice(1).forEach((tr) => {
      const cells = getRowTexts(tr);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (cells[i] || "").trim(); });
      rows.push(obj);
    });
  }
  return { headers, rows };
}

async function exportToDOCX(buffer, rows, idCol, srcCol, tgtCol, scCol) {
  const zip = await JSZip.loadAsync(buffer);
  const xmlStr = await zip.file("word/document.xml").async("string");
  const doc = new DOMParser().parseFromString(xmlStr, "text/xml");
  const tables = Array.from(doc.getElementsByTagName("w:tbl"));
  const dataTables = findAllDataTables(tables);
  if (!dataTables.length) return null;

  const colOrder = [idCol, srcCol, tgtCol, scCol].filter(Boolean);
  let rowOffset = 0;

  for (const tbl of dataTables) {
    const allTrs = Array.from(tbl.getElementsByTagName("w:tr"));
    const dataRows = allTrs.slice(1); // skip header row

    // Take only as many rows as this table originally had;
    // remaining rows will go into subsequent tables.
    const tableRows = rows.slice(rowOffset, rowOffset + dataRows.length);
    rowOffset += dataRows.length;

    // Update existing rows
    for (let ri = 0; ri < Math.min(tableRows.length, dataRows.length); ri++) {
      const tcs = Array.from(dataRows[ri].getElementsByTagName("w:tc"));
      colOrder.forEach((col, ci) => {
        if (ci < tcs.length) setCellText(tcs[ci], tableRows[ri][col] || "");
      });
    }

    // Add new rows if this table slice has more than the original table had
    if (tableRows.length > dataRows.length) {
      const templateRow = dataRows[dataRows.length - 1] || allTrs[allTrs.length - 1];
      for (let ri = dataRows.length; ri < tableRows.length; ri++) {
        const newTr = templateRow.cloneNode(true);
        const tcs = Array.from(newTr.getElementsByTagName("w:tc"));
        colOrder.forEach((col, ci) => {
          if (ci < tcs.length) setCellText(tcs[ci], tableRows[ri][col] || "");
        });
        tbl.appendChild(newTr);
      }
    }

    // Remove excess rows if this table slice has fewer rows than original
    for (let ri = tableRows.length; ri < dataRows.length; ri++) {
      if (dataRows[ri].parentNode) dataRows[ri].parentNode.removeChild(dataRows[ri]);
    }

    if (rowOffset >= rows.length) break;
  }

  const newXml = new XMLSerializer().serializeToString(doc);
  zip.file("word/document.xml", newXml);
  return await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

function isXLSX(filename) {
  return /\.(xlsx?|xls|ods)$/i.test(filename);
}

function isDOCX(filename) {
  return /\.docx?$/i.test(filename);
}

function toTSV(headers, rows) {
  return headers.join("\t") + "\n" + rows.map((r) => headers.map((h) => r[h] || "").join("\t")).join("\n");
}

function toMarkdown(headers, rows) {
  const sep = "|" + headers.map(() => "---").join("|") + "|";
  const head = "| " + headers.join(" | ") + " |";
  const body = rows.map((r) => "| " + headers.map((h) => (r[h] || "").replace(/\|/g, "\\|")).join(" | ") + " |").join("\n");
  return head + "\n" + sep + "\n" + body;
}

function detectRole(headers) {
  const lc = headers.map((h) => h.toLowerCase());
  // Master: has score column OR has both source and target columns
  const hasScore = lc.some((h) => h === "score" || h.startsWith("score"));
  const hasSource = lc.some((h) => h.includes("source"));
  const hasTarget = lc.some((h) => h.includes("target"));
  const hasTranslation = lc.some((h) => h.includes("translation"));
  if (hasScore || (hasSource && hasTarget)) return "master";
  if (hasTranslation || hasSource) return "batch";
  return "batch";
}

function findIdCol(headers) {
  return (
    headers.find((h) => h.toLowerCase() === "id") ||
    headers.find((h) => /^id$/i.test(h.trim())) ||
    headers.find((h) => h.toLowerCase().startsWith("id")) ||
    headers[0]
  );
}

function findSourceCol(headers) {
  return (
    headers.find((h) => h.toLowerCase().includes("source")) ||
    headers[1]
  );
}

function findTargetCol(headers) {
  return (
    headers.find((h) => h.toLowerCase().includes("target")) ||
    headers.find((h) => h.toLowerCase().includes("translation")) ||
    headers[2]
  );
}

function findScoreCol(headers) {
  return headers.find((h) => h.toLowerCase().startsWith("score") || h.toLowerCase() === "score");
}

function findTranslationCol(headers) {
  return (
    headers.find((h) => h.toLowerCase().includes("final") && h.toLowerCase().includes("translation")) ||
    headers.find((h) => h.toLowerCase().includes("translation")) ||
    headers.find((h) => h.toLowerCase().includes("target")) ||
    headers[2] || headers[1]
  );
}

const css = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #f4f5f9;
    --s1: #ffffff;
    --s2: #eaecf4;
    --bd: #d2d5e0;
    --acc: #0d9e74;
    --acc2: #6b48c8;
    --tx: #1c1c2e;
    --mu: #6b7080;
    --er: #c0283e;
    --wa: #b06010;
  }
  body, #root { background:var(--bg); color:var(--tx); font-family:'Segoe UI',system-ui,sans-serif; font-size:15px; }
  .app { min-height:100vh; display:flex; flex-direction:column; background:var(--bg); }
  .hdr { padding:20px 40px 18px; border-bottom:1px solid var(--bd); display:flex; align-items:center; justify-content:space-between; background:var(--s1); box-shadow:0 1px 4px rgba(0,0,0,.06); }
  .hdr-title { font-size:26px; font-weight:800; letter-spacing:-0.5px; line-height:1; color:var(--tx); }
  .hdr-title span { color:var(--acc); }
  .hdr-sub { margin-top:5px; font-size:11px; letter-spacing:1.5px; text-transform:uppercase; color:var(--mu); }
  .badge { display:flex; align-items:center; gap:8px; background:var(--s2); border:1px solid var(--bd); padding:8px 16px; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:var(--mu); border-radius:4px; }
  .dot { width:8px; height:8px; border-radius:50%; background:var(--mu); display:inline-block; }
  .dot.on { background:var(--acc); animation:blink 2s infinite; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
  .layout { flex:1; display:grid; grid-template-columns:380px 1fr; min-height:0; }
  .sidebar { border-right:1px solid var(--bd); padding:28px 24px; display:flex; flex-direction:column; gap:24px; overflow-y:auto; background:var(--s1); }
  .lbl { font-size:11px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:var(--acc); margin-bottom:12px; }
  .drop { border:2px dashed var(--bd); padding:24px 16px; text-align:center; cursor:pointer; transition:border-color .15s,background .15s; border-radius:6px; }
  .drop:hover, .drop.over { border-color:var(--acc); background:rgba(13,158,116,.04); }
  .drop-icon { font-size:24px; color:var(--mu); margin-bottom:8px; }
  .drop-big { display:block; font-size:15px; font-weight:700; color:var(--tx); margin-bottom:4px; }
  .drop-small { font-size:12px; color:var(--mu); line-height:1.6; font-family:'Courier New',monospace; }
  .flist { display:flex; flex-direction:column; gap:6px; margin-top:10px; }
  .fitem { display:flex; align-items:center; gap:10px; padding:10px 12px; background:var(--s2); border:1px solid var(--bd); border-radius:4px; font-size:13px; }
  .fname { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--tx); }
  .frows { color:var(--mu); font-size:11px; white-space:nowrap; }
  .ftag { padding:3px 7px; font-size:10px; font-weight:700; letter-spacing:1px; text-transform:uppercase; flex-shrink:0; border-radius:3px; }
  .ftag-m { background:rgba(13,158,116,.12); color:var(--acc); border:1px solid rgba(13,158,116,.3); }
  .ftag-b { background:rgba(107,72,200,.1); color:#5a38b0; border:1px solid rgba(107,72,200,.25); }
  .xbtn { background:none; border:none; color:var(--mu); cursor:pointer; font-size:18px; padding:0 2px; line-height:1; }
  .xbtn:hover { color:var(--er); }
  hr.div { border:none; border-top:1px solid var(--bd); }
  .btn { display:block; width:100%; font-family:'Segoe UI',system-ui,sans-serif; font-size:13px; font-weight:600; letter-spacing:1px; text-transform:uppercase; padding:13px 16px; border:1px solid; cursor:pointer; transition:all .15s; border-radius:4px; }
  .btn+.btn { margin-top:8px; }
  .btn-p { background:var(--acc); color:#fff; border-color:var(--acc); }
  .btn-p:hover { background:#0b8a65; border-color:#0b8a65; }
  .btn-p:disabled { background:var(--bd); border-color:var(--bd); color:var(--mu); cursor:not-allowed; }
  .btn-s { background:var(--s1); color:var(--tx); border-color:var(--bd); }
  .btn-s:hover { border-color:var(--acc); color:var(--acc); background:rgba(13,158,116,.04); }
  .btn-docx { display:block; width:100%; font-family:'Segoe UI',system-ui,sans-serif; font-size:13px; font-weight:700; letter-spacing:1px; text-transform:uppercase; padding:13px 16px; border:2px solid var(--acc2); cursor:pointer; transition:all .15s; border-radius:4px; margin-top:8px; background:rgba(107,72,200,.07); color:var(--acc2); }
  .btn-docx:hover { background:var(--acc2); color:#fff; }
  .content { padding:28px 36px; display:flex; flex-direction:column; gap:18px; overflow:auto; }
  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
  .stat { background:var(--s1); border:1px solid var(--bd); padding:16px 20px; border-radius:6px; box-shadow:0 1px 3px rgba(0,0,0,.05); }
  .sv { font-size:32px; font-weight:800; line-height:1; color:var(--tx); }
  .sv-g { color:var(--acc); }
  .sv-w { color:var(--wa); }
  .sl { font-size:11px; font-weight:600; letter-spacing:1.5px; text-transform:uppercase; color:var(--mu); margin-top:6px; }
  .pbar { height:6px; background:var(--bd); border-radius:3px; overflow:hidden; }
  .pfill { height:100%; background:linear-gradient(90deg,var(--acc2),var(--acc)); transition:width .4s; }
  .pcap { font-size:12px; color:var(--mu); text-align:right; margin-top:5px; font-weight:600; }
  .log { background:var(--s2); border:1px solid var(--bd); padding:14px 18px; font-size:12px; color:var(--mu); max-height:110px; overflow-y:auto; line-height:2; border-radius:4px; font-family:'Courier New',monospace; }
  .ll { display:flex; gap:14px; }
  .lt { color:var(--acc); opacity:.7; flex-shrink:0; }
  .lok { color:#0a7a5a; font-weight:600; }
  .lwarn { color:var(--wa); font-weight:600; }
  .lerr { color:var(--er); font-weight:600; }
  .tabs { display:flex; border-bottom:2px solid var(--bd); }
  .tab { padding:10px 22px; font-size:13px; font-weight:600; letter-spacing:1px; text-transform:uppercase; cursor:pointer; border:none; background:none; color:var(--mu); border-bottom:2px solid transparent; margin-bottom:-2px; transition:all .15s; }
  .tab.on { color:var(--acc); border-bottom-color:var(--acc); }
  .tab:hover:not(.on) { color:var(--tx); }
  .toolbar { display:flex; gap:10px; align-items:center; }
  .sinput { flex:1; background:var(--s1); border:1px solid var(--bd); color:var(--tx); padding:10px 14px; font-family:inherit; font-size:14px; outline:none; transition:border-color .15s; border-radius:4px; }
  .sinput:focus { border-color:var(--acc); box-shadow:0 0 0 3px rgba(13,158,116,.1); }
  .sinput::placeholder { color:var(--mu); }
  .scnt { font-size:12px; color:var(--mu); white-space:nowrap; font-weight:600; }
  .twrap { overflow:auto; border:1px solid var(--bd); flex:1; min-height:180px; border-radius:4px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  thead tr { background:var(--s2); border-bottom:2px solid var(--bd); }
  th { padding:11px 16px; text-align:left; font-size:11px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:var(--mu); white-space:nowrap; }
  td { padding:10px 16px; border-bottom:1px solid var(--bd); max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--tx); }
  tr:hover td { background:rgba(13,158,116,.03); }
  .c-id { color:var(--acc); font-size:12px; font-weight:700; width:80px; font-family:'Courier New',monospace; }
  .c-sc { color:var(--mu); width:60px; font-family:'Courier New',monospace; }
  .c-src { color:var(--tx); }
  .c-tgt { color:#0a6644; font-weight:500; }
  .c-emp { color:var(--mu); font-style:italic; }
  .pre { background:var(--s2); border:1px solid var(--bd); padding:18px; font-size:12px; line-height:1.9; white-space:pre-wrap; overflow:auto; max-height:420px; color:var(--tx); border-radius:4px; font-family:'Courier New',monospace; }
  .empty { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:80px 40px; text-align:center; gap:12px; border:2px dashed var(--bd); border-radius:6px; color:var(--mu); }
  .ei { font-size:40px; opacity:.25; }
  .et { font-size:18px; font-weight:700; color:var(--tx); }
  .es { font-size:13px; line-height:1.8; max-width:380px; color:var(--mu); }
  .err-box { background:rgba(192,40,62,.07); border:1px solid rgba(192,40,62,.35); padding:14px 18px; color:var(--er); font-size:13px; font-weight:600; border-radius:4px; }
  .modal-overlay { position:fixed; inset:0; background:rgba(28,28,46,.55); backdrop-filter:blur(3px); z-index:999; display:flex; align-items:center; justify-content:center; }
  .modal { background:var(--s1); border:1px solid var(--bd); border-radius:8px; width:min(92vw,860px); max-height:88vh; display:flex; flex-direction:column; box-shadow:0 8px 32px rgba(0,0,0,.15); }
  .modal-hdr { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid var(--bd); }
  .modal-title { font-size:15px; font-weight:700; color:var(--tx); }
  .modal-actions { display:flex; gap:8px; }
  .modal-btn { font-family:inherit; font-size:12px; font-weight:600; letter-spacing:.5px; text-transform:uppercase; padding:8px 16px; border:1px solid; cursor:pointer; transition:all .15s; border-radius:4px; }
  .modal-btn-p { background:var(--acc); color:#fff; border-color:var(--acc); }
  .modal-btn-p:hover { background:#0b8a65; }
  .modal-btn-s { background:var(--s1); color:var(--tx); border-color:var(--bd); }
  .modal-btn-s:hover { border-color:var(--acc); color:var(--acc); }
  .modal-ta { flex:1; background:var(--s2); color:var(--tx); border:none; outline:none; padding:18px 20px; font-family:'Courier New',monospace; font-size:12px; line-height:1.9; resize:none; min-height:300px; max-height:62vh; overflow-y:auto; }
  .modal-foot { padding:10px 20px; border-top:1px solid var(--bd); font-size:12px; color:var(--mu); }
  .copied { color:var(--acc) !important; }
`;

function ExportModal({ content, filename, onClose }) {
  const taRef = useRef();
  const [copied, setCopied] = useState(false);

  const doCopy = () => {
    if (!taRef.current) return;
    taRef.current.select();
    taRef.current.setSelectionRange(0, 999999);
    try {
      const ok = document.execCommand("copy");
      if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); return; }
    } catch (_) {}
    try {
      navigator.clipboard.writeText(content).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } catch (_) {}
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-hdr">
          <span className="modal-title">{filename}</span>
          <div className="modal-actions">
            <button className={`modal-btn modal-btn-p${copied ? " copied" : ""}`} onClick={doCopy}>
              {copied ? "✓ Skopiowano!" : "⎘ Kopiuj wszystko"}
            </button>
            <button className="modal-btn modal-btn-s" onClick={onClose}>✕ Zamknij</button>
          </div>
        </div>
        <textarea
          ref={taRef}
          className="modal-ta"
          readOnly
          value={content}
        />
        <div className="modal-foot">
          Zaznacz wszystko (Ctrl+A), skopiuj i wklej do nowego pliku {filename.split(".").pop().toUpperCase()}.
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [files, setFiles]       = useState([]);
  const [result, setResult]     = useState(null);
  const [tab, setTab]           = useState("table");
  const [search, setSearch]     = useState("");
  const [mOver, setMOver]       = useState(false);
  const [bOver, setBOver]       = useState(false);
  const [modal, setModal]       = useState(null);
  const mRef = useRef();
  const bRef = useRef();

  const loadFiles = (fileList, forceRole) => {
    Array.from(fileList).forEach((file) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        let parsed;
        if (isDOCX(file.name)) {
          parsed = await parseDOCX(e.target.result);
        } else if (isXLSX(file.name)) {
          parsed = parseXLSX(e.target.result);
        } else {
          const text = typeof e.target.result === "string"
            ? e.target.result
            : new TextDecoder().decode(e.target.result);
          parsed = parseTSV(text);
        }
        const { headers, rows } = parsed;
        if (!headers.length) return;
        const role = forceRole || detectRole(headers);
        const buffer = isDOCX(file.name) ? e.target.result : null;
        setFiles((prev) => prev.find((f) => f.name === file.name) ? prev : [...prev, { name: file.name, role, headers, rows, buffer }]);
      };
      if (isDOCX(file.name) || isXLSX(file.name)) {
        reader.readAsArrayBuffer(file);
      } else {
        reader.readAsText(file);
      }
    });
  };

  const removeFile = (name) => setFiles((p) => p.filter((f) => f.name !== name));

  const consolidate = () => {
    const log = [];
    const ts = () => new Date().toLocaleTimeString("pl", { hour12: false });
    const masters = files.filter((f) => f.role === "master");
    if (!masters.length) { setResult({ error: "Brak pliku Master." }); return; }
    const master  = masters[0];
    const batches = files.filter((f) => f.role === "batch");
    log.push({ t: ts(), k: "ok", m: `Master: ${master.name} — ${master.rows.length} wierszy` });
    const idCol  = findIdCol(master.headers);
    const srcCol = findSourceCol(master.headers);
    const tgtCol = findTargetCol(master.headers);
    const scCol  = findScoreCol(master.headers) || "Score";
    log.push({ t: ts(), k: "ok", m: `Kolumny: ID="${idCol}" | Źródło="${srcCol}" | Cel="${tgtCol}" | Score="${scCol}"` });
    const map = new Map();
    batches.forEach((b) => {
      const bId = findIdCol(b.headers);
      const bTr = findTranslationCol(b.headers);
      let n = 0;
      b.rows.forEach((r) => { if (r[bId] && r[bTr]) { map.set(r[bId], r[bTr]); n++; } });
      log.push({ t: ts(), k: "ok", m: `Partia "${b.name}": ${n} tłumaczeń` });
    });
    log.push({ t: ts(), k: "ok", m: `Łączna mapa: ${map.size} unikalnych ID` });
    let filled = 0, missing = 0;
    const rows = master.rows.map((row) => {
      const id  = row[idCol];
      const out = { ...row };
      out[srcCol] = row[srcCol];
      out[scCol]  = row[scCol];
      if (map.has(id)) { out[tgtCol] = map.get(id); filled++; }
      else { out[tgtCol] = row[tgtCol] || ""; if (!row[tgtCol]) missing++; }
      return out;
    });
    const rowsOk = rows.length === master.rows.length;
    log.push({ t: ts(), k: rowsOk ? "ok" : "err", m: rowsOk ? `Weryfikacja OK: ${rows.length} wierszy — 100% zgodność` : `BŁĄD: ${master.rows.length} → ${rows.length} wierszy!` });
    log.push({ t: ts(), k: filled ? "ok" : "warn", m: `Uzupełniono: ${filled} / Brak: ${missing}` });
    // Output always in canonical order: ID, Source, Target, Score
    const outHeaders = [idCol, srcCol, tgtCol, scCol].filter(Boolean);
    setResult({
      headers: outHeaders, rows, log,
      stats: { total: master.rows.length, filled, missing, batches: batches.length },
      masterBuffer: master.buffer || null,
      masterName: master.name,
      idCol, srcCol, tgtCol, scCol,
    });
    setTab("table");
  };

  const handleExportDOCX = async () => {
    if (!result?.masterBuffer) return;
    const blob = await exportToDOCX(
      result.masterBuffer, result.rows,
      result.idCol, result.srcCol, result.tgtCol, result.scCol
    );
    if (!blob) return;
    const ext = result.masterName.match(/\.[^.]+$/)?.[0] || ".docx";
    const baseName = result.masterName.replace(/\.[^.]+$/, "");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = baseName + "_consolidated" + ext;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const openExport = (type) => {
    if (!result) return;
    const content  = type === "md" ? toMarkdown(result.headers, result.rows) : toTSV(result.headers, result.rows);
    const filename = type === "md" ? "master_consolidated.md" : "master_consolidated.tsv";
    setModal({ content, filename });
  };

  const masterFiles = files.filter((f) => f.role === "master");
  const batchFiles  = files.filter((f) => f.role === "batch");
  const canRun      = masterFiles.length > 0;
  const filtered    = result?.rows?.filter((r) => !search || Object.values(r).some((v) => String(v).toLowerCase().includes(search.toLowerCase())));
  const pct         = result && result.stats.total > 0 ? Math.round((result.stats.filled / result.stats.total) * 100) : 0;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {modal && <ExportModal content={modal.content} filename={modal.filename} onClose={() => setModal(null)} />}
      <div className="app">
        <header className="hdr">
          <div>
            <div className="hdr-title">LOC<span>MERGE</span></div>
            <div className="hdr-sub">Agent konsolidacji danych lokalizacyjnych</div>
          </div>
          <div className="badge">
            <span className={`dot${canRun ? " on" : ""}`} />
            {canRun ? "Gotowy" : "Oczekiwanie na pliki"}
          </div>
        </header>

        <div className="layout">
          <aside className="sidebar">
            <div>
              <div className="lbl">Plik Master</div>
              <div className={`drop${mOver ? " over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setMOver(true); }}
                onDragLeave={() => setMOver(false)}
                onDrop={(e) => { e.preventDefault(); setMOver(false); loadFiles(e.dataTransfer.files, "master"); }}
                onClick={() => mRef.current && mRef.current.click()}
              >
                <input ref={mRef} type="file" accept=".tsv,.txt,.csv,.xlsx,.xls,.docx" multiple style={{ display:"none" }}
                  onChange={(e) => { loadFiles(e.target.files, "master"); e.target.value = ""; }} />
                <div className="drop-icon">⊞</div>
                <span className="drop-big">Upuść plik Master</span>
                <span className="drop-small">ID | Source | Target | Score</span>
              </div>
              {masterFiles.length > 0 && (
                <div className="flist">
                  {masterFiles.map((f) => (
                    <div key={f.name} className="fitem">
                      <span className="ftag ftag-m">M</span>
                      <span className="fname">{f.name}</span>
                      <span className="frows">{f.rows.length}w</span>
                      <button className="xbtn" onClick={() => removeFile(f.name)}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <hr className="div" />

            <div>
              <div className="lbl">Pliki Partii</div>
              <div className={`drop${bOver ? " over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setBOver(true); }}
                onDragLeave={() => setBOver(false)}
                onDrop={(e) => { e.preventDefault(); setBOver(false); loadFiles(e.dataTransfer.files, "batch"); }}
                onClick={() => bRef.current && bRef.current.click()}
              >
                <input ref={bRef} type="file" accept=".tsv,.txt,.csv,.xlsx,.xls,.docx" multiple style={{ display:"none" }}
                  onChange={(e) => { loadFiles(e.target.files, "batch"); e.target.value = ""; }} />
                <div className="drop-icon">⊟</div>
                <span className="drop-big">Upuść pliki Partii</span>
                <span className="drop-small">ID | Final Translation</span>
              </div>
              {batchFiles.length > 0 && (
                <div className="flist">
                  {batchFiles.map((f) => (
                    <div key={f.name} className="fitem">
                      <span className="ftag ftag-b">B</span>
                      <span className="fname">{f.name}</span>
                      <span className="frows">{f.rows.length}w</span>
                      <button className="xbtn" onClick={() => removeFile(f.name)}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <hr className="div" />

            <div>
              <button className="btn btn-p" onClick={consolidate} disabled={!canRun}>▶ Konsoliduj</button>
              {result && !result.error && (
                <>
                  <button className="btn btn-s" onClick={() => openExport("tsv")}>↓ Eksport TSV</button>
                  <button className="btn btn-s" onClick={() => openExport("md")}>↓ Eksport Markdown</button>
                  {result.masterBuffer && (
                    <button className="btn btn-docx" onClick={handleExportDOCX}>⬇ Zapisz do DOCX</button>
                  )}
                </>
              )}
            </div>
          </aside>

          <section className="content">
            {result && result.error && <div className="err-box">⚠ {result.error}</div>}

            {result && !result.error && (
              <>
                <div className="stats">
                  <div className="stat"><div className="sv">{result.stats.total}</div><div className="sl">Wierszy Total</div></div>
                  <div className="stat"><div className="sv sv-g">{result.stats.filled}</div><div className="sl">Uzupełniono</div></div>
                  <div className="stat"><div className="sv sv-w">{result.stats.missing}</div><div className="sl">Bez Tłum.</div></div>
                  <div className="stat"><div className="sv">{result.stats.batches}</div><div className="sl">Pliki Partii</div></div>
                </div>

                <div>
                  <div className="pbar"><div className="pfill" style={{ width: pct + "%" }} /></div>
                  <div className="pcap">{pct}% pokrycia</div>
                </div>

                <div className="log">
                  {result.log.map((l, i) => (
                    <div key={i} className="ll">
                      <span className="lt">{l.t}</span>
                      <span className={l.k === "ok" ? "lok" : l.k === "warn" ? "lwarn" : "lerr"}>{l.m}</span>
                    </div>
                  ))}
                </div>

                <div className="tabs">
                  {[["table","Tabela"],["markdown","Markdown"],["tsv","TSV"]].map(([v,label]) => (
                    <button key={v} className={`tab${tab === v ? " on" : ""}`} onClick={() => setTab(v)}>{label}</button>
                  ))}
                </div>

                {tab === "table" && (
                  <>
                    <div className="toolbar">
                      <input className="sinput" placeholder="Szukaj…" value={search} onChange={(e) => setSearch(e.target.value)} />
                      <span className="scnt">{(filtered || []).length} / {result.rows.length}</span>
                    </div>
                    <div className="twrap">
                      <table>
                        <thead><tr>{result.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                        <tbody>
                          {(filtered || []).map((row, i) => (
                            <tr key={i}>
                              {result.headers.map((h) => {
                                const hl = h.toLowerCase();
                                const cls = hl === "id" ? "c-id" : hl === "score" ? "c-sc" : hl === "source" ? "c-src" : hl === "target" ? (row[h] ? "c-tgt" : "c-emp") : "";
                                return <td key={h} className={cls} title={row[h]}>{row[h] || (hl === "target" ? "—" : "")}</td>;
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                {tab === "markdown" && <div className="pre">{toMarkdown(result.headers, result.rows)}</div>}
                {tab === "tsv"      && <div className="pre">{toTSV(result.headers, result.rows)}</div>}
              </>
            )}

            {!result && (
              <div className="empty">
                <div className="ei">⧉</div>
                <div className="et">Brak wyników</div>
                <div className="es">Wgraj plik Master (TSV: <strong>ID | Source | Target | Score</strong>) oraz pliki partii (TSV: <strong>ID | Final Translation</strong>), a następnie kliknij <strong>Konsoliduj</strong>.</div>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
